import {avatarRigProfile} from './avatarRigProfile.mjs';
export {avatarRigProfile};
import { createFaceReader } from './fluffoFaceWorker.mjs';
import {desktopSmoothness} from './fluffoSmoothness.mjs';
import { createHandReader } from './fluffoHandReader.mjs';

const saturate = x => Math.max(0,Math.min(1,x));
const conf = p => p && (p.visibility ?? 1) >= 0.55;
const inside = p => conf(p) && p.x>=0 && p.x<=1 && p.y>=0 && p.y<=1;
const humanDigits = [[1,2,3,4],[5,6,7,8],[9,10,11,12],[13,14,15,16],[17,18,19,20]];

function bend(a,b,c,aspect) {
    const u=[b.x-a.x,(b.y-a.y)*aspect,b.z-a.z], v=[c.x-b.x,(c.y-b.y)*aspect,c.z-b.z];
    const length=Math.hypot(...u)*Math.hypot(...v);
    if (!(length>1e-8)) return 0;
    return Math.acos(Math.max(-1,Math.min(1,(u[0]*v[0]+u[1]*v[1]+u[2]*v[2])/length)));
}

export function fingerCurls(hand,aspect) {
    if (hand?.length!==21 || !hand.every(p=>[p.x,p.y,p.z].every(Number.isFinite))) return null;
    if (![0,5,9,13,17,8,12,16,20].some(i=>inside(hand[i]))) return null;
    return humanDigits.map(([a,b,c,d])=>[
        saturate((bend(hand[0],hand[a],hand[b],aspect)-0.12)/1.35),
        saturate((0.75*bend(hand[a],hand[b],hand[c],aspect)+0.25*bend(hand[b],hand[c],hand[d],aspect)-0.07)/1.45)
    ]);
}

function limbSignals(results,aspect) {
    const p=results.poseLandmarks,w=results.za;
    if (!p?.[32] || !w?.[32]) return {};
    const span=Math.abs(p[11].x-p[12].x);
    if (span<0.04) return {};
    const signals={};
    for (const [side,index] of [['left',11],['right',12]]) {
        const shoulder=p[index], ear=p[index-4], ankle=index+16, heel=index+18, toe=index+20;
        if (inside(shoulder) && inside(ear)) {
            signals[side+'ShoulderGap']=(shoulder.y-ear.y)*aspect/span;
        }
        if ([ankle,heel,toe].every(i=>inside(p[i])&&conf(w[i]))) {
            const dx=w[toe].x-w[heel].x, dy=w[heel].y-w[toe].y, dz=w[heel].z-w[toe].z;
            if (Math.hypot(dx,dy,dz)>0.025) signals[side+'Foot']={
                pitch:Math.atan2(dy,Math.hypot(dx,dz)), yaw:Math.atan2(dx,dz)};
        }
    }
    return signals;
}

export function readAvatarHeader(modelPath) {
    if(!modelPath)return null;
    try {
        const fs=window.require('fs'),path=window.require('path');
        let file=modelPath.startsWith('file:')?window.require('url').fileURLToPath(modelPath):modelPath;
        if(file.startsWith('../models/'))file=path.join(window.require('@electron/remote').app.getAppPath(),'models',file.slice(10));
        if(!path.isAbsolute(file) || !/\.(vrm|glb)$/i.test(file))return null;
        const fd=fs.openSync(file,'r');
        try {
            const header=Buffer.alloc(20);
            if(fs.readSync(fd,header,0,20,0)!==20 || header.toString('ascii',0,4)!=='glTF' || header.toString('ascii',16,20)!=='JSON')return null;
            const length=header.readUInt32LE(12);
            if(length>fs.fstatSync(fd).size-20)return null;
            const json=Buffer.alloc(length);
            return fs.readSync(fd,json,0,length,20)===length?JSON.parse(json):null;
        }finally{fs.closeSync(fd);}
    }catch{return null;}
}
export function supportsExtendedTracking(path){
    return avatarRigProfile(readAvatarHeader(path)).extended;
}

export function createRigCapture(video,enabled) {
    const tuning=desktopSmoothness();
    const preview=video.closest('.preview');
    if(preview){
        // Keep the source and its video-frame callbacks alive while hiding the
        // input, skeleton overlay and camera label together.
        const showPreview=()=>{preview.style.visibility=tuning.values.cameraPreview?'':'hidden';};
        showPreview();
        tuning.onChange(keys=>{if(keys.includes('cameraPreview'))showPreview();});
    }
    if (!enabled) return ()=>null;
    const readFace=createFaceReader(video);
    const readHands=createHandReader(video);
    return results=>{
        const aspect=video.videoHeight/(video.videoWidth||1);
        const extra=readHands(results);
        const face=readFace();
        const packet={frame:video.currentTime,scores:face?.value ?? null,
            liveControls:{...tuning.values},
            faceStamp:face?.stamp ?? null,faceAgeMs:face ? performance.now()-face.time : null,limbs:limbSignals(results,aspect),
            handSource:{},handStamp:{}};
        for(const side of ['left','right']){
            const key=side+'HandLandmarks';
            packet[side]=fingerCurls(results[key],aspect);
            if(packet[side]){
                packet.handSource[side]='holistic';
                packet.handStamp[side]=packet.frame;
            }else if(extra?.value?.[side]){
                packet[side]=fingerCurls(extra.value[side],aspect);
                if(packet[side]){
                    // The same recovered palm drives the wrist, arm and individual digits.
                    results[key]=extra.value[side];
                    packet.handSource[side]='crop';
                    packet.handStamp[side]=extra.stamp;
                }
            }
        }
        return packet;
    };
}
