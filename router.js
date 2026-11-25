// 그림을 실제 도로망에 맞춘다. 결과 경로는 항상 도로의 이어진 구간으로만 이루어진다.
import { meters, toXY, resample } from './core.js';

export class Network {
  constructor(d) {
    this.box = d.box; this.campus = { lat: d.campus[0], lng: d.campus[1] };
    this.ll = d.nodes.map(([lat, lng]) => ({ lat, lng }));
    this.xy = this.ll.map(p => toXY(p, this.campus));
    this.adj = this.ll.map(() => []);
    for (const [a, b, w] of d.edges) {
      const len = Math.hypot(this.xy[a].x - this.xy[b].x, this.xy[a].y - this.xy[b].y);
      this.adj[a].push({ to: b, len, w }); this.adj[b].push({ to: a, len, w });
    }
    this.cell = 150; this.grid = new Map();
    this.xy.forEach((p, i) => { const k = this.key(p.x, p.y); (this.grid.get(k) ?? this.grid.set(k, []).get(k)).push(i); });
    this.g = new Float64Array(this.ll.length); this.prev = new Int32Array(this.ll.length); this.mark = new Int32Array(this.ll.length); this.shut = new Int32Array(this.ll.length); this.gen = 0;
  }
  key(x, y) { return Math.floor(x / this.cell) * 10000 + Math.floor(y / this.cell); }
  contains(p) { const [s, w, n, e] = this.box; return p.lat >= s && p.lat <= n && p.lng >= w && p.lng <= e; }
  nearest(p, max = 600) {
    const cx = Math.floor(p.x / this.cell), cy = Math.floor(p.y / this.cell); let best = -1, bd = max;
    for (let r = 0; r * this.cell <= bd + this.cell; r++)
      for (let i = cx - r; i <= cx + r; i++) for (let j = cy - r; j <= cy + r; j++) {
        if (Math.max(Math.abs(i - cx), Math.abs(j - cy)) !== r) continue;
        for (const n of this.grid.get(i * 10000 + j) ?? []) { const d = Math.hypot(this.xy[n].x - p.x, this.xy[n].y - p.y); if (d < bd) { bd = d; best = n; } }
      }
    return { id: best, d: best < 0 ? max : bd };
  }
  // a에서 b까지, 도안 선(p->q)에서 멀어질수록 비싼 최단 경로
  path(a, b, p, q) {
    if (a === b) return [a];
    const G = ++this.gen, heap = [], T = this.xy[b];
    const push = (f, n) => { let i = heap.push([f, n]) - 1; while (i) { const u = (i - 1) >> 1; if (heap[u][0] <= heap[i][0]) break; [heap[u], heap[i]] = [heap[i], heap[u]]; i = u; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { let c = 2 * i + 1; if (c >= heap.length) break; if (c + 1 < heap.length && heap[c + 1][0] < heap[c][0]) c++; if (heap[i][0] <= heap[c][0]) break; [heap[c], heap[i]] = [heap[i], heap[c]]; i = c; } } return top; };
    const h = n => Math.hypot(this.xy[n].x - T.x, this.xy[n].y - T.y);
    const dx = q.x - p.x, dy = q.y - p.y, L2 = dx * dx + dy * dy || 1;
    const off = n => { const u = this.xy[n], t = Math.max(0, Math.min(1, ((u.x - p.x) * dx + (u.y - p.y) * dy) / L2)); return Math.hypot(u.x - p.x - t * dx, u.y - p.y - t * dy); };
    this.g[a] = 0; this.mark[a] = G; this.prev[a] = -1; push(h(a), a);
    while (heap.length) {
      const n = pop()[1];
      if (this.shut[n] === G) continue; this.shut[n] = G;
      if (n === b) { const out = []; for (let k = b; k >= 0; k = this.prev[k]) out.push(k); return out.reverse(); }
      for (const e of this.adj[n]) {
        const c = this.g[n] + e.len * (1 + off(e.to) / 25 + e.w * 0.3);
        if (this.mark[e.to] !== G || c < this.g[e.to]) { this.mark[e.to] = G; this.g[e.to] = c; this.prev[e.to] = n; push(c + h(e.to), e.to); }
      }
    }
    return null;
  }
  length(ids) { let s = 0; for (let i = 1; i < ids.length; i++) s += Math.hypot(this.xy[ids[i]].x - this.xy[ids[i - 1]].x, this.xy[ids[i]].y - this.xy[ids[i - 1]].y); return s; }
  // 모든 구간이 실제 도로인지 확인 (서버가 검증할 때도 사용)
  valid(ids) { return Array.isArray(ids) && ids.length > 1 && ids.length < 5000 && ids.every(i => Number.isInteger(i) && i >= 0 && i < this.ll.length) && ids.every((n, i) => !i || this.adj[ids[i - 1]].some(e => e.to === n)); }
  latlng(ids) { return ids.map(i => this.ll[i]); }

  trace(pts, gap = 90) { // pts: 지역 좌표(m)로 놓인 도안
    const stops = resample(pts, Math.max(12, Math.min(60, Math.round(polyLen(pts) / gap))));
    const snap = stops.map(p => this.nearest(p));
    if (snap.some(s => s.id < 0)) return null;
    const out = [snap[0].id]; let at = stops[0];
    for (let i = 1; i < snap.length; i++) {
      if (snap[i].id === out.at(-1)) continue;
      const leg = this.path(out.at(-1), snap[i].id, at, stops[i]);
      if (!leg) return null;
      for (const n of leg.slice(1)) { if (out.length > 1 && out.at(-2) === n) out.pop(); else out.push(n); } // 왔다 갔다 하는 막다른 길 제거
      at = stops[i];
    }
    return out.length > 8 ? out : null;
  }

  // 교통대 주변에서 위치, 크기, 기울기를 바꿔 가며 가장 닮은 도로 경로를 찾는다
  async fit(shape, target, { radius = 3500, onProgress } = {}) {
    const n = normalized(shape), L = polyLen(n), cand = [], maxD = target * 0.03 + 40;
    for (const k of [0.6, 0.75, 0.9]) for (const deg of [0, -12, 12, -25, 25]) {
      const S = target / L * k, c = Math.cos(deg * Math.PI / 180), s = Math.sin(deg * Math.PI / 180);
      const base = resample(n, 36).map(p => ({ x: (p.x * c - p.y * s) * S, y: (p.x * s + p.y * c) * S }));
      
      for (let cx = -radius; cx <= radius; cx += 180) for (let cy = -radius; cy <= radius; cy += 180) {
        if (cx * cx + cy * cy > radius * radius) continue;
        let sum = 0, bad = false;
        for (const p of base) { const d = this.nearest({ x: p.x + cx, y: p.y + cy }, 300).d; sum += Math.min(d, 300); if (sum / 36 > maxD * 1.5) { bad = true; break; } }
        if (!bad) cand.push({ q: sum / 36 / S, a: deg * Math.PI / 180, cx, cy, S });
      }
      onProgress?.('찾는 중'); await new Promise(r => setTimeout(r));
    }
    cand.sort((a, b) => a.q - b.q);
    const tops = []; let i = 0;
    const attempt = v => {
      const c = Math.cos(v.a), k = Math.sin(v.a);
      const placed = n.map(p => ({ x: (p.x * v.w * c - p.y * k) * v.S + v.cx, y: (p.x * v.w * k + p.y * c) * v.S + v.cy }));
      for (const gap of [80, 150]) {
        const ids = this.trace(placed, gap); if (!ids) continue;
        const len = this.length(ids);
        if (len > target * 1.35 || len < target * 0.65) continue;
        const r = { ids, len, placed, v, sim: this.similarity(ids, placed, v.S) };
        if (!v.best || r.sim > v.best.sim) v.best = r;
      }
      return v.best;
    };
    for (const c of cand.slice(0, 400)) {
      if (++i % 10 === 0) await new Promise(r => setTimeout(r));
      const r = attempt({ cx: c.cx, cy: c.cy, S: c.S, a: c.a, w: 1 }); if (r) tops.push(r);
    }
    tops.sort((a, b) => b.sim - a.sim);
    let best = tops[0] ?? null, seed = 7;
    const rnd = () => ((seed = seed * 16807 % 2147483647) / 2147483647 - 0.5) * 2;
    const starts = [];
    for (const t of tops) if (starts.length < 10 && starts.every(u => Math.hypot(u.v.cx - t.v.cx, u.v.cy - t.v.cy) > 250)) starts.push(t);
    for (const st of starts) { // 유망한 자리마다 조금씩 움직여 개선
      let cur = st;
      for (let k = 0; k < 80; k++) {
        const z = 1 - k / 95, v = cur.v;
        const r = attempt({ cx: v.cx + rnd() * 110 * z, cy: v.cy + rnd() * 110 * z, S: v.S * (1 + rnd() * 0.12 * z), a: Math.max(-0.6, Math.min(0.6, v.a + rnd() * 0.15 * z)), w: Math.max(0.8, Math.min(1.25, v.w + rnd() * 0.12 * z)) });
        if (r && r.sim > cur.sim) cur = r;
        if (k % 8 === 0) await new Promise(r => setTimeout(r));
      }
      if (cur.sim > best.sim) best = cur;
    }
    return best;
  }
  // 평균뿐 아니라 크게 벗어난 부분(상위 10%)과 선의 방향까지 본다
  similarity(ids, placed, S) {
    const N = 140, tang = l => l.map((p, i) => { const u = l[Math.max(0, i - 2)], v = l[Math.min(l.length - 1, i + 2)], d = Math.hypot(v.x - u.x, v.y - u.y) || 1; return { x: p.x, y: p.y, tx: (v.x - u.x) / d, ty: (v.y - u.y) / d }; });
    const A = tang(resample(ids.map(i => this.xy[i]), N)), B = tang(resample(placed, N));
    const dev = (P, Q) => { const d = P.map(a => { let m = Infinity; for (const b of Q) { const c = Math.hypot(a.x - b.x, a.y - b.y) / S + 0.05 * Math.abs(a.tx * b.ty - a.ty * b.tx); if (c < m) m = c; } return m; }).sort((x, y) => x - y); return 0.5 * d.reduce((s, x) => s + x, 0) / N + 0.5 * d[Math.floor(N * 0.9)]; };
    return Math.round(100 * Math.max(0, 1 - Math.max(dev(A, B), dev(B, A)) / 0.16));
  }
}
const polyLen = p => p.slice(1).reduce((s, q, i) => s + Math.hypot(q.x - p[i].x, q.y - p[i].y), 0);
function normalized(pts) {
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y), ax = Math.min(...xs), bx = Math.max(...xs), ay = Math.min(...ys), by = Math.max(...ys), s = Math.max(bx - ax, by - ay) || 1;
  return pts.map(p => ({ x: (p.x - (ax + bx) / 2) / s, y: (p.y - (ay + by) / 2) / s }));
}
export const pathMeters = ll => ll.slice(1).reduce((s, p, i) => s + meters(ll[i], p), 0);
