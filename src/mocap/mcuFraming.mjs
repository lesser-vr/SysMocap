// VRM meshes are authored in their bind pose. Skinned bounds can include
// expression targets or helpers that are invisible in the neutral silhouette.
export function measureMcuBounds(model, box, useBindPose){
    if(!useBindPose)return box.setFromObject(model,true);
    model.updateWorldMatrix(true,true);
    const part=box.clone();
    model.traverseVisible(node=>{
        const positions=node.geometry?.attributes.position;
        if(node.isMesh && positions){
            part.setFromBufferAttribute(positions).applyMatrix4(node.matrixWorld);
            box.union(part);
        }
    });
    return box;
}

// Build a level, chest-up shot in model space once, before tracking changes the pose.
export function createMcuFraming(camera, baseDirection, getBone, bounds, sceneControls, preset){
    const position=name=>{
        const bone=getBone(name);
        return bone?.getWorldPosition(bone.position.clone());
    };
    const head=position('Head') ?? position('Neck');
    const left=position('LeftUpperArm') ?? position('LeftShoulder');
    const right=position('RightUpperArm') ?? position('RightShoulder');
    const size=bounds.getSize(camera.position.clone());
    const measured=left && right && head && left.distanceTo(right)>1e-5;
    if(!measured && !(size.y>1e-5))return null;
    const center=measured ? left.clone().lerp(right,.5) : bounds.getCenter(camera.position.clone());
    const span=measured ? left.distanceTo(right) : size.y*.23;
    if(!measured)center.y=bounds.min.y+size.y*.80;
    const skull=head ?? center.clone().setY(center.y+span*.36);
    // Leave room for hair, ears and the slight lean toward the lens during speech.
    const crown=Math.min(skull.y+span*1.6,Math.max(skull.y+span*.27,bounds.max.y));
    const top=crown+span*.16, bottom=center.y-span*.67;
    const target=center.clone().lerp(skull,.25);
    target.y=(top+bottom)/2;
    const height=Math.max(top-bottom,span*1.5/camera.aspect);
    const distance=height/(2*Math.tan(35*Math.PI/360))+span*.18;
    const front=baseDirection.clone().setY(0);
    if(front.lengthSq()<1e-8)front.set(0,0,1);
    front.normalize();
    const shot={target,offset:front.clone().multiplyScalar(distance)};
    if(preset){shot.target.fromArray(preset.target);shot.offset.fromArray(preset.offset);}
    const hips=getBone('Hips'),rest=hips?.position.clone();
    const oldNear=camera.near;
    let active=false,first;
    return {
        get active(){return active;},
        setTarget(mode){
            const next=mode==='face';
            if(active===next)return;
            active=next;first=null;
            if(next && hips)hips.position.copy(rest);
            camera.near=next ? Math.min(oldNear,shot.offset.length()*.08) : oldNear;
            sceneControls.setShot(next?shot:null);
        },
        trackHips(p,weight){
            if(!active || !hips?.parent)return false;
            if(!first)first={...p};
            // Input coordinates have a different origin and scale than a VRM or FBX
            // pelvis. Retain small movements relative to the first tracked pose.
            const shift=target.clone().set(p.x-first.x,p.y-first.y,first.z-p.z).clampLength(0,.32).multiplyScalar(span);
            if(front.z<0){shift.x*=-1;shift.z*=-1;}
            const world=hips.parent.localToWorld(rest.clone()).add(shift);
            hips.position.lerp(hips.parent.worldToLocal(world),weight);
            return true;
        }
    };
}
