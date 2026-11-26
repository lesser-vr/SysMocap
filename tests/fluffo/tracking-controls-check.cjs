const assert=require('node:assert/strict');
module.exports=async function({ev,edge,sleep}){
    await ev("document.querySelector('[aria-controls=broadcast-settings]').click()");
    const values={holdOpenEyes:true,standardEyeOpen:35,standardBrowRest:.48,mouth:.7,blink:.7,body:.65,hand:.2,returnMs:620,holdMs:210};
    await ev(`(()=>{
       const panel=document.querySelector('#broadcast-settings');
       for(const [key,val] of Object.entries(${JSON.stringify(values)})){
           const input=panel.querySelector('[name="'+key+'"]');
           input.closest('details').open=true;
           if(!input.getBoundingClientRect().width)throw Error('Missing control '+key);
           if(input.type==='checkbox') input.checked=val;else input.value=val;
           input.dispatchEvent(new Event('input',{bubbles:true}));
       }
    })()`);
    const state=`const m=w.currentVrm,e=m.expressionManager;return [e.getValue('blinkLeft'),e.getValue('blinkRight'),e.getValue('aa'),m.humanoid.getNormalizedBoneNode('leftUpperArm').quaternion.toArray()];`;
    for(const [label,read] of [['desktop',()=>ev(`(()=>{const w=document.querySelector('#foo').contentWindow;${state}})()`)],
        ['browser',async()=>(await edge.send('Runtime.evaluate',{expression:`(()=>{const w=window;${state}})()`,returnByValue:true})).result.value]]){
        const samples=[];
        for(let i=0;i<18;i++){await sleep(65);samples.push(await read());}
        assert.ok(samples.slice(-5).every(s=>s[0]>.63 && s[1]>.63),label+' eye rest '+JSON.stringify(samples.at(-1)));
        assert.ok(new Set(samples.map(s=>s[2])).size>1,label+' mouth');
        console.log(label,'model-calibrated eyes and live vowels passed');
    }
    const saved=await ev("JSON.parse(localStorage.getItem('broadcast.avatarCalibration.'+JSON.parse(sysmocapApp.selectModel).path))");
    assert.equal(saved.standardEyeOpen,35);assert.equal(saved.standardBrowRest,.48);
    const original=await ev("sysmocapApp.selectModel");
    await ev("document.querySelector('.primary').click()");
    await sleep(350);
    await ev("sysmocapApp.selectModel=JSON.stringify(sysmocapApp.builtIn.find(m=>m.name==='Hanako'))");
    await sleep(100);
    const calibration=()=>ev("JSON.parse(localStorage.getItem('fluffo.live-controls.v1'))");
    assert.equal((await calibration()).standardEyeOpen,100);
    await ev('sysmocapApp.selectModel='+JSON.stringify(original));
    await sleep(100);
    assert.equal((await calibration()).standardEyeOpen,35);
    assert.equal((await calibration()).standardBrowRest,.48);
    console.log('Per-avatar calibration restored after switching models');
};
