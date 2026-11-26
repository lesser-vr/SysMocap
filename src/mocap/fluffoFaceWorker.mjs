// The face solver runs independently from Holistic. Only the most recent frame
// is submitted and all assets are loaded from the local SysMocap installation.
export function createLocalReader(video, {modelName, program, frameOptions, interval, maxAge}) {
    const urls = [];
    let worker, busy = true, disposed = false, latest = null, lastSent = -Infinity;
    function stop() {
        disposed = true;
        worker?.terminate();
        for (const url of urls.splice(0)) URL.revokeObjectURL(url);
    }
    function assetUrl(bytes, type) {
        const url = URL.createObjectURL(new Blob([bytes], {type}));
        urls.push(url);
        return url;
    }
    try {
        const fs = window.require('fs'), {fileURLToPath} = window.require('url');
        const read = name => fs.readFileSync(fileURLToPath(new URL('./face-runtime/' + name, import.meta.url)));
        const script = assetUrl(read('vision_bundle.mjs'), 'text/javascript');
        const loader = assetUrl(read('vision_wasm_internal.js'), 'text/javascript');
        const binary = assetUrl(read('vision_wasm_internal.wasm'), 'application/wasm');
        const model = new Uint8Array(read(modelName));
        const workerMain = `
            let tracker;
            const task = (${program.toString()})();
            self.onmessage = async ({data}) => {
                try {
                    if (data.model) {
                        tracker = await task.create(await import(data.script),
                            {wasmBinaryPath:data.binary, wasmLoaderPath:data.loader},
                            data.model
                        );
                        self.postMessage({ready:true});
                    } else {
                        const value = task.detect(tracker,data);
                        self.postMessage({time:data.time, stamp:data.stamp, value});
                    }
                } catch(error) { self.postMessage({error:String(error?.stack || error)}); }
                finally {data.frame?.close();}
            };`;
        worker = new Worker(assetUrl(workerMain,'text/javascript'));
        const fail = msg => { console.error('Fluffo '+modelName+' tracking:',msg); stop(); };
        worker.onerror = e => fail(e.message);
        worker.onmessage = ({data}) => {
            if (data.error) { fail(data.error); return; }
            busy = false;
            if (!data.ready) latest = data;
        };
        worker.postMessage({model,script,loader,binary},[model.buffer]);
        window.addEventListener('pagehide',stop,{once:true});
    } catch(error) { console.error('Fluffo '+modelName+' initialization:',error); stop(); }
    return (context=null, minInterval=interval) => {
        const now = performance.now();
        const stamp = video.currentTime;
        if (!disposed && !busy && video.videoWidth && now-lastSent >= minInterval) {
            busy = true; lastSent = now;
            createImageBitmap(video,frameOptions(video)).then(frame => {
                if (disposed) frame.close(); else worker.postMessage({frame,time:now,stamp,context},[frame]);
            }).catch(()=>{busy=false;});
        }
        return !disposed && latest && now-latest.time < maxAge && stamp >= latest.stamp-.001 &&
            stamp-latest.stamp < maxAge/1000 ? latest : null;
    };
}

export function createFaceReader(video) {
    const read = createLocalReader(video,{
        modelName:'face_landmarker.task',interval:40,maxAge:320,
        frameOptions(video) {
            const scale=Math.min(1,640/video.videoWidth);
            return {resizeWidth:Math.round(video.videoWidth*scale),resizeHeight:Math.round(video.videoHeight*scale)};
        },
        program: function faceTask() {
            return {
                create:({FaceLandmarker},files,model)=>FaceLandmarker.createFromOptions(files,{
                    baseOptions:{modelAssetBuffer:model,delegate:'CPU'},runningMode:'VIDEO',
                    numFaces:1,outputFaceBlendshapes:true}),
                detect(tracker,data) {
                    const list=tracker.detectForVideo(data.frame,data.time).faceBlendshapes[0]?.categories;
                    return list ? Object.fromEntries(list.map(c=>[c.categoryName,c.score])) : null;
                }
            };
        }
    });
    return read;
}
