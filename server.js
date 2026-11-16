'use strict';

// STREET RALLY - single-port HTTP server
// Serves the game page and a tiny shared leaderboard backed by a JSON file.
// No external dependencies, no database, no credentials.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const INDEX = path.join(ROOT, 'index.html');
const DATA_DIR = path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'leaderboard.json');
const PORT = Number(process.env.PORT) || 3000;

const TOP_N = 10;        // only the top 10 are shown
const MAX_KEEP = 100;    // how many records are kept on disk
const MAX_NAME = 12;
const MAX_SIGN = 24;
const MAX_SCORE = 200000;
const RATE_WINDOW = 10000;
const RATE_MAX = 3;

const rateHits = new Map();

function sendJSON(res, status, obj) {
  const body = Buffer.from(JSON.stringify(obj));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': 'same-origin'
  });
  res.end(body);
}

function readDB() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (parsed && Array.isArray(parsed.entries)) return parsed;
  } catch (e) {
    // missing or broken file starts as an empty board
  }
  return { version: 1, updatedAt: null, entries: [] };
}

function writeDB(db) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  db.updatedAt = new Date().toISOString();
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tmp, DATA_FILE);
}

function cleanText(value, max) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function cleanCount(value) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 && n < 1000000 ? n : 0;
}

function sorted(entries) {
  return entries.slice().sort((a, b) =>
    (b.score - a.score) || (a.ts - b.ts) || String(a.id).localeCompare(String(b.id))
  );
}

function publicList(entries) {
  return entries.slice(0, TOP_N).map((e, i) => ({
    rank: i + 1,
    id: e.id,
    name: e.name,
    sign: e.sign,
    score: e.score,
    ts: e.ts
  }));
}

function clientIP(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

function rateLimited(req) {
  const key = clientIP(req);
  const now = Date.now();
  const hits = (rateHits.get(key) || []).filter(t => now - t < RATE_WINDOW);
  if (hits.length >= RATE_MAX) {
    rateHits.set(key, hits);
    return true;
  }
  hits.push(now);
  rateHits.set(key, hits);
  return false;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 8192) {
        reject(new Error('payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(raw));
    req.on('error', reject);
  });
}

async function handlePost(req, res) {
  if (rateLimited(req)) {
    return sendJSON(res, 429, { ok: false, error: '提交太快了，稍等几秒再试' });
  }

  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch (e) {
    return sendJSON(res, 400, { ok: false, error: '请求格式不对' });
  }
  if (!payload || typeof payload !== 'object') {
    return sendJSON(res, 400, { ok: false, error: '请求格式不对' });
  }

  const name = cleanText(payload.name, MAX_NAME);
  const sign = cleanText(payload.sign, MAX_SIGN);
  const score = Math.floor(Number(payload.score));
  if (!name) {
    return sendJSON(res, 400, { ok: false, error: '得先给自己起个名字' });
  }
  if (!Number.isFinite(score) || score < 0 || score > MAX_SCORE) {
    return sendJSON(res, 400, { ok: false, error: '分数不合法' });
  }

  const entry = {
    id: crypto.randomUUID(),
    name,
    sign,
    score,
    perfects: cleanCount(payload.perfects),
    maxCombo: cleanCount(payload.maxCombo),
    winners: cleanCount(payload.winners),
    ts: Date.now()
  };

  const db = readDB();
  db.entries.push(entry);
  db.entries = sorted(db.entries).slice(0, MAX_KEEP);
  try {
    writeDB(db);
  } catch (e) {
    return sendJSON(res, 500, { ok: false, error: '榜单暂时写不进去，稍后再试' });
  }

  const all = sorted(db.entries);
  const rank = all.findIndex(e => e.id === entry.id) + 1;
  return sendJSON(res, 200, {
    ok: true,
    id: entry.id,
    rank,
    onBoard: rank > 0 && rank <= TOP_N,
    total: all.length,
    list: publicList(all)
  });
}

function serveIndex(res) {
  fs.readFile(INDEX, (err, buf) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('index.html missing');
    }
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': buf.length,
      'Cache-Control': 'no-store'
    });
    res.end(buf);
  });
}

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = new URL(req.url, 'http://localhost').pathname;
  } catch (e) {
    return sendJSON(res, 400, { ok: false, error: 'bad request' });
  }

  if (pathname === '/api/health') {
    return sendJSON(res, 200, { ok: true, service: 'street-rally-leaderboard' });
  }

  if (pathname === '/api/leaderboard') {
    if (req.method === 'GET') {
      const all = sorted(readDB().entries);
      return sendJSON(res, 200, { ok: true, total: all.length, list: publicList(all) });
    }
    if (req.method === 'POST') {
      return handlePost(req, res).catch(() => {
        if (!res.headersSent) sendJSON(res, 500, { ok: false, error: '服务器出错' });
      });
    }
    res.setHeader('Allow', 'GET, POST');
    return sendJSON(res, 405, { ok: false, error: 'method not allowed' });
  }

  // Only the game page is public. Source, package files and the JSON store are not served.
  if ((pathname === '/' || pathname === '/index.html') && (req.method === 'GET' || req.method === 'HEAD')) {
    return serveIndex(res);
  }

  return sendJSON(res, 404, { ok: false, error: 'not found' });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('STREET RALLY listening on 0.0.0.0:' + PORT);
});
