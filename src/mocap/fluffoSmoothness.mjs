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
