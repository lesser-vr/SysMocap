import {createLocalReader} from './fluffoFaceWorker.mjs';

const clamp=(value,low,high)=>Math.min(high,Math.max(low,value));
const sides=['left','right'];
const recoveryIntervalMs=42, stableIntervalMs=120;

// Hands approaching each other or the frame edge need a fresh recovery crop.
function interiorBounds(hand){
    if(hand?.length!==21)return null;
    let left=1,right=0,top=1,bottom=0;
    for(const point of hand){
        if(!point)return null;
        const {x,y,z,visibility=1}=point;
        if(!(x>.06 && x<.94 && y>.06 && y<.94 && visibility>=.55 && Number.isFinite(z)))return null;
        left=Math.min(left,x);right=Math.max(right,x);
        top=Math.min(top,y);bottom=Math.max(bottom,y);
    }
    return {left,right,top,bottom};
}

export function createHandRecoveryCadence(){
    let lastTime=-Infinity, stableFrames=0;
    return (results,time)=>{
        if(time<lastTime || time-lastTime>.15)stableFrames=0;
        const left=interiorBounds(results?.leftHandLandmarks);
        const right=interiorBounds(results?.rightHandLandmarks);
        const gap=.025;
        const separated=left && right && (left.right+gap<right.left || right.right+gap<left.left ||
            left.bottom+gap<right.top || right.bottom+gap<left.top);
        if(!separated)stableFrames=0;
        else if(time!==lastTime)stableFrames=Math.min(stableFrames+1,4);
        lastTime=time;
        return stableFrames===4 ? stableIntervalMs : recoveryIntervalMs;
    };
}

// This factory runs inside the independent vision worker.
function handTask() {
    const canvas=new OffscreenCanvas(384,320);
    const ctx=canvas.getContext('2d');
    return {
        create:({HandLandmarker},files,model)=>HandLandmarker.createFromOptions(files,{
            baseOptions:{modelAssetBuffer:model,delegate:'CPU'},runningMode:'IMAGE',numHands:2,
            minHandDetectionConfidence:.46,minHandPresenceConfidence:.5}),
        detect(tracker,{frame,context}) {
            const found={};
            for(const box of context){
                const h=Math.round(canvas.width*box.h*frame.height/(box.w*frame.width));
                if(canvas.height!==h)canvas.height=h;
                ctx.fillStyle='black'; ctx.fillRect(0,0,canvas.width,canvas.height);
                ctx.drawImage(frame,-box.x*canvas.width/box.w,-box.y*h/box.h,canvas.width/box.w,h/box.h);
                const result=tracker.detect(canvas);
                result.landmarks.forEach((points,i)=>{
                    const category=result.handedness[i]?.[0];
                    if(!category || category.score<.65 || category.categoryName.toLowerCase()!==box.side)return;
                    const hand=points.map(p=>({x:box.x+p.x*box.w,y:box.y+p.y*box.h,z:p.z*box.w}));
                    if(![0,5,9,13,17,8,12,16,20].some(j=>hand[j].x>=0 && hand[j].x<=1 && hand[j].y>=0 && hand[j].y<=1))return;
                    found[box.side]=hand;
                });
            }
            return found;
        }
    };
}

export function createHandReader(video) {
    const read=createLocalReader(video,{modelName:'hand_landmarker.task',interval:recoveryIntervalMs,maxAge:140,
        program:handTask,frameOptions:()=>({})});
    const recoveryCadence=createHandRecoveryCadence();
    const lastPalm={};
    let lastTime=-1;
    return results=>{
        const pose=results.poseLandmarks,time=video.currentTime;
        if(time<lastTime || time-lastTime>0.5)for(const side of sides)delete lastPalm[side];
        lastTime=time;
        const span=pose?.[16] && Math.abs(pose[11].x-pose[12].x);
        if(!(span>=.065) || !video.videoHeight){
            recoveryCadence(null,time);
            return null;
        }
        const interval=recoveryCadence(results,time);
        const boxes=sides.map((side,index)=>{
            const shoulder=pose[11+index], wrist=pose[15+index], palm=results[side+'HandLandmarks']?.[9];
            if(palm && Number.isFinite(palm.x+palm.y))lastPalm[side]={x:palm.x,y:palm.y,time};
            const recent=lastPalm[side];
            const midpoint=(pose[11].x+pose[12].x)/2;
            let x=shoulder.x*.82+midpoint*.18,y=shoulder.y+.52*span*video.videoWidth/video.videoHeight;
            if(wrist.visibility>.5 && wrist.y>=0 && wrist.y<1.12){x=wrist.x;y=wrist.y-.04;}
            if(recent && time-recent.time<.42){x=recent.x;y=recent.y;}
            const width=clamp(span*1.12,.26,.62);
            const height=clamp(width*video.videoWidth/video.videoHeight*.77,.33,.92);
            return {side,w:width,h:height,x:clamp(x-width/2,-width*.08,1-width*.92),
                y:clamp(y-height/2,-height*.08,1-height*.88)};
        });
        return read(boxes,interval);
    };
}
