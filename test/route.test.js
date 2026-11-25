import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Network } from '../public/router.js';
import { PRESETS, presetPts } from '../public/presets.js';
import { resample, toXY, toLL, evaluate } from '../public/core.js';
import { parseShape } from '../ai.js';
const net = new Network(JSON.parse(fs.readFileSync(new URL('../public/roads.json', import.meta.url))));
const runOn = (ll, v = 2.8) => { const o = ll[0], xy = ll.map(p => toXY(p, o)); const L = xy.slice(1).reduce((s, p, i) => s + Math.hypot(p.x - xy[i].x, p.y - xy[i].y), 0);
  return resample(xy, Math.round(L / v)).map((p, i) => ({ ...toLL({ x: p.x + Math.sin(i) * 5, y: p.y + Math.cos(i * 1.3) * 5 }, o), acc: 8, t: i * 1000 })); };
test('모든 도안과 길이에서 경로가 도로로만 이어지고 구역 안에 있다', async () => {
  for (const id in PRESETS) for (const t of [3000, 5000, 8000]) {
    const r = await net.fit(presetPts(id), t);
    assert.ok(r, id + t); assert.ok(net.valid(r.ids)); assert.ok(net.latlng(r.ids).every(p => net.contains(p)));
    assert.ok(r.len >= t * .65 && r.len <= t * 1.35); assert.ok(r.sim >= 30, `${id} ${t} ${r.sim}`);
  }
});
test('낙서와 직선도 도로 경로이거나 실패를 알린다', async () => {
  for (const pts of [[{ x: 0, y: 0 }, { x: 100, y: 0 }], Array.from({ length: 60 }, (_, i) => ({ x: 50 + i * Math.cos(i / 3) * .8, y: 50 + i * Math.sin(i / 3) * .8 }))]) { const r = await net.fit(pts, 5000); assert.ok(r === null || net.valid(r.ids)); }
});
test('도로가 아닌 연결은 거절', () => { assert.equal(net.valid([0, 3000]), false); assert.equal(net.valid([0, -1]), false); assert.equal(net.valid(['0', 1]), false); });
test('채점: 완주는 높고, 절반과 엉뚱한 곳은 낮다', async () => {
  const r = await net.fit(presetPts('heart'), 3000), route = net.latlng(r.ids), opt = { mode: 'draw', route }, s = runOn(route);
  assert.ok(evaluate(s, opt).score >= 95); assert.ok(evaluate(s.slice(0, s.length / 2), opt).score < 75);
  assert.equal(evaluate(runOn(route.map(p => ({ lat: p.lat + .01, lng: p.lng }))), opt).score < 25, true);
});
test('AI 응답 검증', () => {
  const pts = Array.from({ length: 10 }, (_, i) => ({ x: 50 + 40 * Math.cos(i), y: 50 + 40 * Math.sin(i) }));
  assert.equal(parseShape(JSON.stringify({ ok: true, name: '원', points: pts })).pts.length, 10);
  for (const bad of ['x', '{"ok":false,"points":[]}', JSON.stringify({ ok: true, points: [{ x: 1, y: 1 }] }), JSON.stringify({ ok: true, points: pts.map(p => ({ ...p, x: 9999 })) })]) assert.equal(parseShape(bad), null);
});
