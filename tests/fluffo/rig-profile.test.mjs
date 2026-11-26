import test from 'node:test';
import assert from 'node:assert/strict';
import {avatarRigProfile,slotVisibility} from '../../src/mocap/avatarRigProfile.mjs';
import {listWardrobeParts} from '../../src/mocap/wardrobe.mjs';
import {Group,Bone} from 'three';
import {createIdlePlayer} from '../../src/mocap/fluffoIdle.mjs';

const names=['hips','head','leftUpperArm','leftLowerArm','leftHand','rightUpperArm','rightLowerArm','rightHand'];
function avatar(version){
    const nodes=names.map(name=>({name}));
    const bones=names.map((bone,node)=>({bone,node}));
    const extensions=version===0?{VRM:{humanoid:{humanBones:bones},blendShapeMaster:{blendShapeGroups:[{name:'Blink'}]}}}:
        {VRMC_vrm:{meta:{name:'Fluffo GTA VI'},humanoid:{humanBones:Object.fromEntries(bones.map(b=>[b.bone,b]))},expressions:{preset:{blink:{}}}}};
    return {nodes,extensions};
}
for(const version of [0,1]){
    test('VRM '+version+' opts into extended capture by rig, independent of wardrobe or name',()=>{
        const json=avatar(version);
        assert.equal(avatarRigProfile(json).extended,false);
        json.extras={sysmocap:{version:1,rig:{tracking:'extended'}}};
        assert.equal(avatarRigProfile(json).extended,true);
        assert.deepEqual(avatarRigProfile(json).wardrobe,[]);
        json.nodes.pop();
        assert.equal(avatarRigProfile(json).extended,false);
    });
}
test('automatic face support, authored neutral and explicit opt-out',()=>{
    const json=avatar(1),vrm=json.extensions.VRMC_vrm;
    vrm.expressions.custom={mouthPucker:{},eyeWideLeft:{},eyeWideRight:{}};
    assert.equal(avatarRigProfile(json).extended,true);
    json.extras={sysmocap:{version:1,rig:{tracking:'standard',neutralEyeOpen:86}}};
    assert.equal(avatarRigProfile(json).extended,false);
    assert.equal(avatarRigProfile(json).neutralEyeOpen,86);
});
test('declared wardrobe and discovered scarf coexist on a rig without extended tracking',()=>{
    const json={nodes:[{name:'Holder',children:[1],extras:{sysmocapSlot:'outer',sysmocapFitExpression:'fit'}},
        {name:'Shirt',mesh:0},{name:'Scarf',mesh:0},{name:'Pin',extras:{sysmocapSlot:'pin'}}],
        meshes:[{name:'Cloth',primitives:[{}]}],extras:{sysmocap:{version:1,wardrobe:[
            {id:'outer',label:'코트',minElbowAngle:90},{id:'pin',requires:'outer'},{id:'absent'}]}}};
    const profile=avatarRigProfile(json);
    assert.equal(profile.extended,false);
    assert.deepEqual(profile.wardrobe.map(s=>s.id),['outer','pin']);
    assert.deepEqual(profile.wardrobe[0].fit,['fit']);
    assert.equal(profile.wardrobe[0].minElbowAngle,90);
    assert.deepEqual(listWardrobeParts(json,profile.wardrobe).map(p=>p.label),['머플러']);
    assert.equal(slotVisibility(profile.wardrobe,['outer'])('pin'),false);
    assert.equal(slotVisibility(profile.wardrobe,[])('pin'),true);
    assert.equal(slotVisibility([{id:'a',requires:'b'},{id:'b',requires:'a'}],[])('a'),false);
});

test('an optional idle clip works with unrelated joint names and a position-only track',()=>{
    const scene=new Group(),joint=new Bone();
    joint.name='Antenna';scene.add(joint);
    scene.userData={sysmocapIdle:'rest',sysmocapClips:{rest:{
        fps:2,duration:1,tracks:{Antenna:{p:[[0,0,0],[1,0,0]]}}
    }}};
    const play=createIdlePlayer({scene});
    play(.25);assert.equal(joint.position.x,.5);
    play(.75);assert.equal(joint.position.x,0);
});
