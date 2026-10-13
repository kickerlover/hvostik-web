// Сервер Хвостика: семейные журналы без входа.
// Файлы сайта отдаёт Cloudflare сам, сюда попадают только запросы /api/*.
// Доступ к журналу даёт ключ устройства (заголовок Authorization: Bearer <ключ>). В базе хранится только его хэш.

const DAY = 864e5;
const INVITE_TTL = 7 * DAY;
const MAX_CHANGES = 200;      // изменений за один запрос
const MAX_ITEMS = 5000;       // записей в одном журнале
const MAX_DATA = 4000;        // размер одной записи, символов
const PAGE = 1000;            // записей в одном ответе
const KINDS = new Set(['pet', 'record', 'weight']);
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; // без похожих 0/O, 1/I/L

const HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: HEADERS });
const fail = (status, error) => json({ error }, status);

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
    try {
      return await handle(req, env, url);
    } catch (e) {
      if (e instanceof HttpError) return fail(e.status, e.code);
      console.error(e);
      return fail(500, 'server');
    }
  }
};

class HttpError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}

async function handle(req, env, url) {
  const db = env.DB;
  const path = url.pathname.replace(/\/+$/, '');
  const method = req.method;

  if (path === '/api/health') return json({ ok: true });

  if (path === '/api/journal' && method === 'POST') {
    const body = await readJson(req);
    const name = cleanName(body.name);
    await limit(db, ip(req), 'create', 60);
    const journalId = crypto.randomUUID(), deviceId = crypto.randomUUID();
    const token = randomToken(), recoveryKey = randomCode(20);
    const now = Date.now();
    await db.batch([
      db.prepare('INSERT INTO journals (id, created_at, rev, recovery_hash) VALUES (?, ?, 0, ?)').bind(journalId, now, await sha256(recoveryKey)),
      db.prepare('INSERT INTO devices (id, journal_id, token_hash, name, created_at, last_seen) VALUES (?, ?, ?, ?, ?, ?)').bind(deviceId, journalId, await sha256(token), name, now, now)
    ]);
    return json({ token, deviceId, name, recoveryKey: formatCode(recoveryKey) });
  }

  if (path === '/api/join' && method === 'POST') {
    const body = await readJson(req);
    const name = cleanName(body.name);
    const code = normalizeCode(body.code);
    await limit(db, ip(req), 'join', 30);
    const now = Date.now();
    let journalId = null, viaRecovery = false;
    if (code.length === 10) {
      const hash = await sha256(code);
      const inv = await db.prepare('SELECT journal_id FROM invites WHERE code_hash = ? AND expires_at > ?').bind(hash, now).first();
      if (inv) {
        journalId = inv.journal_id;
        await db.prepare('DELETE FROM invites WHERE code_hash = ?').bind(hash).run();
      }
    } else if (code.length === 20) {
      const j = await db.prepare('SELECT id FROM journals WHERE recovery_hash = ?').bind(await sha256(code)).first();
      if (j) { journalId = j.id; viaRecovery = true; }
    }
    if (!journalId) {
      await db.prepare('INSERT INTO attempts (ip, kind, ts) VALUES (?, ?, ?)').bind(ip(req), 'join', now).run();
      throw new HttpError(404, 'bad_code');
    }
    const deviceId = crypto.randomUUID(), token = randomToken();
    await db.prepare('INSERT INTO devices (id, journal_id, token_hash, name, created_at, last_seen) VALUES (?, ?, ?, ?, ?, ?)').bind(deviceId, journalId, await sha256(token), name, now, now).run();
    return json({ token, deviceId, name, viaRecovery });
  }

  // Дальше только для подключённых устройств
  const me = await auth(req, db);

  if (path === '/api/sync' && method === 'POST') {
    const body = await readJson(req);
    const since = Number.isInteger(body.since) && body.since >= 0 ? body.since : 0;
    const changes = Array.isArray(body.changes) ? body.changes : [];
    if (changes.length > MAX_CHANGES) throw new HttpError(413, 'too_many_changes');
    const clean = changes.map(cleanChange);
    const keys = clean.map(c => c.kind + ':' + c.id);

    if (clean.length) {
      const count = await db.prepare('SELECT COUNT(*) AS n FROM items WHERE journal_id = ?').bind(me.journal_id).first();
      if (count.n + clean.length > MAX_ITEMS) throw new HttpError(413, 'journal_full');
      // Каждое изменение получает следующий номер журнала. batch выполняется как одна транзакция,
      // поэтому номера идут подряд и читатель не пропустит изменение.
      const stmts = [];
      for (const c of clean) {
        stmts.push(db.prepare('UPDATE journals SET rev = rev + 1 WHERE id = ?').bind(me.journal_id));
        stmts.push(db.prepare(
          `INSERT INTO items (journal_id, kind, id, data, deleted, ts, rev)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, (SELECT rev FROM journals WHERE id = ?1))
           ON CONFLICT (journal_id, kind, id) DO UPDATE SET
             data = excluded.data, deleted = excluded.deleted, ts = excluded.ts, rev = excluded.rev
           WHERE excluded.ts >= items.ts`
        ).bind(me.journal_id, c.kind, c.id, c.data, c.deleted ? 1 : 0, c.ts));
      }
      await db.batch(stmts);
    }

    const rows = (await db.prepare('SELECT kind, id, data, deleted, ts, rev FROM items WHERE journal_id = ? AND rev > ? ORDER BY rev LIMIT ?').bind(me.journal_id, since, PAGE).all()).results;
    const more = rows.length === PAGE;
    const cursor = more ? rows.at(-1).rev : (await db.prepare('SELECT rev FROM journals WHERE id = ?').bind(me.journal_id).first()).rev;
    // Если изменение устройства оказалось старее серверного, возвращаем серверную версию,
    // даже если курсор устройства уже прошёл её номер
    const seen = new Set(rows.map(r => r.kind + ':' + r.id));
    if (keys.length) {
      const echo = (await db.prepare(`SELECT kind, id, data, deleted, ts, rev FROM items WHERE journal_id = ? AND (kind || ':' || id) IN (SELECT value FROM json_each(?))`).bind(me.journal_id, JSON.stringify(keys)).all()).results;
      for (const r of echo) if (!seen.has(r.kind + ':' + r.id)) rows.push(r);
    }
    return json({
      cursor, more,
      items: rows.map(r => ({ kind: r.kind, id: r.id, data: r.deleted ? null : JSON.parse(r.data), deleted: !!r.deleted, ts: r.ts })),
      members: await members(db, me),
      me: { id: me.id, name: me.name }
    });
  }

  if (path === '/api/invites' && method === 'POST') {
    const now = Date.now();
    await db.prepare('DELETE FROM invites WHERE expires_at <= ?').bind(now).run();
    const active = await db.prepare('SELECT COUNT(*) AS n FROM invites WHERE journal_id = ?').bind(me.journal_id).first();
    if (active.n >= 20) throw new HttpError(429, 'too_many_invites');
    const code = randomCode(10), expiresAt = now + INVITE_TTL;
    await db.prepare('INSERT INTO invites (code_hash, journal_id, created_by, expires_at) VALUES (?, ?, ?, ?)').bind(await sha256(code), me.journal_id, me.id, expiresAt).run();
    return json({ code: formatCode(code), expiresAt });
  }

  if (path === '/api/me' && method === 'POST') {
    const name = cleanName((await readJson(req)).name);
    await db.prepare('UPDATE devices SET name = ? WHERE id = ?').bind(name, me.id).run();
    return json({ name, members: await members(db, { ...me, name }) });
  }

  if (path === '/api/leave' && method === 'POST') {
    await db.prepare('DELETE FROM devices WHERE id = ?').bind(me.id).run();
    return json({ ok: true });
  }

  const devMatch = path.match(/^\/api\/devices\/([0-9a-f-]{36})$/);
  if (devMatch && method === 'DELETE') {
    if (devMatch[1] === me.id) throw new HttpError(400, 'use_leave');
    const r = await db.prepare('DELETE FROM devices WHERE id = ? AND journal_id = ?').bind(devMatch[1], me.journal_id).run();
    if (!r.meta.changes) throw new HttpError(404, 'no_device');
    return json({ members: await members(db, me) });
  }

  if (path === '/api/recovery' && method === 'POST') {
    const key = randomCode(20);
    await db.prepare('UPDATE journals SET recovery_hash = ? WHERE id = ?').bind(await sha256(key), me.journal_id).run();
    return json({ recoveryKey: formatCode(key) });
  }

  if (path === '/api/journal' && method === 'DELETE') {
    const id = me.journal_id;
    await db.batch([
      db.prepare('DELETE FROM items WHERE journal_id = ?').bind(id),
      db.prepare('DELETE FROM invites WHERE journal_id = ?').bind(id),
      db.prepare('DELETE FROM devices WHERE journal_id = ?').bind(id),
      db.prepare('DELETE FROM journals WHERE id = ?').bind(id)
    ]);
    return json({ ok: true });
  }

  throw new HttpError(404, 'not_found');
}

// ---------- Проверки ----------
async function auth(req, db) {
  const h = req.headers.get('authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  if (!token || token.length > 100) throw new HttpError(401, 'no_device');
  const me = await db.prepare('SELECT id, journal_id, name, last_seen FROM devices WHERE token_hash = ?').bind(await sha256(token)).first();
  if (!me) throw new HttpError(401, 'no_device');
  const now = Date.now();
  if (now - me.last_seen > 60e3) await db.prepare('UPDATE devices SET last_seen = ? WHERE id = ?').bind(now, me.id).run();
  return me;
}

async function members(db, me) {
  const rows = (await db.prepare('SELECT id, name, created_at, last_seen FROM devices WHERE journal_id = ? ORDER BY created_at').bind(me.journal_id).all()).results;
  return rows.map(r => ({ id: r.id, name: r.name, createdAt: r.created_at, lastSeen: r.last_seen, me: r.id === me.id }));
}

async function readJson(req) {
  const text = await req.text();
  if (text.length > 1_000_000) throw new HttpError(413, 'too_big');
  try { return text ? JSON.parse(text) : {}; } catch { throw new HttpError(400, 'bad_json'); }
}

function cleanName(v) {
  const name = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, 30) : '';
  if (!name) throw new HttpError(400, 'bad_name');
  return name;
}

function cleanChange(c) {
  if (!c || !KINDS.has(c.kind) || typeof c.id !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(c.id) || !Number.isFinite(c.ts)) throw new HttpError(400, 'bad_change');
  if (c.deleted) return { kind: c.kind, id: c.id, data: null, deleted: true, ts: Math.trunc(c.ts) };
  if (!c.data || typeof c.data !== 'object') throw new HttpError(400, 'bad_change');
  const data = JSON.stringify(c.data);
  if (data.length > MAX_DATA) throw new HttpError(413, 'item_too_big');
  return { kind: c.kind, id: c.id, data, deleted: false, ts: Math.trunc(c.ts) };
}

const ip = req => req.headers.get('cf-connecting-ip') || 'local';

// Не больше max попыток данного вида с одного адреса за час
async function limit(db, addr, kind, max) {
  const now = Date.now();
  await db.prepare('DELETE FROM attempts WHERE ts < ?').bind(now - DAY).run();
  const r = await db.prepare('SELECT COUNT(*) AS n FROM attempts WHERE ip = ? AND kind = ? AND ts > ?').bind(addr, kind, now - 3600e3).first();
  if (r.n >= max) throw new HttpError(429, 'slow_down');
  if (kind === 'create') await db.prepare('INSERT INTO attempts (ip, kind, ts) VALUES (?, ?, ?)').bind(addr, kind, now).run();
}

// ---------- Ключи и коды ----------
function randomToken() {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function randomCode(len) {
  let out = '';
  while (out.length < len) {
    for (const v of crypto.getRandomValues(new Uint8Array(len * 2))) {
      if (v < 248) out += CODE_ALPHABET[v % 31]; // 248 = 8 × 31: все символы равновероятны
      if (out.length === len) break;
    }
  }
  return out;
}
const formatCode = c => c.match(/.{1,5}/g).join('-');
const normalizeCode = v => (typeof v === 'string' ? v.toUpperCase().replace(/[^0-9A-Z]/g, '') : '').slice(0, 40);
async function sha256(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map(x => x.toString(16).padStart(2, '0')).join('');
}
