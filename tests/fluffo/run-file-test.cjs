const {spawn} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname,'../..');
const option = key => process.argv.find(arg=>arg.startsWith('--'+key+'='))?.slice(key.length+3);
const fixture = option('avatar') || process.env.SYSMOCAP_TEST_AVATAR;
const input = option('input');
const videoFile = input || process.env.SYSMOCAP_TEST_VIDEO;
if (!fixture || !videoFile || !fs.existsSync(fixture) || !fs.existsSync(videoFile)) {
    throw new Error('Supply existing --avatar=<Fluffo.vrm> and --input=<clip.mp4> files.');
}
const output = path.resolve(option('out') || path.join(root,'test-output'));
fs.mkdirSync(output,{recursive:true});
const profile = fs.mkdtempSync(path.join(os.tmpdir(),'sysmocap-camera-qa-'));
const exe = option('exe') || require('electron');
const proc = spawn(exe,[...(option('exe')?[]:[root]),'--remote-debugging-pipe','--user-data-dir='+profile],{stdio:['ignore','ignore','ignore','pipe','pipe'],windowsHide:true});
const pending = new Map(); let seq=0,buffer='';
const sleep = ms=>new Promise(res=>setTimeout(res,ms));
function send(method,params={},sessionId) {
 const id=++seq;
 return new Promise((resolve,reject)=>{
  pending.set(id,{resolve,reject});
  proc.stdio[3].write(JSON.stringify({id,method,params,sessionId})+'\0');
 });
}
proc.stdio[4].setEncoding('utf8').on('data',chunk=>{
 buffer+=chunk;
 for(let end;(end=buffer.indexOf('\0'))>=0;){
  const msg=JSON.parse(buffer.slice(0,end)); buffer=buffer.slice(end+1);
  if(msg.method==='Runtime.exceptionThrown' && !globalThis.reportedError){globalThis.reportedError=true;const d=msg.params.exceptionDetails;console.log('Renderer error',d.exception?.description || d.exception?.value || d.text,d.url,d.lineNumber,d.columnNumber,JSON.stringify(d.stackTrace?.callFrames?.slice(0,4)?.map(f=>[f.functionName,f.lineNumber,f.columnNumber])));}
  if(msg.method==='Runtime.consoleAPICalled' && ['error','warning'].includes(msg.params.type)){const t=msg.params.args.map(a=>a.value||a.description).join(' ');if(/Fluffo|wasm|face tracking/i.test(t)) console.log(t.slice(0,1200));}
  const p=pending.get(msg.id); if(!p) continue;
  pending.delete(msg.id); if(msg.error) p.reject(new Error(msg.error.message)); else p.resolve(msg.result);
 }
});
const timeout=setTimeout(()=>{console.error('Timed out');proc.kill(); process.exit(1)},95000);
(async()=>{
 try{
 let page;
 for(let n=0;n<80 && !page;n++){
  const {targetInfos}=await send('Target.getTargets');
  page=targetInfos.find(t=>t.type==='page' && t.url.includes('framework.html')); if(!page) await sleep(250);
 }
 assert.ok(page,'Application window');
 const {sessionId}=await send('Target.attachToTarget',{targetId:page.targetId,flatten:true});
 const ev=async (expression)=>{
  const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},sessionId);
  if(r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);
  return r.result.value;
 };
 await send('Page.enable',{},sessionId);await send('Runtime.enable',{},sessionId);

 for(let i=0;i<60 && !(await ev('!!window.sysmocapApp'));i++) await sleep(200);
 assert.equal(path.resolve(await ev("require('@electron/remote').getGlobal('storagePath').jsonPath")),path.join(profile,'profile.json'),'Isolated test profile');
 const previousShirt=process.argv.includes('--shirt-before');
 const previousSleeve=process.argv.includes('--sleeve-before');
 const interfaceCheck=process.argv.includes('--rig-interface-check');
 const avatarFile=interfaceCheck?require('./rig-interface-check.cjs').fixture(fixture,profile):fixture;
 const avatar=require('node:url').pathToFileURL(path.resolve(avatarFile)).href;
 const video=path.resolve(videoFile);
 const obsCheck=process.argv.includes('--obs-check');
 const obsPort=process.argv.includes('--obs-studio')?8080:18081;
 if(obsCheck)await ev(`Object.assign(window.sysmocapApp.settings.forward,{enableForwarding:true,port:'${obsPort}',supportForWebXR:true})`);
 await ev(`(()=>{let a=window.sysmocapApp;a.tab='render';a.settings.performance.useDescrertionProcess=false;a.videoSource='file';a.videoPath=[${JSON.stringify(video)}];a.selectModel=JSON.stringify({name:${JSON.stringify(option('parts-check') || option('framing-check') || (interfaceCheck?'Rig interface sample':'Fluffo'))},path:${JSON.stringify(avatar)}});})()`);
 if(obsCheck)await ev("(()=>{const a=window.sysmocapApp, model=JSON.parse(a.selectModel);model.path=require('url').fileURLToPath(model.path);model.type='vrm';a.selectModel=JSON.stringify(model)})()");
 if(process.argv.includes('--discrete-check')){
   await ev(`(()=>{const {BrowserView,getCurrentWindow}=require('@electron/remote');const w=getCurrentWindow();if(!w.getBrowserView()){const view=new BrowserView({webPreferences:{nodeIntegration:true,nodeIntegrationInSubFrames:true,contextIsolation:false,backgroundThrottling:false}});w.setBrowserView(view);require('@electron/remote').require('@electron/remote/main').enable(view.webContents);}sysmocapApp.settings.performance.useDescrertionProcess=true;})()`);
 }
 await ev("document.querySelector('[onclick*=startMocap]').click()");
 if(process.argv.includes('--discrete-check')){
   const wait=async expression=>{for(let i=0;i<120;i++){if(await ev(expression))return;await sleep(125);}throw Error(expression+' '+JSON.stringify(await ev("(()=>{const a=sysmocapApp,v=require('@electron/remote').getCurrentWindow().getBrowserView();return {running:a.running,model:a.modelReady,input:a.inputReady,error:a.captureError,source:v.webContents.getURL()}})()")));};
   await wait("sysmocapApp.outputOpen && sysmocapApp.facePresent");
   const nativeView="require('@electron/remote').getCurrentWindow().getBrowserView()";
   if(process.argv.includes('--performance-controls-check')){
      const capture=code=>ev(nativeView+'.webContents.executeJavaScript('+JSON.stringify(code)+')');
      await capture(`(()=>{const proto=Holistic.prototype,apply=proto.setOptions,send=proto.send;
          window.levelProbe={level:null,completed:0};
          proto.setOptions=function(options){levelProbe.level=options.modelComplexity;levelProbe.completed=0;return apply.call(this,options);};
          proto.send=async function(input){await send.call(this,input);levelProbe.completed++;};})()`);
      for(const level of ['2','0','1']){
         await ev(`(()=>{const f=document.querySelector('#body-tracking-level');f.value='${level}';f.dispatchEvent(new Event('change'));})()`);
         let applied=false;
         for(let i=0;i<60 && !applied;i++){
            await sleep(100);
            applied=await capture('levelProbe.level==='+level+' && levelProbe.completed>=3');
         }
         assert.ok(applied,'Discrete inference did not resume at level '+level);
      }
   }
   const checkbox="document.querySelector('.preview-switch input')";
   await ev("if(!"+checkbox+".checked)"+checkbox+".click()");
   await wait(nativeView+".getBounds().width>1");
   await ev(checkbox+".click()");
   await wait(nativeView+".getBounds().width===0");
   await ev("document.querySelector('.primary').click()");
   await wait(nativeView+".webContents.getURL()==='about:blank' && !sysmocapApp.outputOpen");
   console.log('Discrete capture passed: video, tracked face, output, native preview bounds and stop');
   return;
 }
 let state;
 for(let i=0;i<100;i++){
   state=await ev("(()=>{const w=document.querySelector('#foo').contentWindow,v=w.document.querySelector('video'),st=w.document.querySelector('#app')?.__vue_app__?._instance?.proxy?.$refs?.stage;return {model:!!w.currentVrm,video:v?.currentTime,error:v?.error?.message,stage:!!st,src:v?.currentSrc}})()");
   if(state.model && state.video>0.4)break;
   await sleep(200);
 }
 console.log('Loaded:',state);if(process.argv.includes('--diagnose')){await sleep(2200);console.log('lookAt present:',await ev('!!document.querySelector('+JSON.stringify('#foo')+').contentWindow.currentVrm?.lookAt'));return;}
 assert.ok(state.model && state.video>0,'Could not load video and VRM');
 if(process.argv.includes('--hand-trace')){
   await require('./hand-trace.cjs')({ev,output});
   return;
 }
 if(process.argv.includes('--performance-controls-check') && !obsCheck){
   await require('./performance-controls-check.cjs')({ev,sleep});
   return;
 }
 if(process.argv.includes('--ear-check')){
   for(let i=0;i<80 && !await ev('sysmocapApp.outputOpen');i++)await sleep(100);
   await require('./ear-check.cjs')({ev,output});return;
 }
 if(process.argv.includes('--fur-edge-check')){
   for(let i=0;i<80 && !await ev('sysmocapApp.outputOpen');i++)await sleep(100);
   await require('./fur-edge-check.cjs')({ev,output});return;
 }
 if(process.argv.includes('--eye-fit-check')){
   for(let i=0;i<80 && !await ev('sysmocapApp.outputOpen');i++)await sleep(100);
   await require('./eye-fit-check.cjs')({ev,output,fixture});return;
 }
 if(process.argv.includes('--builtin-scene-check')){
   for(const name of ['IceDwen','Mousey']){
     await ev("document.querySelector('.primary').click()");
     await sleep(600);
     await ev(`sysmocapApp.selectModel=JSON.stringify(sysmocapApp.builtIn.find(m=>m.name===${JSON.stringify(name)}))`);
     await sleep(100);
     await ev("document.querySelector('.primary').click()");
     for(let i=0;i<120 && !await ev('sysmocapApp.outputOpen && sysmocapApp.facePresent');i++)await sleep(100);
     assert.ok(await ev("sysmocapApp.outputOpen && sysmocapApp.facePresent"),name+' did not start');
     const joints=await ev(`(async()=>{
       const w=document.querySelector('#foo').contentWindow;
       const {scene}=w.document.querySelector('#app')._vnode.component.proxy.$refs.stage.avatar;
       const {binding}=JSON.parse(sysmocapApp.selectModel);
       const camera=await new Promise(ok=>{const old=scene.onAfterRender;scene.onAfterRender=(r,s,c)=>{scene.onAfterRender=old;ok(c);};});
       return ['Head','LeftUpperArm','RightUpperArm'].map(key=>{
         const mapped=binding[key] ?? (key==='Head' && binding.Neck);
         const b=scene.getObjectByName(mapped.name);
         return b.getWorldPosition(b.position.clone()).project(camera).toArray();
       });
     })()`);
     assert.ok(joints.every(p=>p.every(v=>Math.abs(v)<1)),name+' MCU joints outside the camera '+JSON.stringify(joints));
     await require('./scene-controls-check.cjs')({ev,sleep,send,sessionId});
     const fields=await ev(`(()=>{const p=document.querySelector('#broadcast-settings'),shown=k=>!p.querySelector('[name="'+k+'"]').closest('label').hidden;
       return {body:shown('body'),arm:shown('returnMs'),face:shown('blink')};})()`);
     assert.deepEqual(fields,{body:true,arm:true,face:false});
     console.log(name,'scene and bone-specific tracking controls passed');
   }
   return;
 }
 if(process.argv.includes('--controller-check') || process.argv.includes('--panel-check')){
   await require('./controller-check.cjs')({ev,sleep,send,sessionId,output});
   return;
 }
 if(process.argv.includes('--avatar-output-check')){
   await require('./avatar-output-check.cjs')({ev,send,sleep,output});
   return;
 }
 // Renderer-oriented checks inspect the canvas after docking it in the controller.
 for(let i=0;i<80 && !(await ev('window.sysmocapApp.outputOpen'));i++)await sleep(100);
 if(!interfaceCheck && !process.argv.includes('--appearance-check') && !process.argv.includes('--wardrobe-check') && !process.argv.includes('--eyelid-rest-check') && !option('parts-check') && !option('framing-check') && !process.argv.includes('--scene-check') && !process.argv.includes('--tracking-check'))await ev("if(window.sysmocapApp.outputOpen)document.querySelector('#foo').contentDocument.querySelector('#avatar-output-toggle').click()");
 if(process.argv.includes('--camera-preview-check')){
   const read=()=>ev(`(()=>{
     const w=document.querySelector('#foo').contentWindow,d=w.document;
     const toggle=d.querySelector('[name=cameraPreview]'),video=d.querySelector('.input_video');
     const stage=d.querySelector('#app')?._vnode?.component?.proxy?.$refs?.stage;
     if(!toggle || !video || !stage?._lastData?.fluffoRig)return null;
     return {checked:toggle.checked,video:w.getComputedStyle(video).visibility,
       guides:w.getComputedStyle(d.querySelector('canvas.guides')).visibility,
       avatar:w.getComputedStyle(d.querySelector('#model canvas')).visibility,
       playing:!video.paused,frame:stage._lastData.fluffoRig.frame,face:stage._lastData.fluffoRig.faceStamp};
   })()`);
   const click=()=>ev("document.querySelector('#foo').contentDocument.querySelector('[name=cameraPreview]').click()");
   const guideCalls=()=>ev(`(async()=>{
      const w=document.querySelector('#foo').contentWindow,original=w.drawConnectors;
      let calls=0;
      w.drawConnectors=function(...args){calls++;return original.apply(this,args);};
      try{await new Promise(resolve=>setTimeout(resolve,500));return calls;}
      finally{w.drawConnectors=original;}
   })()`);
   async function waitForTracking(matches=()=>true){
     let state;
     for(let i=0;i<80;i++){state=await read();if(Number.isFinite(state?.face) && matches(state))return state;await sleep(100);}
     throw Error('Preview state did not settle: '+JSON.stringify(state));
   }
   const visible=await waitForTracking();
   assert.ok(visible.checked && visible.video==='visible' && visible.guides==='visible');
   assert.ok(await guideCalls()>0);
   await click();
   const hidden=await waitForTracking(s=>!s.checked && s.video==='hidden');
   assert.ok(!hidden.checked && hidden.video==='hidden' && hidden.guides==='hidden' && hidden.avatar==='visible');
   await sleep(1500);
   const tracked=await waitForTracking();
   assert.ok(tracked.playing && tracked.frame!==hidden.frame && tracked.face!==hidden.face,'Tracking stopped with the preview hidden');
   assert.equal(await guideCalls(),0,'Hidden input still draws tracking guides');
   await ev("(()=>{const w=document.querySelector('#foo').contentWindow;w.document.documentElement.dataset.previewReload='pending';w.location.reload();})()");
   for(let i=0;i<80 && await ev("document.querySelector('#foo').contentDocument?.documentElement?.dataset.previewReload==='pending'");i++)await sleep(100);
   assert.ok(!await ev("document.querySelector('#foo').contentDocument?.documentElement?.dataset.previewReload==='pending'"),'Preview frame did not reload');
   const restored=await waitForTracking();
   assert.ok(!restored.checked && restored.video==='hidden' && restored.guides==='hidden');
   await click();
   const shown=await waitForTracking(s=>s.checked && s.video==='visible' && s.guides==='visible' && s.playing);
   assert.ok(shown.checked && shown.video==='visible' && shown.guides==='visible' && shown.playing);
   assert.ok(await guideCalls()>0,'Input guides did not resume');
   console.log('Camera preview toggle, hidden face tracking and saved preference passed');
   return;
 }
 if(process.argv.includes('--live-controls')){
   const result=await ev(`(async()=>{
      const frame=document.querySelector('#foo'),w=frame.contentWindow,d=w.document;
      const stage=d.querySelector('#app')._vnode.component.proxy.$refs.stage;
      const panel=d.getElementById('fluffo-smoothness');
      const camera=await new Promise(resolve=>{const s=stage.avatar.scene,prev=s.onAfterRender;s.onAfterRender=(r,sc,c)=>{s.onAfterRender=prev;resolve(c)}});
      const light=stage.avatar.scene.children.find(o=>o.isDirectionalLight);
      const model=d.querySelector('#model'), canvas=model.querySelector('canvas');
      const original=camera.position.toArray(),mirror=model.style.transform;
      panel.open=true;
      const set=(key,value)=>{const el=panel.querySelector('[name="'+key+'"]');el.value=value;el.dispatchEvent(new w.Event('input',{bubbles:true}));};
      for(const [key,val] of Object.entries({yaw:25,pitch:14,side:.1,height:.08,distance:1.3,fov:49.4,body:.52,mouth:.72,blink:.55,expression:.99,depth:1.2,emotion:'happy',mirror:'on',contrast:1.2,light:.7}))set(key,val);
      await new Promise(resolve=>setTimeout(resolve,500));
      const current=stage._lastData?.fluffoRig?.liveControls;
      const values={count:panel.querySelectorAll('[name]').length,fov:camera.fov,positionChanged:camera.position.toArray().some((x,i)=>Math.abs(x-original[i])>.02),mirror:model.style.transform,fx:canvas.style.filter,
        light:light.intensity,happy:w.currentVrm.expressionManager.getValue('happy'),saved:JSON.parse(w.localStorage.getItem('fluffo.live-controls.v1')),forwarded:current};
      panel.querySelector('button').click();
      values.reset=camera.fov===35 && camera.position.toArray().every((x,i)=>Math.abs(x-original[i])<.00001) && canvas.style.filter==='' && model.style.transform===mirror;
      const a=frame.getBoundingClientRect(),b=panel.getBoundingClientRect();
      values.clip={x:a.x+b.x,y:a.y+b.y,width:b.width,height:b.height,scale:1};
      return values;
   })()`);
   console.log('Live controls',result.count,result.fov,result.happy,result.fx,result.reset);
   assert.ok(result.count>=23 && result.positionChanged && result.fov===49.4 && result.mirror==='scaleX(-1)');
   assert.ok(result.fx.includes('contrast(1.2)') && Math.abs(result.light-.7*Math.PI)<.001 && result.happy>.9);
   assert.ok(result.saved.mouth===.72 && result.forwarded.expression===.99 && result.reset);
   const shot=await send('Page.captureScreenshot',{format:'png',clip:result.clip},sessionId);
   fs.writeFileSync(path.resolve(output,'Fluffo-live-controls.png'),Buffer.from(shot.data,'base64'));
   await ev(`(()=>{const frame=document.querySelector('#foo'),w=frame.contentWindow,input=w.document.querySelector('[name=mouth]');
        input.value=.72;input.dispatchEvent(new w.Event('input'));w.location.reload();})()`);
   let restored;
   for(let i=0;i<70;i++){
      await sleep(200);
      restored=await ev("document.querySelector('#foo')?.contentDocument?.querySelector('#fluffo-smoothness [name=mouth]')?.value");
      if(restored)break;
   }
   assert.equal(restored,'0.72','Reloaded controls did not restore the saved mouth setting');
   console.log('Reloaded mouth setting',restored);
   return;
 }
 if(obsCheck){
   const url='http://127.0.0.1:'+obsPort+'/';
   const response=await fetch(url+'modelInfo');assert.ok(response.ok);console.log('Forwarded model:',await response.json());
   const nativeObs=process.argv.includes('--obs-studio');
   const edge=await require('./obs-browser-check.cjs')(nativeObs?19287:null);
   try{
   await edge.send('Runtime.enable');await edge.send('Page.enable');await edge.send('Network.enable');
   await edge.send('Emulation.setDefaultBackgroundColorOverride',{color:{r:0,g:0,b:0,a:0}});
   await edge.send('Page.navigate',{url});
   const positions=[];
   for(let i=0;i<40;i++){
     await sleep(250);
     const result=await edge.send('Runtime.evaluate',{expression:"(()=>{const m=window.currentVrm;if(!m)return null;return [m.meta.name ?? m.meta.title,m.expressionManager.getValue('aa'),m.humanoid.getNormalizedBoneNode('rightLowerArm').quaternion.toArray()]})()",returnByValue:true});
     if(result.result.value)positions.push(result.result.value);
     if(positions.length>=10)break;
   }
   if(process.argv.includes('--appearance-check')){
      assert.ok(positions.length);await require('./appearance-check.cjs')({ev,edge,output,sleep});assert.equal(edge.exceptions.size,0);return;
   }
   if(process.argv.includes('--performance-controls-check')){
      assert.ok(positions.length,'Receiver did not load the avatar');
      const receiver=expression=>edge.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true}).then(r=>r.result.value);
      await receiver(`new Promise(ok=>{const scene=window.currentVrm.scene.parent,old=scene.onAfterRender;
        scene.onAfterRender=(r,s,c)=>{scene.onAfterRender=old;window.readOutputFrames=()=>[r.info.render.frame,performance.now()];ok(true);};})`);
      for(const [mode,cap] of [['30fps',30],['60fps',60],['unlimited',Infinity]]){
         await ev(`(()=>{const field=document.querySelector('#broadcast-settings [name=outputFps]');field.value='${mode}';field.dispatchEvent(new Event('input'));})()`);
         await sleep(500);
         const [frames,time]=await receiver('readOutputFrames()');
         await sleep(2500);
         const [end,stop]=await receiver('readOutputFrames()');
         const fps=(end-frames)*1000/(stop-time);
         console.log('Browser output',mode,fps);
         assert.ok(fps>5 && fps<cap+2);
      }
      assert.equal(edge.exceptions.size,0);return;
   }
   if(interfaceCheck){
      await require('./rig-interface-check.cjs').check({ev,edge,sleep,positions});
      assert.equal(edge.exceptions.size,0);return;
   }
   if(option('framing-check')){
      assert.ok(positions.length,'Receiver did not load the avatar');
      await require('./framing-check.cjs')({ev,edge,send,sleep,output,name:option('framing-check')});
      assert.equal(edge.exceptions.size,0);return;
   }
   if(option('parts-check')){
      assert.ok(positions.length,'Receiver did not load the avatar');
      await require('./auto-wardrobe-check.cjs')({ev,edge,send,sessionId,output,sleep,name:option('parts-check')});
      assert.equal(edge.exceptions.size,0);return;
   }
   if(process.argv.includes('--tracking-check')){
      assert.ok(positions.length,'Receiver did not load the avatar');
      await require('./tracking-controls-check.cjs')({ev,edge,sleep});
      assert.equal(edge.exceptions.size,0);
      return;
   }
   if(process.argv.includes('--scene-check')){
      assert.ok(positions.length,'Receiver did not load the avatar');
      await require('./scene-controls-check.cjs')({ev,edge,sleep,send,sessionId});
      assert.equal(edge.exceptions.size,0,'Browser threw during rendering');
      return;
   }
   if(process.argv.includes('--eyelid-rest-check')){
      await require('./eyelid-rest-check.cjs')({ev,edge,sleep});
   }else if(process.argv.includes('--wardrobe-check')){
      await require('./wardrobe-check.cjs')({ev,edge,output,sleep});
   }else if(process.argv.includes('--background-check')){
      const ui=action=>ev(`(()=>{const f=document.querySelector('#foo'),w=f.contentWindow,p=w.document.querySelector('#fluffo-smoothness');
          const mode=p.querySelector('[name=backgroundMode]'),hex=p.querySelector('[aria-label="배경 색상 HEX"]');
          const set=(input,value,event='input')=>{input.value=value;input.dispatchEvent(new w.Event(event,{bubbles:true}));};
          ${action}
      })()`);
      const clip=await ui(`const b=f.getBoundingClientRect(),c=w.document.querySelector('#model canvas').getBoundingClientRect();
          return {x:b.left+c.left+18,y:b.top+c.top+18,width:2,height:2,scale:1};`);
      async function pixel(capture,clip){
          const {data}=await capture({format:'png',clip});
          // Electron's nativeImage returns BGRA bytes on Windows.
          return ev("(()=>{const b=require('electron').nativeImage.createFromDataURL('data:image/png;base64,"+data+"').toBitmap();return [b[2],b[1],b[0],b[3]]})()");
      }
      const preview=params=>send('Page.captureScreenshot',params,sessionId);
      const receiver=params=>edge.send('Page.captureScreenshot',params);
      const corner={x:18,y:18,width:2,height:2,scale:1};
      async function checkColor(mode,color){
          let remote;
          for(let i=0;i<18;i++){
              remote=await pixel(receiver,corner);
              if(remote.join()===color.join())break;
              await sleep(100);
          }
          assert.deepEqual(remote,color,mode+' receiver pixel');
          if(color[3])assert.deepEqual(await pixel(preview,clip),color,mode+' preview pixel');
          console.log(mode,remote);
      }
      assert.equal(await ui("return mode.value"),'green');
      await checkColor('green',[0,255,0,255]);
      const sample=await receiver({format:'png'});
      fs.writeFileSync(path.resolve(output,'Fluffo-green-screen.png'),Buffer.from(sample.data,'base64'));
      await ui("set(p.querySelector('[name=saturation]'),0);set(mode,'blue')");
      await checkColor('blue',[0,0,255,255]);
      await ui("set(mode,'custom');set(hex,'27668b','change')");
      assert.equal(await ui("return !hex.parentElement.hidden"),true);
      await checkColor('custom',[39,102,139,255]);
      await ui("w.location.reload()");
      let restored;
      for(let i=0;i<50;i++){await sleep(200);restored=await ev("document.querySelector('#foo').contentDocument.querySelector('[name=backgroundColor]')?.value");if(restored)break;}
      assert.equal(restored,'#27668b');assert.equal(await ui("return mode.value"),'custom');
      await ui("set(mode,'transparent')");
      await checkColor('transparent',[0,0,0,0]);
      assert.equal(await ui("return hex.parentElement.hidden"),true);
      await ui("p.querySelector('button').click()");
      await checkColor('reset',[0,255,0,255]);
   }else if(process.argv.includes('--obs-controls')){
      await ev(`(()=>{const w=document.querySelector('#foo').contentWindow,p=w.document.getElementById('fluffo-smoothness');
         for(const [key,val] of Object.entries({mirror:'on',contrast:1.3,fov:57,light:.8})){
            const input=p.querySelector('[name='+key+']');input.value=val;input.dispatchEvent(new w.Event('input'));
         }})()`);
      let applied;
      for(let i=0;i<25;i++){
         await sleep(150);
         const response=await edge.send('Runtime.evaluate',{expression:`(async()=>{
             const scene=window.currentVrm.scene.parent,canvas=document.querySelector('canvas');
             const camera=await new Promise(resolve=>{const prev=scene.onAfterRender;scene.onAfterRender=(r,s,c)=>{scene.onAfterRender=prev;resolve(c)}});
             return {fov:camera.fov,mirror:canvas.style.transform,fx:canvas.style.filter,
                light:scene.children.find(o=>o.isDirectionalLight).intensity,panel:!!document.querySelector('#fluffo-smoothness')};
         })()`,returnByValue:true,awaitPromise:true});
         applied=response.result.value;
         if(applied?.fov===57)break;
      }
      console.log('Independent browser controls',applied);
      assert.ok(applied?.fov===57 && applied.mirror==='scaleX(-1)' && applied.fx.includes('contrast(1.3)') && !applied.panel);
      assert.ok(Math.abs(applied.light-.8*Math.PI)<.001);
   }else{
      const frame=await edge.send('Page.captureScreenshot',{format:'png'});
      fs.writeFileSync(path.resolve(output,nativeObs?'Fluffo-OBS-Studio.png':'Fluffo-OBS-browser.png'),Buffer.from(frame.data,'base64'));
   }
   console.log('Browser samples:',JSON.stringify(positions.slice(0,3)));
   assert.ok(positions.length && positions[0][0]==='Fluffo GTA VI','Browser did not load Fluffo');
   assert.ok(new Set(positions.map(x=>x[1])).size>=3,'Browser mouth is stationary');
   assert.ok(new Set(positions.map(x=>JSON.stringify(x[2]))).size>=3,'Browser arm is stationary');
   assert.equal(edge.exceptions.size,0,'Browser threw during rendering');
   }finally{edge.close();}
   return;
 }
 if(process.argv.includes('--return-check')){
   const mod=require('node:url').pathToFileURL(path.resolve(root,'src/mocap/fluffoMcu.mjs')).href;
   const result=await ev(`(async()=>{
     const w=document.querySelector('#foo').contentWindow,m=w.currentVrm,scene=m.scene.parent;
     const camera=await new Promise(r=>{scene.onAfterRender=(_,__,c)=>{scene.onAfterRender=()=>{};r(c.clone())};});
     m.humanoid.resetNormalizedPose();m.update(0);m.scene.updateMatrixWorld(true);
     const {createRigView,avatarRigProfile}=await import(${JSON.stringify(mod)});
     const {readAvatarHeader}=await import(new URL('fluffoRigCapture.mjs',${JSON.stringify(mod)}).href);
     const profile=avatarRigProfile(readAvatarHeader(JSON.parse(localStorage.getItem('modelInfo')).path));
     const canvas=w.document.createElement('canvas');w.document.createElement('div').append(canvas);
     const view=createRigView(m,camera,{target:camera.position.clone(),domElement:canvas,update(){}},profile,null);
     let now=2000;
     const upper=m.humanoid.getNormalizedBoneNode('rightUpperArm'),rest=upper.quaternion.clone();
     function tick(y,count){
       for(let i=0;i<count;i++){
         now+=1000/60;
         const right=y===null?null:{palmY:y,wristY:y,stamp:now/1000,
           x:.34,y:-.09,depth:.72,elbow:null,wristRotation:{x:.2,y:.1,z:-.3},palmVisible:true};
         view.applyHands({time:now/1000,right},now);
       }
       return upper.quaternion.clone();
     }
     const tracked=tick(.68,65),occluded=tick(null,7),duringHold=tracked.angleTo(occluded);
     tick(.76,9);tick(.89,3);tick(.98,3);
     const lostAt=now;
     tick(null,4);const exitDelay=view.exits.right-lostAt;
     const mid=tick(null,11);
     const reacquired=tick(.70,1),cancelled=view.exits.right===undefined;
     tick(.70,30);tick(.84,4);tick(.97,3);tick(null,4);
     const start=view.exits.right;
     tick(null,26);const nearRest=upper.quaternion.angleTo(rest);
     tick(null,4);
     return {duringHold,exitDelay,cancelled,reacquireDelta:mid.angleTo(reacquired),nearRest,
       settled:upper.quaternion.angleTo(rest),elapsed:now-start};
   })()`);
   console.log(result);assert.ok(result.duringHold<.01 && result.exitDelay>=40 && result.exitDelay<70);
   assert.ok(result.cancelled && result.reacquireDelta>.001 && result.settled<.005 && result.nearRest<.03);
   return;
 }
 if(previousSleeve || process.argv.includes('--sleeve-live')){
   const dir=output;
   const live=process.argv.includes('--sleeve-live');
   const dataName=input?'fluffo-'+path.parse(input).name:live?'fluffo-sleeve-return':'fluffo-chest-fit';
   const data=JSON.parse(fs.readFileSync(path.join(dir,dataName+'.json'))).samples;
   const poses=input?data.filter((_,i)=>i%4===0):[4,20.84,21.23,21.84,22.35].map(t=>data.reduce((a,b)=>Math.abs(a.t-t)<Math.abs(b.t-t)?a:b));
   if(live && !input)poses.push(...data.filter(s=>s.t>=20.6 && s.t<23.3 && !poses.includes(s)));
   const name=input?path.parse(input).name:live?'live':'before';
   const script=fs.readFileSync(path.join(__dirname,'sleeve-review.js'),'utf8');
   await ev('('+script+')('+[poses,dir,name,!!input].map(x=>JSON.stringify(x)).join(',')+')');
   return;
 }
 if(previousShirt || process.argv.includes('--shirt-after')){
   const dir=output;
   const takes=JSON.parse(fs.readFileSync(path.join(dir,'fluffo-hand-recovery.json'))).samples;
   const selected=[4,21.96].map(t=>takes.reduce((best,s)=>Math.abs(s.t-t)<Math.abs(best.t-t)?s:best));
   const code=fs.readFileSync(path.join(__dirname,'shirt-fit-review.js'),'utf8');
   const png=await ev('('+code+')('+JSON.stringify(selected)+')');
   fs.writeFileSync(path.join(dir,'fluffo-chest-'+(previousShirt?'before':'after')+'.png'),Buffer.from(png,'base64'));
   return;
 }
 if(process.argv.includes('--hand-gap-check')){
   const driver=require('node:url').pathToFileURL(path.resolve(root,'src/mocap/fluffoRigDriver.mjs')).href;
   const result=await ev(`(async()=>{
     const vrm=document.querySelector('#foo').contentWindow.currentVrm;
     vrm.humanoid.resetNormalizedPose();vrm.update(0);
     const {createRigDriver}=await import(${JSON.stringify(driver)});
     const drive=createRigDriver(vrm),curls=Array.from({length:4},()=>[1,1]);
     const angle=side=>2*Math.acos(Math.min(1,Math.abs(vrm.humanoid.getNormalizedBoneNode(side+'MiddleIntermediate').quaternion.w)))*180/Math.PI;
     let now=1000;
     const tick=(hand,frames,stamp=null)=>{
       for(let i=0;i<frames;i++){now+=1000/60;
         drive({frame:now/1000,right:hand,handStamp:{right:stamp??now/1000}},now);}
       return angle('right');
     };
     const closed=tick(curls,48);
     const shortGap=tick(null,8),partialRelease=tick(null,9),rest=tick(null,30);
     const reacquired=tick(curls,1),reclosed=tick(curls,40),lastValid=now/1000;
     const afterRepeatedCrop=tick(curls,50,lastValid);
     return {closed,shortGap,partialRelease,rest,reacquired,reclosed,afterRepeatedCrop,left:angle('left')};
   })()`);
   assert.ok(result.closed>58 && Math.abs(result.shortGap-result.closed)<1);
   assert.ok(result.rest<8 && result.partialRelease<result.shortGap-5 && result.partialRelease>result.rest+5);
   assert.ok(result.reacquired>result.rest+5 && result.reclosed>58);
   assert.ok(result.afterRepeatedCrop<8 && result.left<8);
   console.log(result);return;
 }
 if(process.argv.includes('--rig-controls')){
   const dir=output;
   const frames=fs.mkdtempSync(path.join(os.tmpdir(),'fluffo-rig-frames-'));
   const base=require('node:url').pathToFileURL(path.resolve(root,'src/mocap')+path.sep).href;
   const code=fs.readFileSync(path.join(__dirname,'rig-controls.js'),'utf8');
   const report=await ev('('+code+')('+[dir,frames,base].map(x=>JSON.stringify(x)).join(',')+')');
   fs.writeFileSync(path.join(dir,'fluffo-rig-controls.json'),JSON.stringify(report,null,2));
   assert.equal(report.facial.length,51);
   assert.deepEqual(report.facial.filter(x=>x.maxDisplacement<1e-5),[],'Every facial input must deform a mesh');
   assert.equal(Object.keys(report.fingers).length,16);
   assert.ok(Object.values(report.fingers).every(angle=>angle>20));
   assert.ok(report.maxVertexTravel>.002 && report.handVertices>0,'Paw geometry must move');
   assert.ok(Object.values(report.limbs).every(angle=>angle>2));
   const render=require('node:child_process').spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-framerate','30','-i',path.join(frames,'%03d.jpg'),'-c:v','libx264','-preset','fast','-crf','17','-pix_fmt','yuv420p','-movflags','+faststart',path.join(dir,'Fluffo-Animaze-idle.mp4')],{windowsHide:true});
   assert.equal(render.status,0,String(render.stderr));
   for(const name of fs.readdirSync(frames))fs.unlinkSync(path.join(frames,name));
   fs.rmdirSync(frames);
   console.log('Controlled tests',report.facial.length,report.fingers,report.idleFrames);return;
 }
 if(process.argv.includes('--wink-check')){
   const driver=require('node:url').pathToFileURL(path.resolve(root,'src/mocap/fluffoRigDriver.mjs')).href;
   const measurements=await ev(`(async()=>{
     const vrm=document.querySelector('#foo').contentWindow.currentVrm;
     const {createRigDriver}=await import(${JSON.stringify(driver)});
     const meshes=[];
     vrm.scene.traverse(o=>{if(o.morphTargetDictionary?.eyeBlinkLeft!==undefined && o.morphTargetDictionary?.eyeBlinkRight!==undefined)meshes.push(o)});
     if(!meshes.length)throw Error('No bilateral eyelid morphs');
     const rows=[];
     for(const side of ['Left','Right']){
       const drive=createRigDriver(vrm),other=side==='Left'?'Right':'Left';
       let minimum=1,oppositeMaximum=0,reopenMs=null;
       for(let t=0;t<=800;t+=10){
         const stamp=1+Math.floor(t/40)*.04;
         const closed=t<100?.93:t<640?[.61,.81,.68][Math.floor(t/40)%3]:0;
         const scores=t>=240 && t<480?null:{['eyeBlink'+side]:closed,['eyeBlink'+other]:.05,
           ['eyeLookOut'+side]:t%80?.7:.2,['eyeWide'+side]:.4,['eyeSquint'+side]:.3};
         const backup=side==='Left'?{l:1,r:0}:{l:0,r:1};
         drive({frame:1+t/1000,faceStamp:stamp,scores},1000+t,true,null,{},null,t<640?backup:{l:1,r:1});
         vrm.update(.01);
         const weight=(m,s)=>m.morphTargetInfluences[m.morphTargetDictionary['eyeBlink'+s]];
         if(t>=150 && t<640){
           minimum=Math.min(minimum,...meshes.map(m=>weight(m,side)));
           oppositeMaximum=Math.max(oppositeMaximum,...meshes.map(m=>weight(m,other)));
         }
         if(t>=640 && reopenMs===null && meshes.every(m=>weight(m,side)<.05))reopenMs=t-640;
       }
       rows.push({side,minimum,oppositeMaximum,reopenMs,meshes:meshes.length});
     }
     return rows;
   })()`);
   console.log('Fluffo eyelid morphs:',measurements);
   for(const row of measurements)assert.ok(row.minimum>.98 && row.oppositeMaximum<.08 && row.reopenMs!==null && row.reopenMs<=130);
   return;
 }
 if(process.argv.includes('--rig-probe')){
   const diag=await ev(`(async()=>{
     const w=document.querySelector('#foo').contentWindow,d=w.document;
     const stage=d.querySelector('#app')._vnode.component.proxy.$refs.stage;
     for(let i=0;i<60;i++){let rig=stage._lastData?.fluffoRig;if(rig?.scores)return {channels:Object.keys(rig.scores),jaw:rig.scores.jawOpen};await new Promise(r=>setTimeout(r,140))}
     return {rig:stage._lastData?.fluffoRig};
   })()`); console.log('Rig capture',diag);if(!diag.channels)throw Error('Face scores unavailable');return;
 }

 if(process.argv.includes('--arm-inspect')){
   const dir=output;
   const packet=await ev(`(async()=>{
     const w=document.querySelector('#foo').contentWindow,d=w.document,v=d.querySelector('video'),m=w.currentVrm,sc=m.scene.parent;
     d.querySelectorAll('.targetButton')[2].click();
     v.currentTime=20;
     sc.onBeforeRender=renderer=>renderer.setClearColor(0x52677a,1);
     return await new Promise((resolve,reject)=>{
       let armed=true;
       sc.onAfterRender=(renderer,scene,camera)=>{
         if(!armed || v.currentTime<21.16) return;
         const joints=Object.fromEntries(['rightUpperArm','rightLowerArm','rightHand'].map(k=>{
           const b=m.humanoid.getRawBoneNode(k),p=b.getWorldPosition(b.position.clone()).project(camera);
           return [k,[(1+p.x)/2,(1-p.y)/2]];
         }));
         if(joints.rightHand[1]>0.92 && v.currentTime<21.42) return;
         armed=false;
         const snap=()=>renderer.domElement.toDataURL('image/png').split(',')[1];
         const dressed=snap(),muted=[];
         m.scene.traverse(o=>{if(!o.isMesh||!o.visible)return;
           const names=[o.name,...[o.material].flat().map(mat=>mat?.name)].join(' ');
           if(/sleeve|cuff.?hem/i.test(names)){muted.push(o);o.visible=false}
         });
         renderer.render(scene,camera);
         const exposed=snap();
         for(const o of muted)o.visible=true;
         resolve({dressed,exposed,joints,time:v.currentTime,hidden:muted.map(o=>o.name)});
       };
       setTimeout(()=>reject(new Error('Arm capture timed out')),9000);
     });
   })()`);
   for(const key of ['dressed','exposed'])fs.writeFileSync(path.join(dir,'arm-inspect-'+key+'.png'),Buffer.from(packet[key],'base64'));
   delete packet.dressed;delete packet.exposed;
   fs.writeFileSync(path.join(dir,'arm-inspect.json'),JSON.stringify(packet));console.log(packet);return;
 }

 const fullHD=process.argv.includes('--1080p60');
 const liveHD=process.argv.includes('--live-1080p');
 const baseStem=input?'fluffo-'+path.parse(input).name:process.argv.includes('--return-motion')?'fluffo-sleeve-return':process.argv.includes('--shirt-motion')?'fluffo-chest-fit':
     process.argv.includes('--hand-recovery')?'fluffo-hand-recovery':'fluffo-rig-coverage';
 const take=process.argv.find(arg=>arg.startsWith('--take='))?.slice(7);
 if(take && !/^[a-z0-9-]+$/i.test(take))throw Error('Invalid recording name');
 const stem=baseStem+(take?'-'+take:'')+(fullHD?'-1080p60':liveHD?'-live1080p':'');
 const out=path.resolve(output,stem+(fullHD?'.ivf':'.webm'));
 const info=await ev(`(async()=>{
   const w=document.querySelector('#foo').contentWindow,d=w.document,v=d.querySelector('video'),canvas=d.querySelector('#model canvas'),m=w.currentVrm;
   const scene = m.scene.parent;
   const fullHD=${fullHD};
   let renders=0;
   const faceFrames=[];
   let measuring=false;
   let reviewCamera;
   scene.onBeforeRender = (renderer, sc, camera) => {
     if(${fullHD || liveHD} && (canvas.width!==1920 || canvas.height!==1080))renderer.setDrawingBufferSize(1920,1080,1);
     if(!v.paused) renders++;
     if(measuring && !v.paused && v.currentTime!==faceFrames.at(-1)?.t){
       const expr=m.expressionManager;
       faceFrames.push({t:v.currentTime,aa:expr.getValue('aa'),blink:expr.getValue('blink')});
     }
     renderer.setClearColor(0x52677a, 1);
     reviewCamera = camera;
   };
   d.querySelectorAll('.targetButton')[2].click();
   v.pause(); v.loop=false; v.currentTime=0;
   await new Promise(r=>v.addEventListener('seeked',r,{once:true}));
   let samples=[],blocks=[];
   const stage=d.querySelector('#app')._vnode.component.proxy.$refs.stage;
   const captures=[];
   const originalPush=stage.pushData;
   stage.pushData=function(packet){
     const rig=packet.fluffoRig;
     const hands=packet.riggedPose?.chestUpHands;
     if(rig)captures.push({t:rig.frame,src:rig.handSource,stamp:rig.handStamp,palmY:hands?.right?.palmY,
       handTargets:hands,faceStamp:rig.faceStamp,jaw:rig.scores?.jawOpen,
       palms:{left:hands?.left?.palmY??null,right:hands?.right?.palmY??null}});
     return originalPush.call(this,packet);
   };
   if(${fullHD || liveHD}){
     await new Promise(r=>w.requestAnimationFrame(()=>w.requestAnimationFrame(r)));
     if(canvas.width!==1920 || canvas.height!==1080)throw Error('Full HD render size was not applied');
   }
   let recorder,done,encoder,encodeError,codec,encodeReplay;
   const poseTimes=[];
   if(fullHD){
     for(const candidate of ['vp09.00.10.08','vp8']){
       const config={codec:candidate,width:1920,height:1080,framerate:60,bitrate:18000000,latencyMode:'realtime'};
       if(!(await w.VideoEncoder.isConfigSupported(config)).supported)continue;
       codec=candidate;
       encoder=new w.VideoEncoder({error:e=>{encodeError=e},output:chunk=>{
         const packet=Buffer.allocUnsafe(12+chunk.byteLength);
         packet.writeUInt32LE(chunk.byteLength);packet.writeBigUInt64LE(BigInt(chunk.timestamp),4);
         chunk.copyTo(packet.subarray(12));blocks.push(packet);
       }});
       encoder.configure(config);break;
     }
     if(!encoder)throw Error('No supported full HD video encoder');
     const bones=[],faces=[],poses=[];
     m.scene.traverse(o=>{if(o.isBone)bones.push(o);if(o.morphTargetInfluences?.length)faces.push(o)});
     const count=bones.length*7+faces.reduce((n,o)=>n+o.morphTargetInfluences.length,0);
     function samplePose(){
       const values=new Float32Array(count);
       let k=0;
       for(const bone of bones){bone.position.toArray(values,k);bone.quaternion.toArray(values,k+3);k+=7;}
       for(const mesh of faces){values.set(mesh.morphTargetInfluences,k);k+=mesh.morphTargetInfluences.length;}
       poseTimes.push(v.currentTime);poses.push(values);
     }
     samplePose();
     scene.onAfterRender=()=>{
       if(!v.paused && v.currentTime>poseTimes.at(-1)+.0005)samplePose();
     };
     encodeReplay=async()=>{
       scene.onAfterRender=()=>{};
       const q=bones[0].quaternion.clone(),renderer=stage.avatar.renderer;
       let lo=0;
       for(let i=0;i<Math.round(v.duration*60);i++){
         const t=i/60;
         while(lo+1<poses.length && poseTimes[lo+1]<=t)lo++;
         const hi=Math.min(lo+1,poses.length-1),a=poses[lo],b=poses[hi];
         const f=hi===lo?0:Math.max(0,Math.min(1,(t-poseTimes[lo])/(poseTimes[hi]-poseTimes[lo])));
         const mix=k=>a[k]+(b[k]-a[k])*f;
         let k=0;
         for(const bone of bones){
           bone.position.set(mix(k),mix(k+1),mix(k+2));
           bone.quaternion.fromArray(a,k+3).slerp(q.fromArray(b,k+3),f);k+=7;
         }
         for(const mesh of faces)for(let j=0;j<mesh.morphTargetInfluences.length;j++)mesh.morphTargetInfluences[j]=mix(k++);
         renderer.render(scene,reviewCamera);
         const frame=new w.VideoFrame(canvas,{timestamp:Math.round(t*1e6)});
         encoder.encode(frame,{keyFrame:i===0});frame.close();
         if(encoder.encodeQueueSize>5)await encoder.flush();
       }
     };
   }else{
     recorder=new MediaRecorder(canvas.captureStream(30),{mimeType:'video/webm;codecs=vp8',videoBitsPerSecond:${liveHD?14000000:3800000}});
     done=new Promise(r=>recorder.onstop=r);
     recorder.ondataavailable=e=>{if(e.data.size)blocks.push(e.data)};
   }
   const id=setInterval(()=>{const expr=m.expressionManager,hum=m.humanoid;
     const names=['aa','ih','ou','ee','oh','blinkLeft','blinkRight'];
     const rotations=['neck','leftUpperArm','rightUpperArm','leftLowerArm','rightLowerArm','leftHand','rightHand'].map(k=>hum.getNormalizedBoneNode(k)?.quaternion.toArray());
     const screen = ['neck','head','leftHand','rightHand','leftUpperArm','rightUpperArm','leftLowerArm','rightLowerArm'].map(k=>{
       const b=hum.getRawBoneNode(k);
       if (!reviewCamera || !b) return null;
       const point=b.getWorldPosition(b.position.clone()).project(reviewCamera);
       return [(point.x+1)/2,(1-point.y)/2];
     });
     const stage=d.querySelector('#app')._vnode.component.proxy.$refs.stage;
     const rig=stage._lastData?.fluffoRig;
     const mouth=m.scene.getObjectByName('BipTeethUp');
     const projectedY=node=>{
       if(!reviewCamera || !node)return null;
       const point=node.getWorldPosition(node.position.clone()).project(reviewCamera);
       return (1-point.y)/2;
     };
     const fingers={},idle={};
     for(const side of ['left','right'])for(const digit of ['Thumb','Index','Middle','Ring']){
       for(const part of digit==='Thumb'?['Metacarpal','Proximal']:['Proximal','Intermediate']){
         const name=side+digit+part,b=hum.getNormalizedBoneNode(name);
         fingers[name]=b?2*Math.acos(Math.min(1,Math.abs(b.quaternion.w))):null;
       }
     }
     for(const key of ['BipLEar','BipREar','BipTail_1','BipTail_2','BipTail_3','BipTail_4','BipTail_5'])
       idle[key]=m.scene.getObjectByName(key)?.quaternion.toArray();
     const normalizedPose=${JSON.stringify(!!input || stem==='fluffo-sleeve-return')} ? hum.getNormalizedPose() : undefined;
     samples.push({t:v.currentTime,screen,mouthY:projectedY(mouth),rightKnuckleY:projectedY(hum.getRawBoneNode('rightMiddleProximal')),normalizedPose,expressions:names.map(k=>expr.getValue(k)),rotations,fingers,idle,
       scores:rig?.scores,handInput:[!!rig?.left,!!rig?.right],handSource:rig?.handSource,
       face:Object.fromEntries(expr.expressions.map(e=>[e.expressionName,expr.getValue(e.expressionName)]))});
   },125);
   const ended=new Promise(r=>v.addEventListener('ended',r,{once:true}));
   renders=0;
   measuring=true;
   recorder?.start();await v.play();await ended;clearInterval(id);
   measuring=false;
   if(encoder){
     await encodeReplay();await encoder.flush();encoder.close();if(encodeError)throw encodeError;
     const header=Buffer.alloc(32);header.write('DKIF');header.writeUInt16LE(32,6);
     header.write(codec==='vp8'?'VP80':'VP90',8);header.writeUInt16LE(1920,12);header.writeUInt16LE(1080,14);
     header.writeUInt32LE(1000000,16);header.writeUInt32LE(1,20);header.writeUInt32LE(blocks.length,24);blocks.unshift(header);
   }else{recorder.stop();await done;}
   const bytes=await new Blob(blocks).arrayBuffer(); w.require('fs').writeFileSync(${JSON.stringify(out)},new Uint8Array(bytes));
   return {duration:v.duration,size:bytes.byteLength,samples,captures,renders,faceFrames,poseTimes,canvas:[canvas.width,canvas.height]};
 })()`);
 const summary=info.samples[0].expressions.map((_,i)=>{const vals=info.samples.map(s=>s.expressions[i]);return [Math.min(...vals),Math.max(...vals)]});
 console.log('Expression ranges',JSON.stringify(summary),'video bytes',info.size,'samples',info.samples.length,'canvas',info.canvas);
 fs.writeFileSync(path.resolve(output,stem+'.json'), JSON.stringify(info));
 }catch(e){console.error(e.message);process.exitCode=1}
 finally{send('Browser.close').catch(()=>{});await sleep(800);clearTimeout(timeout);if(proc.exitCode===null) proc.kill();process.exit(process.exitCode||0)}
})()
