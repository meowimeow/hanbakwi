import { Tracker, evaluate, board, resample, toXY, toLL, weekStart, meters } from './core.js';
import { Network } from './router.js';
import { PRESETS, BEST, presetPts } from './presets.js';

const app = document.getElementById('app');
const store = { get(k, d) { try { return JSON.parse(localStorage.getItem('hb:' + k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('hb:' + k, JSON.stringify(v)); return true; } catch { return false; } } };
const uuid = () => [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
let me = store.get('me', null);
const MODES = {
  draw: ['그림 그리기', '실제 도로로 만든 그림 코스를 달려요. 코스를 정확히 따라갈수록 높은 점수'],
  pace: ['페이스 예측', '기록을 예상하고 시계 없이 달려요. 오차가 작으면 승리'],
  crew: ['크루 릴레이', '따로 달려도 거리는 함께 쌓여요. 1인당 주 10km까지'],
};
const STATIC = location.hostname.endsWith('.github.io') || new URLSearchParams(location.search).has('static'); // 서버 없는 공개 주소
const CAMPUS = { lat: 36.9707, lng: 127.8720 }; // 국립한국교통대학교
let netP = null, net = null;
const loadNet = () => netP ??= fetch('./roads.json').then(r => { if (!r.ok) throw 0; return r.json(); }).then(d => (net = new Network(d))).catch(e => { netP = null; throw e; });
loadNet().catch(() => {});
const OUTSIDE = '지금은 교통대 주변에서만 달릴 수 있어요. 구역 안으로 이동해 주세요.';

function h(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) k.startsWith('on') ? e.addEventListener(k.slice(2), v) : v !== undefined && v !== false && e.setAttribute(k, v);
  e.append(...kids.flat().filter(x => x !== null && x !== undefined && x !== false));
  return e;
}
function svg(d, box) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'), p = document.createElementNS(s.namespaceURI, 'path');
  s.setAttribute('viewBox', box); s.setAttribute('width', 52); s.setAttribute('height', 52); s.setAttribute('aria-hidden', 'true');
  p.setAttribute('d', d); p.setAttribute('class', 'p'); s.append(p); return s;
}
const ICON = { draw: 'M26 46C0 28 8 8 18 10c5 1 8 7 8 7s3-6 8-7c10-2 18 18-8 36', pace: 'M26 6a20 20 0 1 1-.1 0M26 14v12l9 6', crew: 'M4 40C14 40 12 12 24 12s8 26 24 22M40 28l9 6-8 8' };
const clock = s => { s = Math.round(s); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const km = m => (m / 1000).toFixed(2);
let view = 'home', map = null, layers = {};

function show(name, ...kids) {
  if (map) { map.remove(); map = null; layers = {}; }
  view = name;
  app.className = name === 'run' ? 'running' : '';
  const nav = me && name !== 'run' && h('nav', { 'aria-label': '메뉴' }, [['home', '달리기', home], ['board', '순위', () => boardView('draw')], ['log', '내 기록', log]]
    .map(([k, t, f]) => h('button', { onclick: f, 'aria-current': k === name ? 'page' : undefined }, t)));
  app.replaceChildren(...kids.flat().filter(Boolean), ...(nav ? [nav] : []));
  scrollTo(0, 0);
}
function makeMap(center) {
  if (!window.L) { const el = document.getElementById('map'); el.textContent = '지도를 불러오지 못했어요. GPS 기록은 계속됩니다.'; return; }
  map = L.map('map', { zoomControl: false }).setView(center, 15);
  if (net) { const [a, b, c, d] = net.box; L.rectangle([[a, b], [c, d]], { fill: false, color: '#14213d', weight: 2, dashArray: '2 6', interactive: false }).addTo(map); }
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map);
}
function line(name, pts, style) {
  if (!map) return;
  if (layers[name]) layers[name].setLatLngs(pts); else layers[name] = L.polyline(pts, style).addTo(map);
}
const GUIDE = { color: '#2340e0', weight: 5, opacity: .55, dashArray: '4 10' }, PATH = { color: '#ff3f8e', weight: 6 };

function profile() {
  const name = h('input', { maxlength: 12, value: me?.name || '', placeholder: '예: 느린거북', required: '' });
  const crew = h('input', { maxlength: 16, value: me?.crew || '', placeholder: '예: 컴공 러닝크루' });
  show('profile', h('h1', {}, me ? '배번표 수정' : '배번표를 만들어요'),
    h('form', { onsubmit: e => { e.preventDefault(); if (!name.value.trim()) return; me = { uid: me?.uid || uuid(), name: name.value.trim(), crew: crew.value.trim() }; store.set('me', me); home(); } },
      h('label', {}, '닉네임', name), h('label', {}, '크루 이름 (없으면 비워 두세요)', crew),
      h('p', { class: 'soft' }, STATIC ? '공개 체험판이라 크루 거리도 내 기록만 더해져요.' : '같은 크루 이름을 적은 사람끼리 거리가 합쳐져요. 닉네임, 크루, 점수는 순위에 공개돼요.'),
      h('p', { class: 'soft' }, STATIC ? '달린 경로와 기록은 이 기기에만 저장돼요. 다른 사람과 순위가 합쳐지지 않아요.' : '달린 경로는 점수 계산을 위해 서버로 보내지만 저장하지 않아요. 경로는 이 기기에만 남아요.'),
      h('button', { class: 'go' }, '저장')));
}
function home() {
  flush();
  const week = store.get('log', []).filter(r => r.at >= weekStart(Date.now())).reduce((s, r) => s + r.distance, 0);
  show('home', h('section', { class: 'bib' }, h('div', { class: 'num' }, (week / 1000).toFixed(1), h('small', {}, 'km')),
    h('div', { class: 'soft' }, '이번 주 달린 거리'),
    h('div', { class: 'who' }, h('span', {}, me.name + (me.crew ? ` / ${me.crew}` : '')), h('button', { onclick: profile }, '수정'))),
    h('h2', {}, '오늘은 무엇으로 겨룰까요?'),
    h('div', { class: 'modes' }, Object.entries(MODES).map(([k, [t, d]]) => h('button', { class: 'mode', onclick: () => k === 'draw' ? pickDraw() : setup(k) }, svg(ICON[k], '0 0 52 52'), h('span', {}, h('b', {}, t), h('span', {}, d))))));
}
function seg(items, value, pick) {
  const box = h('div', { class: 'seg' });
  items.forEach(([v, t]) => box.append(h('button', { type: 'button', 'aria-pressed': String(v === value), onclick: e => {
    [...box.children].forEach(b => b.setAttribute('aria-pressed', 'false')); e.currentTarget.setAttribute('aria-pressed', 'true'); pick(v);
  } }, t)));
  return box;
}
const geoError = e => e.code === 1 ? '위치 권한이 꺼져 있어요. 브라우저 설정에서 이 사이트의 위치를 허용한 뒤 다시 시도하세요.' : '위치를 찾지 못했어요. 하늘이 보이는 곳에서 다시 시도하세요.';

// 그림 고르기
const toSvg = pts => 'M' + pts.map(p => `${p.x.toFixed(1)} ${(100 - p.y).toFixed(1)}`).join('L');
const SIZES = [[3000, '3km'], [5000, '5km'], [8000, '8km']];
let drawSize = 3000, drawTab = 'preset', custom = [];
function pickDraw(tab = drawTab) {
  drawTab = tab;
  const body = h('div');
  show('setup', h('div', { class: 'top' }, h('h1', {}, '그림 고르기'), h('button', { onclick: home }, '닫기')),
    seg([['preset', '도안'], ['hand', '직접 그리기'], ['ai', 'AI 그림']], tab, pickDraw),
    h('label', {}, '코스 길이'), seg(SIZES, drawSize, v => { drawSize = v; }), body);
  ({ preset: presetTab, hand: handTab, ai: aiTab })[tab](body);
}
const thumbs = () => h('div', { class: 'thumbs' }, Object.entries(PRESETS).map(([k, [t]]) => h('button', { onclick: () => makeRoute(presetPts(k), t) }, svg(toSvg(presetPts(k)), '-6 -6 112 112'), h('span', {}, t))));
function presetTab(body) {
  body.append(h('label', {}, '이 동네에서 잘 보이는 그림'), h('div', { class: 'thumbs' }, BEST.map(([k, m]) => h('button', { onclick: () => { drawSize = m; makeRoute(presetPts(k), PRESETS[k][0]); } }, svg(toSvg(presetPts(k)), '-6 -6 112 112'), h('span', {}, `${PRESETS[k][0]} ${m / 1000}km`)))),
    h('label', {}, '모든 도안'), h('p', { class: 'soft' }, '위에서 고른 길이로 만들어요. 길 모양에 따라 많이 달라질 수 있어요.'), thumbs());
}
function handTab(body) {
  const NS = 'http://www.w3.org/2000/svg', pad = document.createElementNS(NS, 'svg'), path = document.createElementNS(NS, 'path'), live = document.createElementNS(NS, 'path');
  pad.setAttribute('viewBox', '0 0 100 100'); pad.setAttribute('class', 'pad'); pad.setAttribute('role', 'img'); pad.setAttribute('aria-label', '그림판. 손가락이나 마우스로 한 줄로 그리세요');
  for (const p of [path, live]) { p.setAttribute('class', 'p'); pad.append(p); }
  let stroke = null; const strokes = custom;
  const all = () => strokes.flat();
  const d = pts => pts.length ? 'M' + pts.map(p => `${p.x.toFixed(1)} ${(100 - p.y).toFixed(1)}`).join('L') : '';
  const msg = h('p', { class: 'soft', role: 'status' });
  const go = h('button', { class: 'go', onclick: () => makeRoute(all(), '내 그림') }, '도로 코스로 만들기');
  const size = () => { const a = all(); return a.length < 5 ? 0 : Math.max(Math.max(...a.map(p => p.x)) - Math.min(...a.map(p => p.x)), Math.max(...a.map(p => p.y)) - Math.min(...a.map(p => p.y))); };
  const paint = () => { path.setAttribute('d', d(all())); live.setAttribute('d', ''); go.disabled = size() < 20; msg.textContent = !strokes.length ? '한 줄로 크게 그려 주세요. 손을 떼고 이어 그리면 앞 선의 끝과 이어져요.' : go.disabled ? '조금 더 크게 그려 주세요.' : '작은 장식보다 큰 윤곽이 도로에서 더 잘 보여요.'; };
  const at = e => { const r = pad.getBoundingClientRect(), c = v => Math.max(0, Math.min(100, v)); return { x: c((e.clientX - r.left) / r.width * 100), y: c(100 - (e.clientY - r.top) / r.height * 100) }; };
  pad.addEventListener('pointerdown', e => { if (stroke) return; try { pad.setPointerCapture(e.pointerId); } catch {} stroke = [at(e)]; });
  pad.addEventListener('pointermove', e => { if (!stroke) return; const p = at(e), q = stroke.at(-1); if (Math.hypot(p.x - q.x, p.y - q.y) > 1.2) { stroke.push(p); live.setAttribute('d', d(stroke)); } });
  const end = () => { if (stroke?.length > 1) strokes.push(stroke); stroke = null; paint(); };
  pad.addEventListener('pointerup', end); pad.addEventListener('pointercancel', end);
  body.append(pad, msg, h('div', { class: 'seg' }, h('button', { onclick: () => { strokes.pop(); paint(); } }, '되돌리기'),
    h('button', { onclick: () => { const a = all(); if (a.length > 2) { strokes.push([a[0]]); paint(); } } }, '시작점과 잇기'), h('button', { onclick: () => { strokes.length = 0; paint(); } }, '모두 지우기')), go);
  paint();
}
function aiTab(body) {
  const input = h('input', { maxlength: 60, placeholder: '예: 우산 쓴 고양이' }), msg = h('div', { role: 'status' }), go = h('button', { class: 'go' }, 'AI에게 그려 달라고 하기');
  const form = h('form', { hidden: '', onsubmit: async e => {
    e.preventDefault(); if (!input.value.trim() || go.disabled) return;
    go.disabled = true; msg.replaceChildren(h('p', { class: 'msg' }, 'AI가 그리는 중이에요. 최대 1분쯤 걸려요.'));
    try {
      const res = await fetch('./api/ai', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: input.value.trim() }) }), r = await res.json();
      if (!app.contains(go)) return;
      if (r.pts) return makeRoute(r.pts, r.name + ' (AI)');
      msg.replaceChildren(h('p', { class: 'msg' }, r.error));
    } catch { msg.replaceChildren(h('p', { class: 'msg' }, 'AI에 연결하지 못했어요. 인터넷을 확인하고 다시 시도해 주세요.')); }
    go.disabled = false;
  } }, h('label', {}, '무엇을 그릴까요?', input), h('p', { class: 'soft' }, '적은 내용은 Anthropic의 Claude로 전송돼요. 개인정보는 적지 마세요.'), msg, go);
  body.append(form, h('label', {}, 'Claude가 미리 그려 둔 도안'), thumbs());
  if (!STATIC) fetch('./api/ai').then(r => r.json()).then(r => { form.hidden = !r.ready; }).catch(() => {});
}
async function makeRoute(pts, name) {
  show('setup', h('h1', {}, name), h('p', { class: 'msg', role: 'status' }, '교통대 주변 도로에서 가장 닮은 코스를 찾고 있어요.'), h('button', { class: 'ghost', onclick: () => pickDraw() }, '취소'));
  const token = app.firstChild; let r = null, err = '이 그림과 길이에 맞는 도로를 찾지 못했어요. 길이를 바꾸거나 더 단순하게 그려 보세요.';
  try { await loadNet(); await new Promise(r => setTimeout(r, 30)); r = await net.fit(pts, drawSize); } catch (e) { console.error(e); err = '도로 정보를 불러오지 못했어요. 인터넷을 확인해 주세요.'; }
  if (app.firstChild !== token) return;
  if (!r) return show('setup', h('h1', {}, name), h('p', { class: 'msg' }, err), h('button', { class: 'go', onclick: () => pickDraw() }, '다시 고르기'));
  setup('draw', { name, ids: r.ids, route: net.latlng(r.ids), sim: r.sim, len: r.len, pts, placed: r.placed });
}

// 원래 그림 / 실제 경로 / 둘을 같은 자리에 겹친 그림. lines는 교통대 기준 좌표(m)의 선들
function compare(art, lines, label) {
  const NS = 'http://www.w3.org/2000/svg', pts = [...art.placed, ...lines.flat()], xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const x0 = Math.min(...xs), y0 = Math.min(...ys), w = Math.max(...xs) - x0, hh = Math.max(...ys) - y0, k = 100 / Math.max(w, hh, 1);
  const at = l => toSvg(l.map(p => ({ x: (p.x - x0) * k + (100 - w * k) / 2, y: (p.y - y0) * k + (100 - hh * k) / 2 })));
  const ran = lines.filter(l => l.length > 1).map(at).join('');
  const panel = (caption, ...ds) => {
    const g = document.createElementNS(NS, 'svg'); g.setAttribute('viewBox', '-8 -8 116 116'); g.setAttribute('role', 'img'); g.setAttribute('aria-label', caption);
    for (const [d, c] of ds) { const e = document.createElementNS(NS, 'path'); e.setAttribute('d', d); e.setAttribute('class', c); g.append(e); }
    return h('figure', {}, g, h('figcaption', {}, caption));
  };
  return h('div', { class: 'compare' }, panel('원래 그림', [at(art.placed), 'orig']), panel(label, [ran, 'p']), panel('겹쳐 보기', [at(art.placed), 'orig'], [ran, 'p']));
}
function setup(mode, art) {
  const opt = { mode };
  if (mode === 'draw') Object.assign(opt, { ids: art.ids, route: art.route, name: art.name, art });
  if (mode === 'pace') Object.assign(opt, { target: 1000 });
  let here = null;
  const where = h('p', { class: 'soft', role: 'status' });
  const draw = () => {
    if (here) where.textContent = net && !net.contains(here) ? OUTSIDE : mode === 'draw' ? `출발점까지 약 ${Math.round(meters(here, art.route[0]))}m예요. 출발점 60m 안에서 기록이 시작돼요.` : '';
    if (mode !== 'draw' || !map) return;
    line('guide', art.route, GUIDE); if (!layers.start) layers.start = L.circleMarker(art.route[0], { radius: 9, color: '#14213d', fillColor: '#fff', fillOpacity: 1, weight: 4 }).bindTooltip('출발', { permanent: true, direction: 'top' }).addTo(map);
    map.fitBounds(layers.guide.getBounds(), { padding: [24, 24], animate: false });
  };
  const msg = h('div', { role: 'status' });
  const min = h('input', { type: 'number', min: 1, max: 90, value: 7, 'aria-label': '분', inputmode: 'numeric' });
  const sec = h('input', { type: 'number', min: 0, max: 59, value: 0, 'aria-label': '초', inputmode: 'numeric' });
  const ready = () => {
    if (mode !== 'pace') return true;
    opt.guess = (+min.value) * 60 + (+sec.value);
    if (!Number.isInteger(opt.guess) || opt.guess < 60 || opt.guess > 7200) { msg.replaceChildren(h('p', { class: 'msg' }, '예상 기록을 1분 이상으로 적어 주세요.')); return false; }
    return true;
  };
  const go = h('button', { class: 'go', onclick: () => ready() && run(opt, false, here) }, '달리기 시작');
  show('setup', h('div', { class: 'top' }, h('h1', {}, art?.name ?? MODES[mode][0]), h('button', { onclick: home }, '닫기')), h('p', { class: 'soft' }, MODES[mode][1]),
    mode === 'draw' && [compare(art, [art.route.map(p => toXY(p, CAMPUS))], '도로 코스'), h('div', { class: 'match' }, h('div', {}, h('b', {}, `${(art.len / 1000).toFixed(1)}km 코스`), h('div', { class: 'soft' }, `도안과 닮음 ${art.sim}점. 모든 구간이 지도에 있는 길이에요.`))),
      art.sim < 50 && h('p', { class: 'msg' }, '이 동네 길로는 모양이 많이 달라져요. 다른 길이나 그림을 골라 보세요.'),
      h('div', { id: 'map' }), h('button', { class: 'ghost', onclick: () => pickDraw() }, '다른 그림 고르기')], where,
    mode === 'pace' && [h('label', {}, '거리'), seg([[1000, '1km'], [3000, '3km'], [5000, '5km']], opt.target, v => { opt.target = v; min.value = v / 1000 * 7; sec.value = 0; }),
      h('label', {}, '예상 기록'), h('div', { class: 'time' }, min, '분', sec, '초'), h('p', { class: 'soft' }, '달리는 동안 시간은 보이지 않아요. 목표 거리에 닿으면 저절로 끝나요.')],
    mode === 'crew' && !me.crew && h('p', { class: 'msg' }, '크루 이름이 없으면 순위에 거리가 쌓이지 않아요. 홈의 수정 버튼에서 적어 주세요.'),
    msg, go, h('button', { class: 'ghost', onclick: () => ready() && run(opt, true) }, '가상으로 달려 보기 (순위 미반영)'),
    h('p', { class: 'soft' }, '달리는 동안 화면을 켜 두세요. 지도 정보가 실제와 다를 수 있으니 공사, 통제, 사유지에서는 돌아가고 차를 먼저 살피세요.'));
  if (mode === 'draw') { makeMap(CAMPUS); draw(); }
  navigator.geolocation?.getCurrentPosition(p => { here = { lat: p.coords.latitude, lng: p.coords.longitude }; if (view === 'setup' && app.contains(go)) draw(); },
    e => app.contains(go) && msg.replaceChildren(h('p', { class: 'msg' }, geoError(e))), { enableHighAccuracy: true, timeout: 15000 });
}

const demoLoop = net => { // 교통대에서 1.5km쯤 떨어진 곳까지 도로로
  const a = net.nearest({ x: 0, y: 0 }).id, p = net.nearest({ x: -700, y: -900 }, 2000).id;
  return net.path(a, p, net.xy[a], net.xy[p]);
};
function run(opt, demo, from) {
  const t = new Tracker(); let watch, timer, lock, done = false, guideLine = null, last = 0;
  const dist = h('span', { class: 'num' }, '0.00', h('small', {}, 'km')), second = h('span', { class: 'num' }, opt.mode === 'pace' ? '??:??' : '0:00');
  const msg = h('div', { role: 'status' }, h('p', { class: 'msg' }, demo ? '가상 달리기예요. 실제보다 40배 빠르게 움직여요.' : 'GPS를 찾는 중이에요.'));
  const note = s => msg.replaceChildren(...(s ? [h('p', { class: 'msg' }, s)] : []));
  show('run', h('div', { id: 'map' }), h('div', { class: 'stats' }, h('div', {}, dist, h('div', { class: 'soft' }, '거리')), h('div', {}, second, h('div', { class: 'soft' }, opt.mode === 'pace' ? '시간은 비밀' : '시간'))), msg,
    h('button', { class: 'go stop', onclick: () => { if (demo || confirm('달리기를 끝낼까요?')) finish(); } }, '달리기 끝내기'));
  makeMap(from || CAMPUS);
  let armed = opt.mode !== 'draw', zoned = false;
  if (opt.mode === 'draw') { guideLine = opt.route; line('guide', guideLine, GUIDE); if (map) map.fitBounds(layers.guide.getBounds(), { padding: [20, 20], animate: false }); }
  function feed(s) {
    if (done) return;
    if (!zoned && s.acc <= 35) { if (!net) return note('도로 정보를 불러오는 중이에요.'); if (!net.contains(s)) return note(OUTSIDE); zoned = true; }
    if (!armed) {
      if (s.acc > 35) return note(`GPS 정확도를 기다려요. 현재 오차 약 ${Math.round(s.acc)}m`);
      const d = meters(s, opt.route[0]);
      if (d > 60) { return note(`출발점까지 ${Math.round(d)}m 남았어요. 도착하면 기록이 시작돼요.`); }
      armed = true;
    }
    t.add(s); last = Date.now();
    if (t.start === null) return note(`GPS 정확도를 기다려요. 현재 오차 약 ${Math.round(s.acc)}m`);
    if (!demo) note(t.suspicious ? '달리기보다 빠른 구간이 많아요. 이대로면 순위에 오르지 않아요.' : s.acc > 35 ? 'GPS 신호가 약해요.' : '');
    dist.firstChild.data = km(t.distance);
    if (opt.mode !== 'pace') second.textContent = clock(t.elapsed);
    if (map) { line('path', t.segments.map(g => g.map(p => [p.lat, p.lng])), PATH); if (!(demo && guideLine)) map.setView([s.lat, s.lng], 16, { animate: false }); }
    if (opt.mode === 'pace' && t.distance >= opt.target) finish();
  }
  async function keepAwake() { try { lock = await navigator.wakeLock?.request('screen'); if (done) lock?.release(); } catch {} }
  const onVisible = () => { if (!document.hidden && !done) keepAwake(); };
  const leave = e => { e.preventDefault(); };
  if (demo) {
    // 가상 달리기도 실제 도로로만 움직인다
    const ids = opt.mode === 'draw' ? opt.ids : net && demoLoop(net);
    if (!ids) { alert('도로 정보를 아직 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.'); return home(); }
    from = net.ll[ids[0]];
    const base = ids.map(i => toXY(net.ll[i], from)), loop = net.length(ids);
    const laps = opt.mode === 'pace' ? Math.ceil(opt.target * 1.1 / loop) : 1;
    const pts = Array.from({ length: laps }, (_, k) => k % 2 ? [...base].reverse() : base).flat();
    const len = pts.slice(1).reduce((s, p, i) => s + Math.hypot(p.x - pts[i].x, p.y - pts[i].y), 0);
    const steps = resample(pts, Math.round(len / 2.6)); let i = 0; const t0 = Date.now(), n = () => (Math.random() - .5) * 2;
    timer = setInterval(() => { const due = (Date.now() - t0) / 25; while (i <= due && !done) { if (i >= steps.length) return finish(); const p = steps[i]; feed({ ...toLL({ x: p.x + (i ? n() : 0), y: p.y + (i ? n() : 0) }, from), acc: 8, t: t0 + i++ * 1000 }); } }, 100);
  } else {
    if (!navigator.geolocation || !isSecureContext) note('이 주소에서는 GPS를 쓸 수 없어요. https 주소로 열어 주세요.');
    else {
      watch = navigator.geolocation.watchPosition(p => feed({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy, t: p.timestamp }), e => note(geoError(e)), { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
      timer = setInterval(() => { if (last && Date.now() - last > 15000) note('GPS가 잠시 끊겼어요. 화면을 켜 두세요.'); }, 5000);
      keepAwake(); document.addEventListener('visibilitychange', onVisible); addEventListener('beforeunload', leave);
    }
  }
  function finish() {
    if (done) return; done = true;
    clearInterval(timer); if (watch !== undefined) navigator.geolocation.clearWatch(watch);
    lock?.release(); document.removeEventListener('visibilitychange', onVisible); removeEventListener('beforeunload', leave);
    if (t.raw.length < 2) return home();
    const r = evaluate(t.raw, opt), runId = uuid();
    const path = r.segments.map(g => g.map(p => [+p.lat.toFixed(5), +p.lng.toFixed(5)]));
    const rec = { mode: opt.mode, name: opt.name, score: r.score, distance: r.distance, elapsed: r.elapsed, ok: r.ok, note: r.note, actual: r.actual, guess: opt.guess, at: Date.now(), path };
    if (!demo) {
      const list = [rec, ...store.get('log', [])].slice(0, 30);
      while (!store.set('log', list) && list.length > 1) list.pop();
      if (r.ok && !STATIC) { const q = store.get('queue', []); q.push({ runId, uid: me.uid, name: me.name, crew: me.crew, opt: { mode: opt.mode, ids: opt.ids, target: opt.target, guess: opt.guess }, samples: t.raw.map(s => ({ ...s, lat: +s.lat.toFixed(6), lng: +s.lng.toFixed(6) })) }); if (!store.set('queue', q)) memory.push(q.at(-1)); }
    }
    result(rec, demo, opt.art);
  }
}
const memory = []; let flushing = null;
function flush() { return flushing ??= doFlush().finally(() => { flushing = null; }); }
async function doFlush() { // 전송에 실패한 기록은 남겨 두었다가 다시 보낸다
  if (STATIC) return true;
  let left = false;
  for (const item of [...store.get('queue', []), ...memory]) {
    try {
      const res = await fetch('./api/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(item) });
      if (!res.ok && res.status !== 400) throw 0;
      store.set('queue', store.get('queue', []).filter(x => x.runId !== item.runId));
      const i = memory.findIndex(x => x.runId === item.runId); if (i >= 0) memory.splice(i, 1);
    } catch { left = true; }
  }
  return !left;
}
const unit = m => m === 'crew' ? 'km' : '점';
function result(r, demo, art) {
  const status = h('p', { class: 'msg', role: 'status' }, demo ? '가상 달리기라 순위와 내 기록에 남지 않아요.' : r.ok ? (STATIC ? '이 기기의 순위에 기록했어요.' : '순위에 올리는 중이에요.') : r.note);
  show('result', h('section', { class: 'bib' }, h('div', { class: 'num' }, r.mode === 'pace' && r.actual === undefined ? '-' : String(r.score), h('small', {}, unit(r.mode))), h('div', { class: 'soft' }, MODES[r.mode][0]),
    h('div', { class: 'who' }, h('span', {}, `${km(r.distance)}km`), h('span', {}, clock(r.elapsed)))),
    r.actual !== undefined && h('p', {}, `예상 ${clock(r.guess)}, 실제 ${clock(r.actual)}. ${Math.round(Math.abs(r.actual - r.guess))}초 차이예요.`),
    demo && r.note && h('p', { class: 'soft' }, r.note), status, art && compare(art, r.path.map(g => g.map(([lat, lng]) => toXY({ lat, lng }, CAMPUS))), '달린 길'), h('div', { id: 'map' }),
    h('button', { class: 'go', onclick: () => boardView(r.mode) }, '순위 보기'), h('button', { class: 'ghost', onclick: home }, '홈으로'));
  const pts = r.path.filter(g => g.length);
  if (pts.length) { makeMap(pts[0][0]); line('path', pts, PATH); if (map) map.fitBounds(layers.path.getBounds(), { padding: [24, 24], maxZoom: 17 }); }
  if (!demo && r.ok && !STATIC) flush().then(ok => { status.textContent = !ok ? '아직 순위에 올리지 못했어요. 다음에 앱을 열면 다시 시도해요.' : r.mode === 'crew' && !me.crew ? '기록했어요. 크루가 없어 크루 순위에는 더해지지 않았어요.' : '순위에 올렸어요.'; });
}
async function boardView(mode) {
  const list = h('ol', { class: 'rank', 'aria-live': 'polite' }, h('li', {}, '불러오는 중이에요.'));
  show('board', h('h1', {}, '이번 주 순위'), seg(Object.entries(MODES).map(([k, v]) => [k, v[0]]), mode, boardView), h('p', { class: 'soft' }, STATIC ? '공개 체험판에서는 이 기기의 기록만 보여요. 매주 월요일 0시에 새로 시작해요.' : '매주 월요일 0시에 새로 시작해요.'), list);
  try {
    await flush();
    let rows;
    if (STATIC) rows = board(store.get('log', []).filter(r => r.ok).map(r => ({ ...r, uid: me.uid, name: me.name, crew: me.crew })), mode, Date.now());
    else { const res = await fetch('./api/board?mode=' + mode); if (!res.ok) throw 0; rows = await res.json(); }
    list.replaceChildren(...(rows.length ? rows.map((r, i) => h('li', {}, h('span', { class: 'num pos' }, String(i + 1)), h('span', { class: 'grow' }, h('b', {}, r.name), h('div', { class: 'soft' }, r.sub || '')), h('span', { class: 'num' }, `${r.score}${unit(mode)}`)))
      : [h('li', {}, '아직 기록이 없어요. 먼저 달리고 1위에 올라 보세요.')]));
  } catch { list.replaceChildren(h('li', {}, '순위를 불러오지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요.')); }
}
function log() {
  const rows = store.get('log', []);
  show('log', h('h1', {}, '내 기록'), h('p', { class: 'soft' }, '경로는 이 기기에만 저장돼요.'),
    h('ol', { class: 'rank' }, rows.length ? rows.map(r => h('li', {}, h('span', { class: 'grow' }, h('b', {}, r.name || MODES[r.mode][0]), h('div', { class: 'soft' }, `${new Date(r.at).toLocaleDateString('ko-KR')} ${km(r.distance)}km ${clock(r.elapsed)}`)), h('span', { class: 'num' }, r.ok ? `${r.score}${unit(r.mode)}` : '무효')))
      : h('li', {}, '첫 달리기를 마치면 여기에 남아요.')),
    rows.length > 0 && h('button', { class: 'ghost', onclick: () => { if (confirm('이 기기의 기록을 모두 지울까요? 되돌릴 수 없어요.')) { store.set('log', []); log(); } } }, '이 기기의 기록 지우기'));
}
me ? home() : profile();
