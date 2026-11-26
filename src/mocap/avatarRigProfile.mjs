import {legacyBindings} from './legacyRigBindings.mjs';

const vector=value=>Array.isArray(value) && value.length===3 && value.every(Number.isFinite);
const armBones=['hips','head','leftUpperArm','leftLowerArm','leftHand','rightUpperArm','rightLowerArm','rightHand'];
export function avatarRigProfile(json){
    const nodes=json?.nodes || [];
    const vrm=json?.extensions?.VRMC_vrm;
    const vrm0=json?.extensions?.VRM;
    const authored=json?.extras?.sysmocap;
    const names=new Set(nodes.map(n=>n.name));
    const legacy=!authored && (nodes.some(n=>n.extras?.[legacyBindings.slotTag] || n.extras?.[legacyBindings.idleTag]) ||
        legacyBindings.signature.every(name=>names.has(name)));
    const data=authored?.version===1 ? authored : legacy ? legacyBindings : {};
    const rig=data.rig || {};
    const bones=vrm?.humanoid?.humanBones ?? Object.fromEntries((vrm0?.humanoid?.humanBones || []).map(b=>[b.bone,b]));
    const mapped=armBones.every(key=>Number.isInteger(bones[key]?.node) && !!nodes[bones[key].node]);
    const groups=vrm0?.blendShapeMaster?.blendShapeGroups || [];
    const channels=new Set(vrm ? Object.keys(vrm.expressions?.custom || {}) : groups.map(g=>g.name));
    const auto=['mouthPucker','eyeWideLeft','eyeWideRight'].every(name=>channels.has(name));
    const extended=mapped && (!!vrm?.expressions || groups.length>0) &&
        (rig.tracking==='extended' || (rig.tracking!=='standard' && auto));
    const mcu=vector(rig.mcu?.target) && vector(rig.mcu?.offset) && Math.hypot(...rig.mcu.offset)>0 ? rig.mcu : null;
    const wardrobe=[];
    const slots=Array.isArray(data.wardrobe)?data.wardrobe:[];
    const byId=new Map(), byMaterial=new Map();
    for(const slot of slots){
        if(typeof slot?.id!=='string' || !slot.id || byId.has(slot.id))continue;
        byId.set(slot.id,{id:slot.id,label:slot.label || slot.id,requires:slot.requires,minElbowAngle:Number.isFinite(slot.minElbowAngle)?Math.max(0,Math.min(170,slot.minElbowAngle)):0,fit:new Set(),nodes:[]});
        if(legacy)for(const prefix of slot.materials)byMaterial.set(prefix,slot.id);
    }
    const prefixes=[...byMaterial.keys()].sort((a,b)=>b.length-a.length);
    for(const [index,node] of nodes.entries()){
        const tag=node.extras;
        let id=tag?.sysmocapSlot ?? (legacy?tag?.[data.slotTag]:null);
        if(!id && legacy && node.mesh!==undefined){
            const materials=json.meshes?.[node.mesh]?.primitives?.map(p=>json.materials?.[p.material]?.name || '') || [];
            id=byMaterial.get(prefixes.find(prefix=>materials.some(name=>name.startsWith(prefix))));
        }
        if(typeof id!=='string' || !id)continue;
        if(!byId.has(id))byId.set(id,{id,label:id,fit:new Set(),nodes:[]});
        const slot=byId.get(id);
        slot.nodes.push(index);
        const fit=tag?.sysmocapFitExpression ?? (legacy?tag?.[data.fitTag]:null);
        if(typeof fit==='string')slot.fit.add(fit);
    }
    for(const slot of byId.values())if(slot.nodes.length)wardrobe.push({...slot,fit:[...slot.fit]});
    const neutralEyeOpen=Number.isFinite(rig.neutralEyeOpen)?Math.max(1,Math.min(100,rig.neutralEyeOpen)):100;
    const authoredEye=json?.asset?.extras?.sysmocapEyeFit;
    let eyeFit;
    if(authoredEye && typeof authoredEye==='object'){
        const limit=(key,min,max,fallback)=>Number.isFinite(authoredEye[key]) ? Math.max(min,Math.min(max,authoredEye[key])) : fallback;
        eyeFit={opening:limit('opening',0,1,0),smileSquint:limit('smileSquint',0,1,0),
            down:limit('down',-.35,.35,0),inward:limit('inward',-.20,.20,0),
            horizontal:limit('horizontal',0,2,1),vertical:limit('vertical',0,2,1)};
    }
    const yawOffset=json?.asset?.extras?.sysmocapKeyYawOffset;
    const keyYawOffset=Number.isFinite(yawOffset)?Math.max(-180,Math.min(180,yawOffset)):0;
    return {hasFur:!!json?.materials?.some(material=>material.extras?.sysmocapSurface?.fur),extended,mcu,neutralEyeOpen,eyeFit,keyYawOffset,mouthAnchor:rig.mouthAnchor,wristHelpers:rig.wristHelpers || {},
        wardrobe,legacy,previousSettingsKey:legacy ? data.settingsKey : null};
}

export function slotVisibility(slots,hidden){
    const available=new Map(slots.map(slot=>[slot.id,slot]));
    const disabled=new Set(hidden);
    function worn(id,visiting=new Set()){
        const slot=available.get(id);
        if(!slot || disabled.has(id) || visiting.has(id))return false;
        visiting.add(id);
        return !slot.requires || worn(slot.requires,visiting);
    }
    return worn;
}

export function bindOutfitSlots(scene,parser,expressions,slots){
    const nodes=new Map();
    scene.traverse(node=>{
        const index=parser.associations.get(node)?.nodes;
        if(index!==undefined)nodes.set(index,node);
    });
    return {apply(hidden=[]){
        const worn=slotVisibility(slots,hidden),weights=new Map();
        for(const slot of slots){
            const on=worn(slot.id);
            for(const index of slot.nodes){const node=nodes.get(index);if(node)node.visible=on;}
            for(const fit of slot.fit)weights.set(fit,on || weights.get(fit) || false);
        }
        for(const [fit,on] of weights)if(expressions?.getExpression(fit))expressions.setValue(fit,Number(on));
    }};
}
