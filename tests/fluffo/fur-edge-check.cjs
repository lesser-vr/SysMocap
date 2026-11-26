const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
module.exports=async ({ev,output})=>{
 const result=await ev(`(async()=>{
    const w=document.querySelector('#foo').contentWindow,vrm=w.currentVrm,scene=vrm.scene.parent;
    const [r,c]=await new Promise(done=>{const old=scene.onAfterRender;scene.onAfterRender=(r,s,c)=>{scene.onAfterRender=old;done([r,c]);};});
    for(const name of ['head','neck','spine','chest','upperChest'])vrm.humanoid.getNormalizedBoneNode(name)?.quaternion.identity();
    const mgr=vrm.expressionManager;
    for(const e of mgr.expressions)mgr.setValue(e.expressionName,0);
    mgr.setValue('happy',1);mgr.setValue('aa',.24);mgr.update();vrm.humanoid.update();
    const field=w.document.querySelector('#fluffo-smoothness [name=furQuality]');
    const canvas=r.domElement, target=document.createElement('canvas'),ctx=target.getContext('2d');
    target.width=canvas.width;target.height=canvas.height;
    const gl=r.getContext(),pixel=new Uint8Array(4);
    const shots={},metrics={};
    for(const mode of ['off','standard','high']){
      field.value=mode;field.dispatchEvent(new w.Event('input'));
      r.setClearColor(0,0);
      r.render(scene,c);
      ctx.clearRect(0,0,target.width,target.height);ctx.drawImage(canvas,0,0);
      shots[mode]=target.toDataURL().split(',')[1];
      const times=[];
      for(let i=0;i<25;i++){const start=performance.now();r.render(scene,c);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);if(i>=5)times.push(performance.now()-start);}
      metrics[mode]={medianMs:times.sort((a,b)=>a-b)[10],draws:r.info.render.calls};
    }
    if(${process.argv.includes('--fur-edge-motion')}){
      field.value='standard';field.dispatchEvent(new w.Event('input'));
      const head=vrm.humanoid.getNormalizedBoneNode('head'),pose=head.quaternion.clone();
      const out=${JSON.stringify(output)},fs=require('fs'),path=require('path');
      const frames=path.join(out,'frames');fs.mkdirSync(frames,{recursive:true});
      r.setClearColor(0x00ff00,1);
      // Same camera and light throughout. Slowly turn the head to expose temporal edge artifacts.
      for(let i=0;i<90;i++){
        head.rotation.y=.22*Math.sin(2*Math.PI*i/90);vrm.humanoid.update();r.render(scene,c);
        ctx.drawImage(canvas,0,0);const jpg=target.toDataURL('image/jpeg',.98).split(',')[1];
        fs.writeFileSync(path.join(frames,String(i).padStart(3,'0')+'.jpg'),Buffer.from(jpg,'base64'));
      }
      head.quaternion.copy(pose);vrm.humanoid.update();
    }
    return {shots,metrics,shaderFailures:r.info.programs.filter(p=>p.diagnostics && !p.diagnostics.runnable).length};
 })()`);
 for(const [mode,data] of Object.entries(result.shots))fs.writeFileSync(path.join(output,mode+'.png'),Buffer.from(data,'base64'));
 assert.equal(result.shaderFailures,0);assert.ok(result.metrics.high.draws>result.metrics.standard.draws);
 fs.writeFileSync(path.join(output,'metrics.json'),JSON.stringify(result.metrics,null,2));console.log(result.metrics);
};
