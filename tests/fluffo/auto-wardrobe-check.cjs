const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
module.exports=async function({ev,edge,send,sessionId,output,sleep,name}){
    const expected={Hanako:['상의','하의','신발'],VAL:['후드','바지','신발'],Ashtra:['상의','신발']}[name];
    const item=expected[0];
    const ui=code=>ev(`(()=>{const p=document.querySelector('.wardrobe');${code}})()`);
    const receiver=async expression=>(await edge.send('Runtime.evaluate',{expression,returnByValue:true})).result.value;
    const inspect=`const meshes=[];vrm.scene.traverse(o=>{if(o.isMesh)meshes.push([o.material].flat().map(m=>({visible:m.visible,name:m.name})));});return meshes;`;
    const local=()=>ev(`(()=>{const vrm=document.querySelector('#foo').contentWindow.currentVrm;${inspect}})()`);
    const remote=()=>receiver(`(()=>{const vrm=window.currentVrm;${inspect}})()`);
    await ev("document.querySelector('[aria-controls=broadcast-settings]').click()");
    await ui('p.open=true;');
    const labels=()=>ui("return Array.from(p.querySelectorAll('.toggle'),el=>el.textContent.trim())");
    assert.deepEqual((await labels()).sort(),expected.slice().sort());
    const original=await Promise.all([local(),remote()]);
    const toggle=label=>ui(`Array.from(p.querySelectorAll('.toggle')).find(el=>el.textContent.trim()===${JSON.stringify(label)}).querySelector('input').click();`);
    await toggle(item);
    const changed=async(read,before)=>{
        let diffs=[];
        for(let attempt=0;attempt<35;attempt++){
            const after=await read();diffs=[];
            before.forEach((m,i)=>m.forEach((mat,j)=>{if(mat.visible && !after[i][j].visible)diffs.push(mat.name);}));
            if(diffs.length)break;await sleep(100);
        }
        assert.ok(diffs.length,'No clothing was hidden');
        assert.ok(diffs.every(n=>/tops|hoodie/i.test(n)),JSON.stringify(diffs));
        return diffs;
    };
    for(const [i,read] of [local,remote].entries())await changed(read,original[i]);
    await toggle(item);await sleep(350);
    assert.deepEqual(await local(),original[0]);assert.deepEqual(await remote(),original[1]);
    const edit=async()=>{
        await ui("p.querySelector('button').click()");
        for(let i=0;i<120;i++){
            if(await ui("return !!p.querySelector('.part button:enabled')"))return;
            await sleep(100);
        }
        throw Error('Preview: '+await ui("return p.innerText.slice(0,300)"));
    };
    await edit();
    await ui(`const row=Array.from(p.querySelectorAll('.part')).find(el=>el.querySelector('input').value===${JSON.stringify(item)});row.querySelector('button').click();`);
    assert.deepEqual(await local(),original[0],'Editing changed the broadcast');
    assert.deepEqual(await remote(),original[1],'Editing changed the receiver');
    const changeLabel=label=>ui(`const el=Array.from(p.querySelectorAll('.part input')).find(el=>el.value===${JSON.stringify(item)});el.value=${JSON.stringify(label)};el.dispatchEvent(new Event('input'));`);
    await changeLabel('방송 상의');
    await ui("p.querySelector('.actions button:last-child').click()");
    assert.ok((await labels()).includes(item),'Cancel changed the wardrobe');
    await edit();
    // Capture the preview with the original clothing and a second time after a trial toggle.
    const clip=await ui("p.querySelector('canvas').scrollIntoView({block:'center'});const {x,y,width,height}=p.querySelector('canvas').getBoundingClientRect();return {x:x+scrollX,y:y+scrollY,width,height,scale:1}");
    const shot=async suffix=>{
        const {data}=await send('Page.captureScreenshot',{format:'png',clip},sessionId);
        fs.writeFileSync(path.join(output,name+'-wardrobe-'+suffix+'.png'),Buffer.from(data,'base64'));return data;
    };
    const shown=await shot('worn');
    await ui(`Array.from(p.querySelectorAll('.part')).find(el=>el.querySelector('input').value===${JSON.stringify(item)}).querySelector('button').click()`);
    await sleep(200);
    assert.notEqual(await shot('preview'),shown,'Preview toggle had no visible effect');
    await changeLabel('방송 상의');
    await ui("p.querySelector('.actions button').click()");
    await toggle('방송 상의');await sleep(250);
    await ev("document.querySelector('.primary').click()");await sleep(400);
    const descriptor=await ev('sysmocapApp.selectModel');
    await ev("sysmocapApp.selectModel=JSON.stringify(sysmocapApp.builtIn.find(m=>m.name==='Sendagaya'))");await sleep(100);
    assert.ok(!(await labels()).includes('방송 상의'));
    await ev('sysmocapApp.selectModel='+JSON.stringify(descriptor));await sleep(100);
    assert.ok((await labels()).includes('방송 상의'),'Saved mapping missing');
    assert.equal(await ui("return Array.from(p.querySelectorAll('.toggle')).find(el=>el.textContent.trim()==='방송 상의').querySelector('input').checked"),false);
    await ev("document.querySelector('.primary').click()");
    for(let i=0;i<120 && !await ev("sysmocapApp.outputOpen && sysmocapApp.modelReady");i++)await sleep(100);
    await changed(local,original[0]);
    console.log(name,'passed discovery, isolated preview, original skin and materials, receiver, cancel and saved per-avatar choices');
};
