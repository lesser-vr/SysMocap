// Original Animaze idle1, sampled in the exported joints' local coordinates.
// Its ear and tail keys continue playing even without a tracking packet.
export function createIdlePlayer(vrm) {
    let clip;
    vrm.scene.traverse(node => { if (node.userData.fluffoAnimazeIdle) clip = node.userData.fluffoAnimazeIdle.idle1; });
    if (!clip) return () => {};
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
                const a = Math.min(i, values.length - 1), b = Math.min(a + 1, values.length - 1);
                target.fromArray(values[a]);
                if (a === b) continue;
                if (key === 'q') target.slerp(rotation.fromArray(values[b]), t);
                else target.lerp(vector.fromArray(values[b]), t);
            }
        }
    };
}
