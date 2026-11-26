export {mountAvatarAppearance} from './avatarAppearance.mjs';
export {createMcuFraming,measureMcuBounds} from "./mcuFraming.mjs";
import {backdropColor} from './fluffoSmoothness.mjs';

// Keep the deadline on the output cadence even on displays such as 144 Hz.
export function createOutputFrameGate(){
    let previousMode, nextFrame;
    return (mode, now) => {
        if(mode !== previousMode){
            previousMode = mode;
            nextFrame = now;
        }
        if(mode === 'unlimited')return true;
        const interval = 1000 / (mode === '30fps' ? 30 : 60);
        const ahead = now + 0.25 - nextFrame;
        if(ahead < 0)return false;
        nextFrame += (1 + Math.floor(ahead / interval)) * interval;
        return true;
    };
}

// Keep the CSS viewport and camera framing independent of the broadcast pixel budget.
export function sizeBroadcastCanvas(renderer,width,height,dpr,quality){
    if(width<=0 || height<=0 || renderer.xr?.isPresenting)return;
    const target=quality==='1080p'?1080:quality==='1440p'?1440:0;
    const ratio=Math.max(dpr,Math.min(target*16/9/width,target/height));
    const canvas=renderer.domElement;
    if(canvas.width!==Math.floor(width*ratio) || canvas.height!==Math.floor(height*ratio) ||
        renderer.getPixelRatio()!==ratio)renderer.setDrawingBufferSize(width,height,ratio);
    canvas.style.width=width+'px';
    canvas.style.height=height+'px';
}

// Camera offsets are always relative to this model's starting shot.
export function mountBroadcastScene(camera, controls, light, mirrorSurface, tuning, saveOrbit, keyYawOffset = 0) {
    const canvas = controls.domElement;
    const defaultTarget = controls.target.clone();
    const defaultOffset = camera.position.clone().sub(defaultTarget);
    const originalMirror = mirrorSurface.style.transform;
    const baseIntensity = light.intensity;
    const {values} = tuning;
    const radians = Math.PI / 180;
    let shot;

    function applyCamera() {
        const target = (shot?.target ?? defaultTarget).clone();
        const offset = (shot?.offset ?? defaultOffset).clone();
        const radius = offset.length();
        if (!radius) return;
        const yaw = Math.atan2(offset.x, offset.z) + values.yaw * radians;
        const pitch = Math.max(-1.55, Math.min(1.55, Math.asin(offset.y / radius) + values.pitch * radians));
        target.x += Math.cos(yaw) * values.side;
        target.z -= Math.sin(yaw) * values.side;
        target.y += values.height;
        target.x += Math.sin(yaw)*values.cameraPanDepth;
        target.z += Math.cos(yaw)*values.cameraPanDepth;
        offset.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
        controls.target.copy(target);
        camera.position.copy(target).addScaledVector(offset, radius * values.distance);
        camera.fov = values.fov;
        camera.updateProjectionMatrix();
        controls.update();
    }

    function apply(keys) {
        if (keys.some(k => ['yaw','pitch','side','height','distance','fov','cameraPanDepth'].includes(k))) applyCamera();
        if (keys.includes('backgroundMode') || keys.includes('backgroundColor')) {
            canvas.parentElement.style.backgroundColor = backdropColor(values);
            canvas.parentElement.style.backgroundImage = '';
        }
        if (keys.includes('mirror')) {
            mirrorSurface.style.transform = values.mirror === 'auto' ? originalMirror :
                values.mirror === 'on' ? 'scaleX(-1)' : 'scaleX(1)';
        }
        if (keys.some(k => ['brightness','contrast','saturation'].includes(k))) {
            canvas.style.filter = values.brightness === 1 && values.contrast === 1 && values.saturation === 1 ? '' :
                `brightness(${values.brightness}) contrast(${values.contrast}) saturate(${values.saturation})`;
        }
        if (keys.some(k => k.startsWith('light'))) {
            const offset = values.lightPreset === 'auto' ? keyYawOffset : 0;
            const az = (values.lightYaw + offset) * radians, el = values.lightPitch * radians;
            light.position.set(Math.sin(az)*Math.cos(el), Math.sin(el), Math.cos(az)*Math.cos(el));
            light.intensity = baseIntensity * values.light;
            light.color.set(values.lightColor);
        }
    }
    if(saveOrbit)controls.addEventListener('end',()=>{
        const base=shot?.offset ?? defaultOffset;
        const offset=camera.position.clone().sub(controls.target);
        if(!base.length() || !offset.length())return;
        const yaw=Math.atan2(offset.x,offset.z),baseYaw=Math.atan2(base.x,base.z);
        const movement=controls.target.clone().sub(shot?.target ?? defaultTarget);
        const angle=(yaw-baseYaw)/radians;
        saveOrbit({
            yaw:((angle+540)%360)-180,
            pitch:(Math.asin(offset.y/offset.length())-Math.asin(base.y/base.length()))/radians,
            distance:offset.length()/base.length(),height:movement.y,
            side:movement.x*Math.cos(yaw)-movement.z*Math.sin(yaw),
            cameraPanDepth:movement.x*Math.sin(yaw)+movement.z*Math.cos(yaw)
        });
    });
    apply(Object.keys(values));
    tuning.onChange(apply);
    return {setShot(base) {shot = base; applyCamera();}};
}
