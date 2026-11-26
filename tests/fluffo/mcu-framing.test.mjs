import test from 'node:test';
import assert from 'node:assert/strict';
import {Bone, Box3, BoxGeometry, Group, Mesh, PerspectiveCamera, Vector3} from 'three';
import {createMcuFraming,measureMcuBounds} from '../../src/mocap/mcuFraming.mjs';

function fixture(scale=1, origin=new Vector3(), withBones=true){
    const model=new Group(), hips=new Bone();
    model.scale.setScalar(scale);
    model.position.copy(origin);
    model.add(hips);
    hips.position.y=.9;
    const bones={Hips:hips};
    for(const [name,x,y] of [['Head',0,.7],['LeftUpperArm',.2,.5],['RightUpperArm',-.2,.5]]){
        const bone=new Bone();
        bone.position.set(x,y,0);
        hips.add(bone);
        bones[name]=bone;
    }
    const bounds=new Box3(new Vector3(-.4,0,-.2),new Vector3(.4,1.85,.2));
    model.updateMatrixWorld(true);
    bounds.applyMatrix4(model.matrixWorld);
    const camera=new PerspectiveCamera(35,16/9,.1,100);
    let shot;
    const rig=createMcuFraming(camera,new Vector3(0,.5,-1),key=>withBones && bones[key] || undefined,bounds,{setShot(value){shot=value;}});
    rig.setTarget('face');
    return {rig,hips,camera,get shot(){return shot;}};
}

test('MCU aim and distance track the size and origin of the avatar',()=>{
    const base=fixture(),origin=new Vector3(4,-2,1),large=fixture(3,origin);
    assert.ok(large.shot.target.distanceTo(base.shot.target.clone().multiplyScalar(3).add(origin))<1e-6);
    assert.ok(large.shot.offset.distanceTo(base.shot.offset.clone().multiplyScalar(3))<1e-6);
    assert.equal(base.shot.offset.y,0);
    assert.ok(base.shot.offset.z<0);
});

test('MCU keeps a fixed camera and bounds movement relative to the first tracked pose',()=>{
    const {rig,hips,camera,shot}=fixture(.4);
    const rest=hips.position.clone(),aim=shot.target.clone();
    assert.ok(rig.trackHips({x:8,y:3,z:10},1));
    assert.ok(hips.position.distanceTo(rest)<1e-6);
    rig.trackHips({x:30,y:12,z:52},1);
    assert.ok(Math.abs(hips.position.distanceTo(rest)-.32*.4)<1e-6);
    assert.ok(shot.target.equals(aim));
    rig.setTarget('full');
    assert.equal(camera.near,.1);
    assert.equal(rig.trackHips({x:0,y:0,z:0},1),false);
    rig.setTarget('face');
    assert.ok(hips.position.equals(rest));
});

test('models without mapped bones use mesh bounds, and empty models keep their existing shot',()=>{
    assert.ok(fixture(1,new Vector3(),false).shot.offset.length()>0);
    const camera=new PerspectiveCamera();
    assert.equal(createMcuFraming(camera,camera.position,()=>undefined,new Box3(),{}),null);
});

test('VRM crown includes visible hair at its authored height and skips hidden costume geometry',()=>{
    const root=new Group(),hair=new Mesh(new BoxGeometry(.3,.2,.3));
    root.position.y=.2;
    hair.position.y=1.5;
    root.add(hair);
    const hidden=hair.clone();
    hidden.position.y=8;
    hidden.visible=false;
    root.add(hidden);
    const bounds=measureMcuBounds(root,new Box3(),true);
    assert.ok(Math.abs(bounds.max.y-1.8)<1e-6);
});
