import { createRigDriver } from "./fluffoRigDriver.mjs";
import { createIdlePlayer } from "./fluffoIdle.mjs";
import {createSmoothness,desktopSmoothness} from "./fluffoSmoothness.mjs";
// In a chest-up shot Holistic can see a hand while its pose wrist is outside the image.
// Use palm knuckles as the paw target, relative to the shoulder span of the speaker.
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

export function chestUpHands(results, video, handStamp={}) {
    const pose = results.poseLandmarks;
    if (!pose?.[12] || !video.videoWidth) return null;
    const span = Math.abs(pose[11].x - pose[12].x);
    if (span < 0.06) return null;
    const aspect = video.videoHeight / video.videoWidth;
    const world = results.za;
    const worldSpan = world && Math.hypot(world[11].x - world[12].x, world[11].z - world[12].z);

    function measure(side, shoulderIndex, hand) {
        const shoulder = pose[shoulderIndex], elbow = pose[shoulderIndex + 2], wrist = pose[shoulderIndex + 4];
        const visible = p => p && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
        const palm = [0, 5, 9, 13, 17].map(i => hand?.[i]);
        const observed = palm.filter(visible);
        // At the bottom edge, visible fingers precede the wrist and knuckles.
        const tips = [8, 12, 16, 20].map(i => hand?.[i]).filter(visible);
        const points = observed.length >= 2 ? observed : [...observed, ...tips];
        const count = points.length;
        let center = wrist, wristRotation = null;
        if (count >= 2 && palm.every(p => Number.isFinite(p?.x) && Number.isFinite(p.y))) {
            center = {
                x: points.reduce((sum, p) => sum + p.x, 0) / count,
                y: points.reduce((sum, p) => sum + p.y, 0) / count
            };
            const rotation = Kalidokit.Hand.solve(hand, side)?.[side + 'Wrist'];
            if (rotation && [rotation.x, rotation.y, rotation.z].every(Number.isFinite)) {
                wristRotation = {x: rotation.x, y: rotation.y, z: rotation.z};
            }
        } else if (!visible(wrist) || wrist.visibility < 0.6) return null;

        const elbowInView = elbow.visibility >= 0.55 && visible(elbow);
        const lip=results.faceLandmarks?.[13];
        return {
            x: (center.x - shoulder.x) / span, y: (shoulder.y - center.y) * aspect / span,
            mouthGap:observed.length>=2 && visible(lip) ? (lip.y-center.y)*aspect/span : null,
            mouthSide:observed.length>=2 && visible(lip) ? (lip.x-center.x)/span : null,
            depth: worldSpan > 0.05 && wrist.visibility >= 0.55
                ? (world[shoulderIndex].z - world[shoulderIndex + 4].z) / worldSpan : null,
            elbow: elbowInView ? {x:(elbow.x-shoulder.x)/span, y:(shoulder.y-elbow.y)*aspect/span} : null,
            wristRotation, palmVisible: observed.length >= 2,
            palmY:count>=2 ? hand[9].y : null, wristY:wrist.y,
            stamp:handStamp?.[side.toLowerCase()] ?? video.currentTime
        };
    }
    return {time:video.currentTime, left:measure('Left',11,results.leftHandLandmarks),
        right:measure('Right',12,results.rightHandLandmarks)};
}

function approachRotation(joint, previous, desired, rate, dt) {
    const angle = previous.angleTo(desired);
    const step = Math.min(rate * dt, angle * (1 - Math.exp(-dt / 0.045)));
    previous.rotateTowards(desired, step);
    joint.quaternion.copy(previous);
}

function easedPhase(t) {
    const u=clamp(t,0,1);
    return u*u*(3-2*u);
}

// One Euro rotation filter, updated once per observation in source-video time.
function headFilter() {
    let stamp=null, raw={}, filtered={}, output={}, speed={};
    const alpha=(hz,dt)=>1/(1+1/(2*Math.PI*hz*dt));
    const wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));
    return (angles,time,factor)=>{
        const dt=time-stamp;
        if(stamp===null || dt<0 || dt>.45){
            raw={...angles}; filtered={...angles}; output={...angles}; speed={x:0,y:0,z:0};
        }else if(dt>0){
            for(const axis of ['x','y','z']){
                const rate=wrap(angles[axis]-raw[axis])/dt;
                speed[axis]+=(rate-speed[axis])*alpha(1.5,dt);
                const cutoff=.85+Math.min(10,4*Math.abs(speed[axis]));
                filtered[axis]+=wrap(angles[axis]-filtered[axis])*alpha(cutoff/factor,dt);
                // Quiet-pose play prevents a few noisy estimates from moving the head.
                // Its angular margin narrows as a deliberate turn builds speed.
                const margin=.025/(1+4*Math.abs(speed[axis]));
                const change=wrap(filtered[axis]-output[axis]);
                if(Math.abs(change)>margin)output[axis]+=change-Math.sign(change)*margin;
            }
            raw={...angles};
        }
        stamp=time;
        return output;
    };
}

function resetReturn(arm) {
    arm.returnStart=null;
    arm.palmHistory=[];
    arm.exitCandidate=false;
    arm.present=false;
    arm.lastObserved=null;
    arm.observedAt=-Infinity;
    arm.lastWrist=null;
    arm.wristAt=-Infinity;
    arm.lastPalmAt=-Infinity;
    arm.missingPalm=false;
    arm.reacquiredAt=-Infinity;
}

function observePalm(arm,sample) {
    const history=arm.palmHistory, last=history.at(-1);
    if(last && sample.stamp<=last.t)return false;
    while(history.length && sample.stamp-history[0].t>.24) history.shift();
    const sinking=history.some(p=>sample.palmY-p.y>.032);
    arm.exitCandidate=sample.palmY>.89 && (sinking || (arm.exitCandidate && sample.palmY>=(last?.y??1)-.018));
    history.push({t:sample.stamp,y:sample.palmY});
    return true;
}

function aimRotation(joint, restAxis, direction) {
    const inverse = joint.parent.getWorldQuaternion(joint.quaternion.clone()).invert();
    const local = direction.clone().normalize().applyQuaternion(inverse);
    return joint.quaternion.clone().setFromUnitVectors(restAxis.clone().normalize(), local);
}

// In a seated close-up, body tracking cannot see a hanging wrist. Keep the
// elbow just clear of the shirt and the paw beneath it, with a soft bend.
function armsAtSides(arm) {
    const sign = arm.side === 'right' ? -1 : 1;
    const upperDirection = arm.upper.position.clone().set(sign*0.53, -1, 0.14);
    const lowerDirection = arm.lower.position.clone().set(sign*0.15, -1, 0.31);
    const upper = aimRotation(arm.upper, arm.upperAxis, upperDirection);
    arm.upper.quaternion.copy(upper);
    const lower = aimRotation(arm.lower, arm.lowerAxis, lowerDirection);
    return {upper, lower};
}

export function createFluffoView(vrm, camera, controls, panelHost=null) {
    if (vrm.meta.name !== 'Fluffo GTA VI') return null;
    const bone = key => vrm.humanoid.getNormalizedBoneNode(key);
    const hips = bone('hips');
    const origin = hips.position.clone();
    const position = b => b.getWorldPosition(b.position.clone());
    const span = position(bone('leftUpperArm')).distanceTo(position(bone('rightUpperArm')));
    const lip = vrm.scene.getObjectByName('BipTeethUp');
    const arms = ['left', 'right'].map(side => {
        const upper = bone(side+'UpperArm'), lower = bone(side+'LowerArm'), hand = bone(side+'Hand');
        const upperAxis = upper.worldToLocal(position(lower));
        const lowerAxis = lower.worldToLocal(position(hand));
        return {side, upper, lower, upperAxis, lowerAxis, a:position(upper).distanceTo(position(lower)),
            b:position(lower).distanceTo(position(hand)), hand,
            upperRotation:upper.quaternion.clone(), lowerRotation:lower.quaternion.clone(),
            wristRotation:hand.quaternion.clone(), lastObserved:null, observedAt:-Infinity,
            lastWrist:null,wristAt:-Infinity,returnStart:null,palmHistory:[],exitCandidate:false};
    });
    const defaultCamera = camera.position.clone(), defaultTarget = controls.target.clone();
    const wrists = ['left','right'].flatMap(side => {
        const hand = vrm.humanoid.getRawBoneNode(side+'Hand');
        const helper = vrm.scene.getObjectByName(side === 'left' ? 'BipLWrist' : 'BipRWrist');
        if (!helper || helper.parent !== hand?.parent) return [];
        return [{hand, helper, axis:helper.position.clone().normalize(), inverse:hand.quaternion.clone().invert(),
            rest:helper.quaternion.clone(), delta:hand.quaternion.clone(), twist:hand.quaternion.clone()}];
    });
    const playIdle = createIdlePlayer(vrm);
    const tuning=panelHost ? desktopSmoothness() : createSmoothness();
    const {values,factors}=tuning;
    const driveRig=createRigDriver(vrm,tuning);
    const canvas=controls.domElement;
    const mirrorSurface=panelHost ? document.getElementById('model') : canvas;
    const originalMirror=mirrorSurface?.style.transform||'';
    const light=vrm.scene.parent?.children.find(node=>node.isDirectionalLight);
    const baseLight=light?.intensity;
    let lastForwarded=null;
    function applyCamera(closeup){
        const target=closeup ? defaultTarget.clone().set(0,.489,0) : defaultTarget.clone();
        const offset=closeup ? defaultCamera.clone().set(0,.020,.819) : defaultCamera.clone().sub(defaultTarget);
        const radians=Math.PI/180;
        const yaw=Math.atan2(offset.x,offset.z)+values.yaw*radians;
        const pitch=clamp(Math.asin(offset.y/offset.length())+values.pitch*radians,-1.55,1.55);
        const distance=offset.length()*values.distance;
        target.x+=Math.cos(yaw)*values.side;
        target.z-=Math.sin(yaw)*values.side;
        target.y+=values.height;
        controls.target.copy(target);
        camera.position.copy(target).add(offset.set(Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),Math.cos(yaw)*Math.cos(pitch)).multiplyScalar(distance));
        camera.fov=values.fov;
        camera.updateProjectionMatrix();controls.update();
    }
    function appearance(keys){
        if(canvas?.parentElement && (keys.includes('backgroundMode') || keys.includes('backgroundColor'))){
            const colors={green:'#00ff00',blue:'#0000ff',transparent:'transparent',custom:values.backgroundColor};
            // Keep the key color outside the canvas' brightness/contrast/saturation filter.
            const backdrop=canvas.parentElement;
            backdrop.style.backgroundColor=colors[values.backgroundMode];
            if(backdrop.style.backgroundImage)backdrop.style.backgroundImage='';
        }
        if(keys.some(k=>['yaw','pitch','side','height','distance','fov'].includes(k)))applyCamera(view.active);
        if(keys.includes('mirror') && mirrorSurface)mirrorSurface.style.transform=values.mirror==='auto'?originalMirror:values.mirror==='on'?'scaleX(-1)':'scaleX(1)';
        if(canvas && keys.some(k=>['brightness','contrast','saturation'].includes(k))){
            canvas.style.filter=values.brightness===1 && values.contrast===1 && values.saturation===1 ? '' :
                'brightness('+values.brightness+') contrast('+values.contrast+') saturate('+values.saturation+')';
        }
        if(light && keys.some(k=>k.startsWith('light'))){
            const az=values.lightYaw*Math.PI/180,el=values.lightPitch*Math.PI/180;
            light.position.set(Math.sin(az)*Math.cos(el),Math.sin(el),Math.cos(az)*Math.cos(el));
            light.intensity=baseLight*values.light;
            light.color.set(values.lightColor);
        }
    }
    let smoothHead=headFilter();
    vrm.scene.traverse(node => { if (node.isSkinnedMesh) node.frustumCulled = false; });
    let lastTick = 0, lastFrame = null, frameArrival = 0;
    const view = {
        active:false,
        receiveControls(input){
            if(!panelHost && input && input!==lastForwarded){tuning.set(input);lastForwarded=input;}
        },
        boneWeight(name,weight){
            const factor=/Arm|Hand/.test(name)?factors.hand:factors.body;
            return factor===1 ? weight : 1-(1-weight)**(1/factor);
        },
        applyRig(data,now,closeup,hands,fallbackMouth,fallbackEye) {
            driveRig(data,now,closeup,hands,view.exits,fallbackMouth,fallbackEye);
        },
        exits:{},
        updateIdle(dt) {
            playIdle(dt);
            for (const {hand,helper,axis,inverse,rest,delta,twist} of wrists) {
                delta.copy(hand.quaternion).multiply(inverse);
                const projected = axis.x*delta.x + axis.y*delta.y + axis.z*delta.z;
                const halfTwist = Math.atan2(projected * (delta.w < 0 ? -1 : 1), Math.abs(delta.w));
                helper.quaternion.copy(twist.setFromAxisAngle(axis,halfTwist)).multiply(rest);
            }
        },
        setTarget(mode) {
            if (mode !== 'face') {
                if (view.active) {
                    applyCamera(false);
                }
                view.active = false;
                return;
            }
            if (!view.active) {
                smoothHead=headFilter();
                lastTick = 0; lastFrame = null;
                for (const arm of arms) {
                    const idle = armsAtSides(arm);
                    arm.upper.quaternion.copy(idle.upper);
                    arm.lower.quaternion.copy(idle.lower);
                    arm.hand.quaternion.identity();
                    arm.upperRotation.copy(idle.upper);
                    arm.lowerRotation.copy(idle.lower);
                    arm.wristRotation.identity();
                    resetReturn(arm);
                    delete view.exits[arm.side];
                }
            }
            view.active = true;
            hips.position.copy(origin); hips.quaternion.identity();
            // Fixed composition for Fluffo's 0.56 m head joint and broad animal head.
            camera.near = 0.02;
            applyCamera(true);
        },
        head(rotation,stamp=performance.now()/1000) {
            if(!view.active){
                const gain=values.headGain;
                return gain===1 ? rotation : {...rotation,x:rotation.x*gain,y:rotation.y*gain,z:rotation.z*gain};
            }
            const r=smoothHead(rotation,stamp,factors.body);
            return {...rotation, x:r.x*0.66*values.headGain, y:r.y*0.76*values.headGain, z:r.z*0.4*values.headGain};
        },
        applyHands(measurements,now=performance.now()) {
            if (!view.active) return;
            const dt = lastTick ? clamp((now-lastTick)/1000, 0.001, 0.05) : 1/60;
            lastTick = now;
            const newFrame = measurements && measurements.time !== lastFrame;
            if (newFrame) {
                if(lastFrame!==null && (measurements.time<lastFrame || measurements.time-lastFrame>.5)){
                    for(const arm of arms){resetReturn(arm);delete view.exits[arm.side];}
                }
                frameArrival = now;
                lastFrame = measurements.time;
            }
            for (const arm of arms) {
                let observation = measurements?.[arm.side];
                if(newFrame && !Number.isFinite(observation?.palmY))arm.missingPalm=true;
                if(newFrame && Number.isFinite(observation?.palmY) && !observePalm(arm,observation)){
                    observation=null;
                }
                // An estimated wrist at the bottom edge can persist after the real hand has left.
                if(arm.exitCandidate && observation?.palmY==null && observation?.wristY>.88)observation=null;
                if(newFrame)arm.present=!!observation;
                if (newFrame && observation) {
                    const freshPalm=Number.isFinite(observation.palmY);
                    const palmGap=now-arm.lastPalmAt;
                    if(arm.returnStart!==null || (freshPalm && arm.lastObserved && palmGap>(arm.missingPalm?85:180))){
                        arm.reacquiredAt=now;
                    }
                    if(freshPalm){arm.lastPalmAt=now;arm.missingPalm=false;}
                    arm.lastObserved = observation;
                    arm.observedAt = now-1000*Math.max(0,measurements.time-(observation.stamp??measurements.time));
                    arm.returnStart=null;
                    delete view.exits[arm.side];
                    if(observation.wristRotation){
                        arm.lastWrist=observation.wristRotation;arm.wristAt=now;
                    }
                }
                const hold=arm.exitCandidate?42:values.holdMs;
                const active=arm.present && now-frameArrival<90;
                const sample=active || now-arm.observedAt<hold ? arm.lastObserved : null;
                let upper, lower;
                const wrist = arm.hand.quaternion.clone().identity();
                if (sample) {
                    const length = arm.a + arm.b;
                    const sign = arm.side === 'right' ? -1 : 1;
                    const depth = sample.depth === null
                        ? clamp(0.55 + 0.3 * sample.y, 0.40, 0.60) * length
                        : clamp(sample.depth * span, 0.15 * length, 0.80 * length);
                    const ray = arm.upper.position.clone().set(sample.x*span, (sample.y + (sample.palmVisible ? 0.21 : 0.12))*span, depth*values.depth);
                    if(lip && Number.isFinite(sample.mouthGap) && Number.isFinite(sample.mouthSide)){
                        const distance=Math.hypot(sample.mouthGap,sample.mouthSide);
                        const nearMouth=easedPhase((1.05-distance)/.55);
                        const mouthHeight=position(lip).y-position(arm.upper).y;
                        ray.y+=nearMouth*clamp(mouthHeight+sample.mouthGap*span-ray.y,0,.55*span);
                    }
                    // A single frontal camera underestimates reach toward the lens.
                    // Preserve the tracked screen target and leave room between the
                    // forearm and Fluffo's wide sleeve when the paw crosses the chest.
                    const minReachSquared=arm.a**2+arm.b**2-2*arm.a*arm.b*Math.cos(100*Math.PI/180);
                    ray.z=Math.max(ray.z,Math.sqrt(Math.max(0,minReachSquared-ray.x**2-ray.y**2)));
                    const reach = clamp(ray.length(), Math.abs(arm.a-arm.b)+0.0001, length*0.985);
                    ray.normalize();
                    const along = (arm.a**2-arm.b**2+reach**2)/(2*reach);
                    // Keep an occluded elbow down and outside the chest. A visible elbow
                    // anchors the bend plane instead of making the wrist drag it across.
                    const pole = ray.clone().set(sign*0.78,-1,-0.15);
                    if (sample.elbow) {
                        pole.x = sign * clamp(sign*sample.elbow.x*2+0.25, 0.20, 1.25);
                        pole.y = clamp(sample.elbow.y*2,-1.25,-0.12);
                    }
                    pole.addScaledVector(ray,-pole.dot(ray)).normalize();
                    const elbow = ray.clone().multiplyScalar(along)
                        .addScaledVector(pole,Math.sqrt(Math.max(0,arm.a**2-along**2)));
                    upper = aimRotation(arm.upper,arm.upperAxis,elbow);
                    // Solve the local forearm target in the intended upper-arm frame.
                    // Both joints then move toward those targets at bounded angular speed.
                    arm.upper.quaternion.copy(upper);
                    lower = aimRotation(arm.lower,arm.lowerAxis,ray.multiplyScalar(reach).sub(elbow));
                    const r=sample.wristRotation || (now-arm.wristAt<155 && arm.lastWrist);
                    if (r) {
                        const angles = arm.hand.rotation.clone().set(clamp(-r.x*0.6,-0.65,0.65),
                            clamp(r.y*0.55,-0.75,0.75),clamp(-r.z*0.4,-0.5,0.5),'XYZ');
                        wrist.setFromEuler(angles);
                    }
                } else {
                    ({upper, lower} = armsAtSides(arm));
                    if(arm.returnStart===null){
                        arm.returnStart=now;
                        arm.fromUpper=arm.upperRotation.clone();
                        arm.fromLower=arm.lowerRotation.clone();
                        arm.fromWrist=arm.wristRotation.clone();
                        if(arm.exitCandidate)view.exits[arm.side]=now;
                    }
                    const age=now-arm.returnStart;
                    arm.upperRotation.slerpQuaternions(arm.fromUpper,upper,easedPhase(age/values.returnMs));
                    arm.lowerRotation.slerpQuaternions(arm.fromLower,lower,easedPhase(age/values.returnMs));
                    arm.wristRotation.slerpQuaternions(arm.fromWrist,wrist,easedPhase((age-25)/values.returnMs));
                    arm.upper.quaternion.copy(arm.upperRotation);arm.lower.quaternion.copy(arm.lowerRotation);
                    arm.hand.quaternion.copy(arm.wristRotation);
                    continue;
                }
                const speed=.22+.78*easedPhase((now-arm.reacquiredAt)/145);
                approachRotation(arm.upper,arm.upperRotation,upper,6.25*speed,dt/factors.hand);
                approachRotation(arm.lower,arm.lowerRotation,lower,7.5*speed,dt/factors.hand);
                approachRotation(arm.hand,arm.wristRotation,wrist,5.5*speed,dt/factors.hand);
            }
        }
    };
    view.setTarget('face');
    appearance(Object.keys(values));
    tuning.onChange(appearance);
    return view;
}
