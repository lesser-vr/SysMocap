import {createSmoothness,defaults} from './fluffoSmoothness.mjs';

// Normalized VRM finger joints use the rest
// skeleton's world axes, not Blender's local bone Y axis.
const sides=['left','right'];
const digits=['Thumb','Index','Middle','Ring','Little'];
const clamp=(x,min,max)=>Math.min(max,Math.max(min,x));
const squash=x=>clamp(((x||0)-0.035)/0.965,0,1);
const eyeShapes=['eyeLookIn','eyeLookOut','eyeLookUp','eyeLookDown','eyeWide','eyeSquint'];
const gazeAxes=[['eyeLookIn','eyeLookOut'],['eyeLookUp','eyeLookDown']];

// Hold the last target inside the observed static-frame noise band. A large
// change or full opening/closure passes on the first observation.
function steadyEye(value,previous,band){
    if(previous===undefined || value===0 || value===1)return value;
    const delta=value-previous, distance=Math.abs(delta);
    if(distance<=band)return previous;
    const margin=clamp((3*band-distance)/2,0,band);
    return value-Math.sign(delta)*margin;
}

// An open eye on the still fixture regularly scores as partially closed.
// Use the configured resting lid pose there. Join the existing analog curve
// smoothly before half closure so full blinks and winks keep their timing.
function openEyeClosure(value){
    const t=clamp((value-.30)/.19,0,1);
    return value*t*t*(3-2*t);
}
const direct=('cheekPuff cheekSquintLeft cheekSquintRight eyeSquintLeft eyeSquintRight '+
    'eyeWideLeft eyeWideRight jawForward jawLeft jawRight mouthClose mouthDimpleLeft mouthDimpleRight mouthFunnel '+
    'mouthLeft mouthLowerDownLeft mouthLowerDownRight mouthPressLeft mouthPressRight mouthPucker mouthRight mouthRollLower '+
    'mouthRollUpper mouthShrugLower mouthShrugUpper mouthStretchLeft mouthStretchRight mouthUpperUpLeft mouthUpperUpRight '+
    'noseSneerLeft noseSneerRight').split(' ');
const pairs=[
    ['blink','eyeBlinkLeft','eyeBlinkRight','blinkLeft','blinkRight'],
    ['happy','mouthSmileLeft','mouthSmileRight'],['sad','mouthFrownLeft','mouthFrownRight'],
    ['angry','browDownLeft','browDownRight'],
    ['lookLeft','eyeLookOutLeft','eyeLookInRight'],['lookRight','eyeLookInLeft','eyeLookOutRight'],
    ['lookUp','eyeLookUpLeft','eyeLookUpRight'],['lookDown','eyeLookDownLeft','eyeLookDownRight']
];

// Use the neutral pose for small upward-brow scores. Ease out of the resting
// range so crossing its boundary does not suddenly lift the brow during speech.
function browLift(score,rest){
    const lift=clamp(((score||0)-rest)/(1-rest),0,1);
    return lift*(.5+.5*lift);
}

export function facialTargets(scores={},heldWink=null,browRest=defaults.browRest,closure=null) {
    const target={
        surprised:browLift(scores.browInnerUp,browRest),
        browOuterUpLeft:browLift(scores.browOuterUpLeft,browRest),
        browOuterUpRight:browLift(scores.browOuterUpRight,browRest)
    };
    for (const key of direct) target[key]=squash(scores[key]);
    for (const [shared,left,right,leftKey=left,rightKey=right] of pairs) {
        const gaze=shared.startsWith('look');
        const l=gaze && heldWink==='Left' ? 0 : squash(scores[left]);
        const r=gaze && heldWink==='Right' ? 0 : squash(scores[right]);
        const common=Math.min(l,r);
        target[shared]=common;
        target[leftKey]=l-common; target[rightKey]=r-common;
    }
    for(const suffix of ['Left','Right']){
        target['eyeWide'+suffix]*=1-(closure?.[suffix]??squash(scores['eyeBlink'+suffix]));
    }
    if(heldWink){
        target['eyeWide'+heldWink]=0;
        target['eyeSquint'+heldWink]=0;
    }
    return target;
}

function fingerBindings(vrm,side) {
    const get=name=>vrm.humanoid.getNormalizedBoneNode(side+name);
    const world=b=>b.getWorldPosition(b.position.clone());
    const pairs=digits.map((name,i)=>[get(name+(i?'Proximal':'Metacarpal')),get(name+(i?'Intermediate':'Proximal'))]);
    const fingers=pairs.slice(1).filter(([base,tip])=>base && tip);
    if(fingers.length<2)return [];
    const middle=pairs[2].every(Boolean)?pairs[2]:fingers[0];
    const outer=pairs[3][0] || fingers.at(-1)[0];
    const across=world(outer).sub(world(fingers[0][0]));
    const along=world(middle[1]).sub(world(middle[0]));
    const normal=across.cross(along).normalize();
    if ((side==='left' && normal.x>0)||(side==='right'&&normal.x<0)) normal.negate();
    return pairs.map(([base,tip],index)=>{
        if(!base || !tip)return [];
        const axis=world(tip).sub(world(base)).normalize().cross(index===0?
            world(middle[0]).sub(world(base)).normalize():normal).normalize();
        return [base,tip].map((joint,i)=>({
            joint,axis:axis.clone().applyQuaternion(joint.getWorldQuaternion(joint.quaternion.clone()).invert()),
            limit:index===0?[0.60,0.83][i]:[0.91,1.12][i]
        }));
    });
}

export function createRigDriver(vrm, tuning=createSmoothness(), eyeFit) {
    const joints=vrm.humanoid, expressions=vrm.expressionManager;
    const fingerSets=Object.fromEntries(sides.map(side=>[side,fingerBindings(vrm,side)]));
    const faceState={},restGap={};
    const eyeClosure={blinkLeft:0,blinkRight:0};
    const eyeSamples={};
    const confirmedBlink={Left:false,Right:false};
    let eyeScores={}, eyeAverages={}, eyeSignals={}, blinkTargets={};
    let heldWink=null;
    const vowels={aa:0,ih:0,ee:0,oh:0,ou:0};
    let lastFaceStamp=null, observedAt=-Infinity, jawTarget=0;
    const handMemory={};
    const supported=new Set(expressions.expressions.map(e=>e.expressionName));
    let previous=0,lastStamp=null,arrival=0,hadFace=false;
    function turn(name,x,y,z,k) {
        const joint=joints.getNormalizedBoneNode(name);
        if(!joint) return;
        const q=joint.quaternion.clone().setFromEuler(joint.rotation.clone().set(x,y,z,'XYZ'));
        joint.quaternion.slerp(q,k);
    }
    return function apply(data,now=performance.now(),closeup=true,hands=null,exits={},fallbackMouth=null,fallbackEye=null){
        const dt=clamp((now-previous)/1000,0.001,0.08);
        const {values,factors}=tuning;
        const follow=factor=>1-Math.exp(-dt/(.065*factor));
        const bodyK=follow(factors.body), handK=follow(factors.hand), expressionK=follow(factors.expression);
        previous=now;
        if(data && data.frame!==lastStamp){
            if(lastStamp!==null && (data.frame<lastStamp || data.frame-lastStamp>.5)){
                delete handMemory.left;delete handMemory.right;
                lastFaceStamp=null; observedAt=-Infinity; jawTarget=0;
                heldWink=null;
                confirmedBlink.Left=confirmedBlink.Right=false;
                eyeScores={}; eyeAverages={}; blinkTargets={};
                delete eyeSamples.Left; delete eyeSamples.Right;
            }
            lastStamp=data.frame;arrival=now;
        }
        const stale=data && now-arrival>180;
        if(stale)data=null;
        const stamp=data?.faceStamp ?? data?.frame;
        if(data?.scores && Number.isFinite(stamp) && (lastFaceStamp===null || stamp>lastFaceStamp)){
            if(now-observedAt>=160){eyeScores={};eyeAverages={};}
            const quietWeight=lastFaceStamp===null ? 1 : 1-Math.exp(-(stamp-lastFaceStamp)/.15);
            lastFaceStamp=stamp;
            observedAt=arrival-Math.max(data.faceAgeMs||0,1000*(data.frame-stamp),0);
            for(const side of ['Left','Right']){
                for(const shape of eyeShapes){
                    const key=shape+side;
                    const raw=data.scores[key]||0, previous=eyeScores[key]??raw;
                    const squint=shape==='eyeSquint';
                    // Only average new camera observations in the resting
                    // range. Large changes, including glances, pass immediately.
                    const quiet=Math.abs(raw-previous)<(squint ? .20 : .085);
                    const average=eyeAverages[key]??raw;
                    const sample=quiet ? average+(raw-average)*quietWeight : raw;
                    eyeScores[key]=steadyEye(sample,previous,squint ? .085 : .05);
                    eyeAverages[key]=sample;
                }
                const raw=data.scores['eyeBlink'+side];
                if(Number.isFinite(raw))eyeSamples[side]={value:squash(raw),until:observedAt+(heldWink?145:95)};
            }
            // Opposing gaze channels often activate together while looking
            // straight ahead. Only their difference describes eye rotation.
            eyeSignals={...eyeScores};
            for(const side of ['Left','Right']){
                for(const [positive,negative] of gazeAxes){
                    const a=positive+side,b=negative+side,net=eyeScores[a]-eyeScores[b];
                    eyeSignals[a]=Math.max(0,net);
                    eyeSignals[b]=Math.max(0,-net);
                }
            }
        }
        const faceAge=now-observedAt;
        const scores=faceAge<160 && stamp===lastFaceStamp ? data?.scores : null;
        // Use one set of blink weights, including when switching to Holistic.
        // Kalidokit reports eye openness, while the VRM expects eye closure.
        const measured={};
        for(const side of ['Left','Right']){
            const sample=eyeSamples[side];
            // Kalidokit calls landmarks 263/362 "r"; MediaPipe calls that eye Left.
            const openness=fallbackEye?.[side==='Left'?'r':'l'];
            const fallback=!stale && Number.isFinite(openness) ? clamp(1-openness,0,1) : 0;
            const raw=sample && now<sample.until ? sample.value : fallback;
            blinkTargets[side]=steadyEye(openEyeClosure(raw),blinkTargets[side],.045);
            // In hold-open mode each lid stays at its configured rest until a
            // clear blink. Hysteresis keeps a sustained wink from fluttering.
            confirmedBlink[side]=values.holdOpenEyes &&
                blinkTargets[side]>=(confirmedBlink[side] ? .46 : .77);
            const closure=values.holdOpenEyes ? Number(confirmedBlink[side]) : blinkTargets[side];
            measured[side]=clamp(closure*values.blinkGain,0,1);
        }
        // Keep a clearly established wink closed through fluctuations. Reopen on
        // the first convincing open measurement; partial closures stay analog.
        if(heldWink && measured[heldWink]<.46)heldWink=null;
        if(!heldWink){
            for(const side of ['Left','Right']){
                const other=side==='Left'?'Right':'Left';
                if(measured[side]>=.77 && measured[other]<.35)heldWink=side;
            }
        }
        const eyes=faceAge<160 ? eyeSignals : {};
        const targets=facialTargets({...scores,...eyes},heldWink,values.browRest,blinkTargets);
        if(values.holdOpenEyes){
            targets.eyeWideLeft=targets.eyeWideRight=0;
            targets.eyeSquintLeft=targets.eyeSquintRight=0;
        }
        if(values.emotion!=='auto'){
            for(const key of Object.keys(targets)){
                if(!key.startsWith('blink'))targets[key]=key===values.emotion ? 1 : 0;
            }
        }
        for(const side of ['Left','Right']){
            const key='blink'+side;
            const desired=heldWink===side ? 1 : measured[side];
            const tau=desired>eyeClosure[key] ? .018 : .040;
            eyeClosure[key]+=(desired-eyeClosure[key])*(1-Math.exp(-dt/(tau*factors.blink)));
        }
        const common=supported.has('blink') ? Math.min(eyeClosure.blinkLeft,eyeClosure.blinkRight) : 0;
        for(const key of ['blink','blinkLeft','blinkRight']){
            if(supported.has(key))expressions.setValue(key,key==='blink' ? common : eyeClosure[key]-common);
            delete targets[key];
        }
        if(eyeFit || scores || hadFace || values.emotion!=='auto'){
            for(const [name,value] of Object.entries(targets)){
                if(!supported.has(name))continue;
                let target=value;
                if(name.toLowerCase().includes('look')){
                    const axis=/up|down/i.test(name)?eyeFit?.vertical:eyeFit?.horizontal;
                    target=clamp(value*values.gazeGain*(axis??1),0,1);
                }
                if(eyeFit && name.startsWith('eyeWide')){
                    const smile=values.holdOpenEyes?0:eyeFit.smileSquint*targets.happy;
                    const lift=eyeFit.opening*(1-smile)*values.eyeRestOpen/100;
                    target+=lift*(1-target);
                }else if(eyeFit && name.startsWith('eyeSquint') && !values.holdOpenEyes){
                    target+=eyeFit.smileSquint*targets.happy*(1-target);
                }
                const weight=/^(mouth|jaw)/.test(name)?follow(factors.mouth):expressionK;
                faceState[name]=(faceState[name]||0)+(target-(faceState[name]||0))*weight;
                const lid=eyeFit && /^(eyeWide|eyeSquint)/.test(name);
                const closure=lid?eyeClosure[name.endsWith('Left')?'blinkLeft':'blinkRight']:0;
                expressions.setValue(name,faceState[name]*(1-closure));
            }
            hadFace=true;
        }
        // A single writer owns the five mouth shapes (including lower teeth).
        // Keep short face-score gaps from switching between two different mouth estimates.
        let mouth=null;
        if(Number.isFinite(scores?.jawOpen)){
            const opening=clamp((scores.jawOpen-.025)*1.6*(1-.5*squash(scores.mouthClose)),0,1);
            const residual=opening-jawTarget;
            if(Math.abs(residual)>.017)jawTarget=opening-Math.sign(residual)*.017;
            const round=squash(scores.mouthPucker), funnel=squash(scores.mouthFunnel);
            const spread=Math.max(squash(scores.mouthStretchLeft),squash(scores.mouthStretchRight));
            mouth={aa:jawTarget,oh:jawTarget*funnel,ou:round*.55,
                ee:spread*.55,ih:spread*(1-jawTarget)*.35};
        }else if(faceAge>=160){
            const f=stale ? null : fallbackMouth;
            mouth={aa:squash(f?.A),ih:squash(f?.I),ee:squash(f?.E),oh:squash(f?.O),ou:squash(f?.U)};
        }
        for(const key of Object.keys(vowels)){
            if(mouth){
                const residual=mouth[key]-vowels[key];
                const tau=Math.abs(residual)>.07 ? .035 : .075;
                vowels[key]+=residual*(1-Math.exp(-dt/(tau*factors.mouth)));
            }
            if(supported.has(key))expressions.setValue(key,clamp(vowels[key]*values.jawGain,0,1));
        }
        for(const side of sides){
            const suffix=side==='left'?'Left':'Right',sign=side==='left'?1:-1;
            const stamp=data?.handStamp?.[side] ?? data?.frame;
            if(data?.[side] && (!handMemory[side] || stamp>handMemory[side].stamp)){
                handMemory[side]={stamp,curls:data[side],time:arrival-1000*Math.max(0,data.frame-stamp)};
            }
            const tracked=handMemory[side];
            // Brief occlusion: finish the observed gesture. Longer absence: ease to rest.
            const age=tracked ? now-tracked.time : Infinity;
            const releasing=closeup && Number.isFinite(exits[side]);
            const t=clamp((now-exits[side]-70)/340,0,1);
            const strength=releasing ? 1-t*t*(3-2*t) : 1-clamp((age-values.holdMs)/210,0,1);
            if(!closeup) {
                const w=hands?.[side]?.wristRotation;
                turn(side+'Hand',clamp(-(w?.x||0)*.6,-.65,.65),clamp((w?.y||0)*.55,-.75,.75),
                    clamp(-(w?.z||0)*.4,-.5,.5),handK);
            }
            fingerSets[side].forEach((segments,i)=>segments.forEach(({joint,axis,limit},j)=>{
                let curl=tracked?.curls[i]?.[j] ?? .105;
                if(i===3 && !fingerSets[side][4]?.length && tracked?.curls[4])curl=.55*curl+.45*tracked.curls[4][j];
                const value=.105+(curl-.105)*strength;
                const q=joint.quaternion.clone().setFromAxisAngle(axis,limit*value);
                joint.quaternion.slerp(q,handK);
            }));
            const s=heldWink===suffix ? {} : eyes;
            const yaw=sign*(squash(s['eyeLookOut'+suffix])-squash(s['eyeLookIn'+suffix]));
            const pitch=squash(s['eyeLookDown'+suffix])-squash(s['eyeLookUp'+suffix]);
            const visibleEye=eyeFit?1-eyeClosure['blink'+suffix]:1;
            turn(side+'Eye',visibleEye*((eyeFit?.down??0)+pitch*.26*values.gazeGain*(eyeFit?.vertical??1)),
                visibleEye*(-sign*(eyeFit?.inward??0)+yaw*.30*values.gazeGain*(eyeFit?.horizontal??1)),0,expressionK);
            const gap=data?.limbs?.[side+'ShoulderGap'];
            let lift=0;
            if(Number.isFinite(gap)){
                restGap[side]??=gap;
                lift=clamp((restGap[side]-gap)*1.15,-.14,.29);
            }
            turn(side+'Shoulder',0,0,sign*lift,bodyK);
            const foot=data?.limbs?.[side+'Foot'];
            const angle=clamp(foot?.pitch||0,-.65,.85);
            turn(side+'Foot',-.82*angle,clamp(foot?.yaw||0,-.65,.65),0,bodyK);
            turn(side+'Toes',-.18*Math.max(0,angle),0,0,bodyK);
        }
    };
}
