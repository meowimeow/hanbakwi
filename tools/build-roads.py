# OSM(Overpass) JSON -> public/roads.json. 사용: build-roads.py 도로 건물 물 출력
import json, math, sys
from collections import defaultdict
ROADS, BLD, WAT, OUT = sys.argv[1:5]
S, W, N, E = 36.935, 127.805, 36.995, 127.890
CAMPUS = (36.9707, 127.8720)
OK = {'footway','residential','living_street','tertiary','unclassified','service','track','pedestrian','cycleway','road','secondary','tertiary_link','secondary_link'}
K = 111195
kx = K * math.cos(math.radians(36.965))
xy = lambda la, lo: ((lo - W) * kx, (la - S) * K)
def allowed(t):
    h = t.get('highway'); foot = t.get('foot')
    if h not in OK or foot in ('no', 'private') or t.get('area') == 'yes' or t.get('indoor') == 'yes': return False
    if t.get('access') in ('private', 'no') and foot not in ('yes', 'designated'): return False
    if t.get('tunnel') not in (None, 'no'): return False
    if t.get('service') in ('parking_aisle', 'drive-through'): return False
    if t.get('sac_scale') or t.get('trail_visibility') or (t['highway'] in ('footway', 'track') and t.get('surface') in ('ground', 'dirt', 'mud', 'grass', 'earth')): return False
    if t.get('motorroad') == 'yes' or t.get('construction') or t.get('footway') == 'indoor': return False
    return True
def cross(a, b, c, d):
    o = lambda p, q, r: (q[0]-p[0])*(r[1]-p[1]) - (q[1]-p[1])*(r[0]-p[0])
    return o(a,b,c)*o(a,b,d) < 0 and o(c,d,a)*o(c,d,b) < 0
def rings(f):
    areas, lines = [], []
    for e in json.load(open(f))['elements']:
        gs = [e['geometry']] if e['type'] == 'way' else [m['geometry'] for m in e.get('members', []) if m.get('geometry')]
        for g in gs:
            p = [xy(q['lat'], q['lon']) for q in g if q]
            if e.get('tags', {}).get('tunnel') in ('culvert', 'yes'): continue
            (areas if e['type'] == 'way' and len(p) > 3 and p[0] == p[-1] else lines).append(p)
    return areas, lines
CELL = 100
def index(polys):
    g = defaultdict(list)
    for p in polys:
        for a, b in zip(p, p[1:]):
            for i in range(int(min(a[0],b[0])//CELL), int(max(a[0],b[0])//CELL)+1):
                for j in range(int(min(a[1],b[1])//CELL), int(max(a[1],b[1])//CELL)+1): g[i,j].append((a,b))
    return g
def hits(g, a, b):
    for i in range(int(min(a[0],b[0])//CELL), int(max(a[0],b[0])//CELL)+1):
        for j in range(int(min(a[1],b[1])//CELL), int(max(a[1],b[1])//CELL)+1):
            if any(cross(a,b,c,d) for c,d in g[i,j]): return True
    return False
def inside(p, poly):
    r = False
    for a, b in zip(poly, poly[1:]):
        if (a[1] > p[1]) != (b[1] > p[1]) and p[0] < (b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0]: r = not r
    return r
ba, bl = rings(BLD); wa, wl = rings(WAT)
bi, wi = index(ba + bl), index(wa + wl)
# 달천 동쪽은 충주 시내라 다리를 끊어 구역에서 뺀다
cut = index([[xy(q['lat'], q['lon']) for q in e['geometry']] for e in json.load(open(WAT))['elements'] if e['type'] == 'way' and e['tags'].get('name') in ('달천', '남한강')])
pos, adj = {}, defaultdict(dict); drop = {'building': 0, 'water': 0}
for e in json.load(open(ROADS))['elements']:
    t = e.get('tags', {})
    if not allowed(t): continue
    bridge = t.get('bridge') not in (None, 'no') 
    pts = list(zip(e['nodes'], e['geometry']))
    for (i, p), (j, q) in zip(pts, pts[1:]):
        if i == j or not all(S <= r['lat'] <= N and W <= r['lon'] <= E for r in (p, q)): continue
        a, b = xy(p['lat'], p['lon']), xy(q['lat'], q['lon'])
        mid = ((a[0]+b[0])/2, (a[1]+b[1])/2)
        if hits(cut, a, b): continue
        if hits(bi, a, b) or any(inside(mid, r) for r in ba): drop['building'] += 1; continue
        if not bridge and (hits(wi, a, b) or any(inside(mid, r) for r in wa)): drop['water'] += 1; continue
        pos[i], pos[j] = (p['lat'], p['lon']), (q['lat'], q['lon'])
        w = 2 if t['highway'].startswith('secondary') else 1 if t['highway'].startswith('tertiary') or t['highway'] == 'track' else 0
        adj[i][j] = adj[j][i] = min(w, adj[i].get(j, 9))
near = min(pos, key=lambda n: (pos[n][0]-CAMPUS[0])**2 + ((pos[n][1]-CAMPUS[1])*.8)**2)
comps, left = [], set(pos)
while left:
    st = [left.pop()]; c = set(st)
    while st:
        for m in adj[st.pop()]:
            if m in left: left.discard(m); c.add(m); st.append(m)
    comps.append(c)
comps.sort(key=len, reverse=True)
main = next(c for c in comps if near in c)
keep = sorted(main); ix = {n: i for i, n in enumerate(keep)}
out = {'box': [S, W, N, E], 'campus': CAMPUS, 'nodes': [[round(pos[n][0],6), round(pos[n][1],6)] for n in keep],
       'edges': [[ix[a], ix[b], w] for a in keep for b, w in adj[a].items() if ix[a] < ix[b]]}
json.dump(out, open(OUT, 'w'), separators=(',', ':'))
print('dropped', drop, 'components', [len(c) for c in comps[:6]], 'campus node in main:', len(main), 'edges', len(out['edges']), 'buildings', len(ba), 'water', len(wa), len(wl))
