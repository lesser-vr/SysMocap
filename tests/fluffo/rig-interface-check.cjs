const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

// Opt in an unrelated humanoid VRM with standard facial presets. Keep the
// supplied asset intact and add new slot IDs that the application has never seen.
exports.fixture=function(source,directory){
    const file=fs.readFileSync(source),end=20+file.readUInt32LE(12);
    const json=JSON.parse(file.subarray(20,end));
    const vrm=json.extensions.VRMC_vrm,old=json.extensions.VRM;
    if(vrm){
        vrm.meta.name='Rig interface sample';
        vrm.expressions.custom={...vrm.expressions.custom,qaFit:vrm.expressions.preset.relaxed};
    }else{
        old.meta.title='Rig interface sample';
        const groups=old.blendShapeMaster.blendShapeGroups;
        groups.push({...groups.find(g=>g.presetName==='joy'),name:'qaFit',presetName:'unknown'});
    }
    json.extras={...json.extras,sysmocap:{version:1,rig:{tracking:'extended'},
        wardrobe:[{id:'outer',label:'테스트 의상'},{id:'trim',label:'테스트 장식',requires:'outer'}]}};
    const meshes=json.nodes.filter(n=>n.mesh!==undefined);
    meshes[0].extras={...meshes[0].extras,sysmocapSlot:'outer',sysmocapFitExpression:'qaFit'};
    meshes[1].extras={...meshes[1].extras,sysmocapSlot:'trim'};
    const text=JSON.stringify(json),bytes=Buffer.byteLength(text),data=Buffer.alloc(Math.ceil(bytes/4)*4,32);
    data.write(text);
    const header=Buffer.from(file.subarray(0,20));
    header.writeUInt32LE(20+data.length+file.length-end,8);header.writeUInt32LE(data.length,12);
    const dest=path.join(directory,'unrelated.vrm');
    fs.writeFileSync(dest,Buffer.concat([header,data,file.subarray(end)]));return dest;
};

exports.check=async function({ev,edge,sleep,positions}){
    assert.equal(await ev('sysmocapApp.customRig'),true);
    assert.equal(await ev("Number(document.querySelector('#broadcast-settings [name=eyeRestOpen]').value)"),100);
    assert.ok(positions.every(([name])=>name==='Rig interface sample'));
    assert.ok(new Set(positions.map(p=>p[1])).size>1,'Vowel did not animate on the receiver');
    const stamp=await ev("document.querySelector('#foo').contentDocument.querySelector('#app')._vnode.component.proxy.$refs.stage._lastData.fluffoRig?.faceStamp");
    assert.ok(Number.isFinite(stamp),'Extended face tracker did not run');
    await ev("const btn=document.querySelector('[aria-controls=broadcast-settings]');if(btn.getAttribute('aria-expanded')!=='true')btn.click()");
    const input=id=>'#broadcast-settings .wardrobe [name='+id+']';
    assert.equal(await ev("document.querySelector("+JSON.stringify(input('outer'))+").parentElement.textContent.trim()"),'테스트 의상');
    assert.equal(await ev("!!document.querySelector('#broadcast-settings .wardrobe [name=shirt]')"),false);
    const inspect=`(m=>{const s={fit:m.expressionManager.getValue('qaFit')};m.scene.traverse(n=>{if(n.userData.sysmocapSlot)s[n.userData.sysmocapSlot]=n.visible;});return s;})`;
    for(const on of [true,false,true]){
        if(on!==await ev("document.querySelector("+JSON.stringify(input('outer'))+").checked"))
            await ev("document.querySelector("+JSON.stringify(input('outer'))+").click()");
        const expected={fit:Number(on),outer:on,trim:on};
        let local,remote;
        for(let i=0;i<45;i++){
            local=await ev(inspect+"(document.querySelector('#foo').contentWindow.currentVrm)");
            remote=(await edge.send('Runtime.evaluate',{expression:inspect+'(window.currentVrm)',returnByValue:true})).result.value;
            if(local?.fit===expected.fit && remote?.fit===expected.fit)break;
            await sleep(100);
        }
        assert.deepEqual(local,expected);assert.deepEqual(remote,expected);
        assert.equal(await ev("document.querySelector("+JSON.stringify(input('trim'))+").disabled"),!on);
    }
    console.log('Unrelated VRM passed extended tracking, custom slots, dependency and fit on both outputs');
};
