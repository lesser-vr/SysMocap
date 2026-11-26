const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async ({ev, edge, output, sleep}) => {
    await edge.send('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false});
    const resolutions={};
    for(const mode of ['native','1440p','1080p']){
        await ev(`(()=>{const el=document.querySelector('#broadcast-settings [name=renderResolution]');el.value='${mode}';el.dispatchEvent(new Event('input'));})()`);
        const measure=`const rect=c.getBoundingClientRect(),win=c.ownerDocument.defaultView;
            return {w:c.width,h:c.height,cssW:rect.width,cssH:rect.height,dpr:win.devicePixelRatio};`;
        const target={native:0,'1080p':1080,'1440p':1440}[mode];
        const matches=r=>{
            if(!r || !r.cssW || !r.cssH)return false;
            const ratio=Math.max(r.dpr,Math.min(target/r.cssH,target*16/9/r.cssW));
            return Math.abs(r.w-r.cssW*ratio)<2 && Math.abs(r.h-r.cssH*ratio)<2;
        };
        let desktop,web;
        for(let i=0;i<40;i++){
            await sleep(125);
            desktop=await ev(`(()=>{const w=document.querySelector('#foo').contentWindow;
                const c=w.document.querySelector('#app')._vnode.component.proxy.$refs.stage.avatar.renderer.domElement;${measure}})()`);
            web=(await edge.send('Runtime.evaluate',{expression:`(()=>{const c=document.querySelector('#avatar-stage canvas');${measure}})()`,returnByValue:true})).result.value;
            if(matches(desktop)&&matches(web))break;
        }
        resolutions[mode]={desktop,web};
        assert.ok(matches(desktop)&&matches(web),JSON.stringify(resolutions));
    }
    fs.writeFileSync(path.join(output,'resolution.json'),JSON.stringify(resolutions,null,2));
    const inspect = `const coats=[];vrm.scene.traverse(n=>{if(n.userData.avatarFurLayer!==undefined)coats.push(n);});
        return {layers:coats.filter(n=>n.visible).length,total:coats.length,
                soft:vrm.scene.parent.children.some(n=>n.isHemisphereLight && n.visible)};`;
    for(const [preset,quality,expected] of [['classic','off',0],['auto','face',18],['auto','high',44],['auto','standard',36]]) {
        await ev(`(()=>{const panel=document.querySelector('#broadcast-settings');for(const [name,value] of Object.entries({lightPreset:${JSON.stringify(preset)},furQuality:${JSON.stringify(quality)}})){
            const input=panel.querySelector('[name='+name+']');input.value=value;input.dispatchEvent(new Event('input'));}})()`);
        let local,web;
        for(let i=0;i<45;i++) {
            await sleep(120);
            local=await ev(`(()=>{const vrm=document.querySelector('#foo').contentWindow.currentVrm;${inspect}})()`);
            web=(await edge.send('Runtime.evaluate',{expression:`(()=>{const vrm=window.currentVrm;${inspect}})()`,returnByValue:true})).result.value;
            if([local,web].every(state=>state?.total===44 && state.layers===expected && state.soft===(preset!=='classic'))) break;
        }
        console.log(preset,quality,{local,web});
        for(const state of [local,web]) assert.deepEqual(state,{layers:expected,total:44,soft:preset!=='classic'});
    }
    const result=await ev(`(async()=>{
        const w=document.querySelector('#foo').contentWindow,vrm=w.currentVrm,scene=vrm.scene.parent;
        const [renderer,camera]=await new Promise(ok=>{const prev=scene.onAfterRender;scene.onAfterRender=(r,s,c)=>{scene.onAfterRender=prev;ok([r,c]);};});
        const panel=w.document.querySelector('#fluffo-smoothness');
        const set=(key,value)=>{const i=panel.querySelector('[name='+key+']');i.value=value;i.dispatchEvent(new w.Event('input'));};
        const gl=renderer.getContext(), pixel=new Uint8Array(4);
        const sync=()=>gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
        const canvas=renderer.domElement, copy=document.createElement('canvas');
        copy.width=canvas.width;copy.height=canvas.height;
        const ctx=copy.getContext('2d');
        const shots={},metrics={};
        const mgr=vrm.expressionManager;
        for(const name of ['head','neck','spine','chest','upperChest']){
            vrm.humanoid.getNormalizedBoneNode(name)?.quaternion.identity();
        }
        vrm.humanoid.update();
        const render=()=>renderer.render(scene,camera);
        for(const pose of ['neutral','smile']){
            for(const exp of mgr.expressions)mgr.setValue(exp.expressionName,0);
            mgr.setValue('happy',pose==='smile'?1:0);
            mgr.setValue('aa',pose==='smile'?.24:0);mgr.update();
            for(const [name,light,quality] of [['classic','classic','off'],['soft','soft','off'],['fur','soft','standard'],['high','soft','high']]){
                set('lightPreset',light);set('furQuality',quality);
                render();sync();
                ctx.fillStyle='#00ff00';ctx.fillRect(0,0,copy.width,copy.height);ctx.drawImage(canvas,0,0);
                shots[pose+'-'+name]=copy.toDataURL().split(',')[1];
                if(pose==='neutral'){
                    const ms=[];
                    for(let i=0;i<18;i++){const start=performance.now();render();sync();ms.push(performance.now()-start);}
                    ms.sort((a,b)=>a-b);
                    metrics[name]={medianMs:ms[9],calls:renderer.info.render.calls,triangles:renderer.info.render.triangles};
                }
            }
        }
        const failed=renderer.info.programs.filter(p=>p.diagnostics && !p.diagnostics.runnable).length;
        return {shots,metrics,width:canvas.width,height:canvas.height,failed,glError:gl.getError()};
    })()`);
    assert.equal(result.failed,0);
    assert.equal(result.glError,0);
    for(const [name,png] of Object.entries(result.shots))fs.writeFileSync(path.join(output,name+'.png'),Buffer.from(png,'base64'));
    delete result.shots;
    console.log(JSON.stringify(result));
    assert.ok(result.metrics.fur.calls>result.metrics.soft.calls);
    fs.writeFileSync(path.join(output,'metrics.json'),JSON.stringify(result,null,2));
};
