const {spawn} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const profile = fs.mkdtempSync(path.join(os.tmpdir(),'sysmocap-camera-qa-'));
const root=path.resolve(__dirname,'../..');
const exe=require('electron');
const proc = spawn(exe,[root,'--remote-debugging-pipe','--user-data-dir='+profile],{stdio:['ignore','ignore','ignore','pipe','pipe'],windowsHide:true});
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
  const p=pending.get(msg.id); if(!p) continue;
  pending.delete(msg.id); if(msg.error) p.reject(new Error(msg.error.message)); else p.resolve(msg.result);
 }
});
const timeout=setTimeout(()=>{console.error('Timed out');proc.kill(); process.exit(1)},45000);
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
 await send('Page.enable',{},sessionId);
 await ev("require('electron-localstorage').setStoragePath("+JSON.stringify(path.join(profile,'test-settings.json'))+")");
 let camera;
 for(let i=0;i<40&&!camera;i++){
  camera=await ev("Array.from(document.querySelector('#demo-js-3')?.options||[]).find(o=>/streamcam/i.test(o.text))?.text");
  if(!camera) await sleep(300);
 }
 console.log('Available cameras:',await ev("Array.from(document.querySelector('#demo-js-3')?.options||[],o=>o.text)"));
 assert.ok(camera,'StreamCam listed');
 await ev("(()=>{const s=document.querySelector('#demo-js-3');s.value=Array.from(s.options).find(o=>/streamcam/i.test(o.text)).value;s.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('[onclick*=startMocap]').click();return true})()");
 let track;
 for(let i=0;i<100&&!track;i++){
  const d=await send('Page.getFrameTree',{},sessionId);
  const f=d.frameTree.childFrames?.find(f=>f.frame.url.includes('mocaprender/render.html'));
  if(f){
    const {executionContextId}=await send('Page.createIsolatedWorld',{frameId:f.frame.id,worldName:'Camera QA'},sessionId);
    const {result}=await send('Runtime.evaluate',{contextId:executionContextId,expression:"(()=>{const v=document.querySelector('.input_video');const t=v?.srcObject?.getVideoTracks()[0];if(t && v.readyState>=2 && v.videoWidth>0 && v.currentTime>0) return {label:t.label,width:v.videoWidth,height:v.videoHeight,mediaTime:v.currentTime,badge:document.querySelector('.input_video')?.parentElement.textContent.includes(t.label),selected:new URLSearchParams(location.search).get('cameraLabel')};})()",returnByValue:true},sessionId);
    track=result.value;
  }
  if(!track) await sleep(250);
 }
 console.log('Live input:',track);
 assert.ok(track && track.badge && track.selected===track.label && /streamcam/i.test(track.label),'StreamCam delivering frames');
 await Promise.race([ev("document.querySelector('[onclick*=startMocap]').click()"),sleep(900)]);
 }catch(e){console.error(e.message);process.exitCode=1}
 finally{send('Browser.close').catch(()=>{});await sleep(800);clearTimeout(timeout);if(proc.exitCode===null) proc.kill();process.exit(process.exitCode||0)}
})()
