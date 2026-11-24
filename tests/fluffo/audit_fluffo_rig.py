"""Compare shipped rig and retained neutral geometry to the previous production VRM."""
from collections import Counter
from pathlib import Path
import hashlib
import json
import argparse
import struct
import numpy as np

parser = argparse.ArgumentParser()
parser.add_argument('--before', type=Path, required=True)
parser.add_argument('--avatar', type=Path, required=True)
parser.add_argument('--out', type=Path, default=Path('test-output'))
args = parser.parse_args()
HERE = args.out

class Model:
    def __init__(self, path):
        data = path.read_bytes()
        length = struct.unpack_from('<I', data, 12)[0]
        self.doc = json.loads(data[20:20 + length])
        self.bin = data[28 + length:]

    def view(self, index):
        v = self.doc['bufferViews'][index]
        start = v.get('byteOffset', 0)
        return self.bin[start:start + v['byteLength']]

    def array(self, index):
        acc = self.doc['accessors'][index]
        size = {'SCALAR':1, 'VEC2':2, 'VEC3':3, 'VEC4':4, 'MAT4':16}[acc['type']]
        dtype = np.dtype({5121:'u1', 5123:'<u2', 5125:'<u4', 5126:'<f4'}[acc['componentType']])
        view = self.doc['bufferViews'][acc['bufferView']]
        return np.ndarray((acc['count'], size), dtype, self.view(acc['bufferView']),
                          offset=acc.get('byteOffset', 0), strides=(view.get('byteStride',size*dtype.itemsize), dtype.itemsize))

    def meshes(self):
        return {n['name']: self.doc['meshes'][n['mesh']] for n in self.doc['nodes'] if 'mesh' in n}


def main():
    before = Model(args.before)
    current = Model(args.avatar)
    d = current.doc
    skin = d['skins'][0]['joints']
    nodes = d['nodes']
    parents = {c:i for i,n in enumerate(nodes) for c in n.get('children',[])}
    model = d['extensions']['VRMC_vrm']
    human = {v['node']:k for k,v in model['humanoid']['humanBones'].items()}
    weights = Counter()
    old_meshes, new_meshes = before.meshes(), current.meshes()
    assert old_meshes.keys() == new_meshes.keys()
    geometry_changes = []
    for name,mesh in new_meshes.items():
        old = old_meshes[name]
        assert len(old['primitives']) == len(mesh['primitives'])
        for a,b in zip(old['primitives'],mesh['primitives']):
            for attr in b['attributes']:
                if not np.array_equal(before.array(a['attributes'][attr]),current.array(b['attributes'][attr])):
                    geometry_changes.append([name,attr])
            if 'JOINTS_0' in b['attributes']:
                idx=current.array(b['attributes']['JOINTS_0'])
                strength=current.array(b['attributes']['WEIGHTS_0'])
                weights.update(int(i) for i in idx[strength>0])
    def textures(m):
        return {n['name']:hashlib.sha256(m.view(n['bufferView'])).hexdigest() for n in m.doc['images']}
    binds=model['expressions']
    idle=next(n['extras']['fluffoAnimazeIdle']['idle1'] for n in nodes if 'fluffoAnimazeIdle' in n.get('extras',{}))
    def route(i,weight):
        name=nodes[i]['name']
        if name in idle['tracks']:return 'Animaze idle1 local track'
        if name=='BipJaw' or 'TeethDown' in name or 'Tongue' in name:return 'Oral mesh expressions and lower dentition follow'
        if 'Wrist' in name:return 'Half of the hand twist around the forearm axis'
        if i in human:
            if human[i]=='hips':return 'Pose with MCU translation and rotation lock'
            if 'Toes' in human[i]:return 'Foot pitch driven toe bend'
            return 'Tracked humanoid '+human[i]
        if weight and ('Goggles' in name or 'Glass' in name or 'TeethUp' in name):return 'Head attachment'
        if weight and ('scale' in name or 'Nose' in name):return 'Base proportions, parent transform and face mesh expressions'
        if weight:return 'Parent transform and skinned mesh'
        return 'Reference, attachment or unweighted helper; follows parent'
    rows=[dict(name=nodes[i]['name'],parent=nodes[parents[i]]['name'],vertexInfluences=weights.get(j,0),
               route=route(i,weights.get(j,0))) for j,i in enumerate(skin)]
    cuffs={n['name']:nodes[parents[i]]['name'] for i,n in enumerate(nodes) if 'gold cuff' in n['name']}
    assert len(cuffs)==2 and all(p=='BipLEar_tip' for p in cuffs.values())
    live=json.loads((HERE/'fluffo-rig-coverage.json').read_text())['samples']
    physical=json.loads((HERE/'fluffo-rig-controls.json').read_text())
    spans={name:round(np.degrees(np.ptp([s['fingers'][name] for s in live])),2) for name in live[0]['fingers']}
    report=dict(skeleton=len(rows),weightedJoints=len(weights),humanoid=len(human),expressions={k:len(v) for k,v in binds.items()},
                meshCount=len(new_meshes),neutralAttributeChanges=geometry_changes,texturesUnchanged=textures(before)==textures(current),
                earCuffParents=cuffs,idleSource=dict(duration=idle['duration'],sha256=idle['sha256']),
                webcamFileTest=dict(samples=len(live),handsDetectedLeftRight=[sum(s['handInput'][i] for s in live) for i in range(2)],
                                    fingerExcursionDegrees=spans,facialInputsWithGeometry=sum(x['maxDisplacement']>1e-5 for x in physical['facial'])),
                bones=rows)
    (HERE/'Fluffo-rig-audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({k:v for k,v in report.items() if k!='bones'},ensure_ascii=False))

if __name__=='__main__':
    main()
