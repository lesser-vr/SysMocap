async function shirtReview(samples) {
    const w=document.querySelector('#foo').contentWindow,d=w.document,vrm=w.currentVrm,scene=vrm.scene.parent;
    d.querySelector('video').pause();
    const {renderer,camera}=await new Promise(resolve=>{
        scene.onAfterRender=(renderer,_,camera)=>{scene.onAfterRender=()=>{};resolve({renderer,camera});};
    });
    const out=d.createElement('canvas'),width=330,height=290;
    out.width=width*3;out.height=height;const ctx=out.getContext('2d'),cam=camera.clone();
    const names=['neck','leftUpperArm','rightUpperArm','leftLowerArm','rightLowerArm','leftHand','rightHand'];
    const views=[[0,.0,.54],[.48,.035,.33],[0,0,.54]];
    vrm.humanoid.resetNormalizedPose();
    for(let i=0;i<views.length;i++){
        const pose=samples[i===2?1:0];
        names.forEach((name,j)=>vrm.humanoid.getNormalizedBoneNode(name).quaternion.fromArray(pose.rotations[j]));
        for(const [name,value] of Object.entries(pose.face))vrm.expressionManager.setValue(name,value);
        vrm.update(0);vrm.scene.updateMatrixWorld(true);
        const target=cam.position.clone().set(0,.366,.005);
        cam.position.copy(target).add(cam.position.clone().set(...views[i]));cam.lookAt(target);cam.near=.01;cam.updateProjectionMatrix();
        renderer.setClearColor(0x52677a,1);renderer.render(scene,cam);
        const c=renderer.domElement,sw=c.height*width/height;
        ctx.drawImage(c,(c.width-sw)/2,0,sw,c.height,i*width,0,width,height);
    }
    return out.toDataURL('image/png').split(',')[1];
}
