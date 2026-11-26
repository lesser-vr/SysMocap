// Move the existing WebGL canvas with its mirror, background and effects.
// Its renderer and tracking pipeline continue to run in the original page.
export function mountAvatarOutput(stage, stageMoved, onChange, getResolution) {
    const button = document.createElement("button");
    button.type = "button";
    button.id = "avatar-output-toggle";
    button.textContent = "아바타 창 분리";
    document.getElementById("controller").append(button);

    const anchor = document.createComment("avatar stage");
    stage.before(anchor);
    let output;

    function restore() {
        if (!output) return;
        output = null;
        anchor.after(stage);
        onChange(false);
        stageMoved();
        button.textContent = "아바타 창 분리";
    }

    button.addEventListener("click", () => {
        if (output && !output.closed) {
            const closing = output;
            restore();
            closing.close();
            return;
        }
        show();
    });
    function show(){
        if(output && !output.closed){output.focus();return;}
        const resolution=getResolution?.();
        const targetHeight=resolution==='1440p'?1440:resolution==='1080p'?1080:0;
        const preferredHeight=targetHeight?targetHeight/window.devicePixelRatio:540;
        const height=Math.floor(Math.min(preferredHeight,window.screen.availHeight-60,
            (window.screen.availWidth-16)*9/16));
        const win = window.open("", "fluffo-avatar-output", `popup,width=${Math.round(height*16/9)},height=${height}`);
        if (!win) return;
        output = win;
        const doc = win.document;
        doc.title = "SysMocap 방송 출력";
        doc.documentElement.lang = "ko";
        const style = doc.createElement("style");
        style.textContent = `
            body { margin: 0; height: 100vh; display: grid; place-items: center; overflow: hidden; background: black; }
            #model { position: static !important; width: min(100vw, 177.77778vh) !important;
                border: none !important; border-radius: 0 !important; }
            #model canvas { display: block; }
        `;
        doc.head.append(style);
        doc.body.append(stage);
        onChange(true);
        button.textContent = "아바타 창 복귀";
        stageMoved();
        win.addEventListener("resize", () => { if (output === win) stageMoved(); });
        win.addEventListener("pagehide", () => { if (output === win) restore(); }, {once:true});
    }
    window.addEventListener("pagehide", () => output?.close(), {once:true});
    return {show};
}
