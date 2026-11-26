<template>
  <main v-show="tab==='render'" class="broadcast" :class="{'with-settings':settingsOpen}" @keydown.esc="closeSettings">
    <section class="controls" :inert="settingsOpen && compact ? true : undefined" aria-label="방송 컨트롤러">
      <header class="tools">
        <div class="modes" role="group" aria-label="입력 모드">
          <button v-for="mode in modes" :key="mode.id" :aria-pressed="videoSource===mode.id" :disabled="running" @click="videoSource=mode.id">{{mode.name}}</button>
        </div>
        <button ref="settingsButton" class="quiet" :aria-expanded="settingsOpen" aria-controls="broadcast-settings" @click="toggleSettings">방송 설정</button>
      </header>
      <div class="field" v-if="videoSource==='camera'">
        <div class="label-row"><label for="broadcast-camera">카메라</label><button class="link" :disabled="running" @click="refresh">다시 찾기</button></div>
        <select id="broadcast-camera" v-model="camera" :disabled="running">
          <option v-if="!currentCamera" :value="camera">{{camera?'이전 카메라 연결 끊김':'연결된 카메라 없음'}}</option>
          <option v-for="c in cameras" :key="c.id" :value="c.id">{{c.label || '카메라'}}</option>
        </select>
      </div>
      <div class="field" v-show="videoSource==='file'">
        <label for="chooseFile">테스트 영상</label><button id="chooseFile" class="file" :disabled="running" :title="fileName">{{fileName || '영상 선택…'}}</button>
      </div>
      <div class="field">
        <div class="label-row"><label for="demo-js">아바타</label><button class="link" :disabled="running" @click="tab='model'">라이브러리</button></div>
        <select id="demo-js" v-model="selectModel" :disabled="running">
          <option v-if="extraModel" :value="selectModel">{{extraModel.name}}</option>
          <optgroup :label="language.tabModelLib.userModel"><option v-for="m in userModels" :key="m.path" :value="JSON.stringify(m)">{{m.name}}</option></optgroup>
          <optgroup :label="language.tabModelLib.buildinModel"><option v-for="m in builtIn" :key="m.path" :value="JSON.stringify(m)">{{m.name}}</option></optgroup>
        </select>
      </div>
      <div class="framing"><label for="shot">구도</label><select id="shot" v-model="framing"><option value="face">얼굴 · MCU</option><option value="half">상반신</option><option value="full">전신</option></select></div>
      <p v-if="running" class="hint">입력과 아바타는 추적 중지 후 변경할 수 있습니다.</p>
      <div class="status-row"><span role="status" class="status" :class="{live:running && inputReady,issue:captureError}">{{status}}</span>
        <button v-if="running && modelReady && inputReady" class="link" @click="showOutput">{{outputOpen?'출력 창 보기':'출력 창 다시 열기'}}</button>
      </div>
      <div class="preview-switch"><label><input type="checkbox" v-model="preview"> {{videoSource==='camera'?'카메라 미리보기':'영상 미리보기'}}</label></div>
      <div class="stage-area" :class="{shown:running && (preview || (modelReady && !outputOpen))}">
        <iframe id="foo" ref="frame" title="추적 미리보기" src="about:blank" @load="syncStage"></iframe>
      </div>
      <button class="primary" onclick="window.startMocap(this)" :disabled="!running && !canStart">{{running?(modelReady && inputReady?'■　추적 중지':'취소'):(captureError?'다시 시작':'▶　추적 시작')}}</button>
    </section>
    <aside id="broadcast-settings" v-show="settingsOpen" aria-label="방송 설정" :class="{specialized:extended}">
      <header class="tools"><h2>방송 설정</h2><button class="quiet" @click="closeSettings">닫기</button></header>
      <div class="framing">
        <label for="body-tracking-level">바디 추적 단계</label>
        <select id="body-tracking-level" name="modelComplexity" v-model="state.settings.mediapipe.modelComplexity">
          <option value="0">0 · 경량</option>
          <option value="1">1 · 표준 (기본)</option>
          <option value="2">2 · 고정밀</option>
        </select>
      </div>
      <p class="hint" v-if="!extended && !knownTracking">추적을 시작하면 이 아바타에서 조절할 수 있는 얼굴·몸 설정이 표시됩니다.</p>
      <Teleport v-if="wardrobeGroup && modelPath && wardrobeParts.length" :to="wardrobeGroup">
        <WardrobePanel :key="modelPath" :path="modelPath" :parts="wardrobeParts" :open-panel="settingsOpen && tab==='render'" />
      </Teleport>
      <div ref="fields"></div>
      <button type="button" class="quiet" @click="resetSettings">방송 설정 기본값 복원</button>
      <button class="link" @click="tab='settings'">프로그램 설정 열기</button>
    </aside>
  </main>
</template>
<script setup>
import {computed,nextTick,onMounted,ref,shallowRef,toRefs,watch} from 'vue';
import {readAvatarHeader,avatarRigProfile} from 'fluffo-rig-capture';
import {avatarStoragePath,listWardrobeParts} from 'avatar-wardrobe';
import WardrobePanel from './WardrobePanel.vue';
import {state,remote} from './store.js';
import {defaults,cameraKeys,desktopSmoothness,mountSmoothnessPanel,saveLiveControls,resetBroadcastSettings} from 'broadcast-controls';
const {tab,videoSource,videoPath,selectModel,userModels,builtIn,camera,cameras,language,running,inputReady,modelReady,facePresent,outputOpen,customRig,captureError,framing}=toRefs(state);
const modes=[{id:'camera',name:'카메라 라이브'},{id:'file',name:'영상 테스트'}];
const frame=ref(null),fields=ref(null),settingsButton=ref(null),settingsOpen=ref(false);
const sidebarQuery=matchMedia('(max-width:690px)');
const compact=ref(sidebarQuery.matches);
sidebarQuery.addEventListener('change',event=>{compact.value=event.matches;});
const modelPath=computed(()=>{try{return JSON.parse(selectModel.value)?.path;}catch{return null;}});
const descriptor=computed(()=>{
  const json=readAvatarHeader(modelPath.value);
  const profile=avatarRigProfile(json);
  return {custom:/\.vrm$/i.test(modelPath.value) && profile.extended,profile,parts:listWardrobeParts(json,profile.wardrobe)};
});
const runtimeOutfits=ref(new Map());
const wardrobeGroup=shallowRef(null);
const wardrobeParts=computed(()=>runtimeOutfits.value.get(modelPath.value) ?? descriptor.value.parts);
const extended=computed(()=>running.value && modelReady.value ? customRig.value : descriptor.value.custom);
const prefs=desktopSmoothness(),preview=ref(prefs.values.cameraPreview);
// The separate capture process reads the same live level as the integrated iframe.
watch(()=>state.settings.mediapipe.modelComplexity,level=>{
  localStorage.setItem('broadcast.bodyTrackingLevel',String(level));
},{immediate:true,flush:'sync'});
function resetSettings(){
  state.settings.mediapipe.modelComplexity='1';
  resetBroadcastSettings(prefs,extended.value,rigCaps.value.get(modelPath.value),descriptor.value.profile);
}
const currentCamera=computed(()=>cameras.value.some(c=>c.id && c.id===camera.value));
const fileName=computed(()=>{const p=videoPath.value?.[0]||'';return p.split(/[\\/]/).pop();});
const extraModel=computed(()=>{
  if([...userModels.value,...builtIn.value].some(m=>JSON.stringify(m)===selectModel.value))return null;
  try{return JSON.parse(selectModel.value);}catch{return null;}
});
const canStart=computed(()=>selectModel.value && (videoSource.value==='camera'?currentCamera.value:!!videoPath.value?.[0]));
const status=computed(()=>{
  if(captureError.value)return captureError.value;
  if(!running.value)return canStart.value?'시작할 수 있습니다':videoSource.value==='camera'?'카메라 연결을 확인하세요':'테스트 영상을 선택하세요';
  if(!modelReady.value)return '아바타를 불러오는 중';
  if(!inputReady.value)return videoSource.value==='camera'?'카메라 연결 중':'영상 여는 중';
  return facePresent.value?'얼굴 추적 중':'얼굴을 찾는 중';
});
const native=remote.getCurrentWindow();
function fit(width,height){
  if(native.isMaximized() || native.isFullScreen())return;
  const area=remote.screen.getDisplayMatching(native.getBounds()).workArea;
  const w=Math.min(width,area.width),h=Math.min(height,area.height);
  const [x,y]=native.getPosition();
  native.setBounds({width:w,height:h,x:Math.max(area.x,Math.min(x,area.x+area.width-w)),y:Math.max(area.y,Math.min(y,area.y+area.height-h))});
}
function toggleSettings(){
  settingsOpen.value=!settingsOpen.value;
  fit(settingsOpen.value?880:480,preview.value && running.value?870:650);
  if(settingsOpen.value)nextTick(()=>fields.value.parentElement.querySelector('button').focus());
}
function closeSettings(){if(settingsOpen.value){toggleSettings();nextTick(()=>settingsButton.value.focus());}}
async function refresh(){captureError.value='';await window.refreshCameras?.();}
function showOutput(){frame.value?.contentWindow.broadcastOutput?.show();}
function syncStage(){
  const doc=frame.value?.contentDocument;
  if(doc){doc.documentElement.classList.add('broadcast-stage');doc.documentElement.dataset.preview=String(preview.value);doc.documentElement.dataset.docked=String(!outputOpen.value);}
  window.layoutCaptureView?.();
}
let lastFace=0,opened=false;
function autoOpen(){if(inputReady.value && modelReady.value && !opened){opened=true;showOutput();}}
const rigCaps=ref(new Map());

const knownTracking=computed(()=>rigCaps.value.has(modelPath.value));
const calibrationKey=path=>'broadcast.avatarCalibration.'+path;
let loadingCalibration=false;
watch(modelPath,path=>{
  if(!path)return;
  let saved={};
  try{saved=JSON.parse(localStorage.getItem(calibrationKey(path))) || {};}catch{}
  const profile=descriptor.value.profile;
  if(!localStorage.getItem('broadcast.previousEyeRest'))localStorage.setItem('broadcast.previousEyeRest',String(prefs.values.eyeRestOpen));
  const eyeRestOpen=profile.extended ? saved.eyeRestOpen ?? (profile.legacy?Number(localStorage.getItem('broadcast.previousEyeRest')):profile.neutralEyeOpen) : prefs.values.eyeRestOpen;
  loadingCalibration=true;
  try{saveLiveControls(prefs,{...prefs.values,eyeRestOpen,standardEyeOpen:saved.standardEyeOpen ?? defaults.standardEyeOpen,
    standardBrowRest:saved.standardBrowRest ?? defaults.standardBrowRest});}
  finally{loadingCalibration=false;}
},{immediate:true,flush:'sync'});
prefs.onChange(keys=>{
  if(!loadingCalibration && modelPath.value && keys.some(k=>k==='standardEyeOpen' || k==='standardBrowRest' || k==='eyeRestOpen')){
    const {standardEyeOpen,standardBrowRest,eyeRestOpen}=prefs.values;
    localStorage.setItem(calibrationKey(modelPath.value),JSON.stringify({standardEyeOpen,standardBrowRest,eyeRestOpen}));
  }
});
// Camera offsets are relative to each model and shot. Keep the old global
// settings on the previously selected avatar when upgrading an existing install.
let cameraProfile,profileKey,loadingCamera=false;
function storeCamera(){
    if(!profileKey || loadingCamera)return;
    cameraProfile.mode=framing.value;
    cameraProfile.shots[framing.value]=Object.fromEntries(cameraKeys.map(k=>[k,prefs.values[k]]));
    localStorage.setItem(profileKey,JSON.stringify(cameraProfile));
}
function loadShot(mode){
    const saved=cameraProfile.shots[mode] || {};
    const camera=Object.fromEntries(cameraKeys.map(k=>[k,saved[k] ?? defaults[k]]));
    saveLiveControls(prefs,{...prefs.values,...camera});
}
watch(modelPath,path=>{
    if(!path)return;
    profileKey='broadcast.camera.v1.'+avatarStoragePath(path);
    let profile;
    try{profile=JSON.parse(localStorage.getItem(profileKey));}catch{}
    const legacy=!localStorage.getItem('broadcast.camera.migrated');
    const mode=['face','half','full'].includes(profile?.mode)?profile.mode:legacy?framing.value:'face';
    cameraProfile={mode,shots:profile?.shots && typeof profile.shots==='object'?profile.shots:{}};
    loadingCamera=true;
    try{
        framing.value=mode;
        if(!legacy || profile)loadShot(mode);
        localStorage.setItem('broadcast.framing',mode);
    }finally{loadingCamera=false;}
    storeCamera();
    if(legacy)localStorage.setItem('broadcast.camera.migrated','1');
},{immediate:true,flush:'sync'});
prefs.onChange(keys=>{if(keys.some(k=>cameraKeys.includes(k)))storeCamera();});
watch(framing,mode=>{
    if(loadingCamera || !cameraProfile)return;
    loadingCamera=true;
    try{loadShot(mode);}finally{loadingCamera=false;}
    storeCamera();
    localStorage.setItem('broadcast.framing',mode);
    frame.value?.contentWindow.broadcastFraming?.(mode);
},{flush:'sync'});
let showTracking;
function syncTracking(){showTracking?.(extended.value,rigCaps.value.get(modelPath.value),descriptor.value.profile,modelPath.value);}
watch([extended,selectModel],syncTracking);
onMounted(()=>{
  showTracking=mountSmoothnessPanel(fields.value,prefs,true);
  wardrobeGroup.value=fields.value.querySelector('.wardrobe');
  syncTracking();
  prefs.onChange(()=>{preview.value=prefs.values.cameraPreview;});
  window.broadcastController={
    preview:()=>preview.value,
    saveOrbit(changes){
      if(!running.value || !modelReady.value)return;
      const fields=Object.fromEntries(Object.entries(changes).map(([k,v])=>[k,Number(v.toFixed(4))]));
      saveLiveControls(prefs,{...prefs.values,...fields});
    },
    ready(custom,caps,parts){if(!running.value)return;if(parts)runtimeOutfits.value.set(modelPath.value,parts);rigCaps.value.set(modelPath.value,caps);customRig.value=custom;modelReady.value=true;syncTracking();frame.value.contentWindow.broadcastFraming?.(framing.value);syncStage();autoOpen();},
    frame(face){if(!running.value)return;inputReady.value=true;if(face)lastFace=performance.now();facePresent.value=lastFace>0 && performance.now()-lastFace<500;autoOpen();},
    outputChanged(open){if(running.value)outputOpen.value=open;nextTick(syncStage);},
    fail(message){if(!running.value)return;window.startMocap();captureError.value=message;}
  };
});
watch(running,active=>{opened=false;lastFace=0;if(tab.value==='render')fit(settingsOpen.value?880:480,active && preview.value?870:650);},{flush:'sync'});
watch(preview,val=>{saveLiveControls(prefs,{...prefs.values,cameraPreview:val});if(running.value && tab.value==='render')fit(settingsOpen.value?880:480,val?870:650);nextTick(syncStage);});
watch([camera,selectModel,videoSource],()=>{captureError.value='';localStorage.setItem('useCamera',videoSource.value);});
watch(tab,t=>{if(t==='render')fit(settingsOpen.value?880:480,preview.value && running.value?870:650);else fit(1180,750);nextTick(syncStage);});
</script>
<style scoped>
.broadcast{max-width:450px;margin:0 auto;font:15px/1.45 "Pretendard Variable","Segoe UI","Malgun Gothic",sans-serif;color:#25262a}.broadcast.with-settings{max-width:870px;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:22px}.controls,aside{min-width:0}.tools,.label-row,.framing,.status-row{display:flex;align-items:center;justify-content:space-between;gap:10px}.tools{margin:10px 0 18px}.modes{display:flex;padding:4px;border-radius:9px;background:#e9ebef}.broadcast button,.broadcast select{font:inherit;cursor:pointer}.broadcast button:focus-visible,.broadcast select:focus-visible,.broadcast input:focus-visible{outline:2px solid #005bc2;outline-offset:2px}.modes button,.quiet,.link{border:0;background:none;color:#384554;padding:7px 8px;border-radius:6px}.modes button[aria-pressed=true]{background:white;color:#142235;font-weight:650}.quiet,.link{color:#0054af}.link{font-size:13px;padding:3px 5px}.broadcast button:disabled,.broadcast select:disabled{cursor:default;color:#66717c}.field{padding:10px 14px;margin:9px 0;background:#eff0f3;border:1px solid #cdd2d8;border-radius:9px}.field label,.framing label{font-size:13px;color:#485464}.field select,.file{width:100%;border:none;background:transparent;color:#192a3d;padding:4px 0;text-align:left;overflow:hidden;text-overflow:ellipsis}.file{white-space:nowrap}.framing{margin:12px 0}.framing select{padding:6px;border:1px solid #cbd0d6;border-radius:6px;background:white}.hint,.preview-switch{font-size:13px;color:#495361}.status-row{margin:14px 0 7px}.status{font-size:14px}.status:before{content:"";display:inline-block;width:8px;height:8px;margin-right:7px;border-radius:100%;background:#737d87}.status.live:before{background:#0067d9}.status.issue:before{background:#b93a28}.primary{width:100%;height:44px;border:0;border-radius:8px;background:#005bc2;color:white;font-weight:650!important;margin:12px 0}.primary:disabled{background:#e1e5e9}.stage-area{height:1px;overflow:hidden}.stage-area.shown{height:auto;aspect-ratio:16/9;margin-top:6px}iframe{border:0;width:100%;height:100%;display:block}.preview-switch input{vertical-align:middle;accent-color:#005bc2}aside{background:white;border:1px solid #d3d6dc;border-radius:10px;padding:12px}aside h2{font-size:18px;margin:0}aside .tools{margin:0 0 8px}@media(max-width:690px){.broadcast.with-settings{display:block}.broadcast.with-settings .controls{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}}
</style>
