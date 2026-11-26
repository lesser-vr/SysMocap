const path=require('node:path'),assert=require('node:assert/strict');
module.exports=async ({ev,output})=>{
 const result=await ev(`(async()=>{
   const w=document.querySelector('#foo').contentWindow,vrm=w.currentVrm,scene=vrm.scene.parent;
   const [r,c]=await new Promise(ok=>{const old=scene.onAfterRender;scene.onAfterRender=(r,s,c)=>{scene.onAfterRender=old;ok([r,c]);};});
   const fs=require('fs'),path=require('path'),out=${JSON.stringify(output)};
   const mgr=vrm.expressionManager;for(const e of mgr.expressions)mgr.setValue(e.expressionName,0);
   mgr.setValue('happy',1);mgr.setValue('aa',.24);mgr.update();
   for(const name of ['head','neck','spine','chest','upperChest'])vrm.humanoid.getNormalizedBoneNode(name)?.quaternion.identity();
   const head=vrm.humanoid.getNormalizedBoneNode('head');
   const field=w.document.querySelector('#fluffo-smoothness [name=furQuality]');
   const ears=['BipLEar','BipREar'].map(name=>vrm.scene.getObjectByName(name));
   let clip;vrm.scene.traverse(n=>{for(const v of Object.values(n.userData))if(v?.idle1?.tracks)clip=v.idle1;});
   const canvas=r.domElement,copy=document.createElement('canvas');copy.width=canvas.width;copy.height=canvas.height;const ctx=copy.getContext('2d');
   function shot(name,roll=0,back=0,phase=0,angle=0,mode='standard',tilt=0){
      field.value=mode;field.dispatchEvent(new w.Event('input'));
      head.rotation.set(tilt*Math.PI/180,angle*Math.PI/180,0);vrm.humanoid.update();
      for(const n of ears){
         const q=clip.tracks[n.name].q;
         n.quaternion.fromArray(q[Math.min(q.length-1,phase)]);
         // Parent axes in this source rig: -Z is forward and Y is horizontal.
         const rot=n.rotation.clone().set(0,back*Math.PI/180,(n===ears[0]?-1:1)*roll*Math.PI/180,'XYZ');
         n.quaternion.premultiply(n.quaternion.clone().setFromEuler(rot));
      }
      r.setClearColor(0,0);r.render(scene,c);ctx.clearRect(0,0,copy.width,copy.height);ctx.drawImage(canvas,0,0);
      fs.writeFileSync(path.join(out,name+'.png'),Buffer.from(copy.toDataURL().split(',')[1],'base64'));
   }
   const qTrack=clip.tracks[ears[0].name].q;
   const displacement=q=>1-Math.abs(q.reduce((sum,v,i)=>sum+v*qTrack[0][i],0));
   const peak=qTrack.reduce((best,q,i)=>displacement(q)>displacement(qTrack[best])?i:best,0);
   shot('neutral');shot('off',0,0,0,0,'off');shot('idle',0,0,peak);shot('turn',0,0,0,20);
   if(${process.argv.includes('--ear-motion')}){
      const dir=path.join(out,'frames');fs.mkdirSync(dir,{recursive:true});
      copy.width=600;copy.height=500;
      field.value='standard';field.dispatchEvent(new w.Event('input'));
      const joints=Object.entries(clip.tracks).map(([key,track])=>[vrm.scene.getObjectByName(key),track]).filter(([node])=>node);
      for(let i=0;i<qTrack.length;i++){
         head.rotation.set(0,.15*Math.sin(2*Math.PI*i/qTrack.length),0);vrm.humanoid.update();
         for(const [node,tr] of joints)for(const [key,prop] of [['q','quaternion'],['p','position'],['s','scale']]){
            if(tr[key]?.length)node[prop].fromArray(tr[key][Math.min(i,tr[key].length-1)]);
         }
         r.setClearColor(0x00ff00,1);r.render(scene,c);
         ctx.drawImage(canvas,610,18,700,584,0,0,600,500);
         fs.writeFileSync(path.join(dir,String(i).padStart(3,'0')+'.jpg'),Buffer.from(copy.toDataURL('image/jpeg',.96).split(',')[1],'base64'));
      }
   }
   if(${process.argv.includes('--ear-sweep')}){
     for(const [name,roll,back] of [['r8',8,0],['r16',16,0],['b12',0,-12],['f12',0,12],['lift',10,-12],['lift2',16,-18]])shot(name,roll,back);
     shot('camera-down',0,0,0,0,'standard',12);shot('camera-up',0,0,0,0,'standard',-12);
   }
   return {shaderErrors:r.info.programs.filter(p=>p.diagnostics && !p.diagnostics.runnable).length,tracks:ears.map(n=>clip.tracks[n.name].q.length)};
 })()`);
 assert.equal(result.shaderErrors,0);assert.ok(result.tracks.every(n=>n>1));
 console.log(result);
};
