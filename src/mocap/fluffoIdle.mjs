import {legacyBindings} from './legacyRigBindings.mjs';

// Local joint tracks continue playing between tracking observations.
export function createIdlePlayer(vrm) {
    let clip;
    vrm.scene.traverse(node=>{
        const {sysmocapIdle,sysmocapClips}=node.userData;
        const idle=typeof sysmocapIdle==='string'?sysmocapClips?.[sysmocapIdle]:sysmocapIdle;
        clip ??= idle ?? node.userData[legacyBindings.idleTag]?.[legacyBindings.idleClip];
    });
    if (!(clip?.duration>0 && clip.fps>0 && clip.tracks)) return () => {};
    const tracks = Object.entries(clip.tracks).flatMap(([name, track]) => {
        const joint = vrm.scene.getObjectByName(name);
        if (!joint) return [];
        return [[joint, track, joint.position.clone(), joint.quaternion.clone()]];
    });
    let elapsed = 0;
    return delta => {
        elapsed = (elapsed + delta) % clip.duration;
        const frame = elapsed * clip.fps, i = Math.floor(frame), t = frame - i;
        for (const [joint, track, vector, rotation] of tracks) {
            for (const [key, field] of [['p','position'], ['s','scale'], ['q','quaternion']]) {
                const values = track[key], target = joint[field];
                if(!values?.length)continue;
                const a = Math.min(i, values.length - 1), b = Math.min(a + 1, values.length - 1);
                target.fromArray(values[a]);
                if (a === b) continue;
                if (key === 'q') target.slerp(rotation.fromArray(values[b]), t);
                else target.lerp(vector.fromArray(values[b]), t);
            }
        }
    };
}
