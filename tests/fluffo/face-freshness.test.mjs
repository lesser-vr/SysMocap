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

test('an already late result is ignored and seeking allows earlier fresh timestamps',()=>{
    const tick=rig(),scores={jawOpen:1};
    assert.equal(tick(2000,{frame:2,faceStamp:1.98,faceAgeMs:220,scores}).aa,0);
    assert.ok(tick(2020,{frame:.5,faceStamp:.5,faceAgeMs:5,scores}).aa>.3);
});
