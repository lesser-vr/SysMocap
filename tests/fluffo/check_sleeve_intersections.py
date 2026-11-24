"""Count actual sleeve triangles crossing weighted arm skin in the rendered test poses."""
import gzip
import json
import argparse
from pathlib import Path
from mathutils.bvhtree import BVHTree

parser = argparse.ArgumentParser()
parser.add_argument('--out', type=Path, default=Path('test-output'))
# Blender passes script arguments after --.
import sys
args = sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
here = parser.parse_args(args).out
summary = {}
for version in ('before','live'):
    source = here / f'sleeve-{version}-geometry.json.gz'
    if not source.exists():
        continue
    rows = []
    for item in json.loads(gzip.decompress(source.read_bytes())):
        def surface(part):
            return BVHTree.FromPolygons(part['p'], part['f'], all_triangles=True)
        crossing = surface(item['sleeve']).overlap(surface(item['arm']))
        rows.append({'side':item['side'], 'pose':item['index'],'time':item.get('time'),
                     'sleeveTriangles':len({a for a,b in crossing}),
                     'skinTriangles':len({b for a,b in crossing})})
    summary[version] = rows
print(json.dumps(summary))
(here/'sleeve-intersections.json').write_text(json.dumps(summary,indent=2))
