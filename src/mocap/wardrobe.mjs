import {slotVisibility,bindOutfitSlots} from './avatarRigProfile.mjs';
// Discover wardrobe surfaces without treating the avatar's anatomy as removable clothing.
const kinds=[
    ['후드',/hood(?:ie|y)/],['재킷',/jacket|blazer|coat|재킷|코트/],['상의',/tops?|shirts?|blouse|sweater|상의|셔츠/],
    ['바지',/pants|trousers|jeans|shorts|바지/],['치마',/skirts?|치마/],['하의',/bottoms?|하의/],
    ['원피스',/dress|원피스/],['신발',/shoes?|boots?|sneakers?|heels?|신발|부츠/],
    ['안경',/glasses|sunglasses|goggles|안경|고글/],['모자',/hats?|cap|beanie|모자/],
    ['머플러',/scarf|scarves|muffler|머플러|목도리/],['목걸이',/necklace|pendant|목걸이/],['귀걸이',/earrings?|earcuff|귀걸이/],
    ['장갑',/gloves?|장갑/],['벨트',/belts?|벨트/],['액세서리',/accessor(?:y|ies)|accessoire|액세서리/]
];
function words(name){
    return String(name || '').replace(/([a-z])([A-Z])/g,'$1 $2').toLowerCase().split(/[^\p{L}]+/u).filter(Boolean);
}
function category(tokens){
    for(const [label,re] of kinds)if(tokens.some(t=>t.match(re)?.[0]===t))return label;
    return '';
}
const anatomy=/^(?:skin|body|head|face|eye|eyes|iris|pupil|brow|lash|teeth|tooth|tongue|mouth|lip|hair|ear|ears|tail|fur|hairback|ponytail|kemomimi|피부|얼굴|눈|머리|꼬리)$/;
function part(id,mesh,material,node){
    const surface=words(material),object=words(mesh),instance=words(node);
    if(surface.some(t=>anatomy.test(t)))return null;
    const label=category(instance) || category(object) || category(surface);
    const bodyMesh=[...object,...instance].includes('body');
    if(!label && [...object,...instance].some(t=>anatomy.test(t))){
        // Combined body meshes often carry custom fabric names. Offer these only
        // in the editor. Named skin, facial and hair materials are excluded above.
        if(!bodyMesh || !material || surface.every(t=>t==='material'))return null;
    }
    const name=[node && node!==mesh ? node : '', mesh, material!==mesh ? material : ''].filter(Boolean).join(' / ');
    return {id,source:name || id,label};
}
function gltfPart(json,meshIndex,primitiveIndex,nodeIndex){
    const mesh=json.meshes?.[meshIndex],primitive=mesh?.primitives?.[primitiveIndex];
    if(!primitive)return null;
    const node=json.nodes?.[nodeIndex]?.name || '',name=mesh.name || '',material=json.materials?.[primitive.material]?.name || '';
    const id=JSON.stringify([nodeIndex ?? -1,meshIndex,primitive.material ?? -1,node,name,material]);
    return part(id,name,material,node);
}

export function listWardrobeParts(json,slots=[]){
    const excluded=new Set();
    function exclude(i){
        if(excluded.has(i))return;
        excluded.add(i);
        for(const child of json.nodes[i]?.children || [])exclude(child);
    }
    for(const slot of slots)for(const index of slot.nodes)exclude(index);
    const parts=new Map();
    for(const [i,node] of (json?.nodes || []).entries()){
        if(excluded.has(i))continue;
        const mesh=json.meshes?.[node.mesh];
        mesh?.primitives?.forEach((_,j)=>{
            const item=gltfPart(json,node.mesh,j,i);
            if(item)parts.set(item.id,item);
        });
    }
    return [...parts.values()];
}

// Mask only the draw materials of the selected primitive. Skin sharing a mesh,
// shared material instances and MToon's extra outline pass retain their own state.
export function bindWardrobe(scene,parser,profile,expressions){
    const slots=profile?.wardrobe || [];
    const declared=slots.length ? bindOutfitSlots(scene,parser,expressions,slots) : null;
    const excluded=new Set(slots.flatMap(slot=>slot.nodes));
    const items=new Map(),bindings=[];
    let invisible,previous;
    function add(item){
        if(item)items.set(item.id,item);
        return item?.id;
    }
    function visit(node,path){
        if(excluded.has(parser?.associations.get(node)?.nodes))return;
        if(node.isMesh){
            const original=node.material,materials=Array.isArray(original)?original:[original];
            const link=parser?.associations.get(node);
            let ids;
            if(link?.meshes!==undefined && link.primitives!==undefined){
                let parent=node,idx;
                while(parent && idx===undefined){idx=parser.associations.get(parent)?.nodes;parent=parent.parent;}
                if(idx===undefined)idx=parser.json.nodes?.findIndex(n=>n.mesh===link.meshes);
                const id=add(gltfPart(parser.json,link.meshes,link.primitives,idx));
                ids=materials.map(()=>id);
            }else{
                ids=materials.map((m,i)=>add(part(JSON.stringify([path,node.name,i,m.name]),node.name,m.name,'')));
            }
            if(ids.some(Boolean))bindings.push({node,original,materials,ids});
        }
        node.children.forEach((child,i)=>visit(child,path+'.'+i));
    }
    visit(scene,'0');
    function apply(hidden=[]){
        const next=new Set(hidden);
        if(previous && next.size===previous.size && [...next].every(id=>previous.has(id)))return false;
        declared?.apply(hidden);
        for(const {node,original,materials,ids} of bindings){
            if(!ids.some(id=>next.has(id))){node.material=original;continue;}
            if(!invisible){invisible=materials[0].clone();invisible.visible=false;}
            node.material=Array.isArray(original)?materials.map((m,i)=>next.has(ids[i])?invisible:m):invisible;
        }
        previous=next;
        return true;
    }
    return {parts:[...items.values()],apply,dispose(){apply([]);invisible?.dispose();}};
}

export function avatarStoragePath(path){
    if(!path)return '';
    const paths=window.require('path'),url=window.require('url');
    let file=path.startsWith('file:')?url.fileURLToPath(path):path;
    if(file.startsWith('../models/'))file=paths.join(window.require('@electron/remote').app.getAppPath(),'models',file.slice(10));
    return paths.normalize(file);
}
export function wardrobeStorageKey(path){
    return path ? 'broadcast.wardrobe.v1.'+avatarStoragePath(path) : '';
}

export function mountSlotControls(section,profile,path){
    const key=wardrobeStorageKey(path);
    const rows=[];
    for(const slot of profile.wardrobe){
        const row=document.createElement('label'),input=document.createElement('input');
        input.type='checkbox';input.name=slot.id;
        row.append(slot.label,input);
        const hint=document.createElement('small');
        if(slot.requires){
            const parent=profile.wardrobe.find(other=>other.id===slot.requires);
            hint.textContent=(parent?.label || slot.requires)+' 착용 시 표시됩니다.';
            row.append(hint);
        }
        input.addEventListener('input',()=>{
            const config=readWardrobe(key,profile),hidden=new Set(config.hidden);
            if(input.checked)hidden.delete(slot.id);else hidden.add(slot.id);
            localStorage.setItem(key,JSON.stringify({...config,hidden:[...hidden]}));
            window.dispatchEvent(new Event('avatar-wardrobe-change'));
        });
        rows.push({row,input,hint,slot});section.append(row);
    }
    function update(){
        const hidden=readWardrobe(key,profile).hidden,worn=slotVisibility(profile.wardrobe,hidden);
        for(const {input,hint,slot} of rows){
            input.disabled=!!slot.requires && !worn(slot.requires);
            hint.hidden=!input.disabled;input.checked=worn(slot.id);
        }
    }
    update();
    const storage=e=>{if(e.key===key || e.key===null)update();};
    window.addEventListener('storage',storage);
    window.addEventListener('avatar-wardrobe-change',update);
    return ()=>{
        window.removeEventListener('storage',storage);
        window.removeEventListener('avatar-wardrobe-change',update);
        for(const {row} of rows)row.remove();
    };
}
export function readWardrobe(key,profile){
    try{
        const data=JSON.parse(localStorage.getItem(key));
        if(!data && profile?.previousSettingsKey){
            const previous=JSON.parse(localStorage.getItem(profile.previousSettingsKey));
            const migrated={labels:{},hidden:profile.wardrobe.filter(slot=>previous?.[slot.id]===false).map(slot=>slot.id)};
            if(key && previous)localStorage.setItem(key,JSON.stringify(migrated));
            return migrated;
        }
        return {labels:Object.fromEntries(Object.entries(data?.labels || {}).filter(([,v])=>typeof v==='string')),
            hidden:Array.isArray(data?.hidden)?data.hidden.filter(v=>typeof v==='string'):[]};
    }catch{return {labels:{},hidden:[]};}
}
