const assert = require('node:assert/strict');

module.exports = async ({ev,sleep}) => {
    const set = (name,value,event) => ev(`(()=>{
        const field=document.querySelector('#broadcast-settings [name=${name}]');
        field.value=${JSON.stringify(value)};
        field.dispatchEvent(new Event('${event}',{bubbles:true}));
    })()`);
    await ev(`(()=>{
        const w=document.querySelector('#foo').contentWindow;
        const stage=w.document.querySelector('#app')._vnode.component.proxy.$refs.stage;
        const proto=w.Holistic.prototype, configure=proto.setOptions, push=stage.pushData;
        const probe=window.performanceProbe={levels:[],poses:0};
        proto.setOptions=function(opts){probe.levels.push(opts.modelComplexity);return configure.call(this,opts);};
        stage.pushData=function(data){if(data.riggedPose)probe.poses++;return push.call(this,data);};
        probe.snap=()=>[performance.now(),stage.avatar.renderer.info.render.frame,probe.poses];
    })()`);
    const readFields=()=>ev(`['outputFps','modelComplexity'].map(n=>document.querySelector('#broadcast-settings [name='+n+']').value)`);
    async function sample(){
        const start=await ev('performanceProbe.snap()');
        await sleep(3000);
        const end=await ev('performanceProbe.snap()');
        const seconds=(end[0]-start[0])/1000;
        return {fps:(end[1]-start[1])/seconds,poses:(end[2]-start[2])/seconds};
    }
    async function waitLevel(level){
        for(let i=0;i<50;i++){
            if(await ev('performanceProbe.levels.at(-1)==='+level))return;
            await sleep(100);
        }
        assert.fail('Capture did not apply level '+level);
    }
    assert.deepEqual(await readFields(),['60fps','1']);
    const initial=await sample();
    await set('outputFps','30fps','input');
    await set('modelComplexity','2','change');
    await waitLevel(2);
    await sleep(700);
    const capped=await sample();
    assert.ok(capped.fps<=31 && capped.fps>10 && capped.poses>8,JSON.stringify(capped));
    await set('outputFps','unlimited','input');
    await set('modelComplexity','0','change');
    await waitLevel(0);
    await sleep(700);
    const free=await sample();
    assert.ok(free.poses>8 && free.fps>10,JSON.stringify(free));
    const saved=await ev(`[
        JSON.parse(localStorage.getItem('fluffo.live-controls.v1')).outputFps,
        JSON.parse(require('fs').readFileSync(require('@electron/remote').getGlobal('storagePath').jsonPath,'utf8'))['sysmocap-global-settings'].mediapipe.modelComplexity
    ]`);
    assert.deepEqual(saved,['unlimited','0']);
    await ev("Array.from(document.querySelectorAll('#broadcast-settings button')).find(b=>b.textContent.includes('기본값 복원')).click()");
    await waitLevel(1);
    await sleep(700);
    assert.deepEqual(await readFields(),['60fps','1']);
    const restored=await sample();
    assert.ok(restored.fps<=61 && restored.poses>8,JSON.stringify(restored));
    console.log('Output FPS and tracked poses/s',{initial,capped,free,restored});
};
