const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

function outfitState(model){
    const visible={};
    let influence;
    model.scene.traverse(node=>{
        const slot=node.userData.sysmocapSlot ?? node.userData.fluffoOutfitSlot;
        if(slot)(visible[slot]??=[]).push(node.visible);
        const index=node.morphTargetDictionary?.['Campaign sleeve clearance'];
        if(index!==undefined)influence=node.morphTargetInfluences[index];
    });
    return {visible,influence};
}

module.exports=async function verifyWardrobe({ev,edge,output,sleep}){
    const read='('+outfitState.toString()+')';
    function toggle(slot){
        return ev("document.querySelector('#foo').contentDocument.querySelector('[name="+slot+"]').click()");
    }
    const outfit={shirt:true,badge:true,aviator:true,chain:true,earCuff:true,goggles:true};
    function matches(state){
        return state?.influence===Number(outfit.shirt) && Object.entries(outfit).every(([slot,worn])=>{
            const visible=state.visible[slot];
            return visible?.length && visible.every(v=>v===(worn && (slot!=='badge' || outfit.shirt)));
        });
    }
    async function check(){
        let local,remote;
        for(let i=0;i<35;i++){
            local=await ev(read+"(document.querySelector('#foo').contentWindow.currentVrm)");
            const response=await edge.send('Runtime.evaluate',{expression:read+'(window.currentVrm)',returnByValue:true});
            remote=response.result.value;
            if(matches(local)&&matches(remote))return;
            await sleep(100);
        }
        assert.fail(JSON.stringify({expected:outfit,local,remote}));
    }
    await check();
    for(const slot of ['shirt','shirt','badge','shirt','shirt','badge','chain','aviator','earCuff','goggles']){
        await toggle(slot);outfit[slot]=!outfit[slot];await check();
    }
    for(const slot of ['chain','aviator','earCuff','goggles']){await toggle(slot);outfit[slot]=true;}
    await check();
    // Render both shirt states at the exact same pose and camera, alternating
    // through the actual UI. The expression update is normally done per frame.
    const image=await ev(`(async()=>{
        const w=document.querySelector('#foo').contentWindow,d=w.document,m=w.currentVrm,scene=m.scene.parent;
        const {renderer,camera}=await new Promise(resolve=>{const prev=scene.onAfterRender;
            scene.onAfterRender=(r,s,c)=>{scene.onAfterRender=prev;resolve({renderer:r,camera:c});};});
        const c=d.createElement('canvas'),width=520,height=293;c.width=width*2;c.height=height+36;
        const ctx=c.getContext('2d'),shirt=d.querySelector('[name=shirt]');
        for(let i=0;i<2;i++){
            if(i)shirt.click();
            m.expressionManager.update();renderer.render(scene,camera);
            ctx.fillStyle='#31424a';ctx.fillRect(i*width,0,width,height);
            ctx.drawImage(renderer.domElement,i*width,0,width,height);
            ctx.fillStyle='#182227';ctx.fillRect(i*width,height,width,36);
            ctx.fillStyle='white';ctx.font='17px sans-serif';
            ctx.fillText(i?'셔츠 끔 · 원래 위팔':'셔츠 켬 · 소매 보정',i*width+12,height+24);
        }
        shirt.click();m.expressionManager.update();
        return c.toDataURL('image/png').split(',')[1];
    })()`);
    fs.writeFileSync(path.join(output,'Fluffo-wardrobe-fit.png'),Buffer.from(image,'base64'));
    await check();
    console.log('Wardrobe, badge dependency and upper-arm morph passed on desktop and browser.');
};
