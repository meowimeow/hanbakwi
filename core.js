// 앱과 서버가 함께 쓰는 GPS 필터 + 점수 계산 (외부 의존성 없음)
const R = 6371000, rad = d => d * Math.PI / 180;
export const MAX_SPEED = 7;      // m/s. 이보다 빠르면 탈것으로 본다
export const MAX_ACCURACY = 35;  // m. 이보다 부정확한 위치는 버린다
export const MIN_RANK_M = 300;

export function meters(a, b) {
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
export const toXY = (p, o) => ({ x: rad(p.lng - o.lng) * R * Math.cos(rad(o.lat)), y: rad(p.lat - o.lat) * R });
export const toLL = (p, o) => ({ lat: o.lat + p.y / R * 180 / Math.PI, lng: o.lng + p.x / (R * Math.cos(rad(o.lat))) * 180 / Math.PI });

export class Tracker {
  constructor() {
    this.raw = []; this.segments = []; this.marks = [];
    this.distance = 0; this.fast = 0; this.checked = 0; this.streak = 0;
    this.anchor = null; this.start = null; this.last = null;
  }
  get elapsed() { return this.start === null ? 0 : (this.last - this.start) / 1000; }
  get suspicious() { return this.fast >= 5 && this.fast / this.checked > 0.2; }
  add(s) {
    if (![s.lat, s.lng, s.acc, s.t].every(Number.isFinite)) return;
    if (this.last !== null && s.t <= this.last) return;
    this.raw.push(s);
    if (s.acc > MAX_ACCURACY) return;
    if (this.start === null) { this.start = s.t; this.marks.push({ m: 0, t: 0 }); }
    this.last = s.t;
    if (!this.anchor) { this.anchor = s; this.segments.push([s]); return; }
    const d = meters(this.anchor, s), dt = (s.t - this.anchor.t) / 1000;
    this.checked++;
    if (d / dt > MAX_SPEED) {
      this.fast++;
      // 탈것으로 이동한 거리를 나중에 한꺼번에 더하지 않도록 기준점을 새로 잡는다
      if (++this.streak >= 5) { this.anchor = s; this.segments.push([s]); this.streak = 0; }
      return;
    }
    this.streak = 0;
    if (d < Math.max(4, s.acc * 0.3)) return; // 제자리 떨림
    this.distance += d;
    this.anchor = s;
    this.segments.at(-1).push(s);
    this.marks.push({ m: this.distance, t: this.elapsed });
  }
  timeAt(target) {
    const i = this.marks.findIndex(k => k.m >= target);
    if (i < 1) return null;
    const a = this.marks[i - 1], b = this.marks[i];
    return a.t + (b.t - a.t) * (target - a.m) / (b.m - a.m);
  }
}

export function resample(pts, n) {
  const seg = pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i].x, p.y - pts[i].y));
  const total = seg.reduce((a, b) => a + b, 0), out = [];
  if (!total) return [pts[0]];
  let i = 0, acc = 0;
  for (let k = 0; k < n; k++) {
    const at = total * k / (n - 1);
    while (i < seg.length - 1 && acc + seg[i] < at) acc += seg[i++];
    const f = seg[i] ? Math.min(1, (at - acc) / seg[i]) : 0;
    out.push({ x: pts[i].x + (pts[i + 1].x - pts[i].x) * f, y: pts[i].y + (pts[i + 1].y - pts[i].y) * f });
  }
  return out;
}
// 실제 도로 경로를 얼마나 빠짐없이(cover), 벗어나지 않고(stay) 달렸는지. GPS 오차를 감안해 25m까지 인정
export const ROUTE_TOLERANCE = 25;
function distToLine(p, line) {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i], dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy;
    const t = L ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L)) : 0;
    best = Math.min(best, Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy));
  }
  return best;
}
const len = l => l.slice(1).reduce((s, p, i) => s + Math.hypot(p.x - l[i].x, p.y - l[i].y), 0);
export function routeScore(segments, route) {
  const o = route[0], R0 = route.map(p => toXY(p, o));
  const paths = segments.filter(g => g.length > 1).map(g => g.map(p => toXY(p, o)));
  if (!paths.length) return 0;
  const every = (l, d) => resample(l, Math.max(2, Math.round(len(l) / d)));
  const want = every(R0, 15), ran = paths.flatMap(l => every(l, 15)), ok = d => d <= ROUTE_TOLERANCE;
  const cover = want.filter(p => ok(Math.min(...paths.map(l => distToLine(p, l))))).length / want.length;
  const stay = ran.filter(p => ok(distToLine(p, R0))).length / ran.length;
  return Math.round(100 * cover * stay);
}
// 오차 20%면 0점
export const paceScore = (guess, actual) => Math.round(100 * Math.max(0, 1 - Math.abs(actual - guess) / guess / 0.2));

export function evaluate(samples, opt) {
  const t = new Tracker();
  samples.forEach(s => t.add(s));
  const r = { mode: opt.mode, distance: t.distance, elapsed: t.elapsed, score: 0, ok: true, note: '' };
  if (opt.mode === 'draw') r.score = routeScore(t.segments, opt.route);
  if (opt.mode === 'pace') {
    const actual = t.timeAt(opt.target);
    if (actual === null) { r.ok = false; r.note = '목표 거리를 채우지 못해 점수가 없어요.'; }
    else { r.actual = actual; r.score = paceScore(opt.guess, actual); }
  }
  if (opt.mode === 'crew') r.score = Math.round(t.distance / 100) / 10;
  if (t.distance < MIN_RANK_M) { r.ok = false; r.note ||= `${MIN_RANK_M}m 이상 달려야 순위에 올라요.`; }
  if (t.suspicious) { r.ok = false; r.note = '달리기보다 빠른 구간이 많아 순위에 올리지 않았어요.'; }
  return { ...r, segments: t.segments };
}

const KST = 9 * 3600e3, DAY = 864e5;
export function weekStart(now) { // 한국 시간 월요일 0시
  const day = Math.floor((now + KST) / DAY);
  return (day - (day + 3) % 7) * DAY - KST;
}
export function board(runs, mode, now) {
  const week = runs.filter(r => r.at >= weekStart(now));
  if (mode !== 'crew') {
    const best = new Map();
    for (const r of week) if (r.mode === mode && (!best.has(r.uid) || best.get(r.uid).score < r.score)) best.set(r.uid, r);
    return [...best.values()].sort((a, b) => b.score - a.score || a.at - b.at).slice(0, 50)
      .map(r => ({ name: r.name, sub: r.crew, score: r.score }));
  }
  const crews = new Map();
  for (const r of week) if (r.crew) {
    const c = crews.get(r.crew) ?? crews.set(r.crew, new Map()).get(r.crew);
    c.set(r.uid, (c.get(r.uid) || 0) + r.distance / 1000);
  }
  // 한 명이 혼자 끌고 가지 못하게 1인당 주 10km까지만 반영
  return [...crews].map(([name, m]) => ({ name, sub: `${m.size}명 참여`, score: Math.round([...m.values()].reduce((s, k) => s + Math.min(10, k), 0) * 10) / 10 }))
    .sort((a, b) => b.score - a.score).slice(0, 50);
}
