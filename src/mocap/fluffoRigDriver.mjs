import {createSmoothness} from './fluffoSmoothness.mjs';

// Mapping for the four-digit Fluffo paw. Normalized VRM joints use the rest
// skeleton's world axes, not Blender's local bone Y axis.
const sides=['left','right'];
const digits=['Thumb','Index','Middle','Ring'];
const clamp=(x,min,max)=>Math.min(max,Math.max(min,x));
const squash=x=>clamp(((x||0)-0.035)/0.965,0,1);
const direct=('browOuterUpLeft browOuterUpRight cheekPuff cheekSquintLeft cheekSquintRight eyeSquintLeft eyeSquintRight '+
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

export function facialTargets(scores={},heldWink=null) {
    const target={surprised:squash(scores.browInnerUp)};
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
        target['eyeWide'+suffix]*=1-squash(scores['eyeBlink'+suffix]);
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
    if (!digits.every(name=>get(name+(name==='Thumb'?'Metacarpal':'Proximal')) &&
        get(name+(name==='Thumb'?'Proximal':'Intermediate')))) return [];
    const finger=(name,part)=>world(get(name+part));
    const across=finger('Ring','Proximal').sub(finger('Index','Proximal'));
    const along=finger('Middle','Intermediate').sub(finger('Middle','Proximal'));
    const normal=across.cross(along).normalize();
    if ((side==='left' && normal.x>0)||(side==='right'&&normal.x<0)) normal.negate();
    return digits.map((name,index)=>{
        const base=get(name+(index===0?'Metacarpal':'Proximal'));
        const tip=get(name+(index===0?'Proximal':'Intermediate'));
        const axis=world(tip).sub(world(base)).normalize().cross(index===0?
            finger('Middle','Proximal').sub(world(base)).normalize():normal).normalize();
        return [base,tip].map((joint,i)=>({
            joint,axis:axis.clone().applyQuaternion(joint.getWorldQuaternion(joint.quaternion.clone()).invert()),
            limit:index===0?[0.60,0.83][i]:[0.91,1.12][i]
        }));
    });
}

export function createRigDriver(vrm, tuning=createSmoothness()) {
    const joints=vrm.humanoid, expressions=vrm.expressionManager;
    const fingerSets=Object.fromEntries(sides.map(side=>[side,fingerBindings(vrm,side)]));
    const faceState={},restGap={};
    const eyeClosure={blinkLeft:0,blinkRight:0};
    const eyeSamples={};
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
                delete eyeSamples.Left; delete eyeSamples.Right;
            }
            lastStamp=data.frame;arrival=now;
        }
        const stale=data && now-arrival>180;
        if(stale)data=null;
        const stamp=data?.faceStamp ?? data?.frame;
        if(data?.scores && Number.isFinite(stamp) && (lastFaceStamp===null || stamp>lastFaceStamp)){
            lastFaceStamp=stamp;
            observedAt=arrival-Math.max(data.faceAgeMs||0,1000*(data.frame-stamp),0);
            for(const side of ['Left','Right']){
                const raw=data.scores['eyeBlink'+side];
                if(Number.isFinite(raw))eyeSamples[side]={value:squash(raw),until:observedAt+(heldWink?145:95)};
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
            measured[side]=clamp((sample && now<sample.until ? sample.value : fallback)*values.blinkGain,0,1);
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
        const targets=facialTargets(scores||{},heldWink);
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
        const common=Math.min(eyeClosure.blinkLeft,eyeClosure.blinkRight);
        for(const key of ['blink','blinkLeft','blinkRight']){
            if(supported.has(key))expressions.setValue(key,key==='blink' ? common : eyeClosure[key]-common);
            delete targets[key];
        }
        if(scores || hadFace || values.emotion!=='auto'){
            for(const [name,value] of Object.entries(targets)){
                if(!supported.has(name))continue;
                const target=name.toLowerCase().includes('look') ? clamp(value*values.gazeGain,0,1) : value;
                const weight=/^(mouth|jaw)/.test(name)?follow(factors.mouth):expressionK;
                faceState[name]=(faceState[name]||0)+(target-(faceState[name]||0))*weight;
                expressions.setValue(name,faceState[name]);
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
            expressions.setValue(key,clamp(vowels[key]*values.jawGain,0,1));
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
                const value=.105+((tracked?.curls[i][j] ?? .105)-.105)*strength;
                const q=joint.quaternion.clone().setFromAxisAngle(axis,limit*value);
                joint.quaternion.slerp(q,handK);
            }));
            const s=heldWink===suffix ? {} : scores||{};
            const yaw=sign*(squash(s['eyeLookOut'+suffix])-squash(s['eyeLookIn'+suffix]));
            const pitch=squash(s['eyeLookDown'+suffix])-squash(s['eyeLookUp'+suffix]);
            turn(side+'Eye',pitch*.26*values.gazeGain,yaw*.30*values.gazeGain,0,expressionK);
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
