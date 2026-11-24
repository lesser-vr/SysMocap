async function sleeveReview(poses,dir,label,bothActual=false){
 const w=document.querySelector('#foo').contentWindow,d=w.document,m=w.currentVrm,scene=m.scene.parent;
 const fs=w.require('fs'),path=w.require('path');
 d.querySelector('video').pause();
 const {renderer,camera}=await new Promise(resolve=>{scene.onAfterRender=(renderer,_,camera)=>{
   scene.onAfterRender=()=>{};resolve({renderer,camera});};});
 const names=['neck','leftUpperArm','rightUpperArm','leftLowerArm','rightLowerArm','leftHand','rightHand'];
 const cam=camera.clone(),width=325,height=270,out=d.createElement('canvas');
 out.width=width*3;out.height=height*2;
 const ctx=out.getContext('2d'),records=[];
 for(const side of ['R','L']){
  const mirror=side==='L' && !bothActual;
  for(const [index,pose] of poses.entries()){
   m.humanoid.resetNormalizedPose();
   names.forEach((n,i)=>{
    const dest=mirror?n.replace(/left|right/,side=>side==='left'?'right':'left'):n;
    const q=m.humanoid.getNormalizedBoneNode(dest).quaternion.fromArray(pose.rotations[i]);
    if(mirror){q.y=-q.y;q.z=-q.z;}
   });
   if(pose.normalizedPose){
    const result={};
    for(const [name,value] of Object.entries(pose.normalizedPose)){
     const dest=mirror?name.replace(/left|right/,s=>s==='left'?'right':'left'):name;
     const entry=structuredClone(value);
     if(mirror && entry.rotation){entry.rotation[1]*=-1;entry.rotation[2]*=-1;}
     if(mirror && entry.position)entry.position[0]*=-1;
     result[dest]=entry;
    }
    m.humanoid.setNormalizedPose(result);
   }
   m.update(0);m.scene.updateMatrixWorld(true);
   const parts={arm:{p:[],f:[],group:[],rest:[]},sleeve:{p:[],f:[]}};
   let transforms;
   m.scene.traverse(o=>{
    if(!o.isSkinnedMesh)return;
    const meshName=o.name+' '+o.parent.name;
    const sleeve=new RegExp('Short[ _]sleeve[ _]'+side+'(?:_| |$)','i').test(meshName);
    if(!sleeve && !meshName.includes('Fluffo_body_02'))return;
    const part=sleeve?parts.sleeve:parts.arm,g=o.geometry,si=g.attributes.skinIndex,sw=g.attributes.skinWeight;
    const armBones=o.skeleton.bones.map(b=>new RegExp('^Bip'+side+'(UpperArm|Forearm|Wrist|Hand|Finger)').test(b.name));
    if(!sleeve&&!transforms){
     transforms=Object.fromEntries(o.skeleton.bones.map((b,i)=>[b.name,o.matrixWorld.clone()
        .multiply(o.bindMatrixInverse).multiply(b.matrixWorld).multiply(o.skeleton.boneInverses[i]).multiply(o.bindMatrix).toArray()]));
    }
    const remap=new Map();
    for(let i=0;i<si.count;i++){
     let weight=0;for(let j=0;j<4;j++)if(armBones[si.getComponent(i,j)])weight+=sw.getComponent(i,j);
     if(!sleeve && weight<.30)continue;
     remap.set(i,part.p.length);
     if(!sleeve){
      part.group.push(o.skeleton.bones[si.getX(i)].name);
      part.rest.push([g.attributes.position.getX(i),g.attributes.position.getY(i),g.attributes.position.getZ(i)]);
     }
     part.p.push(o.localToWorld(o.getVertexPosition(i,cam.position.clone())).toArray());
    }
    for(let j=0;j<g.index.count;j+=3){
     const tri=[0,1,2].map(k=>remap.get(g.index.getX(j+k)));
     if(tri.every(k=>k!==undefined))part.f.push(tri);
    }
   });
   if(!parts.sleeve.f.length || !parts.arm.f.length)throw Error('Missing skinned sleeve or arm');
   records.push({side,index,time:pose.t,transforms,...parts});
   if([0,2,3].includes(index)){
    const target=cam.position.clone().set(side==='L'?.058:-.058,.397,.006);
    cam.position.copy(target).add(cam.position.clone().set(0,.018,.47));cam.lookAt(target);cam.near=.005;cam.updateProjectionMatrix();
    renderer.setClearColor(0x52677a,1);renderer.render(scene,cam);
    const surface=renderer.domElement,sw=surface.height*width/height;
    ctx.drawImage(surface,(surface.width-sw)/2,0,sw,surface.height,[0,2,3].indexOf(index)*width,side==='L'?height:0,width,height);
   }
  }
 }
 fs.writeFileSync(path.join(dir,'sleeve-'+label+'.png'),Buffer.from(out.toDataURL('image/png').split(',')[1],'base64'));
 // Store the actual deformed surfaces for the Blender triangle-intersection check.
 const zip=w.require('zlib');
 fs.writeFileSync(path.join(dir,'sleeve-'+label+'-geometry.json.gz'),zip.gzipSync(JSON.stringify(records)));
}
