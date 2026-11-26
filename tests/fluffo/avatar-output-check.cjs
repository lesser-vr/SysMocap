const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

module.exports=async function check({ev,send,sleep,output}){
    const main=code=>ev(`(()=>{const w=document.querySelector('#foo').contentWindow,d=w.document;
        const stage=d.querySelector('#app')._vnode.component.proxy.$refs.stage;
        const canvas=stage.avatar.renderer.domElement; ${code} })()`);
    const toggle=()=>main("d.querySelector('#avatar-output-toggle').click()");
    const stats=()=>main(`return {renders:stage.avatar.renderer.info.render.frame,face:stage._lastData?.fluffoRig?.faceStamp,
        videoTime:d.querySelector('video')?.currentTime,frame:stage._lastData?.fluffoRig?.frame,
        visible:canvas.ownerDocument.visibilityState,
        docked:d.querySelector('#model canvas')===canvas,attached:canvas.isConnected,
        lost:canvas.getContext('webgl2').isContextLost(),width:canvas.width}`);
    const native=action=>ev("require('@electron/remote').getCurrentWindow()."+action+"()");
    const outputTitle='SysMocap 방송 출력';
    async function findOutput(){
        for(let i=0;i<30;i++){
            const {targetInfos}=await send('Target.getTargets');
            const page=targetInfos.find(t=>t.type==='page' && t.title===outputTitle);
            if(page)return page;
            await sleep(100);
        }
        throw Error('Output window missing');
    }
    const page=await findOutput();
    assert.ok(!(await stats()).docked,'Tracking should automatically open the output window');
    const {sessionId}=await send('Target.attachToTarget',{targetId:page.targetId,flatten:true});
    const contents=(await send('Runtime.evaluate',{expression:`({
        canvases:document.querySelectorAll('canvas').length,
        controls:!!document.querySelector('video,button,#controller,#fluffo-smoothness'),
        background:getComputedStyle(document.querySelector('#model')).backgroundColor})`,returnByValue:true},sessionId)).result.value;
    assert.deepEqual(contents,{canvases:1,controls:false,background:'rgb(0, 255, 0)'});
    const initialWidth=(await stats()).width;
    await ev("require('@electron/remote').BrowserWindow.getAllWindows().find(w=>w.getTitle()==='SysMocap 방송 출력').setContentSize(800,450)");
    await sleep(250);
    assert.ok((await stats()).width>=1920,'Full HD should survive a smaller output window');
    const selectResolution=mode=>ev(`(()=>{const field=document.querySelector('#broadcast-settings [name=renderResolution]');
        field.value=${JSON.stringify(mode)};field.dispatchEvent(new Event('input'));})()`);
    await selectResolution('native');
    await sleep(200);
    assert.notEqual((await stats()).width,initialWidth,'Native resolution should follow the smaller window');
    await selectResolution('1080p');
    await native('minimize');
    try{
        assert.equal(await native('isMinimized'),true);
        await sleep(1000);
        const before=await stats();
        await sleep(1600);
        const after=await stats();
        console.log('Minimized output',before,after);
        if(process.argv.includes('--windows-capture')){
            const hwnd=await ev("require('@electron/remote').BrowserWindow.getAllWindows().find(w=>w.getTitle()==='SysMocap 방송 출력').getNativeWindowHandle().readUInt32LE()");
            const size=120*68*3;
            const grab=require('node:child_process').spawnSync('ffmpeg',['-loglevel','error','-f','lavfi','-i',
                'gfxcapture=hwnd='+hwnd+':capture_cursor=0:max_framerate=8,hwdownload,format=bgra,scale=120:68,format=rgb24',
                '-frames:v','8','-fps_mode','passthrough','-f','rawvideo','pipe:1'],{timeout:10000,windowsHide:true});
            assert.equal(grab.status,0,[grab.error?.message,grab.stderr.toString(),grab.stdout.length].join(' '));
            const pixels=grab.stdout;
            assert.equal(pixels.length,size*8);
            let changed=0,green=0;
            for(let i=0;i<size;i+=3){
                const j=i+size*7;
                if(Math.abs(pixels[i]-pixels[j])+Math.abs(pixels[i+1]-pixels[j+1])+Math.abs(pixels[i+2]-pixels[j+2])>15)changed++;
                if(pixels[j+1]>200 && pixels[j]<40 && pixels[j+2]<40)green++;
            }
            console.log('Windows capture pixels', {green,changed});
            assert.ok(green>1000 && changed>25,'Windows output did not show the moving avatar');
        }
        const shot=await send('Page.captureScreenshot',{format:'png'},sessionId);
        fs.writeFileSync(path.join(output,'Fluffo-output-window.png'),Buffer.from(shot.data,'base64'));
        assert.ok(!after.docked && after.attached && !after.lost && after.renders>before.renders+4);
        assert.ok(Number.isFinite(before.face) && Number.isFinite(after.face) && after.face>before.face,'Tracking froze while minimized');
    }finally{await native('restore');}
    await send('Target.closeTarget',{targetId:page.targetId});
    await sleep(350);
    assert.ok((await stats()).docked,'Closing output should restore the same canvas');
    await toggle();await findOutput();await toggle();await sleep(250);
    assert.ok((await stats()).docked,'Dock button should restore the same canvas');
    const {targetInfos}=await send('Target.getTargets');
    assert.ok(!targetInfos.some(t=>t.title===outputTitle));
    await toggle();await findOutput();
    await ev("document.querySelector('[onclick*=startMocap]').click()");
    await sleep(500);
    const stopped=await send('Target.getTargets');
    assert.ok(!stopped.targetInfos.some(t=>t.title===outputTitle),'Output remained open after stopping');
    await ev("document.querySelector('.primary').click()");
    for(let i=0;i<120 && !await ev('sysmocapApp.outputOpen && sysmocapApp.facePresent');i++)await sleep(100);
    assert.ok(await ev("sysmocapApp.outputOpen && sysmocapApp.facePresent"),'Tracking failed to restart');
    assert.equal((await send('Target.getTargets')).targetInfos.filter(t=>t.title===outputTitle).length,1);
    await ev("document.querySelector('.primary').click()");
    console.log('Single canvas, clean moving output, minimize, native close, dock button, stop and restart passed');
};
