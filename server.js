import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluate, board } from './public/core.js';
import { Network } from './public/router.js';
import { aiReady, drawWithAI } from './ai.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const PUB = path.join(root, 'public');
const DB = process.env.DB_FILE || path.join(root, 'data', 'runs.json');
fs.mkdirSync(path.dirname(DB), { recursive: true });
const net = new Network(JSON.parse(fs.readFileSync(path.join(PUB, 'roads.json'), 'utf8')));
const runs = fs.existsSync(DB) ? JSON.parse(fs.readFileSync(DB, 'utf8')) : [];
const save = () => { fs.writeFileSync(DB + '.tmp', JSON.stringify(runs)); fs.renameSync(DB + '.tmp', DB); };
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.json': 'application/json', '.svg': 'image/svg+xml' };
const send = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
const str = (v, n) => typeof v === 'string' ? v.trim().slice(0, n) : '';
const id = v => typeof v === 'string' && /^[\w-]{8,64}$/.test(v);

async function body(req) {
  let size = 0; const chunks = [];
  for await (const c of req) { if ((size += c.length) > 3e6) throw new Error('too large'); chunks.push(c); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function submit(b) {
  const name = str(b.name, 12), crew = str(b.crew, 16);
  if (!id(b.uid) || !id(b.runId) || !name || !Array.isArray(b.samples) || b.samples.length < 2 || b.samples.length > 40000) return null;
  if (!b.samples.every(s => s && Math.abs(s.lat) <= 90 && Math.abs(s.lng) <= 180)) return null;
  const o = b.opt;
  if (!o || !['draw', 'pace', 'crew'].includes(o.mode)) return null;
  if (o.mode === 'draw') { // 도로가 아닌 구간이 하나라도 있으면 거절
    if (!net.valid(o.ids) || net.length(o.ids) < 1000 || net.length(o.ids) > 15000) return null;
    o.route = net.latlng(o.ids);
  }
  if (o.mode === 'pace' && !([1000, 3000, 5000].includes(o.target) && Number.isFinite(o.guess) && o.guess >= 60)) return null;
  if (!net.contains(b.samples.find(s => s.acc <= 35) ?? b.samples[0])) return null; // 서비스 구역 밖
  const { segments, ...r } = evaluate(b.samples, o); // 경로(segments)는 저장하지 않는다
  if (r.ok && !runs.some(x => x.runId === b.runId && x.uid === b.uid)) {
    runs.push({ runId: b.runId, uid: b.uid, name, crew, mode: r.mode, score: r.score, distance: r.distance, at: Date.now() });
    save();
  }
  return r;
}
http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/api/board') {
      const m = u.searchParams.get('mode');
      return ['draw', 'pace', 'crew'].includes(m) ? send(res, 200, board(runs, m, Date.now())) : send(res, 400, { error: 'mode' });
    }
    if (u.pathname === '/api/ai') {
      if (req.method === 'GET') return send(res, 200, { ready: aiReady });
      if (req.method !== 'POST') return send(res, 405, {});
      let b = null; try { b = await body(req); } catch {}
      const text = str(b?.text, 60);
      if (!text) return send(res, 400, { error: '그리고 싶은 것을 적어 주세요.' });
      const r = await drawWithAI(text);
      return send(res, r.pts ? 200 : r.status, r);
    }
    if (u.pathname === '/api/runs' && req.method === 'POST') {
      let r = null; try { r = submit(await body(req)); } catch {}
      return r ? send(res, 200, r) : send(res, 400, { error: '기록 형식이 올바르지 않아요.' });
    }
    const f = path.join(PUB, u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname));
    if (!f.startsWith(PUB + path.sep) || !fs.existsSync(f) || !fs.statSync(f).isFile()) return send(res, 404, { error: 'not found' });
    res.writeHead(200, { 'content-type': (TYPES[path.extname(f)] || 'application/octet-stream') + '; charset=utf-8', 'cache-control': 'no-cache' });
    fs.createReadStream(f).pipe(res);
  } catch (e) { if (!res.headersSent) send(res, 500, { error: 'server' }); }
}).listen(process.env.PORT || 3000, '127.0.0.1', function () { console.log('http://localhost:' + this.address().port); });
