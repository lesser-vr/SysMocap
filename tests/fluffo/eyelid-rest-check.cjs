const assert=require('node:assert/strict');

module.exports=async function verify({ev,edge,sleep}){
    const local=code=>ev("((w)=>{"+code+"})(document.querySelector('#foo').contentWindow)");
    const remote=async code=>{
        const reply=await edge.send('Runtime.evaluate',{expression:"((w)=>{"+code+"})(window)",returnByValue:true,awaitPromise:true});
        if(reply.exceptionDetails)throw Error(reply.exceptionDetails.text);
        return reply.result.value;
    };
    // Feed known tracking endpoints into the actual per-frame VRM update in each
    // isolated test window, and read the rendered face, lashes and shadows.
    const prepare=`
        const m=w.currentVrm,manager=m.expressionManager,update=manager.update.bind(manager);
        w.testLidPose=[0,0,0,0];
        manager.update=()=>{
            manager.setValue('blink',0);
            ['blinkLeft','blinkRight','eyeWideLeft','eyeWideRight'].forEach((k,i)=>manager.setValue(k,w.testLidPose[i]));
            update();
        };
    `;
    await local(prepare);await remote(prepare);
    for(const percent of [75,45,100,0,75]){
        await local(`const x=w.document.querySelector('[name=eyeRestOpen]');x.value=${percent};x.dispatchEvent(new w.Event('input'));`);
        for(const pose of [[0,0,0,0],[1,0,0,0],[0,1,0,0],[1,1,0,0],[0,0,1,1]]){
            const set="w.testLidPose="+JSON.stringify(pose);
            await local(set);await remote(set);
            const check=`
                let sides=0,maxError=0;
                w.currentVrm.scene.traverse(o=>{
                    for(const [i,s] of ['Left','Right'].entries()){
                        const d=o.morphTargetDictionary,idx=d?.['eyeBlink'+s];if(idx===undefined)continue;
                        const blink=w.testLidPose[i],wide=w.testLidPose[2+i];
                        const expected=blink+(75-${percent})/75*(1-blink-wide);
                        maxError=Math.max(maxError,Math.abs(o.morphTargetInfluences[idx]-expected),
                            Math.abs(o.morphTargetInfluences[d['eyeWide'+s]]-wide));
                        sides++;
                    }
                });
                return sides===8 && maxError<1e-5;
            `;
            let ok=false;
            for(let i=0;i<30&&!ok;i++){await sleep(60);ok=(await local(check))&&(await remote(check));}
            assert.ok(ok,'Rendered eyelid mismatch at '+percent+'%, pose '+pose);
        }
    }
    console.log('Resting eyelid control, left/right winks, bilateral blink and wide endpoints passed on desktop and browser.');
};
