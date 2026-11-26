import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {FBXLoader} from 'three/addons/loaders/FBXLoader.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {VRMLoaderPlugin,VRMUtils} from '@pixiv/three-vrm';
import {resolveModelPath} from '../../render/modelPath.js';
import {bindWardrobe} from 'avatar-wardrobe';

// The fitting preview draws only when opened, resized, orbited or changed.
export async function openWardrobePreview(canvas,path,signal){
    const url=window.require('path').isAbsolute(path)?window.require('url').pathToFileURL(path).href:resolveModelPath(path);
    const isFBX=/\.fbx$/i.test(path);
    const loader=isFBX?new FBXLoader():new GLTFLoader().register(p=>new VRMLoaderPlugin(p));
    const asset=await loader.loadAsync(url),model=isFBX?asset:asset.scene;
    if(signal.aborted){VRMUtils.deepDispose(model);return;}
    const render=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true});
    const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(32,1,.001,10000);
    scene.add(model,new THREE.HemisphereLight(0xffffff,0xc3bbc4,2));
    const sun=new THREE.DirectionalLight(0xffffff,2);sun.position.set(1,3,4);scene.add(sun);
    const vrm=asset.userData?.vrm;
    if(vrm?.meta.metaVersion==='0')model.rotation.y=Math.PI;
    vrm?.update(0);
    const outfit=bindWardrobe(model,asset.parser);
    const bounds=new THREE.Box3().setFromObject(model,true);
    const center=bounds.getCenter(new THREE.Vector3()),size=bounds.getSize(new THREE.Vector3());
    const radius=Math.max(size.y*.55,size.x*.36,.1);
    const controls=new OrbitControls(camera,canvas);
    controls.target.copy(center);camera.position.copy(center);camera.position.z+=radius/Math.tan(16*Math.PI/180);
    camera.near=radius*.01;camera.far=radius*100;controls.update();
    function draw(){
        const w=canvas.clientWidth,h=canvas.clientHeight;if(!w || !h)return;
        render.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();
        render.render(scene,camera);
    }
    const observer=new ResizeObserver(draw);observer.observe(canvas);
    controls.addEventListener('change',draw);draw();
    signal.addEventListener('abort',()=>{
        observer.disconnect();controls.dispose();outfit.dispose();VRMUtils.deepDispose(model);
        render.dispose();render.forceContextLoss();
    },{once:true});
    return {show(hidden){outfit.apply(hidden);draw();},parts:outfit.parts};
}
