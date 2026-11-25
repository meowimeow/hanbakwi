import test from 'node:test';
import assert from 'node:assert/strict';
import { Tracker, resample, toXY, toLL, evaluate, paceScore, board, weekStart } from '../public/core.js';
const O = { lat: 37.5283, lng: 126.9326 };
let seed = 1; const rnd = () => (seed = seed * 16807 % 2147483647) / 2147483647 - .5;
const run = (ll, v = 2.8, noise = 0) => {
  const xy = ll.map(p => toXY(p, O));
  const len = xy.slice(1).reduce((s, p, i) => s + Math.hypot(p.x - xy[i].x, p.y - xy[i].y), 0);
  return resample(xy, Math.round(len / v) + 1).map((p, i) => ({ ...toLL({ x: p.x + rnd() * noise, y: p.y + rnd() * noise }, O), acc: 8, t: i * 1000 }));
};
const line = m => [O, toLL({ x: m, y: 0 }, O)];
test('거리와 목표 시간', () => {
  const r = evaluate(run(line(1200)), { mode: 'pace', target: 1000, guess: 360 });
  assert.ok(Math.abs(r.distance - 1200) < 10); assert.ok(Math.abs(r.actual - 357) < 4); assert.ok(r.score > 90 && r.ok);
});
test('목표 거리 미달은 무효', () => assert.equal(evaluate(run(line(600)), { mode: 'pace', target: 1000, guess: 300 }).ok, false));
test('예측 점수', () => { assert.equal(paceScore(300, 300), 100); assert.equal(paceScore(300, 330), 50); assert.equal(paceScore(300, 400), 0); });
test('탈것은 거리와 순위에서 제외, 멈춘 뒤에도 더하지 않음', () => {
  const s = run(line(2000), 14), l = s.at(-1);
  for (let i = 1; i < 400; i++) s.push({ ...l, t: l.t + i * 1000 });
  const r = evaluate(s, { mode: 'crew' }); assert.ok(r.distance < 100, String(r.distance)); assert.equal(r.ok, false);
});
test('제자리 떨림은 거리로 세지 않음', () => {
  const t = new Tracker(); for (let i = 0; i < 300; i++) t.add({ ...toLL({ x: rnd() * 4, y: rnd() * 4 }, O), acc: 15, t: i * 1000 });
  assert.ok(t.distance < 30, String(t.distance));
});
test('부정확한 위치는 무시', () => { const t = new Tracker(); t.add({ ...O, acc: 200, t: 1 }); assert.equal(t.start, null); });
test('크루: 1인 10km 상한, 주간 초기화', () => {
  const now = Date.UTC(2026, 10, 25); const b = { name: 'a', mode: 'crew', at: now };
  const out = board([{ ...b, uid: '1', crew: 'A', distance: 30000 }, { ...b, uid: '1', crew: 'B', distance: 8000 }, { ...b, uid: '2', crew: 'B', distance: 7000 }, { ...b, uid: '3', crew: 'C', distance: 9000, at: weekStart(now) - 1 }], 'crew', now);
  assert.deepEqual(out.map(x => [x.name, x.score]), [['B', 15], ['A', 10]]);
  assert.equal(new Date(weekStart(now)).toISOString(), '2026-11-22T15:00:00.000Z');
});
