const assert = require('node:assert/strict');

module.exports = async function checkSceneControls({ev,edge,sleep,send,sessionId}) {
    await ev("var panelButton=document.querySelector('[aria-controls=broadcast-settings]');if(panelButton.getAttribute('aria-expanded')!=='true')panelButton.click()");
    const groups = await ev("Array.from(document.querySelectorAll('#broadcast-settings details[data-group]')).filter(e=>e.offsetWidth).map(e=>e.dataset.group)");
    for(const name of ['카메라','배경','조명','화면 효과']) assert.ok(groups.includes(name), name);
    const wardrobeVisible=!!await ev("document.querySelector('.wardrobe-items, .wardrobe > label input')");
    if(wardrobeVisible){
        const index=groups.indexOf('복장·액세서리');
        assert.deepEqual(groups.slice(index-1,index+2),['배경','복장·액세서리','조명']);
        assert.equal(groups.filter(name=>name==='복장·액세서리').length,1);
    }else assert.ok(!groups.includes('복장·액세서리'));

    // Compare rendered siblings at the same depth, independently of which groups the avatar supports.
    const typography=await ev(`(()=>{
        const groups=[...document.querySelectorAll('#broadcast-settings .inline-controls > div > details[data-group]')].filter(g=>g.offsetWidth);
        return groups.map(group=>{
            const title=group.querySelector(':scope > summary'),wasOpen=group.open;
            const size=()=>getComputedStyle(title).fontSize;
            try{
                group.open=false;const collapsed=size();
                group.open=true;const expanded=size();
                const item=group.dataset.group==='복장·액세서리' && [...group.querySelectorAll('label, .wardrobe-items > p')].find(el=>el.offsetWidth);
                return {name:group.dataset.group,collapsed,expanded,item:item?getComputedStyle(item).fontSize:null};
            }finally{group.open=wasOpen;}
        });
    })()`);
    const reference=typography.find(group=>group.name==='배경');
    assert.ok(reference,'Expected a visible background heading');
    for(const group of typography){
        assert.equal(group.collapsed,reference.collapsed,group.name+' (collapsed) versus 배경');
        assert.equal(group.expanded,reference.collapsed,group.name+' (expanded) versus 배경');
        if(group.name==='복장·액세서리')assert.equal(group.item,'13px','Wardrobe item text size');
    }
    console.log('Verified sibling heading size',reference.collapsed,'across',typography.length,'groups');

    // Check the face Chromium actually drew. A CSS family name still matches
    // when a packaged font is missing and the OS silently draws the Hangul.
    await ev('document.fonts.ready.then(()=>true)');
    await send('DOM.enable',{},sessionId);
    await send('CSS.enable',{},sessionId);
    const {root}=await send('DOM.getDocument',{},sessionId);
    for(const selector of ['label[for=shot]','#broadcast-settings h2','details[data-group="배경"] > summary']){
        const {nodeId}=await send('DOM.querySelector',{nodeId:root.nodeId,selector},sessionId);
        const {fonts}=await send('CSS.getPlatformFontsForNode',{nodeId},sessionId);
        assert.ok(fonts.some(f=>f.isCustomFont && f.glyphCount>0 && f.familyName==='Pretendard Variable'),
            selector+' rendered fonts: '+JSON.stringify(fonts));
    }

    const setControls = values => ev(`(()=>{
        const p=document.querySelector('#broadcast-settings');
        for(const [key,value] of Object.entries(${JSON.stringify(values)})){
            const field=p.querySelector('[name='+key+']');
            field.closest('details').open=true;
            field.value=value;
            field.dispatchEvent(new Event('input',{bubbles:true}));
        }
    })()`);
    // Inspect the camera actually used to draw a frame, including the detached output.
    const capture = `
        const camera=await new Promise(resolve=>{
            const prev=scene.onAfterRender;
            scene.onAfterRender=(r,s,c)=>{scene.onAfterRender=prev;resolve(c);};
        });
        const light=scene.children.find(o=>o.isDirectionalLight);
        return {fov:camera.fov,position:camera.position.toArray(),intensity:light.intensity,
            color:light.color.getHexString(),dx:light.position.x,mirror:surface.style.transform,
            filter:canvas.style.filter,background:canvas.parentElement.style.backgroundColor};`;
    const desktop = () => ev(`(async()=>{
        const w=document.querySelector('#foo').contentWindow;
        const avatar=w.document.querySelector('#app')._vnode.component.proxy.$refs.stage.avatar;
        const scene=avatar.scene,canvas=avatar.renderer.domElement;
        const surface=canvas.parentElement;${capture}
    })()`);
    const browser = async () => {
        const {result,exceptionDetails}=await edge.send('Runtime.evaluate',{expression:
            `(async()=>{const w=window,scene=w.currentVrm.scene.parent,canvas=document.querySelector('#avatar-stage canvas'),surface=canvas;${capture}})()`,
            returnByValue:true,awaitPromise:true});
        assert.ok(!exceptionDetails,exceptionDetails?.text);
        return result.value;
    };
    const readers=edge ? [desktop,browser] : [desktop];
    const before=await Promise.all(readers.map(read=>read()));
    await setControls({yaw:17,pitch:9,side:.12,height:.06,distance:1.3,fov:57,mirror:'on',
        light:.8,lightYaw:-45,lightPitch:22,lightColor:'#eeaa55',contrast:1.3,saturation:.7,brightness:.8,backgroundMode:'blue'});
    for(const [index,read] of readers.entries()){
        let state;
        for(let i=0;i<40;i++){state=await read();if(state.fov===57 && state.background==='rgb(0, 0, 255)')break;await sleep(100);}
        assert.equal(state.fov,57);
        assert.notDeepEqual(state.position,before[index].position);
        assert.ok(Math.abs(state.intensity-.8*Math.PI)<.001 && state.dx<0);
        assert.equal(state.color,'eeaa55');
        assert.equal(state.mirror,'scaleX(-1)');
        assert.equal(state.filter,'brightness(0.8) contrast(1.3) saturate(0.7)');
        assert.equal(state.background,'rgb(0, 0, 255)');
    }
    {
        const clickReset=()=>ev("Array.from(document.querySelectorAll('#broadcast-settings button')).find(b=>b.textContent==='방송 설정 기본값 복원').click()");
        assert.equal(await ev("Array.from(document.querySelectorAll('#broadcast-settings button')).filter(b=>b.textContent.includes('기본값 복원')).length"),1);
        const accessory=await ev("document.querySelector('#broadcast-settings .wardrobe > label input:enabled')?.name");
        const firstWorn=accessory && await ev("document.getElementsByName("+JSON.stringify(accessory)+")[0].checked");
        if(accessory)await ev("document.getElementsByName("+JSON.stringify(accessory)+")[0].click()");
        await setControls({body:.82});
        const preview=".preview-switch input";
        await ev("if(document.querySelector('"+preview+"').checked)document.querySelector('"+preview+"').click()");
        await sleep(120);
        await clickReset();
        await sleep(150);
        assert.equal(await ev("document.querySelector('"+preview+"').checked"),false,'Restoring the output enabled the input preview');
        for(const [index,read] of readers.entries()){
            for(let i=0;i<30 && (await read()).fov!==35;i++)await sleep(100);
            assert.deepEqual(await read(),before[index],'Output settings did not return to their original values');
        }
        const sliders=await ev("Array.from(document.querySelectorAll('#broadcast-settings [name=fov], #broadcast-settings [name=contrast]'),e=>Number(e.value))");
        assert.deepEqual(sliders,[35,1]);
        assert.equal(await ev("document.querySelector('#broadcast-settings [name=body]').value"),'0.5');
        if(accessory)assert.equal(await ev("document.getElementsByName("+JSON.stringify(accessory)+")[0].checked"),!firstWorn);
        // Wheel zoom must be reflected in the saved shot and reset along with the sliders.
        await ev(`(()=>{const w=document.querySelector('#foo').contentWindow;
            const canvas=w.document.querySelector('#app')._vnode.component.proxy.$refs.stage.avatar.renderer.domElement;
            canvas.dispatchEvent(new canvas.ownerDocument.defaultView.WheelEvent('wheel',{deltaY:100,cancelable:true}));
            canvas.parentElement.style.backgroundImage='linear-gradient(red,blue)';
        })()`);
        assert.notDeepEqual((await desktop()).position,before[0].position);
        assert.notEqual(await ev("JSON.parse(localStorage.getItem('fluffo.live-controls.v1')).distance"),1);
        await clickReset();
        await sleep(160);
        assert.deepEqual((await desktop()).position,before[0].position,'Mouse camera was not restored');
        assert.equal(await ev("document.querySelector('#foo').contentDocument.querySelector('#app')._vnode.component.proxy.$refs.stage.avatar.renderer.domElement.parentElement.style.backgroundImage"),'');
        assert.equal(await ev("JSON.parse(localStorage.getItem('fluffo.live-controls.v1')).cameraPreview"),false);

        await ev("document.querySelector('"+preview+"').click()");
        await sleep(100);
        await clickReset();
        assert.equal(await ev("document.querySelector('"+preview+"').checked"),true);
    }
    console.log('Verified live scene settings on',readers.length,'output(s)');
};
