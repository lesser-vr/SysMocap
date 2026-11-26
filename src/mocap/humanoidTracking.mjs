// Tracking for ordinary humanoid avatars. All timing is in source-video time.
const unit = x => Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));
const sides = ['Left', 'Right'];
const vowels = {aa:'A',ih:'I',ou:'U',ee:'E',oh:'O'};

export function armVisibility(results) {
    const inside = p => p && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1 && (p.visibility ?? 1) >= .55;
    const pose = results.poseLandmarks;
    function side(elbow, hand) {
        const palm = [0,5,9,13,17].some(i=>inside(hand?.[i]));
        const wrist = !!(palm || inside(pose?.[elbow+2]));
        return {upper:wrist || !!inside(pose?.[elbow]),lower:wrist};
    }
    // Kalidokit's pose solver maps landmarks 11/13/15 to the avatar's right arm.
    return {Right:side(13,results.leftHandLandmarks),Left:side(14,results.rightHandLandmarks)};
}

export function trackingDriver(vrm, getBone, tuning, parser) {
    const {values,factors} = tuning;
    const manager = vrm?.expressionManager;
    const has = key => {
        const exp=manager?.getExpression(key);
        // three-vrm 2.x stores the effective binds on the expression itself.
        return !!(exp?.binds ?? exp?._binds)?.length;
    };
    const blinkL=has('blinkLeft'), blinkR=has('blinkRight'), both=has('blink');
    const supportedVowels=Object.entries(vowels).filter(([key])=>has(key));
    const brows=[], wide=[];
    vrm?.scene.traverse(node=>{
        if(!node.morphTargetInfluences)return;
        // Some VRM 0.x files put names on individual primitives; GLTFLoader
        // only builds named dictionary entries from mesh-level extras.
        const link=parser?.associations.get(node);
        const prim=parser?.json.meshes[link?.meshes]?.primitives[link?.primitives];
        const names=prim?.extras?.targetNames;
        const entries=names?.length===node.morphTargetInfluences.length ?
            names.map((name,index)=>[name,index]) : Object.entries(node.morphTargetDictionary || {});
        for(const [name,index] of entries){
            const target={weights:node.morphTargetInfluences,index};
            if(/(?:^|_)BRW_Surprised$/i.test(name) || /^browInnerUp$/i.test(name))brows.push(target);
            if(/(?:^|_)EYE_Surprised$/i.test(name) || /^eyeWide(Left|Right)$/i.test(name)){
                wide.push({...target,side:name.endsWith('Left')?'Left':name.endsWith('Right')?'Right':null});
            }
        }
    });
    const bones=new Map(), arms=new Map();
    for(const side of sides){
        for(const [part,child,segment] of [['UpperArm','LowerArm','upper'],['LowerArm','Hand','lower'],['Hand',null,'lower']]){
            const name=side+part, joint=getBone(name);
            if(!joint)continue;
            const saved=joint.quaternion.clone();
            const tip=child && (getBone(side+child) || joint.children.find(n=>n.isBone));
            // Derive a lowered pose from the actual bone axes and parent transform.
            // Temporarily pose the upper arm before measuring the forearm in its parent space.
            if(tip){
                const local=joint.worldToLocal(tip.getWorldPosition(tip.position.clone())).normalize();
                const origin=joint.getWorldPosition(joint.position.clone());
                const shoulder=getBone(side+'UpperArm');
                const other=getBone((side==='Left'?'Right':'Left')+'UpperArm');
                const outward=shoulder && other ? shoulder.getWorldPosition(origin.clone()).sub(other.getWorldPosition(origin.clone())) : origin.clone().set(0,0,0);
                outward.y=0;
                outward.normalize().multiplyScalar(part==='UpperArm' ? .16 : .07);
                const down=outward.add(origin.clone().set(0,-1,0)).normalize();
                down.applyQuaternion(joint.parent.getWorldQuaternion(saved.clone()).invert());
                if(local.lengthSq()>.5){
                    const current=local.applyQuaternion(saved);
                    joint.quaternion.setFromUnitVectors(current,down).multiply(saved);
                }
            }
            bones.set(name,{joint,side,segment,rest:joint.quaternion.clone(),saved,from:null,lost:null});
        }
        for(const b of bones.values())if(b.side===side)b.joint.quaternion.copy(b.saved);
        arms.set(side,{upper:true,lower:true});
    }
    const caps={blink:blinkL || blinkR || both,mouth:!!supportedVowels.length,brow:!!brows.length,
        wide:!!wide.length,body:!!getBone('Hips'),arm:bones.size>0};
    const closed={Left:false,Right:false}, lids={Left:0,Right:0};
    let brow=0, previous=null, previousPacket, dt=1/30;
    function weight(name,base){
        const factor=/Arm|Hand|Thumb|Index|Middle|Ring|Little/.test(name)?factors.hand:factors.body;
        return 1-(1-base)**(30*dt/factor);
    }
    function blend(old,target,seconds){return old+(target-old)*(-Math.expm1(-dt/seconds));}
    function face(input){
        const rest=unit(1-values.standardEyeOpen/100);
        for(const side of sides){
            const openness=input?.eye?.[side==='Left'?'l':'r'];
            const raw=Number.isFinite(openness)?unit(1-openness):0;
            closed[side]=raw>=(closed[side] ? .46 : .77);
            const close=values.holdOpenEyes?Number(closed[side]):raw;
            const target=rest+(1-rest)*close;
            lids[side]=blend(lids[side],target,(target>lids[side] ? .012 : .035)*factors.blink);
        }
        if(both && !(blinkL && blinkR)){
            const shared=Math.min(lids.Left,lids.Right);
            manager.setValue('blink',shared);
            if(blinkL)manager.setValue('blinkLeft',lids.Left-shared);
            if(blinkR)manager.setValue('blinkRight',lids.Right-shared);
        }else{
            if(blinkL)manager.setValue('blinkLeft',lids.Left);
            if(blinkR)manager.setValue('blinkRight',lids.Right);
        }
        for(const [key,source] of supportedVowels){
            const old=manager.getValue(key) || 0,target=unit((input?.mouth?.shape?.[source] || 0)/.8);
            manager.setValue(key,blend(old,target,(target>old ? .014 : .037)*factors.mouth));
        }
        const up=unit(((input?.brow || 0)-values.standardBrowRest)/(1-values.standardBrowRest));
        brow=blend(brow,up,.04);
    }
    function begin(packet){
        const stamp=Number.isFinite(packet.sourceTime)?packet.sourceTime:null;
        if(stamp!==null ? stamp===previous : packet===previousPacket)return false;
        const now=stamp ?? performance.now()/1000;
        const gap=previous===null?0:now-previous;
        dt=gap>0 && gap<.5?gap:1/30;
        if(previous===null || gap<0 || gap>.5){
            for(const b of bones.values()){b.lost=null;b.from=null;}
            closed.Left=closed.Right=false;
        }
        previous=now;previousPacket=packet;
        for(const side of sides){
            const visible=packet.armVisibility?.[side] || {upper:true,lower:true};
            arms.set(side,visible);
        }
        for(const b of bones.values()){
            if(arms.get(b.side)[b.segment]){b.lost=null;continue;}
            if(b.lost===null){b.lost=now;b.from=b.joint.quaternion.clone();}
            const t=unit(((now-b.lost)*1000-values.holdMs)/values.returnMs);
            b.joint.quaternion.slerpQuaternions(b.from,b.rest,t*t*(3-2*t));
        }
        if(manager)face(packet.riggedFace);
        return true;
    }
    function finishFace(){
        for(const b of brows)b.weights[b.index]=brow;
        for(const m of wide)m.weights[m.index]=unit(values.standardEyeOpen/100-1)*(1-(m.side?lids[m.side]:Math.max(lids.Left,lids.Right)));
    }
    return {caps,begin,weight,finishFace,canRotate(name){const b=bones.get(name);return !b || b.lost===null;}};
}
