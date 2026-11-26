import test from 'node:test';
import assert from 'node:assert/strict';
import {createOutputFrameGate} from '../../src/mocap/broadcastScene.mjs';
import {createSmoothness,receiverSettings} from '../../src/mocap/fluffoSmoothness.mjs';

test('output follows its own cadence at common display refresh rates',()=>{
    for(const refresh of [30,60,75,120,144,240]){
        for(const cap of [30,60]){
            const draw=createOutputFrameGate();
            let count=0;
            for(let i=0;i<refresh*10;i++){
                if(draw(cap+'fps',i*1000/refresh))count++;
            }
            assert.equal(count,10*Math.min(refresh,cap));
        }
    }
});

test('changing the cap or resuming after a long stall does not replay missed frames',()=>{
    const draw=createOutputFrameGate();
    assert.ok(draw('30fps',0));
    assert.ok(!draw('30fps',3));
    assert.ok(draw('60fps',4));
    assert.ok(draw('60fps',10004));
    assert.ok(!draw('60fps',10005));
    assert.ok(draw('unlimited',10006));
    assert.ok(draw('unlimited',10007));
    assert.ok(draw('30fps',10008));
});

test('older settings default to 60fps and the OBS receiver follows the chosen cap',()=>{
    const controls=createSmoothness({renderResolution:'1440p'});
    assert.equal(controls.values.outputFps,'60fps');
    controls.set({...controls.values,outputFps:'30fps'});
    assert.equal(receiverSettings(controls.values).outputFps,'30fps');
});
