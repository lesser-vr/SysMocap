const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
module.exports=async function({ev,sleep,send,sessionId,output}){
  async function until(expression){
    for(let i=0;i<100;i++){if(await ev(expression))return;await sleep(100);}
    throw Error(expression);
  }
  const stop=()=>ev("document.querySelector('.primary').click()");
  const shot=async name=>{
    const {data}=await send('Page.captureScreenshot',{format:'png'},sessionId);
    fs.writeFileSync(path.join(output,name+'.png'),Buffer.from(data,'base64'));
  };
  await until("sysmocapApp.outputOpen && sysmocapApp.facePresent && sysmocapApp.customRig");
  assert.ok(await ev("document.querySelector('#demo-js').disabled && document.querySelector('#chooseFile').disabled && !document.querySelector('#shot').disabled"));
  const preview=".preview-switch input";
  await ev("if(document.querySelector('"+preview+"').checked)document.querySelector('"+preview+"').click()");
  await sleep(250);await shot('SysMocap-controller');
  await ev("document.querySelector('[aria-controls=broadcast-settings]').click()");
  await until("document.querySelector('#broadcast-settings [name=holdOpenEyes]').getBoundingClientRect().width>0");
  await ev("document.querySelector('#broadcast-settings [name=holdOpenEyes]').click()");
  await until("document.querySelector('#foo').contentDocument.querySelector('[name=holdOpenEyes]').checked");
  await shot('SysMocap-face-settings');
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27},sessionId);
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27},sessionId);
  await until("document.activeElement.matches('[aria-controls=broadcast-settings]') && !document.querySelector('#broadcast-settings').offsetWidth");
  await ev("document.querySelector('#shot').value='half';document.querySelector('#shot').dispatchEvent(new Event('change'))");
  await until("localStorage.getItem('broadcast.framing')==='half'");
  await stop();
  await until("!sysmocapApp.running");
  await ev("sysmocapApp.selectModel=JSON.stringify(sysmocapApp.builtIn[0])");
  await sleep(100);await stop();
  await until("sysmocapApp.outputOpen && !sysmocapApp.customRig && sysmocapApp.facePresent");
  await ev("document.querySelector('[aria-controls=broadcast-settings]').click();const d=document.querySelector('#broadcast-settings [data-group=배경]');d.open=true;const el=d.querySelector('select');el.value='blue';el.dispatchEvent(new Event('input'));");
  await until("document.querySelector('#foo').contentDocument.querySelector('#app')._vnode.component.proxy.$refs.stage.avatar.renderer.domElement.parentElement.style.backgroundColor==='rgb(0, 0, 255)'");
  await stop();
  await ev("sysmocapApp.videoPath=['file:///missing-sysmocap-fixture.mp4']");
  await sleep(100);await stop();await until("!sysmocapApp.running && sysmocapApp.captureError.includes('영상')");
  console.log('Controller passed: automatic output, mode lock, preview, live eye settings, framing, built-in avatar, generic background, file error recovery');
};
