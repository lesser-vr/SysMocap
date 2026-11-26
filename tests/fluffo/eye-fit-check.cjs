const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
module.exports=async({ev,output,fixture})=>{
 const file=path.resolve(fixture);
 const moduleUrl=name=>pathToFileURL(path.resolve(__dirname,'../../src/mocap',name+'.mjs')).href;
 const result=await ev(`(async()=>{
 const w=document.querySelector('#foo').contentWindow,m=w.currentVrm,scene=m.scene.parent;
 const [r,c]=await new Promise(ok=>{const old=scene.onAfterRender;scene.onAfterRender=(r,s,c)=>{scene.onAfterRender=old;ok([r,c]);};});
 const {createRigDriver}=await import(${JSON.stringify(moduleUrl('fluffoRigDriver'))});
 const {avatarRigProfile}=await import(${JSON.stringify(moduleUrl('avatarRigProfile'))});
 const {desktopSmoothness}=await import(${JSON.stringify(moduleUrl('fluffoSmoothness'))});
 const bytes=require('fs').readFileSync(${JSON.stringify(file)});
 const json=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());const profile=avatarRigProfile(json);
 const mgr=m.expressionManager,joints=m.humanoid,eyes=['left','right'].map(s=>joints.getNormalizedBoneNode(s+'Eye'));
 for(const name of ['head','neck','spine','chest','upperChest'])joints.getNormalizedBoneNode(name)?.quaternion.identity();
 const canvas=r.domElement,copy=document.createElement('canvas'),ctx=copy.getContext('2d');const shots={},poses={};
 function shot(name,close=true){
    joints.update();mgr.update();r.render(scene,c);
    const z=canvas.width/1920;const x=close?Math.round(770*z):0,y=close?Math.round(218*z):0;
    const width=close?Math.round(380*z):canvas.width,height=close?Math.round(118*z):canvas.height;
    copy.width=width;copy.height=height;ctx.fillStyle='#00ff00';ctx.fillRect(0,0,width,height);
    ctx.drawImage(canvas,x,y,width,height,0,0,width,height);shots[name]=copy.toDataURL().split(',')[1];
 }
 function clear(){
    for(const exp of mgr.expressions)mgr.setValue(exp.expressionName,0);for(const e of eyes)e.quaternion.identity();
 }
 if(${process.argv.includes('--sweep')}){
   for(const [name,open,squint,cheek,pitch,yaw] of [
     ['base',0,0,0,0,0],['wide',.35,0,0,0,0],['squint',0,.45,0,0,0],['cheek',0,0,.65,0,0],
     ['plus',0,0,0,.14,.09],['minus',0,0,0,-.14,-.09],['mix',.28,.3,.25,.12,.08],['mix2',.28,.3,.25,-.12,-.08]]){
     clear();mgr.setValue('happy',1);
     for(const [i,side] of ['Left','Right'].entries()){for(const [key,v] of [['eyeWide',open],['eyeSquint',squint],['cheekSquint',cheek]])mgr.setValue(key+side,v);
       eyes[i].rotation.set(pitch,i===0?yaw:-yaw,0);}
     shot(name);
   }
 }
 const tune=desktopSmoothness();tune.set({...tune.values,eyeRestOpen:profile.neutralEyeOpen});
 const drive=createRigDriver(m,tune,profile.eyeFit);
 for(const [name,scores] of Object.entries({neutral:{},smile:{mouthSmileLeft:1,mouthSmileRight:1},
    left:{eyeLookOutLeft:.8,eyeLookInRight:.8},right:{eyeLookOutRight:.8,eyeLookInLeft:.8},
    up:{eyeLookUpLeft:.8,eyeLookUpRight:.8},down:{eyeLookDownLeft:.8,eyeLookDownRight:.8},
    blink:{eyeBlinkLeft:1,eyeBlinkRight:1},wink:{eyeBlinkLeft:1},reopen:{}})){
    clear();let t=Object.keys(poses).length*2+1;
    for(let n=0;n<60;n++){t+=1/60;drive({frame:t,faceStamp:t,scores},t*1000);}
    poses[name]={blink:mgr.getValue('blink'),leftBlink:mgr.getValue('blinkLeft'),rot:eyes.map(e=>[e.rotation.x,e.rotation.y])};
    shot(name);if(['smile','neutral'].includes(name))shot(name+'-full',false);
    if(name==='neutral' && ${process.argv.includes('--clarity-check')}){
       const size=r.getSize(c.position.clone()),ratio=r.getPixelRatio();
       r.setDrawingBufferSize(1440,810,1);shot('native-810',false);
       r.setDrawingBufferSize(size.x,size.y,ratio);
       const shells=[];m.scene.traverse(n=>{if(n.userData.avatarFurLayer!==undefined && n.visible)shells.push(n);});
       shells.forEach(n=>n.visible=false);shot('fur-off',false);
       const fills=scene.children.filter(n=>n.isHemisphereLight || (n.isDirectionalLight && n.position.x<0));
       fills.forEach(n=>n.visible=false);shot('fill-off-fur-off',false);
       fills.forEach(n=>n.visible=true);shells.forEach(n=>n.visible=true);
    }
 }
 if(${process.argv.includes('--face-check')}){
    const open={mouthSmileLeft:1,mouthSmileRight:1};
    const oral=[];
    m.scene.traverse(n=>{if(n.isMesh && n.material.userData.sysmocapSurface?.poseOcclusion)oral.push(n.material);});
    for(const [i,jawOpen] of [0,.18,.6].entries()){
       clear();let stamp=35+i*2;
       for(let n=0;n<60;n++){stamp+=1/60;drive({frame:stamp,faceStamp:stamp,scores:{...open,jawOpen}},stamp*1000);}
       shot('speech-'+i,false);
       poses['oral'+i]=oral.map(mat=>r.properties.get(mat).uniforms?.openWeight?.value);
       if(i===1){
          joints.getNormalizedBoneNode('head').rotation.y=.25;
          shot('speech-turn',false);
          joints.getNormalizedBoneNode('head').quaternion.identity();
       }
    }
    poses.shaderErrors=r.info.programs.filter(p=>p.diagnostics && !p.diagnostics.runnable).length;
 }
 return {shots,poses};})()`);
 for(const [name,data] of Object.entries(result.shots))fs.writeFileSync(path.join(output,name+'.png'),Buffer.from(data,'base64'));
 fs.writeFileSync(path.join(output,'poses.json'),JSON.stringify(result.poses,null,2));
 assert.ok(result.poses.blink.blink>.97 && result.poses.wink.leftBlink>.97 && result.poses.reopen.blink<.02);
 for(const side of [0,1]){
    const {neutral,left,right,up,down,reopen}=result.poses;
    const [pitch,yaw]=neutral.rot[side];
    assert.ok(left.rot[side][1]>yaw+.05 && right.rot[side][1]<yaw-.05);
    assert.ok(up.rot[side][0]<pitch-.05 && down.rot[side][0]>pitch+.05);
    assert.ok(Math.abs(reopen.rot[side][1]-yaw)<.005);
 }
 if(process.argv.includes('--face-check')){
    assert.equal(result.poses.shaderErrors,0);
    const b=fs.readFileSync(file),doc=JSON.parse(b.subarray(20,20+b.readUInt32LE(12)));
    if(doc.materials.some(m=>m.extras?.sysmocapSurface?.poseOcclusion)){
       for(const i of [0,1,2]){
          const shades=result.poses['oral'+i];
          assert.equal(shades.length,3);
          assert.ok(shades.every(v=>Number.isFinite(v) && (i===0?v<.02:v>result.poses['oral'+(i-1)][0]+.1)));
       }
    }
 }
 console.log('Gaze, expression and blink samples captured');
};
