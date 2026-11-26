import test from 'node:test';
import assert from 'node:assert/strict';
import {Group,Mesh,MeshBasicMaterial,BoxGeometry} from 'three';
import {listWardrobeParts,bindWardrobe} from '../../src/mocap/wardrobe.mjs';

test('combined body keeps skin and makes unrecognised fabric manual-only',()=>{
    const json={nodes:[{name:'Body',mesh:0}],meshes:[{name:'Body.baked',primitives:[{material:0},{material:1},{material:2}]}],
        materials:[{name:'body_SKIN'},{name:'custom_weave'},{name:'tops_CLOTH'}]};
    const items=listWardrobeParts(json);
    assert.deepEqual(items.map(p=>p.label),['','상의']);
    assert.equal(new Set(items.map(p=>p.id)).size,2);
    const scene=new Group(),links=new Map([[scene,{nodes:0}]]);
    const meshes=json.materials.map((m,i)=>{
        const material=new MeshBasicMaterial();material.name=m.name;
        const mesh=new Mesh(new BoxGeometry(),[material,material.clone()]);
        scene.add(mesh);links.set(mesh,{meshes:0,primitives:i});return mesh;
    });
    const wardrobe=bindWardrobe(scene,{associations:links,json});
    assert.deepEqual(wardrobe.parts,items);
    const original=meshes.map(m=>m.material);
    wardrobe.apply([items[0].id,items[1].id]);
    assert.equal(meshes[0].material,original[0]);
    assert.ok(meshes.slice(1).every(m=>m.material.every(mat=>!mat.visible)));
    wardrobe.dispose();
    assert.ok(meshes.every((m,i)=>m.material===original[i]));
});
test('material slots on an FBX mesh can share a material with another mesh',()=>{
    const scene=new Group(),surface=new MeshBasicMaterial(),skin=new MeshBasicMaterial();
    surface.name='Jacket';skin.name='Skin';
    for(const name of ['PieceA','PieceB']){const mesh=new Mesh(new BoxGeometry(),[surface,skin]);mesh.name=name;scene.add(mesh);}
    const wardrobe=bindWardrobe(scene);
    assert.equal(wardrobe.parts.length,2);
    wardrobe.apply([wardrobe.parts[0].id]);
    assert.equal(scene.children[0].material[0].visible,false);
    assert.equal(scene.children[0].material[1],skin);
    assert.equal(scene.children[1].material[0],surface);
    assert.ok(surface.visible);wardrobe.dispose();
});
