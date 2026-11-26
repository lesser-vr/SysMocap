import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Bone, Group} from 'three';
import {armVisibility,trackingDriver} from '../../src/mocap/humanoidTracking.mjs';
import {createSmoothness} from '../../src/mocap/fluffoSmoothness.mjs';

function fixture(options={},keys=['blinkLeft','blinkRight','aa','ih']) {
    const weights={},morphs=[0,0],scene=new Group(),bones={};
    const add=(key,parent,x,y)=>{const b=new Bone();parent.add(b);b.position.set(x,y,0);bones[key]=b;return b;};
    const hips=add('Hips',scene,0,.9);
    for(const [side,sign] of [['Right',-1],['Left',1]]){
        const arm=add(side+'UpperArm',hips,sign*.2,.4);
        const fore=add(side+'LowerArm',arm,sign*.3,0);
        add(side+'Hand',fore,sign*.25,0);
    }
    scene.morphTargetDictionary={Fcl_BRW_Surprised:0,Fcl_EYE_Surprised:1};
    scene.morphTargetInfluences=morphs;
    const manager={getExpression:k=>keys.includes(k)?{_binds:[1]}:null,
        setValue:(k,v)=>{weights[k]=v;},getValue:k=>weights[k]||0};
    const rig=trackingDriver({expressionManager:manager,scene},key=>bones[key],createSmoothness(options));
    const face=(t,l,r,a=0,brow=0)=>{rig.begin({sourceTime:t,riggedFace:{eye:{l,r},mouth:{shape:{A:a,I:1-a}},brow}});rig.finishFace();};
    return {rig,weights,bones,morphs,face};
}

test('quiet open eyes, a single-frame wink and a one-frame vowel accent survive filtering',()=>{
    const {face,weights}=fixture({holdOpenEyes:true});
    for(let i=0;i<15;i++)face(i/30,.84+(i%2)*.09,.96);
    assert.equal(weights.blinkLeft,0);
    face(.5,0,1,.8);assert.ok(weights.blinkLeft>.85 && weights.blinkRight===0 && weights.aa>.8);
    face(.533,.4,1,0);assert.ok(weights.blinkLeft>.85 && weights.aa<.5);
    for(let i=17;i<26;i++)face(i/30,1,1);
    assert.ok(weights.blinkLeft<.005);
});
test('shared blink only closes both eyes together, rest and isolated brow follow the selected model',()=>{
    const {face,weights,morphs}=fixture({standardEyeOpen:70,standardBrowRest:.6},['blink','aa']);
    for(let i=0;i<30;i++)face(i/30,0,1,0,.3);
    assert.ok(Math.abs(weights.blink-.3)<.001);assert.equal(morphs[0],0);
    face(1,0,0,0,1);assert.ok(weights.blink>.9 && morphs[0]>.5);
    const wide=fixture({standardEyeOpen:130});wide.face(0,1,1);assert.ok(Math.abs(wide.morphs[1]-.3)<.001);
});
test('smoothing follows elapsed source time at 30 and 60 fps, replaying a packet is inert',()=>{
    function response(fps){const x=fixture({mouth:.85});x.face(0,1,1);for(let i=1;i<=fps/10;i++)x.face(i/fps,1,1,1);
        const a=x.weights.aa;x.face(.1,0,0,0);assert.equal(x.weights.aa,a);return a;}
    assert.ok(Math.abs(response(30)-response(60))<1e-6);
    const fast=fixture({mouth:0,blink:0,body:0,hand:0}),slow=fixture({mouth:1,blink:1,body:1,hand:1});
    for(const x of [fast,slow]){x.face(0,1,1);x.face(.033,0,1,1);}
    assert.ok(fast.weights.aa>slow.weights.aa && fast.weights.blinkLeft>slow.weights.blinkLeft);
    assert.ok(fast.rig.weight('LeftIndexProximal',.3)>slow.rig.weight('LeftIndexProximal',.3));
});
test('a missing palm with a visible wrist keeps tracking; a sustained exit eases the arm toward its own lowered pose',()=>{
    const p=Array(33);p[13]={x:.2,y:.5,visibility:.9};p[15]={x:.25,y:.6,visibility:.9};
    const visible=armVisibility({poseLandmarks:p});
    assert.deepEqual(visible.Right,{upper:true,lower:true});
    const {rig,bones}=fixture({holdMs:150,returnMs:450});
    const arm=bones.RightUpperArm;
    arm.rotation.z=-.4;const raised=arm.quaternion.clone();
    const frame=(sourceTime,armVisibility)=>rig.begin({sourceTime,armVisibility});
    frame(0,visible);assert.ok(rig.canRotate('RightUpperArm'));
    const missing=armVisibility({});frame(.03,missing);frame(.15,missing);
    assert.ok(raised.angleTo(arm.quaternion)<1e-6);
    frame(.32,missing);const midway=arm.quaternion.clone();assert.ok(raised.angleTo(midway)>.05);
    frame(.64,missing);assert.ok(midway.angleTo(arm.quaternion)>.05);
    const upper=arm.getWorldPosition(arm.position.clone()),elbow=bones.RightLowerArm.getWorldPosition(arm.position.clone());
    assert.ok(upper.y-elbow.y>.25);
    frame(.67,visible);assert.ok(rig.canRotate('RightUpperArm'));
});
