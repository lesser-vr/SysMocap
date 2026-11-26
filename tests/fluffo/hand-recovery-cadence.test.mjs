import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandRecoveryCadence} from '../../src/mocap/fluffoHandReader.mjs';

const hand=x=>Array.from({length:21},(_,i)=>({x:x+i*.002,y:.55-i*.003,z:0}));
const separated={leftHandLandmarks:hand(.3),rightHandLandmarks:hand(.6)};

test('recovery keeps probing and waits for distinct, consecutive observations before slowing',()=>{
    const cadence=createHandRecoveryCadence();
    assert.deepEqual([0,0,0,.03,.06,.09,.12].map(t=>cadence(separated,t)),[42,42,42,42,42,120,120]);
    assert.equal(cadence(separated,.6),42);
    assert.equal(cadence(separated,0),42);
});

test('loss, partial occlusion, frame edges and overlap immediately restore the fast probe',()=>{
    for(const risky of [null, {...separated,leftHandLandmarks:null},
        {...separated,rightHandLandmarks:hand(.02)}, {...separated,rightHandLandmarks:hand(.34)},
        {...separated,leftHandLandmarks:hand(.3).slice(0,12)},
        {...separated,leftHandLandmarks:hand(.3).map((p,i)=>i===5?{...p,visibility:.2}:p)}]){
        const cadence=createHandRecoveryCadence();
        for(const t of [0,.03,.06,.09])cadence(separated,t);
        assert.equal(cadence(risky,.12),42);
        assert.deepEqual([.15,.18,.21,.24].map(t=>cadence(separated,t)),[42,42,42,120]);
    }
});
