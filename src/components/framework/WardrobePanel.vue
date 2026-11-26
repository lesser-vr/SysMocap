<template>
  <div ref="content" class="wardrobe-items">
    <template v-if="!editing">
      <label v-for="[label,ids] in items" :key="label" class="toggle">{{label}}
        <input type="checkbox" :checked="ids.every(id=>!config.hidden.includes(id))"
          :indeterminate="ids.some(id=>config.hidden.includes(id)) && ids.some(id=>!config.hidden.includes(id))"
          @change="setWorn(ids,$event.target.checked)">
      </label>
      <p v-if="!items.size">후보를 확인하고 메뉴에 표시할 항목을 선택하세요.</p>
      <button type="button" @click="edit">의상 항목 편집</button>
    </template>
    <template v-else>
      <canvas ref="canvas" aria-label="의상 확인용 아바타 미리보기"></canvas>
      <p v-if="message" role="status">{{message}}</p>
      <p>모든 의상을 입힌 미리보기입니다. 부품을 누르면 잠시 숨겨집니다. 같은 항목 이름을 입력하면 함께 착용합니다. 빈 이름은 메뉴에서 제외됩니다.</p>
      <div class="parts">
        <div v-for="part in parts" :key="part.id" class="part">
          <button type="button" :disabled="!previewReady" :aria-pressed="trial===part.id"
            :title="part.source" @click="tryPart(part.id)">{{part.source}}</button>
          <input v-model="draft[part.id]" maxlength="64" :aria-label="part.source+' 항목 이름'" placeholder="항목 이름">
        </div>
      </div>
      <div class="actions"><button type="button" @click="save">저장</button><button type="button" @click="close">취소</button></div>
    </template>
  </div>
</template>
<script setup>
import {computed,nextTick,onBeforeUnmount,onMounted,ref,watch} from 'vue';
import {readWardrobe,wardrobeStorageKey} from 'avatar-wardrobe';
const props=defineProps({path:String,parts:Array,openPanel:Boolean});
const key=wardrobeStorageKey(props.path), config=ref(readWardrobe(key));
const items=computed(()=>{
    const groups=new Map();
    for(const part of props.parts){
        const label=config.value.labels[part.id] ?? part.label;
        if(!label)continue;
        if(!groups.has(label))groups.set(label,[]);
        groups.get(label).push(part.id);
    }
    return groups;
});
const editing=ref(false),draft=ref({}),trial=ref(''),canvas=ref(null),message=ref(''),previewReady=ref(false);
let controller,preview;
function persist(next){
    localStorage.setItem(key,JSON.stringify(next));config.value=next;
    window.dispatchEvent(new Event('avatar-wardrobe-change'));
}
function setWorn(ids,worn){
    const hidden=new Set(config.value.hidden);
    for(const id of ids){if(worn)hidden.delete(id);else hidden.add(id);}
    persist({...config.value,hidden:[...hidden]});
}
async function edit(){
    draft.value=Object.fromEntries(props.parts.map(p=>[p.id,config.value.labels[p.id] ?? p.label]));
    editing.value=true;message.value='미리보기를 불러오는 중…';
    controller=new AbortController();
    const {signal}=controller;
    try{
        await nextTick();
        const {openWardrobePreview}=await import('./wardrobePreview.js');
        if(signal.aborted)return;
        const view=await openWardrobePreview(canvas.value,props.path,signal);
        if(signal.aborted)return;
        preview=view;previewReady.value=true;message.value='';
    }catch{if(!signal.aborted)message.value='미리보기를 열 수 없습니다.';}
}
function tryPart(id){
    trial.value=trial.value===id?'':id;
    preview.show(trial.value?[trial.value]:[]);
}
function close(){
    controller?.abort();preview=null;previewReady.value=false;editing.value=false;trial.value='';
}
function save(){
    const ids=new Set(props.parts.map(p=>p.id));
    const labels={},hidden=config.value.hidden.filter(id=>!ids.has(id));
    for(const p of props.parts){
        const label=(draft.value[p.id] ?? p.label).trim();
        if(label!==p.label)labels[p.id]=label;
        if(label && config.value.hidden.includes(p.id))hidden.push(p.id);
    }
    persist({labels,hidden});close();
}
function onToggle(event){if(!event.currentTarget.open && editing.value)close();}
watch(()=>props.openPanel,open=>{if(!open)close();});
const content=ref(null);
function refreshWardrobe(){config.value=readWardrobe(key);}
function onStorage(event){if(event.key===key || event.key===null)refreshWardrobe();}
onMounted(()=>{
    content.value.parentElement.addEventListener('toggle',onToggle);
    window.addEventListener('storage',onStorage);
    window.addEventListener('avatar-wardrobe-change',refreshWardrobe);
});
onBeforeUnmount(()=>{
    window.removeEventListener('storage',onStorage);
    window.removeEventListener('avatar-wardrobe-change',refreshWardrobe);
    content.value.parentElement.removeEventListener('toggle',onToggle);
    close();
});
</script>
<style scoped>
.wardrobe-items button,.wardrobe-items input{font:inherit}
.wardrobe-items canvas{width:100%;height:190px;background:#e9edf2;display:block;touch-action:none}
.wardrobe-items p{font-size:13px;line-height:1.4}.parts{max-height:215px;overflow:auto}.part{display:grid;grid-template-columns:1.3fr 1fr;gap:5px;margin:4px 0}
.part input,.part button{min-width:0}.part button{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left}.part button[aria-pressed=true]{background:#dbeaff;color:#103c74}.actions{display:flex;gap:6px;margin:8px 0}
</style>
