import {mountSlotControls} from './wardrobe.mjs';
const storageKey='fluffo.live-controls.v1';
const smooth=(label)=>({label,min:0,max:1,step:.01,start:.5});
const range=(label,min,max,step,start)=>({label,min,max,step,start});

const groups={
    '복장·액세서리':{},
    '배경':{
        backgroundMode:{label:'배경 종류',start:'green',choices:{green:'그린스크린',blue:'블루스크린',transparent:'투명',custom:'사용자 색상'}},
        backgroundColor:{label:'사용자 색상',start:'#ffffff',color:true}
    },
    '카메라':{
        cameraPreview:{label:'카메라 미리보기',start:true,toggle:true},
        yaw:range('좌우 회전 (°)',-180,180,1,0), pitch:range('상하 회전 (°)',-80,80,1,0),
        side:range('좌우 이동 (m)',-1,1,.005,0), height:range('높이 이동 (m)',-1,1,.005,0),
        distance:range('거리 배율',.2,4,.001,1), fov:range('시야각 (°)',10,100,.01,35),
        mirror:{label:'좌우 반전',start:'auto',choices:{auto:'기존 미리보기 설정',on:'켬',off:'끔'}}
    },
    '몸·손':{body:smooth('전체 추적'),
        hand:smooth('팔·손 추가 보정'), depth:range('손 깊이 배율',.25,2,.05,1),
        returnMs:range('팔 복귀 시간 (ms)',150,1000,10,450),holdMs:range('가림 유지 시간 (ms)',40,400,5,155),
        headGain:range('고개 움직임 배율',0,1.5,.05,1)},
    '표정·눈썹':{expression:smooth('표정 부드러움'),emotion:{label:'표정',start:'auto',choices:{auto:'자동',neutral:'중립',happy:'기쁨',sad:'슬픔',angry:'화남',surprised:'놀람'}},
        standardBrowRest:range('눈썹 중립 범위',0,.9,.01,.35),
        browRest:range('눈썹 중립 범위',0,.7,.01,.70)},
    '얼굴 · 눈':{blink:smooth('깜빡임 부드러움'),
        standardEyeOpen:range('평소 눈 뜨기 (모델 기준 %)',0,150,1,100),
        eyeRestOpen:range('평소 눈 뜨기 (%)',0,100,1,75),
        holdOpenEyes:{label:'떨릴 때 눈 뜬 상태 유지',start:false,toggle:true},
        blinkGain:range('눈 감김 감도',0,2,.05,1),
        gazeGain:range('시선 배율',0,2,.05,1)},
    '얼굴 · 입':{mouth:smooth('입 부드러움'),jawGain:range('입 벌림 배율',0,2,.05,1)},
    '조명':{lightPreset:{label:'조명 프리셋',start:'auto',choices:{auto:'모델 권장',classic:'기본 방향광',soft:'소프트 스튜디오'}},
        light:range('밝기 배율',0,3,.05,1),lightYaw:range('방향 (°)',-180,180,1,45),
        lightPitch:range('고도 (°)',-85,85,.1,35.2644),lightColor:{label:'색상',start:'#ffffff',color:true}},
    '화면 효과':{renderResolution:{label:'방송 렌더 해상도',start:'1080p',choices:{native:'창 크기', '1080p':'최소 1080p','1440p':'최소 1440p'}},
        outputFps:{label:'출력 프레임률',start:'60fps',choices:{'60fps':'60 fps (기본)','30fps':'30 fps',unlimited:'무제한'}},
        furQuality:{label:'털 표현',start:'standard',choices:{off:'끔',face:'얼굴·귀만',standard:'표준',high:'고급'}},
        contrast:range('대비',.5,2,.01,1),saturation:range('채도',0,2,.01,1),
        brightness:range('화면 밝기',.5,2,.01,1)}
};
const sceneGroups=['카메라','배경','조명','화면 효과'];
// The input preview belongs to the operator's window, not to the broadcast output.
export const cameraKeys=['yaw','pitch','distance','side','height','fov','cameraPanDepth'];
const sceneKeys=[...sceneGroups.flatMap(group=>Object.keys(groups[group])).filter(key=>key!=='cameraPreview'),'cameraPanDepth'];
export function sceneSettings(values){
    return Object.fromEntries(sceneKeys.map(key=>[key,values[key]]));
}
const trackingCaps={blink:'blink',holdOpenEyes:'blink',standardEyeOpen:'blink',mouth:'mouth',
    standardBrowRest:'brow',body:'body',hand:'arm',holdMs:'arm',returnMs:'arm'};
const genericOnly=new Set(['standardBrowRest','standardEyeOpen']);
export function receiverSettings(values){
    return {sceneResetId:values.sceneResetId,...sceneSettings(values),...Object.fromEntries(Object.keys(trackingCaps).map(key=>[key,values[key]]))};
}
const schema=Object.assign({cameraPanDepth:{min:-4,max:4,start:0}},...Object.values(groups));
export const defaults=Object.freeze(Object.fromEntries(Object.entries(schema).map(([k,s])=>[k,s.start])));
export function createSmoothness(initial){
    const values={...defaults}, factors={body:1,hand:1,blink:1,mouth:1,expression:1};
    const listeners=new Set();
    function set(input){
        const changed=[];
        for(const [key,s] of Object.entries(schema)){
            const raw=input?.[key];
            let value=s.start;
            if(s.toggle){if(typeof raw==='boolean')value=raw;}
            else if(s.choices){if(Object.hasOwn(s.choices,raw))value=raw;}
            else if(s.color){if(typeof raw==='string' && /^#[0-9a-f]{6}$/i.test(raw))value=raw;}
            else if(Number.isFinite(raw))value=Math.max(s.min,Math.min(s.max,raw));
            if(value!==values[key]){values[key]=value;changed.push(key);}
        }
        // A mouse orbit or dropped backdrop can change the actual output without
        // changing a slider. Reapply the scene once per explicit reset on each output.
        if(typeof input?.sceneResetId==='string' && input.sceneResetId!==values.sceneResetId){
            values.sceneResetId=input.sceneResetId;
            for(const key of sceneKeys)if(!changed.includes(key))changed.push(key);
        }
        if(!changed.length)return;
        for(const key of Object.keys(factors))factors[key]=2**((values[key]-.5)*3);
        factors.hand*=factors.body;
        for(const notify of listeners)notify(changed);
    }
    set(initial);
    return {values,factors,set,onChange(fn){listeners.add(fn);return ()=>listeners.delete(fn);}};
}

let local;
export function desktopSmoothness(){
    if(local)return local;
    function load(){
        try{
            const saved=JSON.parse(localStorage.getItem(storageKey));
            // Older panels also persisted the default when saving unrelated controls.
            if(saved?.version===undefined && saved?.browRest===.18)delete saved.browRest;
            return saved;
        }catch{return null;}
    }
    local=createSmoothness(load());
    window.addEventListener('storage',event=>{if(event.key===storageKey || event.key===null)local.set(load());});
    return local;
}

// Keep the user's preferred top-left corner even when a temporary resize or
// expanding a section requires shifting the panel into view.
function enablePanelDrag(panel,title){
    const positionKey='fluffo.panel-position.v1';
    let preferred,drag,suppressClick=false;
    try{preferred=JSON.parse(localStorage.getItem(positionKey));}catch{}
    function place(){
        if(!Number.isFinite(preferred?.x) || !Number.isFinite(preferred?.y))return;
        const {width,height}=panel.getBoundingClientRect();
        const bound=(n,limit)=>Math.min(Math.max(4,n),Math.max(0,limit-4));
        panel.style.left=bound(preferred.x,window.innerWidth-width)+'px';
        panel.style.top=bound(preferred.y,window.innerHeight-height)+'px';
        panel.style.bottom='auto';
    }
    title.addEventListener('pointerdown',event=>{
        if(!event.isPrimary || event.button!==0)return;
        const rect=panel.getBoundingClientRect();
        suppressClick=false;
        drag={id:event.pointerId,x:event.clientX,y:event.clientY,left:rect.left,top:rect.top};
        title.setPointerCapture(event.pointerId);
    });
    title.addEventListener('pointermove',event=>{
        if(!drag || event.pointerId!==drag.id)return;
        const dx=event.clientX-drag.x,dy=event.clientY-drag.y;
        if(!suppressClick && Math.hypot(dx,dy)<5)return;
        suppressClick=true;
        panel.classList.add('dragging');
        preferred={x:drag.left+dx,y:drag.top+dy};
        place();
    });
    title.addEventListener('lostpointercapture',()=>{
        if(suppressClick){
            const {left,top}=panel.getBoundingClientRect();
            preferred={x:left,y:top};
            localStorage.setItem(positionKey,JSON.stringify(preferred));
        }
        drag=null;
        panel.classList.remove('dragging');
    });
    title.addEventListener('click',event=>{
        if(suppressClick && event.detail>0)event.preventDefault();
        suppressClick=false;
    });
    new ResizeObserver(place).observe(panel);
    window.addEventListener('resize',place);
    place();
}

function enableSeparateWindow(panel,title,form,stylesheet){
    const detach=document.createElement('button');
    detach.type='button';detach.className='fluffo-detach';detach.textContent='별도 창';
    detach.title='설정을 미리보기 밖으로 옮기기';
    panel.append(detach);
    let popup;
    const boundsKey='fluffo.settings-window.v1';
    detach.addEventListener('click',()=>{
        if(popup && !popup.closed){popup.focus();return;}
        let bounds;
        try{bounds=JSON.parse(localStorage.getItem(boundsKey));}catch{}
        const saved=bounds && ['left','top','width','height'].every(key=>Number.isFinite(bounds[key]));
        const features=saved ? 'left='+bounds.left+',top='+bounds.top+',width='+bounds.width+',height='+bounds.height :
            'left='+(screen.availLeft+Math.max(0,screen.availWidth-430))+',top='+(screen.availTop+40)+',width=410,height=530';
        popup=window.open('','','popup,'+features);
        if(!popup)return;
        const doc=popup.document;
        doc.title='방송 설정';doc.documentElement.lang='ko';
        doc.head.append(stylesheet.cloneNode());
        const content=doc.createElement('main');
        content.id=panel.id;content.className='fluffo-detached';
        doc.body.append(content);content.append(form);
        panel.open=false;
        popup.addEventListener('pagehide',()=>{
            if(popup.innerWidth>0 && popup.innerHeight>0)localStorage.setItem(boundsKey,JSON.stringify({
                left:popup.screenX,top:popup.screenY,width:popup.innerWidth,height:popup.innerHeight}));
            panel.append(form);popup=null;
        },{once:true});
    });
    title.addEventListener('click',event=>{
        if(popup && !popup.closed){event.preventDefault();popup.focus();}
    });
    window.addEventListener('pagehide',()=>popup?.close(),{once:true});
}

export function backdropColor(values){
    return {green:'#00ff00',blue:'#0000ff',transparent:'transparent',custom:values.backgroundColor}[values.backgroundMode];
}
export function saveLiveControls(settings,values){
    settings.set(values);
    let previous;
    try{previous=JSON.parse(localStorage.getItem(storageKey));}catch{}
    localStorage.setItem(storageKey,JSON.stringify({...previous,...settings.values,version:2}));
}

export function resetBroadcastSettings(settings,custom,caps,profile){
    const values={...settings.values,...sceneSettings(defaults),sceneResetId:crypto.randomUUID()};
    if(custom){
        for(const group of ['얼굴 · 눈','얼굴 · 입','표정·눈썹','몸·손']){
            for(const key of Object.keys(groups[group]))if(!genericOnly.has(key))values[key]=defaults[key];
        }
        values.eyeRestOpen=profile?.neutralEyeOpen ?? defaults.eyeRestOpen;
    }else{
        for(const [key,cap] of Object.entries(trackingCaps)){
            if(!caps || caps[cap])values[key]=defaults[key];
        }
    }
    saveLiveControls(settings,values);
}

export function mountSmoothnessPanel(host,settings,inline=false){
    const panel=document.createElement('details');
    panel.id='fluffo-smoothness';
    const style=document.createElement('link');
    style.rel='stylesheet'; style.href=new URL('./fluffoSmoothness.css',import.meta.url).href;
    document.head.append(style);
    const title=document.createElement('summary'); title.textContent='방송 설정';
    title.title='클릭하여 열거나 접기 · 드래그하여 이동';
    const form=document.createElement('div');
    const widgets=[];
    function refresh(){
        for(const [name,input,field] of widgets){
            if(input.type==='checkbox'){
                input.checked=settings.values[name];
            }else input.value=settings.values[name];
            if(field)field.value=name==='standardEyeOpen' ? Math.min(Number(field.max),settings.values[name]) : settings.values[name];
            if(name==='backgroundColor')input.parentElement.hidden=settings.values.backgroundMode!=='custom';
        }
    }
    function commit(values){
        saveLiveControls(settings,values);
        refresh();
    }
    const order=['얼굴 · 눈','얼굴 · 입','표정·눈썹','몸·손','카메라','배경','복장·액세서리','조명','화면 효과'];
    for(const group of order){
        const entries=groups[group];
        const section=document.createElement('details');section.dataset.group=group;
        if(group==='복장·액세서리')section.classList.add('wardrobe');
        if(sceneGroups.includes(group))section.dataset.scene='';const summary=document.createElement('summary');
        section.open=group==='얼굴 · 눈';
        summary.textContent=group;section.append(summary);
        if(group==='몸·손'){
            const hint=document.createElement('small');hint.textContent='낮을수록 빠르게 · 높을수록 부드럽게';section.append(hint);
        }
        for(const [name,s] of Object.entries(entries)){
            const row=document.createElement('label');
            row.dataset.setting=name;
            if(genericOnly.has(name))row.hidden=true;
            const input=document.createElement(s.choices?'select':'input');
            let field=null;
            input.name=name; input.setAttribute('aria-label',s.label);
            row.append(s.label,input);
            if(s.toggle){
                input.type='checkbox';
            }else if(s.choices){
                for(const [key,text] of Object.entries(s.choices))input.add(new Option(text,key));
            }else if(s.color){
                input.type='color';
                if(name==='backgroundColor'){
                    const hex=document.createElement('input');
                    hex.type='text';hex.maxLength=7;hex.spellcheck=false;
                    hex.setAttribute('aria-label','배경 색상 HEX');
                    hex.addEventListener('change',()=>{
                        const value='#'+hex.value.trim().replace(/^#/,'');
                        if(/^#[0-9a-f]{6}$/i.test(value))commit({...settings.values,backgroundColor:value.toLowerCase()});
                        else refresh();
                    });
                    row.className='fluffo-background-color';
                    row.append(hex);field=hex;
                }
            }
            else{
                input.type='range';
                const number=document.createElement('input'); number.type='number';number.setAttribute('aria-label',s.label+' 값');
                for(const control of [input,number])Object.assign(control,{min:s.min,max:s.max,step:s.step});
                row.append(number);
                field=number;
                number.addEventListener('change',()=>{
                    if(Number.isFinite(number.valueAsNumber))commit({...settings.values,[name]:Math.min(Number(number.max),number.valueAsNumber)});
                    else refresh();
                });
            }
            input.addEventListener('input',()=>{
                let value=input.value;
                if(s.toggle)value=input.checked;
                if(input.type==='range')value=input.valueAsNumber;
                commit({...settings.values,[name]:value});
            });
            widgets.push([name,input,field]);section.append(row);
            if(name==='holdOpenEyes'){
                const hint=document.createElement('small');
                hint.dataset.settingHint=name;
                hint.textContent='작은 눈꺼풀 떨림은 무시하고 깜빡임과 윙크는 반영합니다.';
                section.append(hint);
            }
        }
        form.append(section);
    }
    if(!inline){
        const reset=document.createElement('button');
        reset.type='button';reset.textContent='방송 설정 기본값 복원';
        reset.addEventListener('click',()=>resetBroadcastSettings(settings,true,null,shownProfile));
        form.append(reset);
    }
    panel.append(title,form);
    if(inline){
        panel.open=true;
        panel.className='inline-controls';
        title.hidden=true;
        host.append(panel);
    }else{
        host.after(panel);
        enablePanelDrag(panel,title);
        enableSeparateWindow(panel,title,form,style);
    }
    settings.onChange(refresh);
    if(!inline)panel.addEventListener('keydown',e=>e.stopPropagation());
    let clearSlots,shownPath,shownProfile;
    function showTracking(custom,caps={},profile,path){
        form.querySelector('[data-setting=furQuality]').hidden=!profile?.hasFur;
        const section=form.querySelector('.wardrobe');
        if(path!==shownPath || profile!==shownProfile){
            clearSlots?.();shownPath=path;shownProfile=profile;
            clearSlots=profile?.wardrobe.length ? mountSlotControls(section,profile,path) : null;
        }
        for(const section of form.querySelectorAll('details:not([data-scene])')){
            let count=0;
            for(const row of section.querySelectorAll('label[data-setting]')){
                const key=row.dataset.setting;
                row.hidden=custom ? genericOnly.has(key) : !caps[trackingCaps[key]];
                if(!row.hidden)count++;
                const hint=section.querySelector('[data-setting-hint="'+key+'"]');
                if(hint)hint.hidden=row.hidden;
                if(key==='standardEyeOpen'){
                    for(const field of row.querySelectorAll('input'))field.max=caps.wide?150:100;
                    for(const field of row.querySelectorAll('input'))field.value=Math.min(field.max,settings.values[key]);
                }
            }
            section.dataset.available=String(count>0 || (section.classList.contains('wardrobe') && !!clearSlots));
        }
    }
    refresh();
    return showTracking;
}
