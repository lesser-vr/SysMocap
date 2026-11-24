async function rigControls(dir, frames, base) {
    const w = document.querySelector('#foo').contentWindow, d = w.document;
    const m = w.currentVrm, scene = m.scene.parent, hum = m.humanoid, manager = m.expressionManager;
    const fs = w.require('fs'), path = w.require('path');
    const {createRigDriver} = await import(base + 'fluffoRigDriver.mjs');
    const {fingerCurls} = await import(base + 'fluffoRigCapture.mjs');
    const {createIdlePlayer} = await import(base + 'fluffoIdle.mjs');
    const stage = d.querySelector('#app')._vnode.component.proxy.$refs.stage;
    for (let i=0; i<80 && !stage._lastData?.fluffoRig?.scores; i++) await new Promise(r=>setTimeout(r,100));
    const categories = Object.keys(stage._lastData.fluffoRig.scores).filter(n=>n!=='_neutral');
    d.querySelectorAll('.targetButton')[2].click();
    d.querySelector('video').pause();
    const {renderer,camera} = await new Promise(resolve=>{
        scene.onAfterRender=(renderer,_,camera)=>{scene.onAfterRender=()=>{};resolve({renderer,camera});};
    });
    const cam = camera.clone(), canvas=d.createElement('canvas');
    const width=432,height=360;
    canvas.width=width*2; canvas.height=height;
    const ctx=canvas.getContext('2d');
    const bone=name=>hum.getNormalizedBoneNode(name);
    const pos=b=>b.getWorldPosition(b.position.clone());
    const vector=(x,y,z)=>cam.position.clone().set(x,y,z);
    const write=(file,canvas,mime='image/png')=>fs.writeFileSync(file,Buffer.from(canvas.toDataURL(mime,.91).split(',')[1],'base64'));
    const show=(center,offset,x,label)=>{
        cam.position.copy(center).add(offset); cam.lookAt(center); cam.near=.003;cam.updateProjectionMatrix();
        renderer.setClearColor(0x52677a,1); renderer.render(scene,cam);
        // Crop equal pixels from both sides of the wide renderer, preserving aspect.
        const surface=renderer.domElement, sw=Math.min(surface.width,surface.height*width/height);
        ctx.drawImage(surface,(surface.width-sw)/2,0,sw,surface.height,x,0,width,height);
        ctx.fillStyle='rgba(18,26,38,.82)';ctx.fillRect(x+12,height-35,ctx.measureText(label).width+20,25);
        ctx.fillStyle='white';ctx.fillText(label,x+22,height-17);
    };
    ctx.font='15px Segoe UI';
    hum.resetNormalizedPose();m.update(0);m.scene.updateMatrixWorld(true);
    const apply=createRigDriver(m), idle=createIdlePlayer(m);
    let now=1000;
    function step(payload,n=24){
        for(let i=0;i<n;i++){now+=1000/60; apply({...payload,frame:now},now);}
        m.update(0);m.scene.updateMatrixWorld(true);
    }
    const meshes=[];
    m.scene.traverse(o=>{if(o.morphTargetInfluences)meshes.push(o);});
    const facial=[];
    for(const name of categories){
        for(const e of manager.expressions)manager.setValue(e.expressionName,0);
        step({scores:{}},70);
        const neutral=meshes.map(o=>o.morphTargetInfluences.slice());
        step({scores:{[name]:1}},40);
        let maxDisplacement=0;
        for(const [i,o] of meshes.entries()){
            for(const [j,value] of o.morphTargetInfluences.entries()){
                const diff=Math.abs(value-neutral[i][j]);
                if(diff<.02)continue;
                const a=o.geometry.morphAttributes.position?.[j];
                if(!a)continue;
                // Exported glTF morph accessors are relative displacements.
                for(let v=0;v<a.count;v++)maxDisplacement=Math.max(maxDisplacement,
                    diff*Math.hypot(a.getX(v),a.getY(v),a.getZ(v)));
            }
        }
        facial.push({name,maxDisplacement});
    }
    function landmarks(curl) {
        const hand=[{x:.5,y:.7,z:0}];
        for(let digit=0;digit<5;digit++){
            const spread=(digit-2)*.19;
            let x=.5+.1*Math.sin(spread), y=.7-.1*Math.cos(spread), z=0;
            hand.push({x,y,z});
            for(let segment=1;segment<=3;segment++){
                const angle=curl*segment*1.46;
                x+=.045*Math.sin(spread)*Math.cos(angle);
                y-=.045*Math.cos(spread)*Math.cos(angle);
                z-=.045*Math.sin(angle);hand.push({x,y,z});
            }
        }
        return fingerCurls(hand,1);
    }
    const fingers={},names=Object.keys(hum.humanBones).filter(n=>/Thumb|Index|Middle|Ring/.test(n));
    step({left:landmarks(0),right:landmarks(0),scores:{}},90);
    const open=Object.fromEntries(names.map(n=>[n,hum.getRawBoneNode(n).quaternion.clone()]));
    const paw=hum.getRawBoneNode('rightHand'), middle=hum.getRawBoneNode('rightMiddleProximal');
    const center=pos(paw).lerp(pos(middle),.95);
    const offset=vector(-.11,.09,.125);
    const pawBytes=pose=>{
        const verts=[];m.scene.traverse(o=>{
            if(!o.isSkinnedMesh)return;
            const si=o.geometry.attributes.skinIndex, sw=o.geometry.attributes.skinWeight;
            const indices=new Set(o.skeleton.bones.map((b,i)=>/^BipRFinger/.test(b.name)?i:-1).filter(i=>i>=0));
            if(!indices.size)return;
            for(let i=0;i<si.count;i++)if([0,1,2,3].some(j=>indices.has(si.getComponent(i,j))&&sw.getComponent(i,j)>.1))
                verts.push(o.localToWorld(o.getVertexPosition(i,vector(0,0,0))));
        });return verts;
    };
    const vertices=pawBytes();
    show(center,offset,0,'OPEN');
    step({left:landmarks(1),right:landmarks(1),scores:{}},90);
    for(const n of names)fingers[n]=open[n].angleTo(hum.getRawBoneNode(n).quaternion)*180/Math.PI;
    const distances=pawBytes().map((v,i)=>v.distanceTo(vertices[i]));
    show(center,offset,width,'CLOSED');
    write(path.join(dir,'Fluffo-paw-open-closed.png'),canvas);
    const limbs={};
    step({limbs:{leftShoulderGap:.8,rightShoulderGap:.8}},80);
    const limbNames=['leftShoulder','rightShoulder','leftFoot','rightFoot','leftToes','rightToes'];
    const rest=limbNames.map(n=>hum.getRawBoneNode(n).quaternion.clone());
    step({limbs:{leftShoulderGap:.5,rightShoulderGap:.5,leftFoot:{pitch:.5,yaw:.2},rightFoot:{pitch:.55,yaw:-.2}}},80);
    limbNames.forEach((n,i)=>limbs[n]=rest[i].angleTo(hum.getRawBoneNode(n).quaternion)*180/Math.PI);
    // Hold body and face constant; only advance the exported Animaze idle clock.
    step({scores:{}},100);for(const e of manager.expressions)manager.setValue(e.expressionName,0);
    const armRest=stage._lastData;
    if(armRest)for(let i=0;i<4;i++)stage.avatar?.applyRigged?.({...armRest,fluffoRig:null,riggedLeftHand:null,riggedRightHand:null});
    for(const e of manager.expressions)manager.setValue(e.expressionName,0);
    m.update(0);
    const head=pos(hum.getRawBoneNode('head')), hip=pos(hum.getRawBoneNode('hips'));
    const tailRoot=m.scene.getObjectByName('BipTail_1'),tailEnd=m.scene.getObjectByName('BipTail_5');
    const idleFrames=250, check=[];
    for(let i=0;i<idleFrames;i++){
        idle(i===0?0:1/30);m.scene.updateMatrixWorld(true);
        if(i%25===0)check.push({frame:i,tip:pos(tailEnd).toArray(),ear:m.scene.getObjectByName('BipLEar').quaternion.toArray()});
        show(head.clone().add(vector(0,.035,0)),vector(.03,.02,.66),0,'EARS  /  FRONT');
        const center=hip.clone().add(vector(0,-.04,-.12));
        show(center,vector(.76,.12,-.48),width,'TAIL  /  REAR THREE-QUARTER');
        write(path.join(frames,String(i).padStart(3,'0')+'.jpg'),canvas,'image/jpeg');
    }
    return {facial,fingers,limbs,handVertices:vertices.length,maxVertexTravel:Math.max(...distances),
        idleFrames,idleSamples:check,tailRoot:pos(tailRoot).toArray()};
}
