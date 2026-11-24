const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

module.exports=async function openReceiver(obsPort){
    let browser;
    try{
        let port=obsPort;
        if(!port){
        const profile=fs.mkdtempSync(path.join(os.tmpdir(),'fluffo-obs-edge-'));
        browser=spawn(path.join(process.env['ProgramFiles(x86)'],'Microsoft/Edge/Application/msedge.exe'),
        ['--headless','--no-first-run','--remote-debugging-port=0','--window-size=960,540',
         '--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:'ignore'});
    const portFile=path.join(profile,'DevToolsActivePort');
        for(let i=0;i<100 && !fs.existsSync(portFile);i++)await sleep(100);
        port=fs.readFileSync(portFile,'utf8').split(/\r?\n/)[0];
        }
        const tabs=await (await fetch('http://127.0.0.1:'+port+'/json/list')).json();
        const tab=tabs.find(t=>t.type==='page' && (!obsPort || t.url==='http://127.0.0.1:8080/'));
        if(!tab)throw Error('OBS browser source was not found');
        const ws=new WebSocket(tab.webSocketDebuggerUrl),pending=new Map();
        let sequence=0;
        const exceptions=new Set();
        await new Promise((ok,fail)=>{ws.onopen=ok;ws.onerror=fail;});
        ws.onmessage=({data})=>{
            const m=JSON.parse(data), p=pending.get(m.id);
            if(p){pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);}
            if(m.method==='Runtime.executionContextsCleared')exceptions.clear();
            if(m.method==='Runtime.exceptionThrown'){
                const details=m.params.exceptionDetails;
                const message=details.exception?.description?.split('\n')[0] || details.text+' '+(details.url||'');
                if(!exceptions.has(message))console.error('Browser error:',message);
                exceptions.add(message);
            }
            if(m.method==='Network.responseReceived' && m.params.response.status>=400)console.error(m.params.response.status,m.params.response.url);
        };
        const send=(method,params={})=>new Promise((resolve,reject)=>{
            const id=++sequence;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));
        });
        return {send,exceptions,close:()=>{ws.close();browser?.kill();}};
    }catch(error){browser?.kill();throw error;}
};
