const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

// Runs inside the installed capture page via the file-test harness.
async function traceHands() {
    const w = document.querySelector('#foo').contentWindow;
    const d = w.document;
    const video = d.querySelector('video');
    const stage = d.querySelector('#app')._vnode.component.proxy.$refs.stage;
    const toggle = document.querySelector('.preview-switch input');
    if (toggle.checked) toggle.click();
    const windows = [[10.85, 12.05], [13.65, 14.85]];
    if (!(video.duration > 15.2)) throw Error('This check needs the 26-second MCU speech fixture');
    const wanted = t => windows.some(([a, b]) => t >= a && t <= b);
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
    const sources = new Set(), bitmapTimes = new WeakMap(), requests = new Map();
    const packets = [], jobs = [], replay = [];
    const watched = new WeakSet();
    const originalSend = w.Holistic.prototype.send;
    const originalBitmap = w.createImageBitmap;
    const originalPost = w.Worker.prototype.postMessage;
    const originalPush = stage.pushData;
    let inputPts, handWorker, resultsListener, listeners, rawHands;
    // Use decoded video PTS to compare the same picture across runs. The app's
    // video.currentTime is also logged, but advances while a solve is in flight.
    w.Holistic.prototype.send = function(input, ...args) {
        // The pinned Holistic build registered its result listener before this
        // probe attached. Observe its callback before solve() fuses crop data.
        if (!listeners) {
            listeners = this.h?.listeners;
            resultsListener = listeners?.['$'];
            if (typeof resultsListener !== 'function') throw Error('Unknown Holistic result listener');
            listeners['$'] = function(result) {
                rawHands = {left:result.leftHandLandmarks?.length || 0, right:result.rightHandLandmarks?.length || 0};
                return resultsListener.call(this,result);
            };
        }
        inputPts = undefined;
        if (wanted(video.currentTime)) {
            const frame = new w.VideoFrame(input.image);
            inputPts = frame.timestamp / 1e6;
            sources.add(inputPts);
            frame.close();
        }
        return originalSend.call(this, input, ...args);
    };
    w.createImageBitmap = function(source, ...args) {
        if (source !== video || !wanted(video.currentTime)) return originalBitmap.call(this, source, ...args);
        const frame = new w.VideoFrame(source), pts = frame.timestamp / 1e6;
        frame.close();
        const task = originalBitmap.call(this, source, ...args);
        task.then(bitmap => bitmapTimes.set(bitmap, pts), () => {});
        return task;
    };
    stage.pushData = function(packet) {
        const rig = packet.fluffoRig;
        if (rig && wanted(packet.sourceTime)) {
            packets.push({time:packet.sourceTime, inputPts, rawHands, sources:{...rig.handSource}, stamps:{...rig.handStamp}});
        }
        return originalPush.call(this, packet);
    };
    w.Worker.prototype.postMessage = function(message, ...args) {
        if (message.frame && Array.isArray(message.context)) {
            handWorker = this;
            if (!watched.has(this)) {
                watched.add(this);
                this.addEventListener('message', ({data}) => {
                    const job = requests.get(data.stamp);
                    if (!job) return;
                    requests.delete(data.stamp);
                    job.sides = Object.keys(data.value || {});
                    job.responseAt = video.currentTime;
                });
            }
            if (wanted(message.stamp)) {
                const job = {stamp:message.stamp, pts:bitmapTimes.get(message.frame), boxes:message.context};
                requests.set(message.stamp, job);
                jobs.push(job);
            }
        }
        return originalPost.call(this, message, ...args);
    };
    const replayVideo = d.createElement('video');
    try {
        const deadline = Date.now() + 35000;
        while (video.currentTime < 15.2) {
            if (Date.now() > deadline || !video.isConnected) {
                throw Error('Stopped before target windows: '+JSON.stringify({time:video.currentTime,
                    state:video.readyState,paused:video.paused,frames:sources.size,packets:packets.length,
                    error:window.sysmocapApp.captureError}));
            }
            await delay(25);
        }
        video.pause();
        await delay(200);
        if (!handWorker || !jobs.length || !sources.size) throw Error('Missing hand requests or decoded frames');
        // Replay every available picture through the same worker after the live
        // measurement. Unscheduled frames use the nearest real pair of crops.
        // Record that distance so estimates are distinguishable from exact crops.
        const loaded = new Promise((resolve,reject) => {
            replayVideo.onloadeddata = resolve;
            replayVideo.onerror = () => reject(Error('Could not decode the replay video'));
        });
        replayVideo.src = video.currentSrc;
        await loaded;
        for (const pts of sources) {
            const near = jobs.filter(j => Number.isFinite(j.pts)).reduce((a,b) =>
                !a || Math.abs(b.pts-pts) < Math.abs(a.pts-pts) ? b : a, null);
            if (!near || Math.abs(near.pts-pts) > .12) continue;
            const seeked = new Promise(resolve => {replayVideo.onseeked = resolve;});
            replayVideo.currentTime = pts + .001;
            await seeked;
            const frame = new w.VideoFrame(replayVideo);
            const replayPts = frame.timestamp / 1e6;
            frame.close();
            if (Math.abs(replayPts-pts) > .001) throw Error('Replay frame mismatch: '+pts+' / '+replayPts);
            const bitmap = await originalBitmap.call(w, replayVideo);
            const stamp = -1000 - replay.length;
            const sides = await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {handWorker.removeEventListener('message', receive);reject(Error('Replay timed out'));}, 3000);
                function receive({data}) {
                    if (data.stamp !== stamp) return;
                    clearTimeout(timeout);
                    handWorker.removeEventListener('message', receive);
                    resolve(Object.keys(data.value || {}));
                }
                handWorker.addEventListener('message', receive);
                originalPost.call(handWorker, {frame:bitmap, stamp, time:w.performance.now(), context:near.boxes}, [bitmap]);
            });
            replay.push({pts, cropPts:near.pts, sides});
        }
        return {windows, packets, jobs, replay};
    } finally {
        replayVideo.onerror = replayVideo.onloadeddata = replayVideo.onseeked = null;
        replayVideo.removeAttribute('src');
        replayVideo.load();
        w.Holistic.prototype.send = originalSend;
        if (listeners && resultsListener) listeners['$'] = resultsListener;
        w.createImageBitmap = originalBitmap;
        w.Worker.prototype.postMessage = originalPost;
        stage.pushData = originalPush;
    }
}

module.exports = async ({ev, output}) => {
    const data = await ev('(' + traceHands.toString() + ')()');
    fs.writeFileSync(path.join(output,'hand-trace.json'), JSON.stringify(data, null, 2));
    for (const [start,end] of data.windows) {
        const inside = t => t >= start && t <= end;
        assert.ok(data.packets.filter(p => inside(p.inputPts)).length >= 25, 'Too few decoded frames');
        assert.ok(data.packets.filter(p => inside(p.inputPts)).every(p => p.rawHands), 'Missing pre-fusion results');
        assert.ok(data.jobs.filter(j => inside(j.pts) && Array.isArray(j.sides)).length >= 5, 'Missing worker responses');
        assert.ok(data.replay.filter(r => inside(r.pts)).length >= 25, 'Incomplete frame replay');
    }
    console.log('Captured live packets, hand worker responses and frame replay in', output);
};
