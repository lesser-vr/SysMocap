import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRigDriver,facialTargets} from '../../src/mocap/fluffoRigDriver.mjs';
import {createSmoothness} from '../../src/mocap/fluffoSmoothness.mjs';
import {Object3D} from 'three';

function rig(tuning) {
    const output={};
    const drive=createRigDriver({
        humanoid:{getNormalizedBoneNode:()=>null},
        expressionManager:{
            expressions:['aa','blink','blinkLeft','blinkRight','eyeWideLeft','eyeSquintLeft','surprised'].map(expressionName=>({expressionName})),
            setValue:(key,value)=>{output[key]=value;}
        }
    },tuning);
    return (now,packet,eye={l:1,r:1})=>{
        drive(packet,now,true,null,{}, {A:0},eye);
        return {...output};
    };
}

test('optional open lids reject uncertain closures but register a wink and a short bilateral blink',()=>{
    const tuning=createSmoothness(),tick=rig(tuning);
    let ms=1000;
    const pose=(l,r)=>{
        ms+=40;
        return tick(ms,{frame:ms/1000,scores:{eyeBlinkLeft:l,eyeBlinkRight:r,eyeWideLeft:.55,eyeSquintLeft:.48}});
    };
    assert.equal(tuning.values.holdOpenEyes,false);
    assert.ok(pose(.6,.5).blink>.2);
    tuning.set({...tuning.values,holdOpenEyes:true});
    let v;
    for(let i=0;i<30;i++)v=pose(i%2?.65:.35,i%2?.50:.25);
    for(const k of ['blink','blinkLeft','blinkRight','eyeWideLeft','eyeSquintLeft'])assert.ok(v[k]<.001);
    v=pose(.95,.25);assert.ok(v.blinkLeft>.85 && v.blink<.001);
    v=pose(.65,.28);assert.ok(v.blinkLeft>.98 && v.blinkRight<.001);
    v=pose(1,1);assert.ok(v.blink>.85);
    for(let i=0;i<10;i++)v=pose(.25,.28);
    assert.ok(v.blink+v.blinkLeft+v.blinkRight<.001);
    tuning.set({...tuning.values,holdOpenEyes:false});
    v=pose(.62,.62);
    assert.ok(v.blink>.45 && v.eyeSquintLeft>.1 && v.eyeWideLeft>.05);
});

test('resting upward brows agree with neutral while deliberate and asymmetric lifts survive',()=>{
    assert.equal(createSmoothness().values.browRest,.70);
    const rest=facialTargets({browInnerUp:.70,browOuterUpLeft:.69,browOuterUpRight:.35});
    assert.deepEqual([rest.surprised,rest.browOuterUpLeft,rest.browOuterUpRight],[0,0,0]);
    const lift=facialTargets({browInnerUp:1,browOuterUpLeft:.8,browOuterUpRight:.12});
    assert.equal(lift.surprised,1);
    assert.ok(lift.browOuterUpLeft>0 && lift.browOuterUpLeft<1 && lift.browOuterUpRight===0);
    const scores={browInnerUp:.35,browDownLeft:.42,eyeWideRight:.33,mouthPucker:.3};
    const a=facialTargets(scores,null,.18),b=facialTargets(scores);
    assert.ok(a.surprised>0 && b.surprised===0);
    for(const key of ['browDownLeft','eyeWideRight','mouthPucker'])assert.equal(a[key],b[key]);
    const tick=rig(createSmoothness({emotion:'surprised',browRest:.7}));
    assert.ok(tick(1000,{frame:1,scores:{browInnerUp:0}}).surprised>.6);
});

for(const [channel,shape] of Object.entries({mouth:'aa',blink:'blink',expression:'surprised'})){
    test(channel+' smoothing changes its own step response independently',()=>{
        function step(amount){
            const tick=rig(createSmoothness({[channel]:amount}));
            tick(1000,{frame:1,scores:{jawOpen:0,eyeBlinkLeft:0,eyeBlinkRight:0,browInnerUp:0}});
            return tick(1020,{frame:1.02,scores:{jawOpen:1,eyeBlinkLeft:1,eyeBlinkRight:1,browInnerUp:1}});
        }
        const fast=step(.1),middle=step(.5),slow=step(.9);
        assert.ok(fast[shape]>middle[shape] && middle[shape]>slow[shape]);
        for(const other of ['aa','blink','surprised'].filter(s=>s!==shape))assert.equal(fast[other],slow[other]);
    });
}

test('extra hand smoothing changes the wrist independently of the global body response',()=>{
    function pose(body,hand){
        const foot=new Object3D(),wrist=new Object3D();
        const bones={leftFoot:foot,leftHand:wrist};
        const drive=createRigDriver({
            humanoid:{getNormalizedBoneNode:name=>bones[name]},
            expressionManager:{expressions:[],setValue(){}}
        },createSmoothness({body,hand}));
        drive({frame:1},1000,false);
        drive({frame:1.02,limbs:{leftFoot:{pitch:.6}}},1020,false,{left:{wristRotation:{x:.6}}});
        return [Math.abs(foot.rotation.x),Math.abs(wrist.rotation.x)];
    }
    const [foot,wrist]=pose(.5,.5),[slowFoot,slowWrist]=pose(.9,.5),[sameFoot,slowerWrist]=pose(.5,.9);
    assert.ok(foot>slowFoot && wrist>slowWrist);
    assert.ok(foot===sameFoot && wrist>slowerWrist);
});

test('repeating a cached jaw observation cannot extend its fallback deadline',()=>{
    const tick=rig(), scores={jawOpen:.8};
    let value;
    for(let now=1000;now<=1350;now+=10){
        value=tick(now,{frame:now/1000,faceStamp:1,scores});
        if(now===1140)assert.ok(value.aa>.90);
    }
    assert.ok(value.aa<.04);
    assert.ok(tick(1360,{frame:1.36,faceStamp:1.36,scores}).aa>.2);
});

test('a brief blink registers, hands off to one-sided fallback and reopens after loss',()=>{
    const tick=rig(), scores={eyeBlinkLeft:1,eyeBlinkRight:1};
    tick(1000,{frame:1,faceStamp:1,scores:{eyeBlinkLeft:0,eyeBlinkRight:0}});
    let value;
    for(let now=1010;now<=1060;now+=10)value=tick(now,{frame:now/1000,faceStamp:1.01,scores});
    assert.ok(value.blink>.90);
    for(let now=1070;now<=1250;now+=10){
        value=tick(now,{frame:now/1000,faceStamp:1.01,scores},{l:1,r:0});
        assert.ok(value.blink+value.blinkLeft<=1.00001);
    }
    assert.ok(value.blink<.04 && value.blinkLeft>.95 && value.blinkRight<.01);
    for(let now=1260;now<=1520;now+=10)value=tick(now,{frame:now/1000,scores:null},null);
    assert.ok(value.blink+value.blinkLeft<.01);
});

for(const side of ['Left','Right']){
    test('held '+side+' wink survives score noise and tracker handoff',()=>{
        const tick=rig(),other=side==='Left'?'Right':'Left';
        const fallback=side==='Left'?{l:1,r:0}:{l:0,r:1};
        const closure=(v,s)=>v.blink+v['blink'+s];
        let v, stamp=1, scores;
        for(let ms=0;ms<=780;ms+=10){
            // Separate render ticks, new camera observations, and a real score gap.
            if(ms%40===0 && (ms<280 || ms>=560)){
                stamp=1+ms/1000;
                scores={['eyeBlink'+side]:ms<120?.93:[.59,.81,.70][(ms/40)%3],
                    ['eyeBlink'+other]:.05,eyeWideLeft:.35,eyeSquintLeft:.4};
            }
            v=tick(1000+ms,{frame:1+ms/1000,faceStamp:stamp,scores:ms>=280 && ms<560?null:scores},fallback);
            if(ms>=150){
                assert.ok(closure(v,side)>.98,'held eyelid sagged at '+ms);
                assert.ok(closure(v,other)<.08,'opposite eyelid closed at '+ms);
            }
        }
        if(side==='Left')assert.ok(v.eyeWideLeft<.01 && v.eyeSquintLeft<.01);
        for(let ms=790;ms<=910;ms+=10){
            const t=1+ms/1000;
            v=tick(1000+ms,{frame:t,faceStamp:t,scores:{eyeBlinkLeft:.02,eyeBlinkRight:.02}});
        }
        assert.ok(closure(v,side)<.05);
    });
}

test('partial closure remains graded and the opposite eye can blink during a wink',()=>{
    const tick=rig();
    function at(ms,l,r){return tick(ms,{frame:ms/1000,scores:{eyeBlinkLeft:l,eyeBlinkRight:r}});}
    let v;
    for(let ms=1000;ms<=1200;ms+=10)v=at(ms,.50,.08);
    assert.ok(v.blink+v.blinkLeft>.4 && v.blink+v.blinkLeft<.6);
    for(let ms=1210;ms<=1330;ms+=10)v=at(ms,.91,.04);
    for(let ms=1340;ms<=1420;ms+=10)v=at(ms,.66,.97);
    assert.ok(v.blink>.90 && v.blink+v.blinkLeft>.98);
});

test('noisy gaze cannot move the held eyelid or suppress gaze on the open side',()=>{
    const scores={eyeLookOutLeft:.95,eyeLookInRight:.8};
    const moving=facialTargets(scores), wink=facialTargets(scores,'Left');
    assert.equal(wink.lookLeft+wink.eyeLookOutLeft,0);
    assert.equal(wink.lookLeft+wink.eyeLookInRight,moving.lookLeft+moving.eyeLookInRight);
});

test('resting eye noise holds still while a small deliberate glance and a one-frame blink respond',()=>{
    const eye=new Object3D(),output={};
    const drive=createRigDriver({
        humanoid:{getNormalizedBoneNode:k=>k==='leftEye'?eye:null},
        expressionManager:{expressions:['blink','blinkLeft','eyeLookOutLeft','eyeSquintLeft'].map(expressionName=>({expressionName})),
            setValue:(k,v)=>output[k]=v}
    });
    function tick(ms,noise=0,shift=0,blink=.18){
        const scores={eyeBlinkLeft:blink+noise,eyeSquintLeft:.38+noise,eyeLookOutLeft:.16+noise+shift};
        drive({frame:ms/1000,scores},ms);
        return [output.blink+output.blinkLeft,output.eyeSquintLeft,output.eyeLookOutLeft,eye.rotation.y];
    }
    for(let ms=1000;ms<2200;ms+=20)tick(ms);
    const still=tick(2200);
    for(let ms=2220;ms<=2600;ms+=20){
        const v=tick(ms,(ms%40===0?1:-1)*.028);
        v.forEach((n,i)=>assert.ok(Math.abs(n-still[i])<.00001));
    }
    const glance=tick(2620,0,.09);
    assert.ok(glance[2]>still[2]+.01 && glance[3]>still[3]);
    const blink=tick(2640,0,0,1);
    assert.ok(blink[0]>.65 && tick(2660,0,0,0)[0]<blink[0]);
});

test('an already late result is ignored and seeking allows earlier fresh timestamps',()=>{
    const tick=rig(),scores={jawOpen:1};
    assert.equal(tick(2000,{frame:2,faceStamp:1.98,faceAgeMs:220,scores}).aa,0);
    assert.ok(tick(2020,{frame:.5,faceStamp:.5,faceAgeMs:5,scores}).aa>.3);
});

test('open eyes hold their resting pose through asymmetric blink and squint noise',()=>{
    const tick=rig();
    const squint=[.31,.46,.36,.43];
    let rest;
    for(let i=0;i<100;i++){
        const ms=1000+i*40;
        const v=tick(ms,{frame:ms/1000,scores:{
            eyeBlinkLeft:[.11,.19][i%2],eyeBlinkRight:[.22,.305][i%2],
            eyeSquintLeft:i<16 ? .385 : squint[i%4]
        }});
        assert.equal(v.blink+v.blinkLeft+v.blinkRight,0);
        if(i===30)rest=v.eyeSquintLeft;
        if(i>30)assert.ok(Math.abs(v.eyeSquintLeft-rest)<.001);
    }
    const deliberate=tick(5000,{frame:5,scores:{eyeSquintLeft:.8,eyeBlinkLeft:.50,eyeBlinkRight:.15}});
    assert.ok(deliberate.eyeSquintLeft>rest+.1 && deliberate.blinkLeft>.35);
});
