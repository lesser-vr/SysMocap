// Camera selection is forwarded from the settings window to the capture page.
export function selectedCameraQuery() {
    const select = document.getElementById("demo-js-3");
    const option = select?.selectedOptions[0];
    return { cameraId: option?.value || "", cameraLabel: option?.textContent.trim() || "" };
}

export async function openSelectedCamera() {
    const query = new URLSearchParams(location.search);
    const selectedId = query.get("cameraId");
    const label = query.get("cameraLabel");
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "videoinput");
    const byId = devices.find(d => d.deviceId === selectedId && selectedId && (!label || !d.label || d.label === label));
    const byName = devices.filter(d => label && d.label === label);
    const device = byId || (byName.length === 1 ? byName[0] : null);
    if (!device?.deviceId) throw new Error("카메라를 찾을 수 없습니다. 카메라 목록에서 장치를 다시 선택하세요. " + (label || ""));
    let stream;
    try {
        stream = await navigator.mediaDevices.getUserMedia({
            audio: false, video: { deviceId: { exact: device.deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
        });
        const track = stream.getVideoTracks()[0];
        if (track?.getSettings().deviceId !== device.deviceId || (label && track.label && track.label !== label)) {
            throw new Error("실제 열린 장치가 선택한 카메라와 다릅니다.");
        }
        const video = document.querySelector(".input_video");
        const status = document.createElement("span");
        status.textContent = "카메라 · " + (track.label || label || device.deviceId);
        Object.assign(status.style, { position: "fixed", zIndex: "1001", top: "14px", left: getComputedStyle(video).left,
            color: "white", background: "#202124db", padding: "3px 7px", pointerEvents: "none", font: '13px "Pretendard Variable", sans-serif' });
        video.parentElement.appendChild(status);
        return stream;
    } catch (error) {
        stream?.getTracks().forEach(track => track.stop());
        throw new Error((label || device.label || "카메라") + " 열기 실패 (" + error.message + ")");
    }
}
