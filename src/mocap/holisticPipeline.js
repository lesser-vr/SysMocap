import {readWardrobe,wardrobeStorageKey} from "avatar-wardrobe";
import {armVisibility} from "humanoid-tracking";
import { desktopSmoothness, receiverSettings } from "broadcast-controls";
import { createRigCapture, avatarRigProfile, readAvatarHeader } from "fluffo-rig-capture";
import { chestUpHands } from "fluffo-mcu";
import { openSelectedCamera } from "./selectedCamera.mjs";
/**
 *  MediaPipe Holistic detection pipeline (shared).
 *
 *  Owns camera/video input + the Holistic model + the input-skeleton overlay,
 *  and per frame solves the landmarks into Kalidokit rigged data, handing it to
 *  onRigged({riggedPose, riggedLeftHand, riggedRightHand, riggedFace}). The
 *  consumer (integrated mocaprender wrapper) then forwards and/or applies it via
 *  the shared avatarRenderer — so the detection half lives here, the render half
 *  in avatarRenderer.js, and neither is duplicated.
 *
 *  Holistic / Kalidokit / drawConnectors / drawLandmarks / POSE_CONNECTIONS /
 *  FACEMESH_TESSELATION / HAND_CONNECTIONS are window globals provided by the
 *  page's classic <script> tags (loaded before this module runs).
 *
 *  A part of SysMocap, open sourced under Mozilla Public License 2.0
 *  https://github.com/xianfei/SysMocap
 */

/**
 * @param {object} opts
 * @param {object} opts.settings  globalSettings (mediapipe.* + preview.showSketelonOnInput)
 * @param {string} opts.fileType  model file type ("vrm" gates right-hand solving, as before)
 * @param {(rigged: object) => void} opts.onRigged  called per detected frame
 */
export function createHolisticPipeline({ settings, fileType, onRigged }) {
    const videoElement = document.querySelector(".input_video");
    const guideCanvas = document.querySelector("canvas.guides");
    let started = false;
    const modelPath=JSON.parse(localStorage.getItem('modelInfo'))?.path;
    const profile=avatarRigProfile(readAvatarHeader(modelPath));
    const readRig=createRigCapture(videoElement,fileType==='vrm' && profile.extended);
    const outfitKey=wardrobeStorageKey(modelPath);
    let framing=localStorage.getItem('broadcast.framing') || 'face';
    let outfitHidden=readWardrobe(outfitKey,profile).hidden;
    const readLevel=()=>{
        const saved=localStorage.getItem('broadcast.bodyTrackingLevel') ?? String(settings.mediapipe.modelComplexity);
        return ['0','1','2'].includes(saved) ? Number(saved) : 1;
    };
    let requestedLevel=readLevel();
    window.addEventListener('storage',event=>{
        if(event.key==='broadcast.bodyTrackingLevel' || event.key===null)requestedLevel=readLevel();
        if(event.key==='broadcast.framing')framing=event.newValue || 'face';
        if(event.key===outfitKey || event.key===null)outfitHidden=readWardrobe(outfitKey,profile).hidden;
    });
    window.addEventListener('avatar-wardrobe-change',()=>{outfitHidden=readWardrobe(outfitKey,profile).hidden;});
    const tuning = desktopSmoothness();
    let sceneControls = receiverSettings(tuning.values);
    tuning.onChange(()=>{sceneControls=receiverSettings(tuning.values);});

    // Landmarks -> Kalidokit rigged data (note: MediaPipe's 3D-landmark field is
    // the mangled `results.za`, and the hand landmarks arrive reversed).
    const solve = (results) => {
        // Keep the guide overlay on raw input while solving the avatar from fused hands.
        results = {...results};
        const fluffoRig = readRig(results);
        const faceLandmarks = results.faceLandmarks;
        const pose3DLandmarks = results.za;
        const pose2DLandmarks = results.poseLandmarks;
        const leftHandLandmarks = results.rightHandLandmarks;
        const rightHandLandmarks = results.leftHandLandmarks;
        // Face.solve converts the face landmarks to pixels in place.
        const handTargets=pose2DLandmarks && pose3DLandmarks
            ? chestUpHands(results,videoElement,fluffoRig?.handStamp) : null;

        let riggedPose, riggedLeftHand, riggedRightHand, riggedFace;
        if (faceLandmarks) {
            riggedFace = Kalidokit.Face.solve(faceLandmarks, {
                runtime: "mediapipe",
                video: videoElement,
            });
        }
        if (pose2DLandmarks && pose3DLandmarks) {
            riggedPose = Kalidokit.Pose.solve(pose3DLandmarks, pose2DLandmarks, {
                runtime: "mediapipe",
                video: videoElement,
            });
        }
        if (riggedPose) riggedPose.chestUpHands = handTargets;
        if (leftHandLandmarks) {
            riggedLeftHand = Kalidokit.Hand.solve(leftHandLandmarks, "Left");
        }
        if (rightHandLandmarks && fileType == "vrm") {
            riggedRightHand = Kalidokit.Hand.solve(rightHandLandmarks, "Right");
        }
        return { framing,outfitHidden,sourceTime:videoElement.currentTime,armVisibility:armVisibility(results),riggedPose, riggedLeftHand, riggedRightHand, riggedFace, fluffoRig, sceneControls:fluffoRig ? undefined : sceneControls };
    };

    let guideContext = null, guidesDrawn = false;
    const drawResults = (results) => {
        if (guideCanvas.width !== videoElement.videoWidth) guideCanvas.width = videoElement.videoWidth;
        if (guideCanvas.height !== videoElement.videoHeight) guideCanvas.height = videoElement.videoHeight;
        const canvasCtx = guideContext ??= guideCanvas.getContext("2d");
        canvasCtx.save();
        canvasCtx.clearRect(0, 0, guideCanvas.width, guideCanvas.height);
        drawConnectors(canvasCtx, results.poseLandmarks, POSE_CONNECTIONS, {
            color: "#00cff7",
            lineWidth: 4,
        });
        drawLandmarks(canvasCtx, results.poseLandmarks, {
            color: "#ff0364",
            lineWidth: 2,
        });
        drawConnectors(canvasCtx, results.faceLandmarks, FACEMESH_TESSELATION, {
            color: "#C0C0C070",
            lineWidth: 1,
        });
        if (results.faceLandmarks && results.faceLandmarks.length === 478) {
            // draw pupils
            drawLandmarks(
                canvasCtx,
                [results.faceLandmarks[468], results.faceLandmarks[468 + 5]],
                { color: "#ffe603", lineWidth: 2 }
            );
        }
        drawConnectors(canvasCtx, results.leftHandLandmarks, HAND_CONNECTIONS, {
            color: "#eb1064",
            lineWidth: 5,
        });
        drawLandmarks(canvasCtx, results.leftHandLandmarks, {
            color: "#00cff7",
            lineWidth: 2,
        });
        drawConnectors(canvasCtx, results.rightHandLandmarks, HAND_CONNECTIONS, {
            color: "#22c3e3",
            lineWidth: 5,
        });
        drawLandmarks(canvasCtx, results.rightHandLandmarks, {
            color: "#ff0364",
            lineWidth: 2,
        });
    };

    const onResults = (results) => {
        if(stopped)return;
        const showGuides = tuning.values.cameraPreview && settings.preview.showSketelonOnInput;
        if (showGuides) drawResults(results);
        else if (guidesDrawn) guideContext.clearRect(0, 0, guideCanvas.width, guideCanvas.height);
        guidesDrawn = showGuides;
        onRigged(solve(results));
        if (!started) {
            document.getElementById("loading")?.remove();
            if (localStorage.getItem("useCamera") == "file") videoElement.play();
            started = true;
        }
    };

    const holistic = new Holistic({
        // MediaPipe (with nodeIntegration on) loads these sibling assets via
        // Node fs, so locateFile must return an ABSOLUTE filesystem path, not a
        // URL/relative path (fs.open would resolve it against cwd -> ENOENT).
        // Derive the absolute path from the page URL so it works from the
        // bundled chunk without relying on __dirname/cwd. Pages live at
        // dist/src/pages/<page>/render.html, so node_modules (copied to the dist
        // root) is three levels up: dist/src/pages/<page>/ -> dist/node_modules.
        locateFile: (file) => {
            const rel = `../../../node_modules/@mediapipe/holistic/${file}`;
            try {
                return require("url").fileURLToPath(
                    new URL(rel, window.location.href)
                );
            } catch (e) {
                return rel;
            }
        },
    });
    let activeLevel=requestedLevel;
    holistic.setOptions({
        modelComplexity: activeLevel,
        smoothLandmarks: settings.mediapipe.smoothLandmarks,
        minDetectionConfidence: parseFloat(settings.mediapipe.minDetectionConfidence),
        minTrackingConfidence: parseFloat(settings.mediapipe.minTrackingConfidence),
        refineFaceLandmarks: settings.mediapipe.refineFaceLandmarks,
    });
    holistic.onResults(onResults);

    // input: live camera or a video file, driven by requestVideoFrameCallback
    const useCamera = localStorage.getItem("useCamera") == "camera";

    // input-preview horizontal mirror, configurable per source. The .input_video +
    // .guides ship an inline scale(-1,1), so set the transform EXPLICITLY here (not "")
    // to let the toggle win. Display-only: MediaPipe reads the raw videoElement, so
    // this never affects detection.
    const mirrorPreview = useCamera
        ? settings.preview.mirroringWhenCamera
        : settings.preview.mirroringWhenVideoFile;
    videoElement.style.transform = guideCanvas.style.transform = mirrorPreview
        ? "scale(-1, 1)"
        : "scale(1, 1)";

    // On Windows a minimized input window can throttle video frame callbacks
    // even as the source is playing and a separate avatar output is visible.
    const timers = require("timers");
    let inFlight, pendingFrame, watchdog, stopped = false, lastTime = -1;
    function scheduleCapture(fallback = false) {
        if (stopped) return;
        pendingFrame = videoElement.requestVideoFrameCallback(() => capture(false));
        watchdog = timers.setTimeout(() => capture(true), fallback ? 33 : 140);
    }
    async function capture(fallback) {
        if (stopped) return;
        timers.clearTimeout(watchdog);
        videoElement.cancelVideoFrameCallback(pendingFrame);
        if (videoElement.readyState >= 2 && videoElement.currentTime !== lastTime) {
            lastTime = videoElement.currentTime;
            try{
                // Apply graph changes between sends, when the previous inference has finished.
                if(activeLevel!==requestedLevel){
                    holistic.setOptions({modelComplexity:requestedLevel});
                    activeLevel=requestedLevel;
                }
                inFlight=holistic.send({image:videoElement});
                await inFlight;
            }catch{inputFailed('추적을 시작할 수 없습니다. 입력을 확인하고 다시 시도해 주세요.');return;}
        }
        scheduleCapture(fallback);
    }
    function stopCapture(){
        stopped = true;
        videoElement.srcObject?.getTracks().forEach(track=>track.stop());
        timers.clearTimeout(watchdog);
        videoElement.cancelVideoFrameCallback(pendingFrame);
        return inFlight?.catch(()=>{});
    }
    window.stopBroadcastCapture=stopCapture;
    window.addEventListener("pagehide",stopCapture,{once:true});
    function inputFailed(message){
        if(stopped)return;
        if(window.parent.broadcastController) window.parent.broadcastController.fail(message);
        else require('electron').ipcRenderer.send('broadcast-input-error',message);
    }
    videoElement.addEventListener('error',()=>inputFailed('영상을 열 수 없습니다. 파일 위치와 형식을 확인해 주세요.'),{once:true});
    if (useCamera) {
        openSelectedCamera()
            .then(function (stream) {
                if(stopped){stream.getTracks().forEach(track=>track.stop());return;}
                const track=stream.getVideoTracks()[0];
                track?.addEventListener('ended',()=>inputFailed('카메라 연결이 끊겼습니다. 장치를 확인하고 다시 연결해 주세요.'),{once:true});
                videoElement.srcObject = stream;
                videoElement.play();
                scheduleCapture();
            })
            .catch(function (err0r) {
                inputFailed(err0r.message);
            });
    } else {
        const source=localStorage.getItem("videoFile") || "";
        videoElement.src = require("path").isAbsolute(source) ? require("url").pathToFileURL(source).href : source;
        videoElement.loop = true;
        videoElement.controls = true;
        scheduleCapture();
    }

    return { videoElement, guideCanvas };
}
