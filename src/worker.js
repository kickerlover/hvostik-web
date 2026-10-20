// Сервер Хвостика: семейные журналы без входа.
// Файлы сайта отдаёт Cloudflare сам, сюда попадают только запросы /api/*.
// Доступ к журналу даёт ключ устройства (заголовок Authorization: Bearer <ключ>). В базе хранится только его хэш.
// Раз в час Cloudflare запускает scheduled(): рассылка напоминаний тем, у кого наступил выбранный час.

import { sendPush, vapidPublicKey, okEndpoint } from './push.js';

const DAY = 864e5;
const INVITE_TTL = 7 * DAY;
const MAX_CHANGES = 200;      // изменений за один запрос
const MAX_ITEMS = 5000;       // записей в одном журнале
const MAX_DATA = 4000;        // размер одной записи, символов
const MAX_PET_DATA = 80000;   // питомец может быть с фото (сжатый JPEG до 70 000 символов)
const PAGE = 1000;            // записей в одном ответе
const KINDS = new Set(['pet', 'record', 'weight']);
const MAX_PLAN = 400;         // напоминаний в плане журнала
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
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(sendReminders(env));
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
  if (path === '/api/push/key' && method === 'GET') return json({ key: vapidPublicKey(env) });

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
    await db.batch([
      db.prepare('DELETE FROM devices WHERE id = ?').bind(me.id),
      db.prepare('DELETE FROM push_subs WHERE device_id = ?').bind(me.id)
    ]);
    return json({ ok: true });
  }

  const devMatch = path.match(/^\/api\/devices\/([0-9a-f-]{36})$/);
  if (devMatch && method === 'DELETE') {
    if (devMatch[1] === me.id) throw new HttpError(400, 'use_leave');
    const r = await db.prepare('DELETE FROM devices WHERE id = ? AND journal_id = ?').bind(devMatch[1], me.journal_id).run();
    if (!r.meta.changes) throw new HttpError(404, 'no_device');
    await db.prepare('DELETE FROM push_subs WHERE device_id = ?').bind(devMatch[1]).run();
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
      db.prepare('DELETE FROM push_subs WHERE journal_id = ?').bind(id),
      db.prepare('DELETE FROM push_plans WHERE journal_id = ?').bind(id),
      db.prepare('DELETE FROM push_log WHERE journal_id = ?').bind(id),
      db.prepare('DELETE FROM journals WHERE id = ?').bind(id)
    ]);
    return json({ ok: true });
  }

  // ---------- Напоминания ----------
  if (path === '/api/push/subscribe' && method === 'POST') {
    const b = await readJson(req);
    const keys = b.keys || {};
    if (!okEndpoint(b.endpoint) || !okKey(keys.p256dh, 87, 88) || !okKey(keys.auth, 22, 24)) throw new HttpError(400, 'bad_subscription');
    const hour = Number.isInteger(b.hour) && b.hour >= 0 && b.hour <= 23 ? b.hour : 10;
    const tz = okTz(b.tz) ? b.tz : 'Europe/Moscow';
    // У устройства одна подписка: прежнюю (если браузер выдал новый адрес) убираем.
    // last_day сохраняем, чтобы смена часа не прислала напоминания второй раз за день.
    const old = await db.prepare('SELECT last_day FROM push_subs WHERE device_id = ? OR endpoint = ?').bind(me.id, b.endpoint).first();
    await db.batch([
      db.prepare('DELETE FROM push_subs WHERE device_id = ? OR endpoint = ?').bind(me.id, b.endpoint),
      db.prepare('INSERT INTO push_subs (endpoint, device_id, journal_id, p256dh, auth, hour, tz, last_day, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(b.endpoint, me.id, me.journal_id, keys.p256dh, keys.auth, hour, tz, old ? old.last_day : '', Date.now())
    ]);
    return json({ ok: true, hour, tz });
  }

  if (path === '/api/push/unsubscribe' && method === 'POST') {
    await db.prepare('DELETE FROM push_subs WHERE device_id = ?').bind(me.id).run();
    return json({ ok: true });
  }

  if (path === '/api/push/test' && method === 'POST') {
    const sub = await db.prepare('SELECT * FROM push_subs WHERE device_id = ?').bind(me.id).first();
    if (!sub) throw new HttpError(404, 'no_subscription');
    const status = await sendPush(sub, { title: 'Пробное уведомление', body: `Напоминания работают. Когда подойдёт срок, пришлём в ${sub.hour}:00.`, tag: 'hvostik-test' }, env);
    if (status === 404 || status === 410) {
      await db.prepare('DELETE FROM push_subs WHERE endpoint = ?').bind(sub.endpoint).run();
      throw new HttpError(410, 'subscription_gone');
    }
    if (status >= 300) { console.error('push test', status); throw new HttpError(502, 'push_failed'); }
    return json({ ok: true });
  }

  if (path === '/api/push/log' && method === 'GET') {
    const rows = (await db.prepare('SELECT day, items, sent_at FROM push_log WHERE journal_id = ? ORDER BY day DESC LIMIT 90').bind(me.journal_id).all()).results;
    return json({ log: rows.map(r => ({ day: r.day, items: JSON.parse(r.items), sentAt: r.sent_at })) });
  }

  if (path === '/api/push/plan' && method === 'POST') {
    const b = await readJson(req);
    if (!Array.isArray(b.items) || b.items.length > MAX_PLAN) throw new HttpError(400, 'bad_plan');
    const items = [];
    for (const it of b.items) {
      if (!it || typeof it.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(it.day) || typeof it.pet !== 'string' || typeof it.text !== 'string') continue;
      const pet = it.pet.trim().slice(0, 40), text = it.text.trim().slice(0, 160);
      if (pet && text) items.push({ day: it.day, pet, text });
    }
    await db.prepare('INSERT INTO push_plans (journal_id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT (journal_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at')
      .bind(me.journal_id, JSON.stringify(items), Date.now()).run();
    return json({ ok: true, count: items.length });
  }

  throw new HttpError(404, 'not_found');
}

// ---------- Рассылка напоминаний (раз в час) ----------
// Каждому устройству — одно уведомление в день, в выбранный час по его часовому поясу.
// Если запуск в нужный час пропал, догоняем в следующие два часа; позже не шлём, чтобы не будить ночью.
async function sendReminders(env) {
  const db = env.DB;
  const now = new Date();
  await db.prepare('DELETE FROM push_log WHERE sent_at < ?').bind(now.getTime() - 90 * DAY).run();
  const subs = (await db.prepare('SELECT s.*, p.data AS plan FROM push_subs s LEFT JOIN push_plans p ON p.journal_id = s.journal_id').all()).results;
  for (const s of subs) {
    const { day, hour } = localTime(now, s.tz);
    if (s.last_day === day || hour < s.hour || hour > s.hour + 2) continue;
    await db.prepare('UPDATE push_subs SET last_day = ? WHERE endpoint = ?').bind(day, s.endpoint).run();
    let plan = [];
    try { plan = JSON.parse(s.plan || '[]'); } catch { /* испорченный план — просто пропускаем */ }
    const items = plan.filter(it => it.day === day);
    if (!items.length) continue;
    try {
      const status = await sendPush(s, reminderMessage(items, day), env);
      if (status < 300) {
        await db.prepare('INSERT OR IGNORE INTO push_log (journal_id, day, items, sent_at) VALUES (?, ?, ?, ?)')
          .bind(s.journal_id, day, JSON.stringify(items.map(it => ({ pet: it.pet, text: it.text }))), Date.now()).run();
      }
      if (status === 404 || status === 410) await db.prepare('DELETE FROM push_subs WHERE endpoint = ?').bind(s.endpoint).run();
      else if (status >= 300) console.error('push', status, new URL(s.endpoint).hostname);
    } catch (e) {
      console.error('push', e);
    }
  }
}

// Одно дело — кличка в заголовке; несколько — списком.
// Название приложения в заголовок не ставим: iPhone сам подписывает «from Хвостик».
function reminderMessage(items, day) {
  if (items.length === 1) return { title: items[0].pet, body: items[0].text, tag: 'hvostik-' + day };
  const lines = items.slice(0, 4).map(it => `${it.pet}: ${it.text}`);
  if (items.length > 4) lines.push(`И ещё ${items.length - 4}`);
  return { title: `Дела на сегодня: ${items.length}`, body: lines.join('\n'), tag: 'hvostik-' + day };
}

// Дата и час в часовом поясе устройства
function localTime(date, tz) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
    .formatToParts(date).map(p => [p.type, p.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}
function okTz(tz) {
  if (typeof tz !== 'string' || tz.length > 60) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; }
}
const okKey = (v, min, max) => typeof v === 'string' && v.length >= min && v.length <= max && /^[A-Za-z0-9_-]+=*$/.test(v);

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
  if (data.length > (c.kind === 'pet' ? MAX_PET_DATA : MAX_DATA)) throw new HttpError(413, 'item_too_big');
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
