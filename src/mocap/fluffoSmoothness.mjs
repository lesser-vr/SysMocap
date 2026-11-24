const storageKey='fluffo.live-controls.v1';
const smooth=(label)=>({label,min:0,max:1,step:.01,start:.5});
const range=(label,min,max,step,start)=>({label,min,max,step,start});
const groups={
    '배경':{
        backgroundMode:{label:'배경 종류',start:'green',choices:{green:'그린스크린',blue:'블루스크린',transparent:'투명',custom:'사용자 색상'}},
        backgroundColor:{label:'사용자 색상',start:'#ffffff',color:true}
    },
    '카메라':{
        yaw:range('좌우 회전 (°)',-180,180,1,0), pitch:range('상하 회전 (°)',-80,80,1,0),
        side:range('좌우 이동 (m)',-1,1,.005,0), height:range('높이 이동 (m)',-1,1,.005,0),
        distance:range('거리 배율',.2,4,.001,1), fov:range('시야각 (°)',10,100,.01,35),
        mirror:{label:'좌우 반전',start:'auto',choices:{auto:'기존 미리보기 설정',on:'켬',off:'끔'}}
    },
    '부드러움':{body:smooth('전체 추적'),mouth:smooth('입'),blink:smooth('깜빡임'),expression:smooth('표정·시선')},
    '고급 추적':{hand:smooth('팔·손 추가 보정'), depth:range('손 깊이 배율',.25,2,.05,1),
        returnMs:range('팔 복귀 시간 (ms)',150,1000,10,450),holdMs:range('가림 유지 시간 (ms)',40,400,5,155),
        headGain:range('고개 움직임 배율',0,1.5,.05,1)},
    '얼굴 표정':{emotion:{label:'표정',start:'auto',choices:{auto:'자동',neutral:'중립',happy:'기쁨',sad:'슬픔',angry:'화남',surprised:'놀람'}},
        jawGain:range('입 벌림 배율',0,2,.05,1),blinkGain:range('눈 감김 감도',0,2,.05,1),
        gazeGain:range('시선 배율',0,2,.05,1)},
    '조명':{light:range('밝기 배율',0,3,.05,1),lightYaw:range('방향 (°)',-180,180,1,45),
        lightPitch:range('고도 (°)',-85,85,.1,35.2644),lightColor:{label:'색상',start:'#ffffff',color:true}},
    '화면 효과':{contrast:range('대비',.5,2,.01,1),saturation:range('채도',0,2,.01,1),
        brightness:range('화면 밝기',.5,2,.01,1)}
};
const schema=Object.assign({},...Object.values(groups));
export const defaults=Object.freeze(Object.fromEntries(Object.entries(schema).map(([k,s])=>[k,s.start])));
export function createSmoothness(initial){
    const values={...defaults}, factors={body:1,hand:1,blink:1,mouth:1,expression:1};
    const listeners=new Set();
    function set(input){
        const changed=[];
        for(const [key,s] of Object.entries(schema)){
            const raw=input?.[key];
            let value=s.start;
            if(s.choices){if(Object.hasOwn(s.choices,raw))value=raw;}
            else if(s.color){if(typeof raw==='string' && /^#[0-9a-f]{6}$/i.test(raw))value=raw;}
            else if(Number.isFinite(raw))value=Math.max(s.min,Math.min(s.max,raw));
            if(value!==values[key]){values[key]=value;changed.push(key);}
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
    function load(){try{return JSON.parse(localStorage.getItem(storageKey));}catch{return null;}}
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
        doc.title='Fluffo 방송 설정';doc.documentElement.lang='ko';
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

export function mountSmoothnessPanel(host,settings){
    const panel=document.createElement('details');
    panel.id='fluffo-smoothness';
    const style=document.createElement('link');
    style.rel='stylesheet'; style.href=new URL('./fluffoSmoothness.css',import.meta.url).href;
    document.head.append(style);
    const title=document.createElement('summary'); title.textContent='Fluffo 방송 설정';
    title.title='클릭하여 열거나 접기 · 드래그하여 이동';
    const form=document.createElement('div');
    const widgets=[];
    function refresh(){
        for(const [name,input,field] of widgets){
            input.value=settings.values[name];
            if(field)field.value=settings.values[name];
            if(name==='backgroundColor')input.parentElement.hidden=settings.values.backgroundMode!=='custom';
        }
    }
    function commit(values){
        settings.set(values);
        localStorage.setItem(storageKey,JSON.stringify(settings.values));
        refresh();
    }
    for(const [group,entries] of Object.entries(groups)){
        const section=document.createElement('details'),summary=document.createElement('summary');
        section.open=group==='부드러움';
        summary.textContent=group;section.append(summary);
        if(group==='부드러움'){
            const hint=document.createElement('small');hint.textContent='낮을수록 빠르게 · 높을수록 부드럽게';section.append(hint);
        }
        for(const [name,s] of Object.entries(entries)){
            const row=document.createElement('label');
            const input=document.createElement(s.choices?'select':'input');
            let field=null;
            input.name=name; input.setAttribute('aria-label',s.label);
            row.append(s.label,input);
            if(s.choices){
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
                    if(Number.isFinite(number.valueAsNumber))commit({...settings.values,[name]:number.valueAsNumber});
                    else refresh();
                });
            }
            input.addEventListener('input',()=>commit({...settings.values,[name]:input.type==='range'?input.valueAsNumber:input.value}));
            widgets.push([name,input,field]);section.append(row);
        }
        form.append(section);
    }
    const reset=document.createElement('button');reset.type='button';reset.textContent='전체 기본값 복원';
    reset.addEventListener('click',()=>commit(defaults));
    form.append(reset);panel.append(title,form);host.after(panel);
    enablePanelDrag(panel,title);
    enableSeparateWindow(panel,title,form,style);
    settings.onChange(refresh);
    panel.addEventListener('keydown',e=>e.stopPropagation());
    refresh();
}
