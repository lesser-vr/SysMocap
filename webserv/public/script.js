import {bindWardrobe} from "/fluffo/wardrobe.mjs";
import {trackingDriver} from "/fluffo/humanoidTracking.mjs";
/**
 *  Web Render Part with WebXR API
 *
 *  A part of SysMocap, open sourced under Mozilla Public License 2.0
 *
 *  https://github.com/xianfei/SysMocap
 *
 *  xianfei 2022.3
 */


// import * as Kalidokit from "../dist";
//Import Helper Functions from Kalidokit
const remap = Kalidokit.Utils.remap;
const clamp = Kalidokit.Utils.clamp;
const lerp = Kalidokit.Vector.lerp;

// websocket setup
const socket = io();

import { ARButton } from "/node_modules/three/examples/jsm/webxr/ARButton.js";
import { VRButton } from "/node_modules/three/examples/jsm/webxr/VRButton.js";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import Stats from "three/addons/libs/stats.module.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";
import { createMcuFraming, measureMcuBounds, mountAvatarAppearance, mountBroadcastScene, sizeBroadcastCanvas, createOutputFrameGate } from "/fluffo/broadcastScene.mjs";
import { createSmoothness } from "/fluffo/fluffoSmoothness.mjs";
import { createRigView,createIdlePlayer,avatarRigProfile } from "/fluffo/fluffoMcu.mjs";


/* THREEJS WORLD SETUP */
let currentVrm;
let mcu;
let standardRig,wardrobe,previousOutfit;
let playIdle;
let rigView;
const sceneTuning=createSmoothness();
let appliedSceneControls,activeFraming;

var mocapData = null;


// renderer
const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });

const useXRres = await fetch("/useWebXR");
const useXR = await useXRres.json();
if (useXR) {
    renderer.xr.enabled = true;
    for (const [mode,button,margin] of [['immersive-ar',ARButton,'-75px'],['immersive-vr',VRButton,'75px']]) {
        if (await navigator.xr?.isSessionSupported(mode).catch(()=>false)) {
            const element=button.createButton(renderer);
            element.style.marginLeft=margin;
            document.body.appendChild(element);
        }
    }
}

document.getElementById("avatar-stage").appendChild(renderer.domElement);

// camera
const orbitCamera = new THREE.PerspectiveCamera(
    50,
    window.innerWidth / window.innerHeight,
    0.01,
    1000
);
orbitCamera.position.set(0.0, 1.1, 1.8);
function resizeBroadcast(){
    if(renderer.xr.isPresenting || !window.innerHeight)return;
    sizeBroadcastCanvas(renderer,window.innerWidth,window.innerHeight,window.devicePixelRatio,sceneTuning.values.renderResolution);
    orbitCamera.aspect=window.innerWidth/window.innerHeight;
    orbitCamera.updateProjectionMatrix();
}
resizeBroadcast();
window.addEventListener('resize',resizeBroadcast);
renderer.xr.addEventListener('sessionend',resizeBroadcast);
sceneTuning.onChange(keys=>{if(keys.includes('renderResolution'))resizeBroadcast();});

// controls
const orbitControls = new OrbitControls(orbitCamera, renderer.domElement);
orbitControls.screenSpacePanning = true;
orbitControls.target.set(0.0, 1.4, 0.0);
orbitControls.update();

// scene
const scene = new THREE.Scene();

// model info
const modelInfoRes = await fetch("/modelInfo");
var modelObj = await modelInfoRes.json();
var modelPath = modelObj.path;

// Main Render Loop
const clock = new THREE.Clock();


var fileType =  modelObj.type

// light
var light0 = new THREE.DirectionalLight(0xffffff, Math.PI);
light0.position.set(1.0, 1.0, 1.0).normalize();
scene.add(light0);

if (fileType !== "vrm") {
    const light = new THREE.AmbientLight(0xffffff, 0.8);
    light.position.set(10.0, 10.0, -10.0).normalize();
    scene.add(light);
    var light2 = new THREE.DirectionalLight(0xffffff, 1);
    light2.position.set(0, 3, -2);
    light2.castShadow = true;
    scene.add(light2);
}

var skeletonHelper;

/* VRM CHARACTER SETUP */

// Import Character VRM
var initRotation = {};

// Import model from URL, add your own model here
var loader = null;
if (fileType == "fbx") {
    loader = new FBXLoader();
} else {
    loader = new GLTFLoader();
    loader.register((parser) => {
        return new VRMLoaderPlugin(parser);
    });
}
// Import Character
loader.crossOrigin = "anonymous";
loader.load(
    modelPath,

    (gltf) => {
        var model = null;
        if (fileType == "fbx") {
            model = gltf;
            gltf.scale.set(0.01, 0.01, 0.01);
        } else {
            model = gltf.scene;
        }

        const profile=avatarRigProfile(gltf.parser?.json);
        if (fileType == "vrm") {
            // calling these functions greatly improves the performance
            VRMUtils.removeUnnecessaryVertices(gltf.scene);
            VRMUtils.removeUnnecessaryJoints(gltf.scene);
            const vrm = gltf.userData.vrm;
            scene.add(vrm.scene);
            if (vrm.meta.metaVersion === "0") {
                vrm.scene.rotation.y = Math.PI; // Rotate model 180deg to face camera
            }
            currentVrm = vrm;
            window.currentVrm = currentVrm;
            playIdle=createIdlePlayer(vrm);
            const bounds=profile.extended && !profile.mcu ? measureMcuBounds(model,new THREE.Box3(),true) : null;
            rigView=createRigView(vrm,orbitCamera,orbitControls,profile,bounds,null,sceneTuning);
        } else {
            skeletonHelper = new THREE.SkeletonHelper(model);
            skeletonHelper.visible = false;
            scene.add(skeletonHelper);
            // for glb files
            scene.add(model);
            model.rotation.y = Math.PI; // Rotate model 180deg to face camera
            var rot = {
                x: 0,
                y: 0,
                z: -3.1129221599796764,
            };
            for (var i in rot) orbitCamera.rotation[i] = rot[i];
            var pos = {
                x: -0,
                y: 0.5922529898344698,
                z: -1.4448572419883419,
            };
            for (var i in pos) orbitCamera.position[i] = pos[i];

            orbitControls.target.y = 0.5;
            orbitControls.update();

            if (modelObj.cameraTarget) {
                orbitControls.target.set(
                    modelObj.cameraTarget.x,
                    modelObj.cameraTarget.y,
                    modelObj.cameraTarget.z
                );
                orbitControls.update();
            }
            if (modelObj.cameraPosition) {
                for (var i in modelObj.cameraPosition)
                    orbitCamera.position[i] = modelObj.cameraPosition[i];
            }
            if (modelObj.cameraRotation) {
                for (var i in modelObj.cameraRotation)
                    orbitCamera.rotation[i] = modelObj.cameraRotation[i];
            }

            if (modelObj.init) {
                initRotation = modelObj.init;
            }
        }
        wardrobe=bindWardrobe(model,gltf.parser,profile,currentVrm?.expressionManager);
        if(!rigView){
                const baseDirection=orbitCamera.position.clone().sub(orbitControls.target);
                const sceneControls=mountBroadcastScene(orbitCamera,orbitControls,light0,renderer.domElement,sceneTuning,undefined,profile.keyYawOffset);
                const getBone=name=>currentVrm ? currentVrm.humanoid.getNormalizedBoneNode(name[0].toLowerCase()+name.slice(1)) :
                    skeletonHelper.bones.find(b=>b.name===modelObj.binding?.[name]?.name);
                standardRig=trackingDriver(currentVrm,getBone,sceneTuning,gltf.parser);
                const bounds=measureMcuBounds(model,new THREE.Box3(),!!currentVrm);
                mcu=createMcuFraming(orbitCamera,baseDirection,getBone,bounds,sceneControls,profile.mcu);
            }
        mountAvatarAppearance(THREE,scene,model,gltf.parser,sceneTuning,currentVrm?.expressionManager);
    },

    (progress) =>
        console.log(
            "Loading model...",
            100.0 * (progress.loaded / progress.total),
            "%"
        ),

    (error) => console.error(error)
);

function capitalizeFirstLetterToLowerCase(str) {
    if (str.length === 0) {
        return str;
    }
    return str.charAt(0).toLowerCase() + str.slice(1);
}

// Animate Rotation Helper function
const rigRotation = (
    name,
    rotation = { x: 0, y: 0, z: 0 },
    dampener = 1,
    lerpAmount = 0.3
) => {
        if(standardRig && !standardRig.canRotate(name))return;
    if (currentVrm) {
        const Part = currentVrm.humanoid.getNormalizedBoneNode(
            capitalizeFirstLetterToLowerCase(name)
        );
        if (!Part) {
            return;
        }
        let euler = new THREE.Euler(
            (currentVrm.meta.metaVersion === "1" ? -1 : 1) *
                rotation.x *
                dampener,
            rotation.y * dampener,
            (currentVrm.meta.metaVersion === "1" ? -1 : 1) *
                rotation.z *
                dampener,
            rotation.rotationOrder || "XYZ"
        );
        let quaternion = new THREE.Quaternion().setFromEuler(euler);
        Part.quaternion.slerp(quaternion, rigView?.boneWeight(name,lerpAmount) ?? standardRig.weight(name,lerpAmount));
    } else if (skeletonHelper) {
        var skname = modelObj.binding[name].name; // convert name with model json binding info
        if (skname == "None") {
            return;
        }
        // find bone in bones by name
        var b = skeletonHelper.bones.find((bone) => bone.name == skname);

        if (b) {
            if (!initRotation[name]) {
                initRotation[name] = {
                    x: b.rotation.x,
                    y: b.rotation.y,
                    z: b.rotation.z,
                };
            }
            const bindingFunc = modelObj.binding[name].func;
             const order = modelObj.binding[name].order?.toUpperCase();
            const x = rotation.x * dampener;
            const y = rotation.y * dampener;
            const z = rotation.z * dampener;

            let euler = new THREE.Euler(
                initRotation[name].x + eval(bindingFunc.fx),
                initRotation[name].y + eval(bindingFunc.fy),
                initRotation[name].z + eval(bindingFunc.fz),
                order || rotation.rotationOrder || "XYZ"
            );
            let quaternion = new THREE.Quaternion().setFromEuler(euler);
            b.quaternion.slerp(quaternion, standardRig.weight(name,lerpAmount)); // interpolate
        } else {
            console.log("Can not found bone " + name);
        }
    }
};

// Animate Position Helper Function
const rigPosition = (
    name,
    position = { x: 0, y: 0, z: 0 },
    dampener = 1,
    lerpAmount = 0.3
) => {
    if (currentVrm) {
        const Part = currentVrm.humanoid.getNormalizedBoneNode(
            capitalizeFirstLetterToLowerCase(name)
        );
        if (!Part) {
            return;
        }
        let vector = new THREE.Vector3(
            position.x * dampener,
            position.y * dampener,
            position.z * dampener
        );
        Part.position.lerp(vector, rigView?.boneWeight(name,lerpAmount) ?? standardRig.weight(name,lerpAmount));
    } else if (skeletonHelper) {
        name = modelObj.binding[name].name; // convert name with model json binding info
        // find bone in bones by name
        var b = skeletonHelper.bones.find((bone) => bone.name == name);
        if (b) {
            if (fileType == "fbx") {
                dampener *= 100;
            }
            let vector = new THREE.Vector3(
                position.x * dampener,
                position.y * dampener,
                -position.z * dampener
            );
            if (fileType == "fbx") {
                vector.y -= 1.2 * dampener;
            }
            b.position.lerp(vector, standardRig.weight("Hips",lerpAmount)); // interpolate
        } else {
            console.log("Can not found bone " + name);
        }
    }
};

let oldLookTarget = new THREE.Euler();
const rigFace = (riggedFace) => {
    if (!currentVrm) {
        return; // face motion only support VRM Now
    }

//PUPILS
    //interpolate pupil and keep a copy of the value
    let lookTarget = new THREE.Euler(
        lerp(oldLookTarget.x, riggedFace.pupil.y, 0.4),
        lerp(oldLookTarget.y, riggedFace.pupil.x, 0.4),
        0,
        "XYZ"
    );
    oldLookTarget.copy(lookTarget);
    currentVrm.lookAt?.applier?.applyYawPitch(lookTarget.y, lookTarget.x);
};

/* VRM Character Animator */
const animateVRM = (vrm, results) => {
    if (!vrm && !skeletonHelper) {
        return;
    }
    if(!results) return;
    const mode=results.framing || 'face';
    if(mode!==activeFraming){
        activeFraming=mode;mcu?.setTarget(mode);rigView?.setTarget(mode);
    }
    if(rigView)rigView.receiveControls(results.fluffoRig?.liveControls);
    else if(results.sceneControls && results.sceneControls!==appliedSceneControls){
        appliedSceneControls=results.sceneControls;
        sceneTuning.set(appliedSceneControls);
    }
    if(wardrobe && previousOutfit!==results.outfitHidden){
        previousOutfit=results.outfitHidden;
        if(wardrobe.apply(previousOutfit))rigView?.setOutfit(previousOutfit);
    }
    if(standardRig && !standardRig.begin(results))return;
    // Take the results from `Holistic` and animate character based on its Face, Pose, and Hand Keypoints.
    let riggedPose = results.riggedPose,
        riggedLeftHand = results.riggedLeftHand,
        riggedRightHand = results.riggedRightHand,
        riggedFace = results.riggedFace;

    // Animate Face
    if (riggedFace ) {
        const head=rigView ? rigView.head(riggedFace.head,results.fluffoRig?.frame) : riggedFace.head;
        rigRotation("Neck", head, rigView ? .49 : .7);
        if(rigView) rigRotation("Head",head,.21);
        else if (fileType == "vrm") rigFace(JSON.parse(JSON.stringify(riggedFace)));
    }

    // Animate Pose
    if (riggedPose) {
        if(!rigView?.active) rigRotation("Hips", riggedPose.Hips.rotation, 0.7);
        if(!rigView?.active && !mcu?.trackHips(riggedPose.Hips.position,standardRig?.weight("Hips",.07))) rigPosition(
            "Hips",
            {
                x: riggedPose.Hips.position.x, // Reverse direction
                y: riggedPose.Hips.position.y + (mode==='full'?1.4:mode==='half'?1.1:1), // Add a bit of height
                z: -riggedPose.Hips.position.z + (mode==='full'?2:mode==='half'?1:0)*(currentVrm?.meta.metaVersion==='1'?-1:1), // Reverse direction
            },
            1,
            0.07
        );

        rigRotation("Chest", riggedPose.Chest, 0.25, 0.3);
        rigRotation("Spine", riggedPose.Spine, 0.45, 0.3);

        rigRotation("RightUpperArm", riggedPose.RightUpperArm);
        rigRotation("RightLowerArm", riggedPose.RightLowerArm);
        rigRotation("LeftUpperArm", riggedPose.LeftUpperArm);
        rigRotation("LeftLowerArm", riggedPose.LeftLowerArm);

        rigRotation("LeftUpperLeg", riggedPose.LeftUpperLeg);
        rigRotation("LeftLowerLeg", riggedPose.LeftLowerLeg);
        rigRotation("RightUpperLeg", riggedPose.RightUpperLeg);
        rigRotation("RightLowerLeg", riggedPose.RightLowerLeg);
    }

    // Animate Hands
    if(rigView){
        const hands=riggedPose?.chestUpHands;
        const now=performance.now();
        rigView.applyHands(hands,now);
        rigView.applyRig(results.fluffoRig,now,rigView.active,hands,riggedFace?.mouth?.shape,riggedFace?.eye);
    }
    if (riggedLeftHand && riggedPose && fileType == "vrm" && !rigView) {
        rigRotation("LeftHand", {
            // Combine pose rotation Z and hand rotation X Y
            z: riggedPose.LeftHand.z,
            y: riggedLeftHand.LeftWrist.y,
            x: riggedLeftHand.LeftWrist.x,
        });
        rigRotation("LeftRingProximal", riggedLeftHand.LeftRingProximal);
        rigRotation(
            "LeftRingIntermediate",
            riggedLeftHand.LeftRingIntermediate
        );
        rigRotation("LeftRingDistal", riggedLeftHand.LeftRingDistal);
        rigRotation("LeftIndexProximal", riggedLeftHand.LeftIndexProximal);
        rigRotation(
            "LeftIndexIntermediate",
            riggedLeftHand.LeftIndexIntermediate
        );
        rigRotation("LeftIndexDistal", riggedLeftHand.LeftIndexDistal);
        rigRotation("LeftMiddleProximal", riggedLeftHand.LeftMiddleProximal);
        rigRotation(
            "LeftMiddleIntermediate",
            riggedLeftHand.LeftMiddleIntermediate
        );
        rigRotation("LeftMiddleDistal", riggedLeftHand.LeftMiddleDistal);
        rigRotation("LeftThumbProximal", riggedLeftHand.LeftThumbProximal);
        rigRotation(
            "LeftThumbIntermediate",
            riggedLeftHand.LeftThumbIntermediate
        );
        rigRotation("LeftThumbDistal", riggedLeftHand.LeftThumbDistal);
        rigRotation("LeftLittleProximal", riggedLeftHand.LeftLittleProximal);
        rigRotation(
            "LeftLittleIntermediate",
            riggedLeftHand.LeftLittleIntermediate
        );
        rigRotation("LeftLittleDistal", riggedLeftHand.LeftLittleDistal);
    }
    if (riggedRightHand && riggedPose && fileType == "vrm" && !rigView) {
        // riggedRightHand = Kalidokit.Hand.solve(rightHandLandmarks, "Right");
        rigRotation("RightHand", {
            // Combine Z axis from pose hand and X/Y axis from hand wrist rotation
            z: riggedPose.RightHand.z,
            y: riggedRightHand.RightWrist.y,
            x: riggedRightHand.RightWrist.x,
        });
        rigRotation("RightRingProximal", riggedRightHand.RightRingProximal);
        rigRotation(
            "RightRingIntermediate",
            riggedRightHand.RightRingIntermediate
        );
        rigRotation("RightRingDistal", riggedRightHand.RightRingDistal);
        rigRotation("RightIndexProximal", riggedRightHand.RightIndexProximal);
        rigRotation(
            "RightIndexIntermediate",
            riggedRightHand.RightIndexIntermediate
        );
        rigRotation("RightIndexDistal", riggedRightHand.RightIndexDistal);
        rigRotation("RightMiddleProximal", riggedRightHand.RightMiddleProximal);
        rigRotation(
            "RightMiddleIntermediate",
            riggedRightHand.RightMiddleIntermediate
        );
        rigRotation("RightMiddleDistal", riggedRightHand.RightMiddleDistal);
        rigRotation("RightThumbProximal", riggedRightHand.RightThumbProximal);
        rigRotation(
            "RightThumbIntermediate",
            riggedRightHand.RightThumbIntermediate
        );
        rigRotation("RightThumbDistal", riggedRightHand.RightThumbDistal);
        rigRotation("RightLittleProximal", riggedRightHand.RightLittleProximal);
        rigRotation(
            "RightLittleIntermediate",
            riggedRightHand.RightLittleIntermediate
        );
        rigRotation("RightLittleDistal", riggedRightHand.RightLittleDistal);
    }

};


const shouldDraw = createOutputFrameGate();
function animate(timestamp) {
    animateVRM(currentVrm, mocapData);
    if (currentVrm) {
        // Update model to render physics
        const dt=clock.getDelta();
        currentVrm.update(dt);
            standardRig?.finishFace();
        playIdle?.(dt);
        rigView?.updateIdle(dt);
    }
    if (renderer.xr.isPresenting || shouldDraw(sceneTuning.values.outputFps, timestamp))
        renderer.render(scene, orbitCamera);
}
renderer.setAnimationLoop(animate);

socket.on("message",  function (evt) {
    // console.log(evt.data);

    var mydata = JSON.parse(evt);
    // console.log(mydata);
    if (!mydata.type) return;
    if (mydata.type != "xf-sysmocap-data") return;
    mocapData = mydata;
    // animateVRM(currentVrm, mydata);
});


document.addEventListener("keydown", (event) => {
    const camera = orbitCamera
    console.log(event);
    var x = camera.position.x;
    var y = camera.position.y;
    var z = camera.position.z;
    var step = 0.03;
    switch (event.key) {
        case "d":
        case "ArrowRight":
            camera.position.set(x + step, y, z);
            break;
        case "a":
        case "ArrowLeft":
            camera.position.set(x - step, y, z);
            break;
        case "w":
        case "ArrowUp":
            camera.position.set(x, y + step, z);
            break;
        case "s":
        case "ArrowDown":
            camera.position.set(x, y - step, z);
            break;
    }
});
