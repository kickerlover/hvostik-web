// Хвостик: журнал здоровья для собак и кошек.
// Данные лежат в браузере (localStorage) и синхронизируются с семейным журналом на сервере (/api).
// Входа нет: устройство получает секретный ключ журнала, второй владелец подключается по приглашению.

const STORE_KEY = 'hvostik:data:v1';
const SYNC_KEY = 'hvostik:sync:v1';
const THEME_KEY = 'hvostik:theme'; // тёмной темы больше нет, ключ стирается при запуске
const APP_VERSION = '1.9.6';

// ---------- Даты ----------
const DAY = 864e5;
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseIso = s => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d, 12); };
const isIso = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(parseIso(s).getTime());
const todayDate = () => { const d = new Date(); d.setHours(12, 0, 0, 0); return d; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const addMonths = (d, n) => { const x = new Date(d); const day = x.getDate(); x.setDate(1); x.setMonth(x.getMonth() + n); const last = new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate(); x.setDate(Math.min(day, last)); return x; };
const diffDays = (a, b) => Math.round((a - b) / DAY);
let T = todayDate();

const MON = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const MON1 = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const MONF = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const WD = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
const WDS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const fmt = d => `${d.getDate()} ${MON[d.getMonth()]}`;
const fmtWd = d => `${WDS[d.getDay()]}, ${fmtFull(d)}`;
const fmtFull = d => `${d.getDate()} ${MONF[d.getMonth()]}${d.getFullYear() !== T.getFullYear() ? ' ' + d.getFullYear() : ''}`;

// ---------- Слова ----------
const plural = (n, a, b, c) => { n = Math.abs(n) % 100; const n1 = n % 10; if (n > 10 && n < 20) return c; if (n1 > 1 && n1 < 5) return b; if (n1 === 1) return a; return c; };
const dayWord = n => plural(n, 'день', 'дня', 'дней');
const petsWord = n => `${n} ${plural(n, 'питомец', 'питомца', 'питомцев')}`;
const kg = v => (Math.round(v * 10) / 10).toFixed(1).replace('.', ',');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const every = m => m === 1 ? 'раз в месяц' : m === 12 ? 'раз в год' : `раз в ${m} ${plural(m, 'месяц', 'месяца', 'месяцев')}`;
const age = birth => {
  if (!birth) return '';
  const b = parseIso(birth);
  let m = (T.getFullYear() - b.getFullYear()) * 12 + T.getMonth() - b.getMonth();
  if (T.getDate() < b.getDate()) m--;
  if (m < 0) return '';
  const y = Math.floor(m / 12), mm = m % 12;
  return [y ? `${y} ${plural(y, 'год', 'года', 'лет')}` : '', mm ? `${mm} мес` : ''].filter(Boolean).join(' ') || 'меньше месяца';
};
const KIND = { dog: 'Собака', cat: 'Кошка', other: 'Питомец' };
// Виды записей. Срок по умолчанию — только стартовое значение в форме, хозяин выбирает его сам.
const TYPES = {
  treatment: { tab: 'Обработки', one: 'Обработка', acc: 'обработку', ask: 'От чего обработка', ph: 'Например, клещи и блохи', err: 'Напишите, от чего обработка.', months: 3, suggest: ['Клещи и блохи', 'Глисты', 'Блохи'] },
  vaccine: { tab: 'Прививки', one: 'Прививка', acc: 'прививку', ask: 'Какая прививка', ph: 'Например, бешенство', err: 'Напишите, какая это прививка.', months: 12, suggest: ['Комплексная прививка', 'Бешенство'] },
  visit: { tab: 'Врач', one: 'Врач', acc: 'визит к врачу', ask: 'Зачем ходили к врачу', ph: 'Например, осмотр', err: 'Напишите, зачем ходили к врачу.', months: 0, suggest: ['Осмотр', 'Анализы', 'Лечение'], notePh: 'Например, клиника' },
  groom: { tab: 'Уход', one: 'Уход', acc: 'уход', ask: 'Что сделали', ph: 'Например, стрижка когтей', err: 'Напишите, что сделали.', months: 1, suggest: ['Стрижка когтей', 'Груминг', 'Чистка зубов', 'Чистка ушей'] },
  course: { tab: 'Лекарства', one: 'Лекарства', acc: 'курс лекарств', ask: 'Какое лекарство', ph: 'Например, Отипакс', err: 'Напишите название лекарства.', months: 0, suggest: [], noteLabel: 'Как давать', notePh: 'Например, 3 капли в правое ухо' }
};
// Как повторяется дело: «раз в 3 месяца» или «повторный приём»
// Интервал напоминания: в месяцах (months) или в днях (repDays — для «своего» интервала в днях и неделях)
const everyDays = d => d % 7 === 0 ? (d === 7 ? 'раз в неделю' : `раз в ${d / 7} ${plural(d / 7, 'неделю', 'недели', 'недель')}`) : d === 1 ? 'каждый день' : `раз в ${d} ${plural(d, 'день', 'дня', 'дней')}`;
const everyRec = r => (r.repDays ? everyDays(r.repDays) : r.months ? every(r.months) : '');
const nextByRep = (from, r) => (r.repDays ? addDays(from, r.repDays) : addMonths(from, r.months));
const hasRep = r => r.months > 0 || r.repDays > 0;
const REP_MAX = { d: 730, w: 104, m: 36 };
// Как повторяется дело: «раз в 3 месяца», «раз в 2 недели» или «повторный приём»
const repeatText = r => (hasRep(r) ? everyRec(r) : r.nextDate ? 'повторный приём' : '');
const money = v => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(v) + ' ₽';
const STERILE = { yes: 'да', no: 'нет' };

// Пастельный цвет питомца и его насыщенная пара для точек на графиках
const PET_COLORS = [
  { bg: '#F6B27A', strong: '#E07A2C', name: 'Персиковый' },
  { bg: '#B9CFFF', strong: '#4F7BDB', name: 'Голубой' },
  { bg: '#B7E4C7', strong: '#2F8F5B', name: 'Мятный' },
  { bg: '#F5B8D0', strong: '#C9497E', name: 'Розовый' },
  { bg: '#FFE08A', strong: '#B8860B', name: 'Жёлтый' }
];
const petColor = p => PET_COLORS[p.color] || PET_COLORS[0];

// ---------- Данные в браузере ----------
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const emptyData = () => ({ version: 1, demo: false, pets: [], records: [], weights: [] });
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const okId = v => typeof v === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(v);
const okTs = v => (Number.isFinite(v) ? v : 0);
// Фото питомца: маленький квадратный JPEG прямо в записи (data:-ссылка), чтобы храниться и синхронизироваться вместе с ней
const PHOTO_MAX = 70000;
const okPhoto = v => typeof v === 'string' && v.length <= PHOTO_MAX && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(v);

// Курс лекарств: сколько дней, сколько раз в день, отметки приёма по дням, досрочное окончание
const cleanCourse = r => {
  const days = Number.isInteger(r.days) && r.days >= 1 && r.days <= 120 ? r.days : 7;
  const perDay = Number.isInteger(r.perDay) && r.perDay >= 1 && r.perDay <= 6 ? r.perDay : 1;
  const marks = {};
  if (r.marks && typeof r.marks === 'object') for (const [k, n] of Object.entries(r.marks).slice(0, 150)) if (isIso(k) && Number.isInteger(n) && n > 0) marks[k] = Math.min(n, perDay);
  return { days, perDay, marks, stopped: isIso(r.stopped) ? r.stopped : '' };
};
// Чистка одной записи: из браузера, файла копии или с сервера. Битая запись → null.
const CLEAN = {
  pet: p => (p && okId(p.id) && str(p.name, 40) ? {
    id: p.id, name: str(p.name, 40), kind: KIND[p.kind] ? p.kind : 'other', breed: str(p.breed, 60),
    birth: isIso(p.birth) ? p.birth : '', color: Number.isInteger(p.color) && PET_COLORS[p.color] ? p.color : 0, photo: okPhoto(p.photo) ? p.photo : '',
    chip: str(p.chip, 40), sterile: STERILE[p.sterile] ? p.sterile : '', allergy: str(p.allergy, 200), ts: okTs(p.ts)
  } : null),
  record: r => (r && okId(r.id) && okId(r.pet) && TYPES[r.type] && str(r.title, 80) && isIso(r.date) ? {
    id: r.id, pet: r.pet, type: r.type, title: str(r.title, 80), date: r.date,
    months: Number.isInteger(r.months) && r.months >= 0 && r.months <= 36 ? r.months : 0,
    repDays: Number.isInteger(r.repDays) && r.repDays >= 1 && r.repDays <= 730 ? r.repDays : 0,
    note: str(r.note, 300), concl: str(r.concl, 1500), meds: str(r.meds, 1500), nextDate: isIso(r.nextDate) ? r.nextDate : '', cost: Number.isFinite(r.cost) && r.cost > 0 && r.cost < 1e7 ? Math.round(r.cost * 100) / 100 : 0, by: str(r.by, 30), snooze: isIso(r.snooze) ? r.snooze : null, created: okTs(r.created), ts: okTs(r.ts),
    ...(r.type === 'course' ? cleanCourse(r) : {})
  } : null),
  weight: w => (w && okId(w.id) && okId(w.pet) && isIso(w.date) && Number.isFinite(w.kg) && w.kg > 0 && w.kg < 200 ? { id: w.id, pet: w.pet, date: w.date, kg: w.kg, ts: okTs(w.ts) } : null)
};
const LIST = { pet: 'pets', record: 'records', weight: 'weights' };

function normalize(d) {
  if (!d || typeof d !== 'object' || !Array.isArray(d.pets)) throw new Error('not hvostik data');
  const pets = d.pets.map(CLEAN.pet).filter(Boolean);
  const ids = new Set(pets.map(p => p.id));
  const records = (Array.isArray(d.records) ? d.records : []).map(CLEAN.record).filter(r => r && ids.has(r.pet));
  const weights = (Array.isArray(d.weights) ? d.weights : []).map(CLEAN.weight).filter(w => w && ids.has(w.pet));
  return { version: 1, demo: d.demo === true, pets, records, weights };
}

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? normalize(JSON.parse(raw)) : emptyData();
  } catch (e) {
    return emptyData();
  }
}
let db = load();

function loadMeta() {
  try {
    const m = JSON.parse(localStorage.getItem(SYNC_KEY) || 'null');
    if (!m || typeof m.token !== 'string') return null;
    return { cursor: 0, pending: {}, members: [], name: '', recoveryKey: null, setupDone: true, ...m };
  } catch (e) {
    return null;
  }
}
let meta = loadMeta();

// Записать данные и состояние синхронизации в браузер
function persist() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(db));
    if (meta) localStorage.setItem(SYNC_KEY, JSON.stringify(meta)); else localStorage.removeItem(SYNC_KEY);
    return true;
  } catch (e) {
    toast('Не получилось сохранить. Возможно, браузер в режиме инкогнито или память заполнена.');
    return false;
  }
}
// Записать и отправить изменения на сервер
function save() {
  const ok = persist();
  scheduleSync();
  return ok;
}
// Пометить запись изменённой (уйдёт на сервер) или удалённой
function touch(kind, ent) {
  ent.ts = Date.now();
  if (meta) meta.pending[kind + ':' + ent.id] = { ts: ent.ts, deleted: false };
}
function tombstone(kind, id) {
  if (meta) meta.pending[kind + ':' + id] = { ts: Date.now(), deleted: true };
}
const myName = () => (meta && meta.name) || '';

// Пример с Рексом и Муркой, даты считаются от сегодняшнего дня. На сервер не отправляется.
function demoData() {
  const d = emptyData();
  d.demo = true;
  const rex = { id: uid(), name: 'Рекс', kind: 'dog', breed: 'Бигль', birth: iso(addMonths(T, -53)), color: 0, chip: '643094100212345', sterile: 'no', allergy: 'Курица в корме', ts: 0 };
  const mura = { id: uid(), name: 'Мурка', kind: 'cat', breed: 'Британская', birth: iso(addMonths(T, -74)), color: 1, sterile: 'yes', ts: 0 };
  d.pets.push(rex, mura);
  const rec = (pet, type, title, date, months, note = '', cost = 0) => d.records.push({ id: uid(), pet: pet.id, type, title, date: iso(date), months, note, cost, by: '', snooze: null, created: Date.now(), ts: 0 });
  rec(rex, 'vaccine', 'Комплексная прививка', addDays(addMonths(T, -12), 12), 12, '', 1800);
  rec(rex, 'vaccine', 'Бешенство', addDays(addMonths(T, -12), 40), 12);
  rec(rex, 'treatment', 'Клещи и блохи', addDays(T, -64), 1, 'Капли на холку');
  rec(rex, 'treatment', 'Клещи и блохи', addDays(T, -34), 1, 'Капли на холку', 650);
  rec(rex, 'visit', 'Осмотр', addDays(T, -120), 0, 'Всё хорошо, зубы в порядке', 1500);
  rec(rex, 'groom', 'Стрижка когтей', addDays(T, -25), 1, '', 400);
  rec(rex, 'treatment', 'Глисты', addDays(T, -80), 3, 'Таблетка');
  rec(mura, 'vaccine', 'Комплексная прививка', addDays(addMonths(T, -12), 75), 12);
  rec(mura, 'treatment', 'Глисты', addDays(T, -150), 6, 'Таблетка');
  rec(mura, 'treatment', 'Блохи', addDays(T, -82), 3, 'Капли на холку', 550);
  rec(mura, 'groom', 'Чистка ушей', addDays(T, -40), 2);
  const bub = { id: uid(), name: 'Бублик', kind: 'dog', breed: 'Такса', birth: iso(addMonths(T, -14)), color: 2, ts: 0 };
  d.pets.push(bub);
  rec(bub, 'vaccine', 'Комплексная прививка', addDays(addMonths(T, -12), 12), 12, '', 1700);
  d.records.push({ id: uid(), pet: bub.id, type: 'visit', title: 'Чешет ухо', date: iso(addDays(T, -3)), months: 0, note: '', cost: 1500, concl: 'Наружный отит правого уха.', meds: 'Отипакс по 3 капли в правое ухо 2 раза в день, 7 дней.', nextDate: iso(addDays(T, 10)), by: '', snooze: null, created: Date.now(), ts: 0 });
  d.records.push({ id: uid(), pet: bub.id, type: 'course', title: 'Отипакс', date: iso(addDays(T, -3)), months: 0, note: '3 капли в правое ухо', cost: 0, days: 7, perDay: 2, marks: { [iso(addDays(T, -3))]: 2, [iso(addDays(T, -2))]: 2, [iso(addDays(T, -1))]: 2, [iso(T)]: 1 }, stopped: '', by: '', snooze: null, created: Date.now(), ts: 0 });
  [7.1, 7.4, 7.6, 7.8].forEach((v, i, a) => d.weights.push({ id: uid(), pet: bub.id, date: iso(addDays(addMonths(T, -(a.length - 1 - i)), -5)), kg: v, ts: 0 }));
  [11.2, 11.5, 11.4, 11.8, 12.1, 12.0, 12.4, 12.6].forEach((v, i, a) => d.weights.push({ id: uid(), pet: rex.id, date: iso(addDays(addMonths(T, -(a.length - 1 - i)), -3)), kg: v, ts: 0 }));
  [4.6, 4.7, 4.9, 5.0, 5.2, 5.1, 5.3].forEach((v, i, a) => d.weights.push({ id: uid(), pet: mura.id, date: iso(addDays(addMonths(T, -(a.length - 1 - i)), -9)), kg: v, ts: 0 }));
  return d;
}

// ---------- Сервер ----------
async function api(method, path, body, token = meta && meta.token) {
  let res;
  try {
    res = await fetch(path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  } catch (e) {
    const err = new Error('offline'); err.status = 0; throw err;
  }
  let data = {};
  try { data = await res.json(); } catch (e) { /* пустой ответ */ }
  if (!res.ok) { const err = new Error(data.error || 'http'); err.status = res.status; err.code = data.error; throw err; }
  return data;
}

function defaultDeviceName() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Mac/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Компьютер';
  return 'Устройство';
}

// Журнал заводится сам, когда появляется первый свой (не пример) питомец
async function ensureJournal() {
  if (meta) return true;
  if (db.demo || !db.pets.length) return false;
  const r = await api('POST', '/api/journal', { name: defaultDeviceName() });
  meta = { token: r.token, deviceId: r.deviceId, name: r.name, recoveryKey: r.recoveryKey, setupDone: false, cursor: 0, pending: {}, members: [] };
  for (const [kind, list] of Object.entries(LIST)) {
    for (const e of db[list]) { if (!e.ts) e.ts = Date.now(); meta.pending[kind + ':' + e.id] = { ts: e.ts, deleted: false }; }
  }
  persist();
  return true;
}

// Состояние синхронизации: idle | syncing | ok | offline | error
let syncStatus = 'idle', syncedAt = 0, syncing = false, syncAgain = false, syncTimer = null;
function setSync(s) {
  syncStatus = s;
  if (s === 'ok') syncedAt = Date.now();
  document.querySelectorAll('[data-sync-status]').forEach(el => { el.textContent = syncText(); el.dataset.state = syncStatus; });
}
function syncText() {
  if (!meta) return '';
  const waiting = Object.keys(meta.pending).length;
  if (syncStatus === 'offline') return waiting ? 'Нет связи · сохранится позже' : 'Нет связи';
  if (syncStatus === 'error') return 'Не удалось сохранить · повторим';
  if (syncStatus === 'syncing') return 'Сохраняем…';
  if (waiting) return 'Ждёт отправки';
  return 'Сохранено';
}
function scheduleSync(delay = 600) {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(sync, delay);
}

async function sync() {
  if (syncing) { syncAgain = true; return; }
  if (!meta && (db.demo || !db.pets.length)) return;
  if (navigator.onLine === false) { setSync('offline'); return; }
  syncing = true;
  let changed = false;
  try {
    if (!(await ensureJournal())) return;
    setSync('syncing');
    for (let round = 0; round < 50; round++) {
      // В одной пачке не больше 200 изменений и примерно 700 КБ (питомцы с фото тяжелее остальных записей)
      const keys = [], changes = [], sent = {};
      let size = 0;
      for (const k of Object.keys(meta.pending)) {
        const p = meta.pending[k];
        const [kind, id] = k.split(':');
        const ent = p.deleted ? null : db[LIST[kind]].find(e => e.id === id);
        const c = ent ? { kind, id, ts: p.ts, data: ent } : { kind, id, ts: p.ts, deleted: true };
        const len = JSON.stringify(c).length;
        if (keys.length && (keys.length >= 200 || size + len > 700000)) break;
        keys.push(k); changes.push(c); sent[k] = p.ts; size += len;
      }
      const res = await api('POST', '/api/sync', { since: meta.cursor, changes });
      for (const k of keys) if (meta.pending[k] && meta.pending[k].ts === sent[k]) delete meta.pending[k];
      if (applyRemote(res.items)) changed = true;
      meta.cursor = res.cursor;
      meta.members = res.members;
      meta.name = res.me.name;
      persist();
      if (!res.more && !Object.keys(meta.pending).length) break;
    }
    setSync('ok');
  } catch (e) {
    if (e.status === 401 && meta) { revoked(); changed = true; }
    else setSync(e.status ? 'error' : 'offline');
  } finally {
    syncing = false;
    if (changed) safeRender();
    if (syncAgain) { syncAgain = false; scheduleSync(100); }
  }
}

// Применить изменения с сервера. Более позднее изменение побеждает.
function applyRemote(items) {
  let changed = false;
  for (const it of items || []) {
    const list = LIST[it.kind];
    if (!list) continue;
    const k = it.kind + ':' + it.id;
    const p = meta.pending[k];
    if (p && p.ts > it.ts) continue; // своё изменение новее — оно уйдёт на сервер
    if (p) delete meta.pending[k];
    const arr = db[list], i = arr.findIndex(e => e.id === it.id);
    if (it.deleted) {
      if (i >= 0) { arr.splice(i, 1); changed = true; }
      continue;
    }
    const clean = CLEAN[it.kind]({ ...it.data, id: it.id, ts: it.ts });
    if (!clean) continue;
    if (i < 0) { arr.push(clean); changed = true; }
    else if (JSON.stringify(arr[i]) !== JSON.stringify(clean)) { arr[i] = clean; changed = true; }
  }
  if (changed) db.demo = false;
  return changed;
}

// Устройство отключили или журнал удалили: локальные записи стираются, у остальных они остаются
function revoked() {
  meta = null;
  db = emptyData();
  persist();
  closeSheet();
  toast('Это устройство отключили от семейного журнала. У остальных участников записи остались.');
}

// Перерисовать, только если человек сейчас ничего не заполняет
function safeRender() {
  const r = currentRoute();
  if (['pet-new', 'pet-edit', 'join'].includes(r.name)) return;
  const a = document.activeElement;
  if (a && main.contains(a) && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) return;
  render();
}

// ---------- Расчёт сроков ----------
const petById = id => db.pets.find(p => p.id === id);
const petWeights = id => db.weights.filter(w => w.pet === id).sort((a, b) => a.date.localeCompare(b.date));

// Для каждой процедуры питомца берётся последняя запись; следующий срок = дата + интервал,
// или дата переноса, если нажали «Завтра»
function upcoming({ pet, type } = {}) {
  const latest = new Map();
  for (const r of db.records) {
    if (!petById(r.pet)) continue;
    if (pet && r.pet !== pet) continue;
    if (type && r.type !== type) continue;
    const k = r.type === 'visit' ? r.pet + '|visit' : r.pet + '|' + r.type + '|' + r.title.toLowerCase();
    const cur = latest.get(k);
    if (!cur || r.date > cur.date || (r.date === cur.date && r.created > cur.created)) latest.set(k, r);
  }
  return [...latest.values()].filter(r => hasRep(r) || r.nextDate).map(r => {
    const last = parseIso(r.date);
    const planned = r.nextDate ? parseIso(r.nextDate) : nextByRep(last, r);
    const snoozed = r.snooze ? parseIso(r.snooze) : null;
    const next = snoozed && snoozed > planned ? snoozed : planned;
    const d = diffDays(next, T);
    const pct = Math.min(1, Math.max(0, diffDays(T, last) / Math.max(1, diffDays(next, last))));
    return { ...r, next, d, pct, moved: next !== planned, status: d <= 0 ? 'hot' : d <= 14 ? 'soon' : 'later' };
  }).sort((a, b) => a.d - b.d);
}

// ---------- Мелкие части интерфейса ----------
// Кружок питомца: фото, а если его нет — первая буква клички на цвете питомца
const avatar = (p, size) => okPhoto(p.photo)
  ? `<span class="avatar photo" style="background-image:url(${p.photo});width:${size}px;height:${size}px" aria-hidden="true"></span>`
  : `<span class="avatar" style="background:${petColor(p).bg};width:${size}px;height:${size}px;font-size:${Math.round(size * 0.45)}px" aria-hidden="true">${esc((p.name || '?')[0].toUpperCase())}</span>`;
const personAvatar = (name, size, mine) => `<span class="avatar" style="background:${mine ? 'var(--lime)' : 'var(--divider)'};width:${size}px;height:${size}px;font-size:${Math.round(size * 0.38)}px" aria-hidden="true">${esc((name || '?')[0].toUpperCase())}</span>`;
// Срок крупной цифрой: «12 дн.», просрочка со знаком минус
const numHtml = (d, cls = '') => `<span class="num ${cls}">${d < 0 ? '−' + -d : d}<small> дн.</small></span>`;
const ICONS = {
  check: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  back: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  edit: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20l4-1 11-11-3-3L5 16z"/></svg>',
  trash: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>',
  vaccine: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 3l3 3M16 5l3 3M14 7l-8 8-2 5 5-2 8-8z"/></svg>',
  treatment: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 3c3 4 5 7 5 10a5 5 0 0 1-10 0c0-3 2-6 5-10z"/></svg>',
  weight: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="3" y="5" width="18" height="15" rx="3"/><path d="M8 11a4 4 0 0 1 8 0M12 11l2-2"/></svg>',
  chev: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
  camera: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>'
};
const syncLine = () => (meta ? `<span class="sync" data-sync-status data-state="${syncStatus}">${esc(syncText())}</span>` : '');

const deltaText = ws => {
  if (ws.length < 2) return ws.length ? 'для графика нужно ещё одно взвешивание' : 'вес ещё не записан';
  const d = ws.at(-1).kg - ws[0].kg, m = Math.max(1, Math.round(diffDays(parseIso(ws.at(-1).date), parseIso(ws[0].date)) / 30.4));
  return `${d >= 0 ? '+' : '−'}${kg(Math.abs(d))} кг за ${m} мес`;
};

// Просроченное дело: салатовая карточка, сколько дней просрочено — огромной цифрой
function hotCard(u, showPet) {
  const p = petById(u.pet), n = -u.d;
  const sub = [u.note, repeatText(u)].filter(Boolean).join(', ');
  return `<div class="hot">
    <div class="hot-top"><span class="tag">${n === 0 ? 'Срок сегодня' : 'Просрочено'}${u.moved ? ' · перенесено' : ''}</span>${showPet ? `<span class="hot-pet">${avatar(p, 24)}${esc(p.name)}</span>` : ''}</div>
    <div class="hot-num"><b>${n}</b><span>${dayWord(n)}</span></div>
    <div class="grow" style="gap:1px"><span class="title">${esc(u.title)}</span>${sub ? `<span class="sub">${esc(sub)}</span>` : ''}</div>
    <div class="hot-actions"><button class="btn-dark" data-act="done" data-id="${u.id}">Готово</button><button class="btn-light" data-act="snooze" data-id="${u.id}">Завтра</button></div>
  </div>`;
}
// Ближайшее дело: строка с крупной цифрой дней
// brief — для карточки на главной: только дата, без «раз в N месяцев»
function itemRow(u, showPet, brief) {
  const p = petById(u.pet);
  const sub = showPet ? `${p.name} · ${fmtWd(u.next)}` : brief ? fmtWd(u.next) : [fmtWd(u.next), repeatText(u)].filter(Boolean).join(' · ');
  return `<div class="nrow">
    ${numHtml(u.d)}
    <span class="grow" style="gap:1px"><span class="title">${esc(u.title)}</span><span class="small">${esc(sub)}</span></span>
    <button class="btn-check" data-act="done" data-id="${u.id}" aria-label="Отметить: ${esc(u.title)}, сделано" title="Отметить сделанным">${ICONS.check}</button>
  </div>`;
}

// Карточка после создания журнала: как подписывать и ключ восстановления
function setupCard() {
  if (!meta || meta.setupDone) return '';
  const nameVal = meta.name === defaultDeviceName() ? '' : meta.name;
  return `<form class="card pad stack" id="setup-form" novalidate>
    <span class="title">Ваши записи сохраняются на сервере</span>
    <p class="para small">Теперь журнал можно открыть на другом устройстве и вести вместе с семьёй — раздел «Семья».</p>
    <div class="field"><label for="setup-name">Как вас подписывать в журнале</label><input id="setup-name" type="text" maxlength="30" autocomplete="given-name" placeholder="Например, Даня" value="${esc(nameVal)}"></div>
    ${meta.recoveryKey ? `<div class="field"><span class="lbl">Ключ восстановления</span>
      <code class="key">${esc(meta.recoveryKey)}</code>
      <p class="para small">Сохраните его, например в заметках. Если потеряете телефон, по этому ключу журнал откроется на новом устройстве. Без ключа и без второго подключённого устройства доступ к записям пропадёт.</p>
      <div class="row-btns"><button type="button" class="btn-light outline" data-act="copy" data-v="${esc(meta.recoveryKey)}">Скопировать ключ</button></div></div>` : ''}
    <button class="btn-primary" type="submit">Готово</button>
  </form>`;
}

// ---------- Экраны ----------
const state = { seg: 'treatment', segPet: null };

function viewWelcome() {
  return `<header class="top"><span class="eyebrow">${WD[T.getDay()]}, ${fmtFull(T)}</span><h1 class="h1">Привет! Это Хвостик</h1></header>
    <div class="card pad stack">
      <p class="para">Хвостик помнит, когда пора делать прививку или обработку от клещей и глистов, и показывает, как меняется вес питомца.</p>
      <p class="para small">Входить не нужно: записи сохраняются в вашем журнале на сервере Хвостика, а вести его можно вместе с семьёй.</p>
      <div class="row-btns"><a class="btn-dark" href="#/pets/new">Добавить питомца</a>${meta ? '' : '<button class="btn-light outline" data-act="demo">Посмотреть на примере</button>'}</div>
      ${meta ? '' : '<a class="small link" href="#/join">У меня есть приглашение от семьи</a>'}
    </div>`;
}

// ---------- Курс лекарств ----------
// Запись вида «course»: лекарство (title), начало (date), сколько дней (days), сколько раз в день (perDay),
// как давать (note), отметки приёма по дням (marks: { '2026-10-18': 2 }), досрочное окончание (stopped).
const timesText = n => `${n} ${plural(n, 'раз', 'раза', 'раз')} в день`;
function courseInfo(c) {
  const start = parseIso(c.date), end = addDays(start, c.days - 1);
  const dayNo = diffDays(T, start) + 1;
  const stopped = !!c.stopped;
  const active = !stopped && dayNo >= 1 && dayNo <= c.days;
  const future = !stopped && dayNo < 1;
  const today = (c.marks || {})[iso(T)] || 0;
  const fullDays = Object.values(c.marks || {}).filter(n => n >= c.perDay).length;
  return { start, end, dayNo, active, future, finished: !active && !future, today, fullDays, pct: Math.min(1, Math.max(0, dayNo / c.days)) };
}
const petCourses = pet => db.records.filter(r => r.type === 'course' && r.pet === pet).sort((a, b) => b.date.localeCompare(a.date));
const activeCourses = pet => petCourses(pet).filter(c => courseInfo(c).active);

// Полоска курса: лекарство, день из скольких, сколько приёмов сегодня; кнопка отмечает приём
function courseRow(c) {
  const ci = courseInfo(c), all = ci.today >= c.perDay;
  return `<div class="pc-course">
    <div class="pc-cline"><span class="grow" style="gap:0"><span class="title">${esc(c.title)}, ${timesText(c.perDay)}</span><span class="pc-sub">день ${ci.dayNo} из ${c.days} · сегодня ${ci.today} из ${c.perDay}</span></span>
      <button type="button" class="take" data-act="take" data-id="${c.id}" ${all ? "disabled" : ""} aria-label="Отметить приём: ${esc(c.title)}">${all ? "Всё принято" : "Отметить"}</button></div>
    <div class="cbar" role="img" aria-label="Курс: день ${ci.dayNo} из ${c.days}"><i style="width:${Math.round(ci.pct * 100)}%"></i></div>
  </div>`;
}

// ---------- Главная: все питомцы на одном экране ----------
// Цвет карточки — состояние питомца: просрочено (салатовая), идёт лечение (зелёная), всё вовремя (белая)
const STATUS = { hot: 'Нужно внимание', treat: 'Идёт лечение', ok: 'Всё вовремя' };
function petCard(p) {
  const list = upcoming({ pet: p.id }), next = list[0];
  const courses = activeCourses(p.id);
  const status = list.some(u => u.status === 'hot') ? 'hot' : courses.length ? 'treat' : 'ok';
  const w = petWeights(p.id).at(-1);
  const metaLine = [p.breed || KIND[p.kind], age(p.birth), w ? kg(w.kg) + ' кг' : ''].filter(Boolean).join(' · ');
  // при лечении строку ближайшего дела не показываем: его дни видны на плашке справа, а место нужно под курс
  const nextText = courses.length && status !== 'hot' ? '' : !next ? 'Прививок и обработок пока нет — добавьте последнюю'
    : `${next.title} — ${next.d < 0 ? 'пора сделать' : next.d === 0 ? 'сегодня' : fmtWd(next.next)}`;
  // Метки: аллергия, последний визит к врачу, повторный приём, стерилизация
  const visits = db.records.filter(r => r.pet === p.id && r.type === 'visit').sort((a, b) => b.date.localeCompare(a.date));
  const lastVisit = visits[0];
  const short = lastVisit && lastVisit.concl ? lastVisit.concl.split(/[.,;\n]/)[0].trim().slice(0, 20) : '';
  const tags = [
    p.allergy ? `<span class="tag-b warn">Аллергия: ${esc(p.allergy.slice(0, 30))}</span>` : '',
    lastVisit ? `<span class="tag-b">Врач: ${fmt(parseIso(lastVisit.date))}${short ? ', ' + esc(short.charAt(0).toLowerCase() + short.slice(1)) : ''}</span>` : '',
    lastVisit && lastVisit.nextDate && parseIso(lastVisit.nextDate) > T ? `<span class="tag-b">Повторный приём ${fmt(parseIso(lastVisit.nextDate))}</span>` : '',
    p.sterile === 'yes' ? '<span class="tag-b">Стерилизация: да</span>' : ''
  ].filter(Boolean).join('');
  return `<article class="pcard s-${status}">
    <div class="pc-head">${avatar(p, 76)}<div class="grow" style="gap:1px"><span class="pc-status">${STATUS[status]}</span><a class="pc-name" href="#/pet/${p.id}">${esc(p.name)}</a><span class="pc-sub">${esc(metaLine)}</span></div>
      ${next ? `<div class="pc-days"><b>${next.d < 0 ? '−' + -next.d : next.d}</b><span>дн.</span></div>` : ''}</div>
    ${nextText ? `<span class="pc-next">${esc(nextText)}</span>` : ''}
    ${courses.map(courseRow).join('')}
    ${tags ? `<div class="pc-tags">${tags}</div>` : ''}
  </article>`;
}

function viewFeed() {
  if (!db.pets.length) return viewWelcome();
  const hot = upcoming().filter(u => u.status === 'hot').length;
  return `${db.demo ? '<div class="banner"><span>Это пример с Рексом, Муркой и Бубликом. Он не сохраняется на сервере.</span><button class="btn-light outline" style="height:38px" data-act="clear-demo">Убрать пример</button></div>' : ""}
    <header class="head"><div class="top"><span class="eyebrow">${WD[T.getDay()]}, ${fmtFull(T)}</span><h1 class="h1">Мои питомцы</h1>${syncLine()}</div>
      <span class="count">${hot ? `${hot} ${plural(hot, "просрочено", "просрочено", "просрочено")}` : "Всё вовремя"}</span></header>
    ${setupCard()}
    <div class="pet-list">${db.pets.map(petCard).join("")}</div>
    <a class="add-more" href="#/pets/new"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>Новый питомец</a>`;
}

// Курсы в карточке питомца (раздел «Лекарства»): текущие подробно, с отметками по дням
function courseCard(c) {
  const ci = courseInfo(c), all = ci.today >= c.perDay;
  const days = Array.from({ length: c.days }, (_, i) => {
    const d = iso(addDays(ci.start, i)), n = (c.marks || {})[d] || 0;
    const cls = n >= c.perDay ? 'full' : n > 0 ? 'part' : d < iso(T) ? 'miss' : d === iso(T) ? 'today' : '';
    return `<span class="cday ${cls}" title="${fmtFull(parseIso(d))}: ${n} из ${c.perDay}"></span>`;
  }).join('');
  return `<div class="card pad stack course-card">
    <div class="meta"><span class="title" style="font-size:17px">${esc(c.title)}</span><span class="pill">${ci.future ? 'начнётся ' + fmt(ci.start) : `день ${ci.dayNo} из ${c.days}`}</span></div>
    <span class="small">${esc([timesText(c.perDay), c.note, `${fmt(ci.start)} — ${fmt(ci.end)}`].filter(Boolean).join(' · '))}</span>
    <div class="cdays" role="img" aria-label="Отмечено полностью ${ci.fullDays} из ${c.days} дней">${days}</div>
    ${ci.active ? `<div class="row-btns" style="align-items:center"><span class="small">Сегодня ${ci.today} из ${c.perDay}</span>
      <button class="btn-dark" data-act="take" data-id="${c.id}" ${all ? 'disabled' : ''}>${all ? 'Всё принято' : 'Отметить приём'}</button>
      ${ci.today ? `<button class="btn-light outline" data-act="untake" data-id="${c.id}">Отменить отметку</button>` : ''}</div>` : ''}
    <button class="btn-light outline" style="align-self:flex-start" data-act="stop-course" data-id="${c.id}">Закончить курс</button>
  </div>`;
}

// Строка истории; у визита с заключением — раскрывающийся блок с полным текстом
function histRow(r) {
  const meta = r.type === 'course'
    ? [timesText(r.perDay), r.note, `${r.days} дн.`, `полностью отмечено ${courseInfo(r).fullDays} из ${r.days}`, r.stopped ? 'закончен ' + fmtFull(parseIso(r.stopped)) : ''].filter(Boolean).join(' · ')
    : [r.note, r.cost ? money(r.cost) : '', hasRep(r) ? everyRec(r) : r.nextDate ? 'повторный приём ' + fmtFull(parseIso(r.nextDate)) : 'без напоминания', r.by ? 'отметил(а) ' + r.by : ''].filter(Boolean).join(' · ');
  const head = `<span class="grow" style="gap:0"><span class="title">${esc(r.title)}</span><span class="small">${esc(meta)}</span></span><span class="row-btns" style="align-items:center;flex-wrap:nowrap"><span class="small">${fmtFull(parseIso(r.date))}</span><button class="btn-icon plain" data-act="del-record" data-id="${r.id}" aria-label="Удалить запись ${esc(r.title)} от ${fmtFull(parseIso(r.date))}">${ICONS.trash}</button></span>`;
  if (!r.concl && !r.meds) return `<div class="line">${head}</div>`;
  const hint = `<span class="pill" style="align-self:flex-start;margin-top:4px">Заключение — нажмите, чтобы открыть</span>`;
  return `<details class="line hist-more"><summary>${head.replace('</span></span><span class="row-btns"', `</span>${hint}</span><span class="row-btns"`)}</summary>
    ${r.concl ? `<div class="doc"><span class="lbl">Заключение</span><p class="para pre">${esc(r.concl)}</p></div>` : ''}
    ${r.meds ? `<div class="doc"><span class="lbl">Назначения</span><p class="para pre">${esc(r.meds)}</p></div>` : ''}</details>`;
}

// Паспортные данные питомца и расходы на него за год
const yearSpent = (pet, y = T.getFullYear()) => db.records.filter(r => r.cost && (!pet || r.pet === pet) && r.date.startsWith(y + '-')).reduce((a, r) => a + r.cost, 0);
function petInfo(p) {
  const rows = [['Чип', p.chip], ['Стерилизация', STERILE[p.sterile]], ['Особенности и аллергии', p.allergy]].filter(x => x[1]);
  const spent = yearSpent(p.id);
  if (spent) rows.push(['Расходы в ' + T.getFullYear(), money(spent)]);
  const hasPassport = p.chip || p.sterile || p.allergy;
  return `${rows.length ? `<div class="card list">${rows.map(([k, v]) => `<div class="line"><span class="small">${k}</span><span class="title" style="text-align:right">${esc(v)}</span></div>`).join('')}</div>` : ''}
    ${hasPassport ? '' : `<a class="add-more" href="#/pet/${p.id}/edit">Добавить чип, стерилизацию, аллергии</a>`}`;
}

// Подписи месяцев под графиком: не больше шести, повторы месяца не пишем, первая и последняя видны всегда
function monthLabels(shown) {
  const step = Math.ceil(shown.length / 6);
  return shown.map((w, i) => {
    const m = parseIso(w.date).getMonth();
    const repeat = i && parseIso(shown[i - 1].date).getMonth() === m;
    const keep = i === 0 || i === shown.length - 1 || (i % step === 0 && shown.length - 1 - i >= step);
    return `<span>${keep && !repeat ? MON1[m] : ''}</span>`;
  }).join('');
}

function weightChart(ws, p) {
  if (ws.length < 2) {
    return `<div class="card chart"><span class="title">Вес</span><span class="small">${ws.length ? 'Чтобы появился график, нужно ещё одно взвешивание.' : 'Вес ещё не записан. Его можно записать в разделе «Вес» ниже.'}</span></div>`;
  }
  const shown = ws.slice(-12);
  const W = 316, H = 110, vals = shown.map(w => w.kg), lo = Math.min(...vals), hi = Math.max(...vals), span = Math.max(hi - lo, 0.1);
  const pts = shown.map((w, i) => [10 + i / (shown.length - 1) * (W - 22), 12 + (1 - (w.kg - lo) / span) * (H - 24)]);
  const line = pts.map(q => q.map(n => n.toFixed(1)).join(',')).join(' ');
  const last = pts.at(-1);
  return `<div class="card chart">
    <div class="meta"><span class="title">Вес</span><span class="pill">${deltaText(ws)}</span></div>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Вес: от ${kg(shown[0].kg)} до ${kg(shown.at(-1).kg)} кг">
      <polyline points="${line}" fill="none" stroke="var(--ink)" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
      ${pts.slice(0, -1).map(q => `<circle cx="${q[0]}" cy="${q[1]}" r="3.5" fill="var(--card)" stroke="var(--ink)" stroke-width="2"/>`).join('')}
      <circle cx="${last[0]}" cy="${last[1]}" r="7" fill="var(--lime)" stroke="var(--ink)" stroke-width="2.5"/>
    </svg>
    <div class="months">${monthLabels(shown)}</div>
  </div>`;
}

function viewPet(id) {
  const p = petById(id);
  if (!p) return viewMissing();
  if (state.segPet !== id) { state.seg = 'treatment'; state.segPet = id; }
  const ws = petWeights(p.id);
  const segBtn = (v, label) => `<button data-act="seg" data-v="${v}" aria-pressed="${state.seg === v}">${label}</button>`;
  let body;
  if (state.seg === 'course') {
    const cs = petCourses(p.id), cur = cs.filter(c => !courseInfo(c).finished), done = cs.filter(c => courseInfo(c).finished);
    body = `${cur.length ? cur.map(courseCard).join('') : '<div class="card list"><div class="empty">Сейчас курсов нет.</div></div>'}
      ${done.length ? `<h2 class="h2">Прошлые курсы</h2><div class="card list">${done.map(histRow).join('')}</div>` : ''}
      <button class="btn-wide" data-act="add" data-type="course" data-pet="${p.id}">Добавить курс лекарств</button>`;
  } else if (state.seg === 'weight') {
    body = `${ws.length ? `<div class="card list">${ws.slice().reverse().map(w => `<div class="line"><span class="title">${kg(w.kg)} кг</span><span class="row-btns" style="align-items:center"><span class="small">${fmtFull(parseIso(w.date))}</span><button class="btn-icon plain" data-act="del-weight" data-id="${w.id}" aria-label="Удалить взвешивание ${kg(w.kg)} кг">${ICONS.trash}</button></span></div>`).join('')}</div>` : ''}
      <button class="btn-wide" data-act="add" data-type="weight" data-pet="${p.id}">Записать вес</button>`;
  } else {
    const next = upcoming({ pet: p.id, type: state.seg });
    const hot = next.filter(u => u.status === 'hot'), rest = next.filter(u => u.status !== 'hot');
    const hist = db.records.filter(r => r.pet === p.id && r.type === state.seg).sort((a, b) => b.date.localeCompare(a.date) || b.created - a.created);
    body = `${hot.map(u => hotCard(u, false)).join('')}
      ${rest.length ? `<div class="nums">${rest.map(u => itemRow(u, false)).join('')}</div>` : ''}
      ${!next.length ? '<div class="card list"><div class="empty">Ничего не запланировано.</div></div>' : ''}
      ${hist.length ? `<h2 class="h2">История</h2>
      <div class="card list">${hist.map(histRow).join('')}</div>` : ''}
      <button class="btn-wide" data-act="add" data-type="${state.seg}" data-pet="${p.id}">Добавить ${TYPES[state.seg].acc}</button>`;
  }
  const segAnim = state.segAnim; state.segAnim = false; // анимация раздела — только сразу после переключения
  const metaLine = [p.breed, KIND[p.kind].toLowerCase()].filter(Boolean).join(', ');
  const lastW = ws.at(-1);
  // «4 года 5 мес»: годы крупно, месяцы мелко рядом
  const ageM = /^(\d+ \S+)( .+)?$/.exec(age(p.birth));
  const ageHtml = ageM ? `<span class="nw">${esc(ageM[1])}</span>${ageM[2] ? `<small>${esc(ageM[2])}</small>` : ''}` : esc(age(p.birth) || '—');
  return `<div class="head"><a class="round" href="#/" aria-label="Назад на главную">${ICONS.back}</a><a class="round" href="#/pet/${p.id}/edit" aria-label="Изменить данные питомца">${ICONS.edit}</a></div>
    <header class="pet-head">${avatar(p, 80)}<div class="top"><h1 class="h1 big">${esc(p.name)}</h1><span class="eyebrow">${esc(metaLine)}</span></div></header>
    <div class="stats">
      <div class="stat"><span class="small">Возраст</span><span class="num">${ageHtml}</span></div>
      <div class="stat"><span class="small">Вес</span><span class="num">${lastW ? `${kg(lastW.kg)}<small> кг</small>` : '—'}</span></div>
    </div>
    ${weightChart(ws, p)}
    ${petInfo(p)}
    <div class="typepick" role="group" aria-label="Раздел">${Object.entries(TYPES).map(([k, t]) => segBtn(k, t.tab)).join('')}${segBtn('weight', 'Вес')}</div>
    <div class="seg-body${segAnim ? ' in-fade' : ''}">${body}</div>
    <p class="note">Сроки указываете вы, по совету врача или инструкции препарата. Хвостик напоминает, но не заменяет ветеринара.</p>`;
}

function viewPetForm(id) {
  const p = id ? petById(id) : null;
  if (id && !p) return viewMissing();
  const v = p || { name: '', kind: 'dog', breed: '', birth: '', color: db.pets.length % PET_COLORS.length, photo: '', chip: '', sterile: '', allergy: '' };
  if (photoDraft.key !== location.hash) photoDraft = { key: location.hash, value: v.photo || '' };
  const sterOpt = (k, label) => `<label class="opt"><input type="radio" name="sterile" value="${k}" ${(v.sterile || '') === k ? 'checked' : ''}><span>${label}</span></label>`;
  const kindOpt = (k, label) => `<label class="opt"><input type="radio" name="kind" value="${k}" ${v.kind === k ? 'checked' : ''}><span>${label}</span></label>`;
  return `<div class="head"><a class="round" href="${p ? '#/pet/' + p.id : '#/'}" aria-label="Назад">${ICONS.back}</a></div>
    <h1 class="h1">${p ? 'Изменить данные' : 'Новый питомец'}</h1>
    ${!p && db.demo ? '<div class="banner"><span>Сейчас открыт пример. Когда вы добавите своего питомца, пример уберётся.</span></div>' : ''}
    <form class="form" id="pet-form" data-id="${p ? p.id : ''}" novalidate>
      <div class="field" role="group" aria-label="Фото"><span class="lbl" aria-hidden="true">Фото, по желанию</span><div class="photo-pick" id="pf-photo">${photoField(v)}</div></div>
      <div class="field"><label for="pf-name">Кличка</label><input id="pf-name" name="name" type="text" maxlength="40" autocomplete="off" value="${esc(v.name)}" required></div>
      <div class="field" role="group" aria-label="Кто это"><span class="lbl" aria-hidden="true">Кто это</span><div class="chips">${kindOpt('dog', 'Собака')}${kindOpt('cat', 'Кошка')}${kindOpt('other', 'Другой')}</div></div>
      <div class="field-row">
        <div class="field"><label for="pf-breed">Порода, если знаете</label><input id="pf-breed" name="breed" type="text" maxlength="60" autocomplete="off" value="${esc(v.breed)}"></div>
        <div class="field"><label for="pf-birth">Дата рождения, можно примерно</label><input id="pf-birth" name="birth" type="date" max="${iso(T)}" value="${esc(v.birth)}"></div>
      </div>
      <div class="field" role="group" aria-label="Стерилизован или кастрирован"><span class="lbl" aria-hidden="true">Стерилизация или кастрация</span><div class="chips">${sterOpt('yes', 'Да')}${sterOpt('no', 'Нет')}${sterOpt('', 'Не указано')}</div></div>
      <div class="field-row">
        <div class="field"><label for="pf-chip">Номер чипа</label><input id="pf-chip" name="chip" type="text" inputmode="numeric" maxlength="40" autocomplete="off" value="${esc(v.chip)}"></div>
        <div class="field"><label for="pf-allergy">Особенности и аллергии</label><input id="pf-allergy" name="allergy" type="text" maxlength="200" autocomplete="off" placeholder="Например, не ест курицу" value="${esc(v.allergy)}"></div>
      </div>
      <div class="field" role="group" aria-label="Цвет в приложении"><span class="lbl" aria-hidden="true">Цвет в приложении</span><div class="chips">${PET_COLORS.map((c, i) => `<label class="opt swatch" title="${c.name}"><input type="radio" name="color" value="${i}" ${v.color === i ? 'checked' : ''} aria-label="${c.name}"><span style="background-color:${c.bg}"></span></label>`).join('')}</div></div>
      <p class="err" id="pf-err" hidden></p>
      <button class="btn-primary" type="submit">${p ? 'Сохранить' : 'Добавить питомца'}</button>
    </form>
    ${p ? `<button class="btn-danger" data-act="del-pet" data-id="${p.id}">Удалить ${esc(p.name)} и все записи</button>` : ''}`;
}

// Выбранное, но ещё не сохранённое фото в форме питомца
let photoDraft = { key: '', value: '' };
function photoField(v) {
  const has = okPhoto(photoDraft.value);
  return `<button type="button" class="photo-btn" data-act="pick-photo" aria-label="${has ? 'Заменить фото' : 'Выбрать фото'}">${has ? avatar({ ...v, photo: photoDraft.value }, 96) : `<span class="avatar photo-empty" style="width:96px;height:96px">${ICONS.camera}</span>`}</button>
    <div class="row-btns"><button type="button" class="${has ? 'btn-light outline' : 'btn-dark'}" data-act="pick-photo">${has ? 'Заменить' : 'Выбрать фото'}</button>${has ? '<button type="button" class="btn-light outline" data-act="remove-photo">Убрать</button>' : ''}</div>`;
}
function refreshPhotoField() {
  const box = document.getElementById('pf-photo');
  if (box) box.innerHTML = photoField({});
}

// Новое фото у существующего питомца сохраняется сразу, без кнопки «Сохранить»,
// у нового питомца — вместе с ним
function setPhoto(key, value) {
  if (key !== location.hash) return; // пока выбирали, ушли с формы
  photoDraft = { key, value };
  const r = currentRoute();
  const pet = r.name === 'pet-edit' ? petById(r.id) : null;
  if (pet) { pet.photo = value; touch('pet', pet); if (save()) toast(value ? 'Фото сохранили' : 'Фото убрали'); }
  refreshPhotoField();
}

// Открыть снимок и уменьшить до рабочего размера (у фото с телефона бывает 48 Мп — это тяжело для памяти)
async function loadPhotoSource(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = url; });
    const w = img.naturalWidth, h = img.naturalHeight;
    if (!w || !h) throw new Error('empty image');
    const k = Math.min(1, 1200 / Math.min(w, h), 4096 / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, c.width, c.height); // прозрачный фон PNG станет белым, а не чёрным
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Сжать выбранный квадрат до 320×320, JPEG. Получается около 20–40 КБ.
function makePhoto(src, sx, sy, side) {
  const size = Math.max(1, Math.min(320, Math.round(side)));
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  canvas.getContext('2d').drawImage(src, sx, sy, side, side, 0, 0, size, size);
  let q = 0.82, out = canvas.toDataURL('image/jpeg', q);
  while (out.length > PHOTO_MAX - 2000 && q > 0.35) { q -= 0.12; out = canvas.toDataURL('image/jpeg', q); }
  if (!okPhoto(out)) throw new Error('photo too big');
  return out;
}

const photoInput = document.getElementById('photo-file');
photoInput.addEventListener('change', async () => {
  const file = photoInput.files && photoInput.files[0];
  photoInput.value = '';
  if (!file) return;
  const key = location.hash;
  try {
    const src = await loadPhotoSource(file);
    if (key === location.hash) openCrop(src, key);
  } catch (e) {
    toast('Не получилось открыть это фото. Попробуйте другое, например в формате JPG или PNG.');
  }
});

// ---------- Сканирование заключения ----------
// Распознавание идёт прямо в браузере (Tesseract, файлы в /ocr). Программа и русский словарь (~7 МБ)
// скачиваются при первом скане, дальше работают и без интернета. Фото никуда не отправляется.
let ocrWorker = null, ocrProgress = null;
async function getOcr() {
  if (!window.Tesseract) {
    await new Promise((ok, bad) => { const sc = document.createElement('script'); sc.src = '/ocr/tesseract.min.js'; sc.onload = ok; sc.onerror = bad; document.head.appendChild(sc); });
  }
  if (!ocrWorker) {
    ocrWorker = await window.Tesseract.createWorker('rus', 1, {
      workerPath: '/ocr/worker.min.js', corePath: '/ocr', langPath: '/ocr', workerBlobURL: false,
      logger: m => ocrProgress && ocrProgress(m)
    });
  }
  return ocrWorker;
}
// Снимок документа: уменьшаем до 2400 точек по большей стороне — так быстрее, а буквы ещё читаются
async function loadDocImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = url; });
    const k = Math.min(1, 2400 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Разбор распознанного текста. Данные владельца (ФИО, телефон, адрес, почта) выбрасываются сразу,
// дальше ищем разделы по привычным заголовкам и даты.
// \b в JS не видит границу русского слова, поэтому вместо него (?![а-яё])
const OWNER_LINE = /(^\s*(ветеринарный\s+)?врач\s*[:—-]|ветврач|подпись|владел|хозя(ин|йк)|клиент|ф\.?\s?и\.?\s?о|фамили|адрес|тел(?![а-яё])|телефон|e-?mail|эл\.?\s?почт|паспорт|снилс|@)/i;
const PHONE = /(\+7|\b8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}/;
const SECTIONS = [
  ['concl', /^(заключение|диагноз|предварительный диагноз|клинический диагноз|выводы?)(?![а-яё])/i],
  ['meds', /^(назначени[яе]|рекомендаци[ия]|лечение|терапия|план лечения|лекарства)(?![а-яё])/i],
  ['why', /^(причина обращения|цель (визита|обращения|при[её]ма)|жалобы|повод обращения)(?![а-яё])/i],
  ['other', /^(анамнез|осмотр|клинический осмотр|результаты|данные осмотра|температура|вес)(?![а-яё])/i],
  ['nextline', /^(повторн|следующ|контрольн|явка)/i],
  ['stop', /^(врач|ветеринарный врач|ветврач|подпись|м\.?\s?п\.?)(?![а-яё])/i]
];
// ФИО без подписи: «Фамилия Имя Отчество» и «Фамилия И. О.» / «И. О. Фамилия»
const FIO = /[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+(вич|вна|ична|чна|ич)(?![а-яё])|[А-ЯЁ][а-яё]{2,}\s+[А-ЯЁ]\.\s?[А-ЯЁ]\.|[А-ЯЁ]\.\s?[А-ЯЁ]\.\s?[А-ЯЁ][а-яё]{2,}/;
// Обрывки символов вместо текста: мало букв или слишком коротко
// (край листа и рамки бланка превращаются в строки вроде «ооОЛЛЛОо» — в них всего 2–3 разные буквы)
const junk = l => {
  const letters = l.match(/[а-яёa-z0-9]/gi) || [];
  return letters.length < 4 || letters.length / l.length < 0.55 || new Set(letters.join('').toLowerCase()).size < 4;
};
function parseReport(raw) {
  const lines = raw.split(/\r?\n/).map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  let removed = 0;
  const kept = lines.filter(l => {
    const personal = OWNER_LINE.test(l) || PHONE.test(l) || FIO.test(l);
    if (personal) removed++;
    return !personal && !junk(l);
  });
  const out = { concl: [], meds: [], why: [] };
  let cur = null, visitDate = '', next = '';
  const dateRe = /\b(\d{1,2})\s?[.\/,]\s?(\d{1,2})\s?[.\/,]\s?(\d{4}|\d{2})\b/; // распознавание иногда ставит пробел: «04. 10.2026»
  for (const line of kept) {
    const plain = line.replace(/^[\d.)\s-]+/, '');
    // Заголовок раздела — только «Диагноз: …» или «Назначения» отдельной строкой;
    // «Заключение по результатам приёма» — это название документа, а не раздел
    const sec = SECTIONS.find(([k, re]) => { const m2 = re.exec(plain); return m2 && (k === 'nextline' || /^\s*([:.\-—]|$)/.test(plain.slice(m2[0].length))); });
    let body = line;
    if (sec) { cur = sec[0]; body = plain.replace(sec[1], '').replace(/^[\s:.\-—]+/, ''); }
    const m = dateRe.exec(line);
    if (m) {
      const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
      const d = iso(new Date(y, Number(m[2]) - 1, Number(m[1]), 12));
      if (isIso(d) && Number(m[2]) <= 12) {
        if (/повторн|следующ|контрольн|явка/i.test(line) && parseIso(d) > T) next = d;
        else if (!visitDate && parseIso(d) <= T) visitDate = d;
      }
    }
    if (cur && out[cur] && body) out[cur].push(body);
  }
  const text = kept.join('\n');
  return { concl: out.concl.join('\n'), meds: out.meds.join('\n'), why: out.why.join(' ').slice(0, 80), visitDate, next, text, removed };
}

// Шаги скана: выбрать фото → выделить рамкой заключение (можно повернуть) → «Распознать выделенное».
// Рамка нужна, чтобы распознавать только нужную часть листа: так меньше ошибок и в текст не попадает шапка с данными владельца.
const docInput = document.getElementById('doc-file');
docInput.addEventListener('change', async () => {
  const file = docInput.files && docInput.files[0];
  docInput.value = '';
  if (!file || !sheet || sheet.kind !== 'add') return;
  try {
    const src = await loadDocImage(file);
    if (!sheet || sheet.kind !== 'add') return;
    sheet.doc = { src, rect: { x: 0.04, y: 0.04, w: 0.92, h: 0.92 } };
    sheet.scanMsg = '';
    renderSheet();
  } catch (e) {
    toast('Не получилось открыть это фото. Попробуйте другое.');
  }
});

// Повернуть снимок на четверть оборота по часовой стрелке
function rotateDoc() {
  const s = sheet.doc.src, c = document.createElement('canvas');
  c.width = s.height; c.height = s.width;
  const ctx = c.getContext('2d');
  ctx.translate(c.width, 0); ctx.rotate(Math.PI / 2); ctx.drawImage(s, 0, 0);
  sheet.doc = { src: c, rect: { x: 0.04, y: 0.04, w: 0.92, h: 0.92 } };
  renderSheet();
}

// Рамка выделения: тянуть за углы — менять размер, за середину — двигать
let lastDrag = 0;
function initDocCrop() {
  const box = document.getElementById('doc-crop'), cv = document.getElementById('doc-view'), sel = document.getElementById('doc-sel');
  if (!box || !cv || !sel || !sheet || !sheet.doc) return;
  const { src } = sheet.doc;
  const k = Math.min(1, 1000 / Math.max(src.width, src.height));
  cv.width = Math.round(src.width * k); cv.height = Math.round(src.height * k);
  cv.getContext('2d').drawImage(src, 0, 0, cv.width, cv.height);
  const place = () => { const r = sheet.doc.rect; Object.assign(sel.style, { left: r.x * 100 + '%', top: r.y * 100 + '%', width: r.w * 100 + '%', height: r.h * 100 + '%' }); };
  place();
  let drag = null;
  box.addEventListener('pointerdown', e => {
    if (!sheet || !sheet.doc) return;
    const h = e.target.dataset && e.target.dataset.h;
    if (!h && e.target !== sel) return;
    e.preventDefault();
    box.setPointerCapture(e.pointerId);
    drag = { h: h || 'move', x: e.clientX, y: e.clientY, r: { ...sheet.doc.rect } };
  });
  box.addEventListener('pointermove', e => {
    if (!drag || !sheet || !sheet.doc) return;
    const b = box.getBoundingClientRect();
    const dx = (e.clientX - drag.x) / b.width, dy = (e.clientY - drag.y) / b.height, MIN = 0.08;
    let { x, y, w, h } = drag.r;
    if (drag.h === 'move') { x = Math.min(1 - w, Math.max(0, x + dx)); y = Math.min(1 - h, Math.max(0, y + dy)); }
    else {
      if (drag.h.includes('w')) { const nx = Math.min(x + w - MIN, Math.max(0, x + dx)); w += x - nx; x = nx; }
      if (drag.h.includes('e')) w = Math.min(1 - x, Math.max(MIN, w + dx));
      if (drag.h.includes('n')) { const ny = Math.min(y + h - MIN, Math.max(0, y + dy)); h += y - ny; y = ny; }
      if (drag.h.includes('s')) h = Math.min(1 - y, Math.max(MIN, h + dy));
    }
    sheet.doc.rect = { x, y, w, h };
    place();
  });
  const up = () => { if (drag) lastDrag = Date.now(); drag = null; };
  box.addEventListener('pointerup', up);
  box.addEventListener('pointercancel', up);
}

// Подготовка снимка: выделенная часть, серый цвет, без теней и неровного света, мелкий текст крупнее
function prepareDoc() {
  const { src, rect } = sheet.doc;
  const sx = Math.round(rect.x * src.width), sy = Math.round(rect.y * src.height);
  const sw = Math.max(1, Math.round(rect.w * src.width)), sh = Math.max(1, Math.round(rect.h * src.height));
  const k = Math.min(3, Math.max(1, 1800 / sw), 4000 / Math.max(sw, sh));
  const c = document.createElement('canvas');
  c.width = Math.round(sw * k); c.height = Math.round(sh * k);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height);
  // Фон листа: сильно уменьшенная и снова растянутая копия — буквы в ней растворяются, остаются тени и свет
  const bgc = document.createElement('canvas');
  bgc.width = Math.max(1, Math.round(c.width / 28)); bgc.height = Math.max(1, Math.round(c.height / 28));
  const bctx = bgc.getContext('2d');
  bctx.imageSmoothingQuality = 'high';
  bctx.drawImage(c, 0, 0, bgc.width, bgc.height);
  const big = document.createElement('canvas');
  big.width = c.width; big.height = c.height;
  const gctx = big.getContext('2d');
  gctx.imageSmoothingQuality = 'high';
  gctx.drawImage(bgc, 0, 0, c.width, c.height);
  const img = ctx.getImageData(0, 0, c.width, c.height), bg = gctx.getImageData(0, 0, c.width, c.height).data, d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const b = 0.299 * bg[i] + 0.587 * bg[i + 1] + 0.114 * bg[i + 2];
    const v = Math.min(255, (g / Math.max(b, 1)) * 255); // делим на фон — тень исчезает
    const out = Math.max(0, Math.min(255, 255 - (255 - v) * 1.8)); // текст темнее, фон белее
    d[i] = d[i + 1] = d[i + 2] = out;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

async function runDocOcr() {
  if (!sheet || !sheet.doc || sheet.scanning) return;
  const status = msg => { if (sheet) sheet.scanMsg = msg; const el = document.getElementById('scan-status'); if (el) el.textContent = msg; };
  let img;
  try { img = prepareDoc(); } catch (e) { toast('Не получилось обработать фото. Попробуйте выделить часть поменьше.'); return; }
  sheet.doc = null; sheet.scanning = true; renderSheet();
  status('Готовим распознавание… При первом скане скачивается около 7 МБ, потом работает без интернета.');
  try {
    ocrProgress = m => { if (m.status === 'recognizing text') status(`Распознаём текст… ${Math.round(m.progress * 100)}%`); };
    const ocr = await getOcr();
    const { data } = await ocr.recognize(img);
    ocrProgress = null;
    const r = parseReport(data.text || '');
    if (!sheet || sheet.kind !== 'add') return;
    sheet.scanning = false;
    if (!r.text.trim()) {
      sheet.scanText = '';
      sheet.scanMsg = 'Текст не нашёлся. Снимите ближе, ровно и при хорошем свете, а рамкой выделите только заключение.';
      renderSheet(); return;
    }
    const set = (id, v) => { const el = document.getElementById(id); if (el && v) el.value = v; };
    set('f-concl', r.concl.slice(0, 1500));
    set('f-meds', r.meds.slice(0, 1500));
    set('f-next', r.next);
    set('f-date', r.visitDate);
    const t = document.getElementById('f-title');
    if (t && !t.value.trim() && (r.why || r.concl || r.meds)) t.value = r.why || 'Приём у врача';
    const found = r.concl || r.meds;
    sheet.scanText = r.text;
    sheet.scanOpen = !found; // разделы не нашлись — сразу показываем текст, из него можно скопировать
    sheet.scanMsg = (found ? 'Готово. Проверьте поля: распознавание может ошибаться.' : 'Разделы «Диагноз» и «Назначения» не нашлись. Скопируйте нужное из распознанного текста ниже в поля.')
      + (r.removed ? ` Убрали строк с личными данными: ${r.removed}.` : '');
    renderSheet();
  } catch (e) {
    ocrProgress = null;
    if (!sheet) return;
    sheet.scanning = false;
    sheet.scanMsg = navigator.onLine === false && !ocrWorker ? 'Для первого скана нужен интернет: скачивается программа распознавания.' : 'Не получилось распознать. Попробуйте другое фото.';
    renderSheet();
  }
}

// ---------- Выбор области фото ----------
// Видимый квадрат задаётся центром (cx, cy) и приближением zoom в координатах уменьшенного снимка
const CROP_MAX_ZOOM = 4;
const cropSide = s => Math.min(s.src.width, s.src.height) / s.zoom;
function cropClamp(s) {
  s.zoom = Math.min(CROP_MAX_ZOOM, Math.max(1, s.zoom));
  const half = cropSide(s) / 2;
  s.cx = Math.min(s.src.width - half, Math.max(half, s.cx));
  s.cy = Math.min(s.src.height - half, Math.max(half, s.cy));
}
function openCrop(src, key) {
  sheet = { kind: 'crop', src, key, zoom: 1, cx: src.width / 2, cy: src.height / 2 };
  renderSheet();
  const box = document.getElementById('crop-box'), range = document.getElementById('crop-zoom');
  const pts = new Map();
  let last = null; // прошлое положение: середина между пальцами и расстояние между ними
  const now = () => {
    const p = [...pts.values()];
    const x = p.reduce((a, q) => a + q.x, 0) / p.length, y = p.reduce((a, q) => a + q.y, 0) / p.length;
    return { x, y, d: p.length > 1 ? Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) : 0, n: p.length };
  };
  const move = (dx, dy, k) => {
    const s = sheet;
    if (!s || s.kind !== 'crop') return;
    const perPx = cropSide(s) / box.clientWidth; // сколько точек снимка в одном пикселе экрана
    s.cx -= dx * perPx; s.cy -= dy * perPx;
    if (k) s.zoom *= k;
    cropClamp(s);
    range.value = s.zoom;
    drawCrop();
  };
  box.addEventListener('pointerdown', e => {
    box.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    last = now();
  });
  box.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const c = now();
    if (last && last.n === c.n) move(c.x - last.x, c.y - last.y, c.n > 1 && last.d ? c.d / last.d : 0);
    last = c;
  });
  const up = e => { pts.delete(e.pointerId); last = pts.size ? now() : null; };
  box.addEventListener('pointerup', up);
  box.addEventListener('pointercancel', up);
  box.addEventListener('wheel', e => { e.preventDefault(); move(0, 0, Math.exp(-e.deltaY / 400)); }, { passive: false });
  range.addEventListener('input', () => { if (sheet && sheet.kind === 'crop') { sheet.zoom = Number(range.value); cropClamp(sheet); drawCrop(); } });
  drawCrop();
}
function drawCrop() {
  const cv = document.getElementById('crop-view'), s = sheet;
  if (!cv || !s || s.kind !== 'crop') return;
  const px = Math.max(1, Math.round(cv.clientWidth * (window.devicePixelRatio || 1)));
  if (cv.width !== px) cv.width = cv.height = px;
  const side = cropSide(s);
  cv.getContext('2d').drawImage(s.src, s.cx - side / 2, s.cy - side / 2, side, side, 0, 0, px, px);
}
function applyCrop() {
  const s = sheet;
  if (!s || s.kind !== 'crop') return;
  const side = cropSide(s);
  let out;
  try { out = makePhoto(s.src, s.cx - side / 2, s.cy - side / 2, side); } catch (e) {
    toast('Не получилось сохранить это фото. Попробуйте другое.');
    return;
  }
  closeSheet();
  setPhoto(s.key, out);
}

function seenText(m) {
  if (m.me) return 'это устройство';
  const ago = Date.now() - m.lastSeen;
  if (ago < 5 * 60e3) return 'сейчас в сети';
  const d = new Date(m.lastSeen); d.setHours(12, 0, 0, 0);
  const days = diffDays(T, d);
  return days === 0 ? 'заходил(а) сегодня' : days === 1 ? 'заходил(а) вчера' : 'заходил(а) ' + fmtFull(d);
}

function viewFamily() {
  if (!meta) {
    const waiting = !db.demo && db.pets.length;
    return `<h1 class="h1">Семья</h1>
      <div class="card pad stack">
        ${waiting
          ? '<span class="title">Подключаемся к серверу</span><p class="para small">Записи сохранены на этом устройстве и попадут в ваш журнал, как только появится связь.</p><div class="row-btns"><button class="btn-dark" data-act="sync-now">Попробовать сейчас</button></div>'
          : '<span class="title">Вести журнал вместе</span><p class="para small">Когда вы добавите своего питомца, Хвостик заведёт для вас журнал. Здесь можно будет пригласить второго владельца: он увидит тех же питомцев, и отметки будут общими.</p>'}
      </div>
      <div class="card pad stack"><span class="title">Вас пригласили?</span><p class="para small">Откройте ссылку из приглашения или введите код.</p><div class="row-btns"><a class="btn-light outline" href="#/join">Ввести код</a></div></div>`;
  }
  const people = meta.members.length ? meta.members : [{ id: meta.deviceId, name: meta.name, me: true, lastSeen: Date.now() }];
  return `<header class="head"><div class="top"><h1 class="h1">Семья</h1>${syncLine()}</div><button class="btn-dark" data-act="invite">Пригласить</button></header>
    ${setupCard()}
    <div class="passport count-card"><span class="num">${people.length}</span><span class="grow" style="gap:2px"><span class="title">${plural(people.length, 'участник', 'участника', 'участников')} в журнале</span><span class="psub">Те же питомцы и общие отметки. В истории видно, кто что отметил.</span></span></div>
    <section class="card list">
      ${people.map(m => `<div class="line"><span class="pet-name">${personAvatar(m.name, 40, m.me)}<span class="grow" style="gap:0"><span class="title">${esc(m.name)}${m.me ? ' (вы)' : ''}</span><span class="small">${seenText(m)}</span></span></span>${m.me ? '' : `<button class="btn-light outline" style="height:38px" data-act="kick" data-id="${esc(m.id)}" data-name="${esc(m.name)}">Отключить</button>`}</div>`).join('')}
    </section>
    <p class="note">Каждый участник видит тех же питомцев, все отметки общие. В истории видно, кто что отметил. Свой второй телефон или компьютер подключается так же, по приглашению.</p>
    <form class="card pad stack" id="rename-form" novalidate>
      <div class="field"><label for="rename">Как вас подписывать</label><input id="rename" type="text" maxlength="30" value="${esc(meta.name)}" autocomplete="given-name"></div>
      <div class="row-btns"><button class="btn-light outline" type="submit">Сохранить имя</button></div>
    </form>
    <section class="card pad stack">
      <span class="title">Ключ восстановления</span>
      ${meta.recoveryKey
        ? `<code class="key">${esc(meta.recoveryKey)}</code><p class="para small">По этому ключу журнал можно открыть на новом устройстве, если старое потерялось. Храните его в надёжном месте и никому не показывайте.</p><div class="row-btns"><button class="btn-light outline" data-act="copy" data-v="${esc(meta.recoveryKey)}">Скопировать</button><button class="btn-light outline" data-act="rotate">Сделать новый</button></div>`
        : '<p class="para small">Ключ показывается тому, кто создал журнал или сделал новый ключ. Если ключа ни у кого нет, сделайте новый: старый перестанет работать.</p><div class="row-btns"><button class="btn-light outline" data-act="rotate">Сделать новый ключ</button></div>'}
    </section>
    <div class="row-btns"><a class="btn-light outline" href="#/join">Перейти в другой журнал</a></div>
    <button class="btn-danger" data-act="leave">Отключить это устройство</button>`;
}

function viewJoin(code) {
  const ownPets = db.demo ? 0 : db.pets.length;
  return `<div class="head"><a class="round" href="#/family" aria-label="Назад">${ICONS.back}</a></div>
    <h1 class="h1">Семейный журнал</h1>
    <form class="card pad form" id="join-form" novalidate>
      <p class="para">Подключитесь к журналу по приглашению — и вы будете видеть тех же питомцев и общие отметки. Ключ восстановления тоже подходит.</p>
      <div class="field"><label for="join-code">Код приглашения или ключ восстановления</label><input id="join-code" type="text" maxlength="40" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABCDE-FGHJK" value="${esc(code || '')}"></div>
      <div class="field"><label for="join-name">Как вас подписывать</label><input id="join-name" type="text" maxlength="30" autocomplete="given-name" placeholder="Например, Аня" value="${esc(meta && meta.name !== defaultDeviceName() ? meta.name : '')}"></div>
      ${ownPets || meta ? `<p class="para small" style="color:var(--danger)">На этом устройстве ${meta ? 'уже подключён другой журнал' : 'уже есть записи'}${ownPets ? ` (${petsWord(ownPets)})` : ''}. После подключения здесь будет журнал из приглашения, а текущие записи с этого устройства пропадут${meta ? ' (у других участников прежнего журнала они останутся)' : ''}. Если они нужны, сначала скачайте копию в настройках.</p>` : ''}
      <p class="err" id="join-err" hidden></p>
      <button class="btn-primary" type="submit">Подключиться</button>
    </form>`;
}

// Расходы за текущий год: всего, по питомцам и по видам записей
function spendCard() {
  const y = T.getFullYear(), total = yearSpent(null, y);
  if (!total) return `<section class="card pad stack"><span class="title">Расходы в ${y}</span><p class="para small">Пока ничего не записано. Сумму можно указать в новой записи, в поле «Сколько стоило».</p></section>`;
  const recs = db.records.filter(r => r.cost && r.date.startsWith(y + "-"));
  const byPet = db.pets.map(p => [p.name, yearSpent(p.id, y)]).filter(x => x[1]);
  const byType = Object.entries(TYPES).map(([k, t]) => [t.tab, recs.filter(r => r.type === k).reduce((a, r) => a + r.cost, 0)]).filter(x => x[1]);
  const rows = list => list.map(([k, v]) => `<div class="line"><span>${esc(k)}</span><span class="title">${money(v)}</span></div>`).join("");
  return `<section class="card pad stack"><span class="title">Расходы в ${y}</span><span class="num">${money(total)}</span>
    <div>${rows(byPet)}</div><div>${rows(byType)}</div></section>`;
}
function viewSettings() {
  const stat = (n, a, b, c) => `<span><span class="num">${n}</span><span class="small">${plural(n, a, b, c)}</span></span>`;
  const where = meta
    ? 'Хранится в вашем семейном журнале на сервере и на этом устройстве. Копия в файл — на всякий случай.'
    : 'Пока хранится только в этом браузере. Если очистить данные браузера, записи пропадут.';
  return `<h1 class="h1">Настройки</h1>
    <section class="card pad stack">
      <span class="title">В журнале</span>
      <div class="big-stats">${stat(db.pets.length, 'питомец', 'питомца', 'питомцев')}${stat(db.records.length, 'запись', 'записи', 'записей')}${stat(db.weights.length, 'взвешивание', 'взвешивания', 'взвешиваний')}</div>
      <p class="para small">${where}</p>
      <div class="row-btns"><button class="btn-dark" data-act="export" ${db.pets.length ? '' : 'disabled style="opacity:.5"'}>Скачать копию</button><button class="btn-light outline" data-act="import">Загрузить из файла</button></div>
    </section>
    ${spendCard()}
    <section class="passport">
      <span class="title">Установить на телефон</span>
      <p class="para psub">iPhone: откройте сайт в Safari, нажмите «Поделиться» и выберите «На экран Домой». Android: в меню Chrome выберите «Добавить на главный экран». Хвостик откроется как отдельное приложение и будет работать без интернета.</p>
    </section>
    <button class="btn-danger" data-act="wipe" ${db.pets.length || meta ? '' : 'disabled style="opacity:.5"'}>${meta ? 'Удалить журнал у всех' : 'Удалить все данные'}</button>
    <p class="note">Хвостик ${APP_VERSION}. Напоминает о сроках, но не заменяет ветеринара.</p>`;
}

const viewMissing = () => `<h1 class="h1">Такой страницы нет</h1><div class="card pad stack"><span class="small">Возможно, питомца удалили.</span><div class="row-btns"><a class="btn-dark" href="#/">На главную</a></div></div>`;

// ---------- Маршруты ----------
function currentRoute() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (!parts.length) return { name: 'feed' };
  if (parts[0] === 'pets' && parts[1] === 'new') return { name: 'pet-new' };
  if (parts[0] === 'pets') return { name: 'feed' }; // старый адрес раздела «Питомцы» ведёт на главную
  if (parts[0] === 'pet' && parts[1] && parts[2] === 'edit') return { name: 'pet-edit', id: parts[1] };
  if (parts[0] === 'pet' && parts[1]) return { name: 'pet', id: parts[1] };
  if (parts[0] === 'family') return { name: 'family', tab: 'family' };
  if (parts[0] === 'join') return { name: 'join', code: decodeURIComponent(parts[1] || ''), tab: 'family' };
  if (parts[0] === 'settings') return { name: 'settings', tab: 'settings' };
  return { name: 'missing' };
}

const main = document.getElementById('main');
let lastRouteKey = '', lastDepth = 0;
// Глубина экрана: вглубь (к питомцу) — въезжает справа, назад — слева, между разделами — проявляется
const DEPTH = { feed: 0, family: 0, settings: 0, missing: 0, join: 1, pet: 1, 'pet-new': 1, 'pet-edit': 2 };
function render() {
  const r = currentRoute();
  const html = r.name === 'feed' ? viewFeed()
    : r.name === 'pet' ? viewPet(r.id)
    : r.name === 'pet-new' ? viewPetForm(null)
    : r.name === 'pet-edit' ? viewPetForm(r.id)
    : r.name === 'family' ? viewFamily()
    : r.name === 'join' ? viewJoin(r.code)
    : r.name === 'settings' ? viewSettings()
    : viewMissing();
  main.innerHTML = html;
  main.classList.toggle('narrow', ['feed', 'pet', 'pet-new', 'pet-edit', 'settings', 'family', 'join'].includes(r.name));
  const tab = r.tab || 'feed';
  document.querySelectorAll('.nav [data-route]').forEach(a => {
    if (a.dataset.route === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  const key = location.hash;
  if (key !== lastRouteKey) {
    const d = DEPTH[r.name] ?? 0;
    main.classList.remove('in-fwd', 'in-back', 'in-fade');
    main.style.minHeight = ''; // запас высоты от переключения разделов нужен только на одном экране
    if (lastRouteKey) { void main.offsetWidth; main.classList.add(d > lastDepth ? 'in-fwd' : d < lastDepth ? 'in-back' : 'in-fade'); }
    window.scrollTo(0, 0); lastRouteKey = key; lastDepth = d;
  }
  const overdue = db.pets.length ? upcoming().filter(u => u.status === 'hot').length : 0;
  document.title = overdue ? `(${overdue}) Хвостик` : 'Хвостик';
}
// Несохранённое фото не должно «всплывать» при следующем открытии формы
window.addEventListener('hashchange', () => { closeSheet(); photoDraft = { key: '', value: '' }; render(); main.focus({ preventScroll: true }); });

// ---------- Уведомление внизу ----------
let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 3600);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Скопировано');
  } catch (e) {
    toast('Не получилось скопировать. Выделите текст и скопируйте вручную.');
  }
}

// ---------- Нижний лист: новая запись, приглашение, подтверждения ----------
const sheetHost = document.getElementById('sheet');
let sheet = null;

function closeSheet() { sheet = null; sheetHost.innerHTML = ''; }
// Плавно уехать вниз и закрыться
function closeSheetAnimated() {
  const sh = sheetHost.querySelector('.sheet'), scrim = sheetHost.firstElementChild;
  if (!sh || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { closeSheet(); return; }
  sh.style.transition = 'transform 0.24s cubic-bezier(0.3, 0, 0.8, 0.15)';
  sh.style.transform = 'translateY(105%)';
  if (scrim) { scrim.style.transition = 'background-color 0.24s ease'; scrim.style.backgroundColor = 'rgba(21, 21, 21, 0)'; }
  const was = sheet;
  setTimeout(() => { if (sheet === was) closeSheet(); }, 240);
}
// Смахнуть окно вниз: тянем, когда содержимое прокручено до верха; отпустили ниже 110 точек или резко — закрываем
function enableSheetSwipe(sh) {
  let y0 = null, dy = 0, t0 = 0, drag = false;
  const scrim = sheetHost.firstElementChild;
  sh.addEventListener('touchstart', e => {
    if (e.touches.length !== 1 || e.target.closest('.crop-box, .doc-crop, textarea, input[type=range]')) { y0 = null; return; }
    y0 = e.touches[0].clientY; t0 = Date.now(); dy = 0; drag = false;
  }, { passive: true });
  sh.addEventListener('touchmove', e => {
    if (y0 === null) return;
    const d = e.touches[0].clientY - y0;
    if (!drag) {
      if (d > 8 && sh.scrollTop <= 0) { drag = true; sh.style.transition = 'none'; }
      else if (Math.abs(d) > 8) { y0 = null; return; }
      else return;
    }
    e.preventDefault();
    dy = Math.max(0, d);
    sh.style.transform = `translateY(${dy}px)`;
    if (scrim) scrim.style.backgroundColor = `rgba(21, 21, 21, ${Math.max(0, 0.5 - dy / 900)})`;
  }, { passive: false });
  const end = () => {
    if (!drag) { y0 = null; return; }
    drag = false; y0 = null;
    if (dy > 110 || (dy > 40 && dy / Math.max(1, Date.now() - t0) > 0.6)) { lastDrag = Date.now(); closeSheetAnimated(); return; }
    sh.style.transition = 'transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1)';
    sh.style.transform = '';
    if (scrim) scrim.style.backgroundColor = '';
  };
  sh.addEventListener('touchend', end);
  sh.addEventListener('touchcancel', end);
}

function openAdd(type, pet) {
  if (!db.pets.length) { toast('Сначала добавьте питомца'); location.hash = '#/pets/new'; return; }
  const r = currentRoute();
  const t = type || (r.name === 'pet' ? state.seg : 'treatment');
  sheet = { kind: 'add', type: t, pet: pet || (r.name === 'pet' && petById(r.id) ? r.id : db.pets[0].id), months: TYPES[t] ? TYPES[t].months : 3, rep: TYPES[t] && !TYPES[t].months ? 'none' : 'm', repUnit: 'w', repN: 2, days: 7, perDay: 2, error: '' };
  sheetHost.innerHTML = '';
  renderSheet();
}

function openConfirm({ title, text, ok, onOk }) {
  sheet = { kind: 'confirm', title, text, ok, onOk, busy: false };
  renderSheet();
}

function renderSheet() {
  const first = !sheetHost.firstElementChild;
  // окно перерисовывается при каждом нажатии внутри — запоминаем прокрутку, чтобы оно не прыгало наверх
  const old = sheetHost.querySelector('.sheet'), top = old ? old.scrollTop : 0;
  renderSheetBody();
  const sh = sheetHost.querySelector('.sheet');
  if (!sh) return;
  if (!first) sh.scrollTop = top;
  if (first) sheetHost.firstElementChild.classList.add('enter'); // анимация только при открытии, не при каждом нажатии внутри
  enableSheetSwipe(sh);
}
function renderSheetBody() {
  if (!sheet) { sheetHost.innerHTML = ''; return; }
  if (sheet.kind === 'confirm') {
    sheetHost.innerHTML = `<div class="scrim" data-act="sheet-cancel"><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sh-title">
      <div class="grip"></div><h3 id="sh-title">${esc(sheet.title)}</h3><p class="para">${esc(sheet.text)}</p>
      <div class="actions"><button type="button" class="btn-light" data-act="sheet-cancel">Отмена</button><button type="button" class="btn-primary" style="background:var(--danger);color:#fff" data-act="confirm-ok" ${sheet.busy ? 'disabled' : ''}>${sheet.busy ? 'Минутку…' : esc(sheet.ok)}</button></div>
    </div></div>`;
    return;
  }
  if (sheet.kind === 'crop') {
    // У подложки нет data-act: палец, съехавший с фото, не должен закрывать окно
    sheetHost.innerHTML = `<div class="scrim"><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sh-title">
      <div class="grip"></div><h3 id="sh-title">Выберите область</h3>
      <p class="small">Перетащите фото, чтобы питомец оказался в круге. Приблизить можно ползунком или двумя пальцами.</p>
      <div class="crop-box" id="crop-box"><canvas id="crop-view" role="img" aria-label="Выбранная часть фото"></canvas></div>
      <label class="crop-zoom"><span aria-hidden="true">−</span><input type="range" id="crop-zoom" min="1" max="${CROP_MAX_ZOOM}" step="0.01" value="${sheet.zoom}" aria-label="Приближение"><span aria-hidden="true">+</span></label>
      <div class="actions"><button type="button" class="btn-light" data-act="sheet-cancel">Отмена</button><button type="button" class="btn-primary" data-act="crop-ok">Готово</button></div>
    </div></div>`;
    return;
  }
  if (sheet.kind === 'invite') {
    const link = `${location.origin}/#/join/${sheet.code}`;
    sheetHost.innerHTML = `<div class="scrim" data-act="sheet-cancel"><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sh-title">
      <div class="grip"></div><h3 id="sh-title">Приглашение готово</h3>
      <p class="para">Отправьте ссылку тому, кто тоже ухаживает за питомцами. Он откроет её, напишет, как его подписывать, и увидит ваш журнал.</p>
      <code class="key" style="font-size:13px">${esc(link)}</code>
      <p class="para small">Или код: <b>${esc(sheet.code)}</b>. Приглашение одноразовое и действует до ${fmtFull(new Date(sheet.expiresAt))}.</p>
      <div class="actions">${navigator.share ? '<button type="button" class="btn-light" data-act="share-invite">Поделиться</button>' : '<button type="button" class="btn-light" data-act="sheet-cancel">Закрыть</button>'}<button type="button" class="btn-primary" data-act="copy" data-v="${esc(link)}">Скопировать ссылку</button></div>
    </div></div>`;
    return;
  }
  const prev = id => { const el = document.getElementById(id); return el ? el.value : null; };
  const title = prev('f-title') ?? '', date = prev('f-date') ?? iso(T), note = prev('f-note') ?? '', w = prev('f-kg') ?? '', cost = prev('f-cost') ?? '', daysV = prev('f-days') ?? String(sheet.days || 7), concl = prev('f-concl') ?? '', meds = prev('f-meds') ?? '', nextD = prev('f-next') ?? '';
  const isV = sheet.type === 'visit', isC = sheet.type === 'course';
  const ty = TYPES[sheet.type];
  const isW = sheet.type === 'weight';
  const tile = (v, label) => `<button type="button" data-act="sheet-type" data-v="${v}" aria-pressed="${sheet.type === v}">${label}</button>`;
  const remindBase = isIso(date) ? parseIso(date) : T;
  const repN = prev('f-rep-n') ?? String(sheet.repN || 2);
  const remind = repHint(remindBase, repN);
  sheetHost.innerHTML = `<div class="scrim" data-act="sheet-cancel"><form class="sheet" id="add-form" role="dialog" aria-modal="true" aria-labelledby="sh-title" novalidate>
    <div class="grip"></div>
    <h3 id="sh-title">Новая запись</h3>
    ${sheet.type === 'visit' ? `<div class="scan">${sheet.doc ? `
      <span class="title">Выделите заключение</span>
      <span class="small">Потяните рамку за углы, чтобы в неё попали только заключение и назначения — без шапки бланка с данными владельца.</span>
      <div class="doc-crop" id="doc-crop"><canvas id="doc-view" role="img" aria-label="Фото документа"></canvas><div class="doc-sel" id="doc-sel"><i data-h="nw"></i><i data-h="ne"></i><i data-h="sw"></i><i data-h="se"></i></div></div>
      <div class="row-btns"><button type="button" class="btn-light outline" data-act="doc-rotate">Повернуть</button><button type="button" class="btn-light outline" data-act="doc-cancel">Отмена</button><button type="button" class="btn-dark" data-act="doc-ocr">Распознать выделенное</button></div>` : `
      <button type="button" class="btn-dark" data-act="scan-doc" ${sheet.scanning ? 'disabled' : ''}>${ICONS.camera}${sheet.scanning ? 'Распознаём…' : 'Сканировать заключение'}</button>
      <span class="beta">В разработке: функция тестируется, обязательно проверяйте распознанный текст</span>
      <span class="small" id="scan-status" role="status">${esc(sheet.scanMsg || 'Положите распечатку на ровный стол и снимайте сверху при хорошем свете. Фото не сохраняется и не покидает телефон.')}</span>
      ${sheet.scanText ? `<details class="scan-text" ${sheet.scanOpen ? 'open' : ''}><summary class="small">Весь распознанный текст</summary><textarea rows="8" readonly aria-label="Распознанный текст">${esc(sheet.scanText)}</textarea></details>` : ''}`}</div>` : ''}
    <div class="field" role="group" aria-label="Кто"><span class="lbl" aria-hidden="true">Кто</span><div class="who">${db.pets.map(p => `<button type="button" data-act="sheet-pet" data-v="${p.id}" aria-pressed="${sheet.pet === p.id}">${avatar(p, 36)}<span>${esc(p.name)}</span></button>`).join('')}</div></div>
    <div class="field" role="group" aria-label="Что"><span class="lbl" aria-hidden="true">Что</span><div class="typepick">${Object.entries(TYPES).map(([k, t]) => tile(k, t.one)).join('')}${tile('weight', 'Вес')}</div></div>
    ${isW ? `<div class="field"><label for="f-kg">Сколько весит, кг</label><input id="f-kg" type="text" inputmode="decimal" placeholder="Например, 12,4" value="${esc(w)}" autocomplete="off"></div>`
      : `<div class="field"><label for="f-title">${ty.ask}</label><input id="f-title" type="text" maxlength="80" autocomplete="off" placeholder="${ty.ph}" value="${esc(title)}">
         <div class="chips">${ty.suggest.map(s => `<button type="button" class="chip ghost" data-act="suggest" data-v="${esc(s)}">${esc(s)}</button>`).join('')}</div></div>`}
    <div class="field"><label for="f-date">${isC ? 'Начало курса' : 'Когда'}</label><input id="f-date" type="date" value="${esc(date)}" max="${iso(isC ? addDays(T, 30) : T)}"></div>
    ${isC ? `<div class="field"><label for="f-days">Сколько дней</label><input id="f-days" type="number" inputmode="numeric" min="1" max="120" value="${esc(daysV)}">
      <div class="chips">${[3, 5, 7, 10, 14].map(n => `<button type="button" class="chip ghost" data-act="sheet-days" data-v="${n}">${n} ${plural(n, 'день', 'дня', 'дней')}</button>`).join('')}</div></div>
    <div class="field" role="group" aria-label="Сколько раз в день"><span class="lbl" aria-hidden="true">Сколько раз в день</span><div class="mpick">${[1, 2, 3, 4].map(n => `<button type="button" data-act="sheet-perday" data-v="${n}" aria-pressed="${sheet.perDay === n}" aria-label="${timesText(n)}">${n}</button>`).join('')}</div><span class="small">Отмечайте каждый приём на главной — будет видно, сколько осталось.</span></div>` : ''}
    ${isV ? `<div class="field"><label for="f-concl">Заключение врача</label><textarea id="f-concl" rows="4" maxlength="1500" placeholder="Диагноз, выводы врача">${esc(concl)}</textarea></div>
    <div class="field"><label for="f-meds">Назначения и лекарства</label><textarea id="f-meds" rows="4" maxlength="1500" placeholder="Что, сколько и сколько дней давать">${esc(meds)}</textarea></div>
    <div class="field"><label for="f-next">Повторный приём, если назначен</label><input id="f-next" type="date" min="${iso(addDays(T, 1))}" value="${esc(nextD)}"><span class="small">Хвостик напомнит в этот день.</span></div>` : ''}
    ${isW || isV || isC ? '' : `<div class="field" role="group" aria-label="Напомнить снова"><span class="lbl" aria-hidden="true">Напомнить снова через</span>
      <div class="rpick">${[[1, '1', 'месяц'], [3, '3', 'месяца'], [6, '6', 'месяцев'], [12, '1', 'год']].map(([m, n, u]) => `<button type="button" data-act="sheet-months" data-v="${m}" aria-pressed="${sheet.rep === 'm' && sheet.months === m}" aria-label="Через ${n} ${u}"><b>${n}</b><small>${u}</small></button>`).join('')}<button type="button" class="word" data-act="sheet-rep" data-v="custom" aria-pressed="${sheet.rep === 'custom'}">Своё</button><button type="button" class="word" data-act="sheet-rep" data-v="none" aria-pressed="${sheet.rep === 'none'}">Не надо</button></div>
      ${sheet.rep === 'custom' ? `<div class="rep-custom"><label class="sr" for="f-rep-n">Через сколько</label><input id="f-rep-n" type="number" inputmode="numeric" min="1" max="${REP_MAX[sheet.repUnit]}" value="${esc(repN)}"><div class="seg">${[['d', 'дней'], ['w', 'недель'], ['m', 'месяцев']].map(([u, l]) => `<button type="button" data-act="sheet-unit" data-v="${u}" aria-pressed="${sheet.repUnit === u}">${l}</button>`).join('')}</div></div>` : ''}
      <span class="small" id="rep-hint">${remind}</span></div>`}
    ${isW ? '' : `<div class="field"><label for="f-note">${ty.noteLabel || 'Заметка'}</label><input id="f-note" type="text" maxlength="300" autocomplete="off" placeholder="${ty.notePh || 'Препарат, клиника'}" value="${esc(note)}"></div>
    <div class="field"><label for="f-cost">Сколько стоило, ₽ — по желанию</label><input id="f-cost" type="text" inputmode="decimal" maxlength="12" autocomplete="off" placeholder="Например, 1500" value="${esc(cost)}"></div>`}
    ${sheet.error ? `<p class="err" role="alert">${esc(sheet.error)}</p>` : ''}
    <div class="actions"><button type="button" class="btn-light" data-act="sheet-cancel">Отмена</button><button type="submit" class="btn-primary">Сохранить</button></div>
  </form></div>`;
  if (sheet.doc) initDocCrop();
}

// Интервал из окна записи: готовый вариант в месяцах, своё число дней/недель/месяцев или без напоминания
function sheetRep(nRaw) {
  if (sheet.rep === 'none') return { months: 0, repDays: 0 };
  if (sheet.rep === 'custom') {
    const n = Number(nRaw);
    if (!(Number.isInteger(n) && n >= 1 && n <= REP_MAX[sheet.repUnit])) return null;
    return sheet.repUnit === 'm' ? { months: n, repDays: 0 } : { months: 0, repDays: sheet.repUnit === 'w' ? n * 7 : n };
  }
  return { months: sheet.months, repDays: 0 };
}
function repHint(base, nRaw) {
  const rp = sheetRep(nRaw);
  if (!rp) return `Напишите число от 1 до ${REP_MAX[sheet.repUnit]}.`;
  return hasRep(rp) ? `Напомним ${fmtFull(nextByRep(base, rp))} (${everyRec(rp)}). Срок подскажет ветеринар или инструкция.` : 'Без напоминания.';
}
// Подсказка «Напомним …» меняется сразу, пока вводишь число или дату
function updateRepHint() {
  const h = document.getElementById('rep-hint');
  if (!h || !sheet || sheet.kind !== 'add') return;
  const d = document.getElementById('f-date'), n = document.getElementById('f-rep-n');
  if (n) sheet.repN = n.value;
  h.textContent = repHint(d && isIso(d.value) ? parseIso(d.value) : T, n ? n.value : sheet.repN);
}

function newRecord(fields) {
  const r = { id: uid(), snooze: null, by: myName(), created: Date.now(), note: '', ...fields };
  db.records.push(r);
  touch('record', r);
  return r;
}

function saveAdd() {
  const dateVal = document.getElementById('f-date').value;
  if (!isIso(dateVal)) { sheet.error = 'Укажите дату.'; renderSheet(); return; }
  if (sheet.type === 'course' ? parseIso(dateVal) > addDays(T, 30) : parseIso(dateVal) > T) { sheet.error = sheet.type === 'course' ? 'Курс можно начать не позже чем через 30 дней.' : 'Дата не может быть в будущем.'; renderSheet(); return; }
  const p = petById(sheet.pet);
  if (!p) { closeSheet(); return; }
  if (sheet.type === 'weight') {
    const v = parseFloat(String(document.getElementById('f-kg').value).replace(',', '.').replace(/\s/g, ''));
    if (!(v > 0 && v < 200)) { sheet.error = 'Напишите вес в килограммах, например 12,4.'; renderSheet(); return; }
    const w = { id: uid(), pet: p.id, date: dateVal, kg: Math.round(v * 100) / 100 };
    db.weights.push(w);
    touch('weight', w);
    if (!save()) return;
    toast(`${p.name}: записали ${kg(v)} кг`);
  } else {
    const isV = sheet.type === 'visit', isC = sheet.type === 'course';
    const days = isC ? Number(document.getElementById('f-days').value) : 0;
    if (isC && !(Number.isInteger(days) && days >= 1 && days <= 120)) { sheet.error = 'Сколько дней длится курс: от 1 до 120.'; renderSheet(); return; }
    const concl = isV ? document.getElementById('f-concl').value.trim().slice(0, 1500) : '';
    const meds = isV ? document.getElementById('f-meds').value.trim().slice(0, 1500) : '';
    const nextDate = isV ? document.getElementById('f-next').value : '';
    if (nextDate && (!isIso(nextDate) || parseIso(nextDate) <= T)) { sheet.error = 'Дата повторного приёма должна быть позже сегодняшней.'; renderSheet(); return; }
    const repEl = document.getElementById('f-rep-n');
    const rp = isV || isC ? { months: 0, repDays: 0 } : sheetRep(repEl ? repEl.value : sheet.repN);
    if (!rp) { sheet.error = `Через сколько напомнить: число от 1 до ${REP_MAX[sheet.repUnit]}.`; renderSheet(); return; }
    let title = document.getElementById('f-title').value.trim();
    if (!title && (concl || meds)) title = 'Приём у врача';
    if (!title) { sheet.error = TYPES[sheet.type].err; renderSheet(); return; }
    const costRaw = document.getElementById('f-cost').value.replace(/\s/g, '').replace(',', '.').replace(/₽|р\.?$/i, '');
    const cost = costRaw ? Number(costRaw) : 0;
    if (costRaw && !(cost >= 0 && cost < 1e7)) { sheet.error = 'Напишите сумму числом, например 1500.'; renderSheet(); return; }
    newRecord({ pet: p.id, type: sheet.type, title: title.slice(0, 80), date: dateVal, months: rp.months, repDays: rp.repDays, note: document.getElementById('f-note').value.trim().slice(0, 300), cost: Math.round(cost * 100) / 100, ...(isV ? { concl, meds, nextDate } : {}), ...(isC ? { days, perDay: sheet.perDay, marks: {}, stopped: '' } : {}) });
    if (!save()) return;
    if (isC) { toast(`Курс записан: ${days} ${plural(days, 'день', 'дня', 'дней')}, ${timesText(sheet.perDay)}. Отмечайте приёмы на главной.`); closeSheet(); render(); return; }
    const nextDue = isV ? (nextDate ? parseIso(nextDate) : null) : hasRep(rp) ? nextByRep(parseIso(dateVal), rp) : null;
    toast(!nextDue ? 'Записали без напоминания'
      : nextDue <= T ? `Записали. Следующий срок уже наступил (${fmtFull(nextDue)}) — дело на главной`
      : `Записали. Напомним ${fmtFull(nextDue)}`);
  }
  closeSheet(); render();
}


// ---------- Резервная копия ----------
function exportData() {
  const blob = new Blob([JSON.stringify({ app: 'hvostik', exported: new Date().toISOString(), ...db }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `hvostik-${iso(T)}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast('Копия скачана. Сохраните файл в надёжное место.');
}
// Заменить все записи данными из файла. В подключённом журнале старые записи удаляются у всех.
function replaceAll(data) {
  for (const [kind, list] of Object.entries(LIST)) for (const e of db[list]) tombstone(kind, e.id);
  db = data;
  db.demo = false;
  for (const [kind, list] of Object.entries(LIST)) for (const e of db[list]) touch(kind, e);
  save();
}
const importInput = document.getElementById('import-file');
importInput.addEventListener('change', () => {
  const file = importInput.files && importInput.files[0];
  importInput.value = '';
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    let data;
    try { data = normalize(JSON.parse(String(reader.result))); } catch (e) { toast('Это не файл копии Хвостика. Выберите файл, который скачали в настройках.'); return; }
    if (!data.pets.length) { toast('В файле нет ни одного питомца.'); return; }
    const apply = () => { replaceAll(data); closeSheet(); render(); toast(`Загрузили: ${petsWord(data.pets.length)}`); };
    if (!db.pets.length || db.demo) apply();
    else openConfirm({ title: 'Заменить данные?', text: `Сейчас в журнале ${petsWord(db.pets.length)}. Они заменятся данными из файла (${petsWord(data.pets.length)})${meta ? ' — у всех участников семьи' : ''}.`, ok: 'Заменить', onOk: apply });
  };
  reader.onerror = () => toast('Не получилось прочитать файл.');
  reader.readAsText(file);
});

// ---------- Действия ----------
async function busyConfirm(fn) {
  sheet.busy = true; renderSheet();
  try { await fn(); } catch (e) {
    sheet && (sheet.busy = false); renderSheet();
    toast(e.status === 0 ? 'Нет связи с сервером. Попробуйте, когда появится интернет.' : 'Не получилось. Попробуйте ещё раз.');
  }
}

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  if (el.classList.contains('scrim') && (e.target !== el || Date.now() - lastDrag < 500)) return;
  const act = el.dataset.act, v = el.dataset.v;
  switch (act) {
    case 'add': openAdd(el.dataset.type, el.dataset.pet); break;
    case 'seg': {
      // Страница остаётся на месте: запоминаем прокрутку и не даём странице стать короче, пока открыт этот питомец
      const y = window.scrollY;
      main.style.minHeight = Math.max(main.offsetHeight, parseFloat(main.style.minHeight) || 0) + 'px';
      state.seg = v; state.segAnim = true;
      render();
      window.scrollTo(0, y);
      const b = document.querySelector(`[data-act="seg"][data-v="${v}"]`);
      if (b) b.focus({ preventScroll: true });
      break;
    }
    case 'done': {
      const r = db.records.find(x => x.id === el.dataset.id);
      if (!r) break;
      newRecord({ pet: r.pet, type: r.type, title: r.title, date: iso(T), months: r.months, repDays: r.repDays || 0, note: r.note });
      if (save()) toast(`${petById(r.pet).name}: отмечено.${hasRep(r) ? ` Следующий раз ${fmtFull(nextByRep(T, r))}` : ''}`);
      render(); break;
    }
    case 'snooze': {
      const r = db.records.find(x => x.id === el.dataset.id);
      if (!r) break;
      r.snooze = iso(addDays(T, 1));
      touch('record', r);
      if (save()) toast(`Хорошо, напомним завтра, ${fmtFull(addDays(T, 1))}`);
      render(); break;
    }
    case 'del-record': {
      const r = db.records.find(x => x.id === el.dataset.id);
      if (!r) break;
      openConfirm({ title: 'Удалить запись?', text: `${r.title}, ${fmtFull(parseIso(r.date))}. Это действие не отменить.`, ok: 'Удалить', onOk: () => {
        db.records = db.records.filter(x => x.id !== r.id); tombstone('record', r.id); save(); closeSheet(); render(); toast('Запись удалена');
      } });
      break;
    }
    case 'del-weight': {
      const w = db.weights.find(x => x.id === el.dataset.id);
      if (!w) break;
      openConfirm({ title: 'Удалить взвешивание?', text: `${kg(w.kg)} кг, ${fmtFull(parseIso(w.date))}.`, ok: 'Удалить', onOk: () => {
        db.weights = db.weights.filter(x => x.id !== w.id); tombstone('weight', w.id); save(); closeSheet(); render(); toast('Взвешивание удалено');
      } });
      break;
    }
    case 'del-pet': {
      const p = petById(el.dataset.id);
      if (!p) break;
      const n = db.records.filter(r => r.pet === p.id).length + db.weights.filter(w => w.pet === p.id).length;
      openConfirm({ title: `Удалить ${p.name}?`, text: `Вместе с питомцем удалятся все его записи (${n})${meta ? ' — у всех участников семьи' : ''}. Это действие не отменить.`, ok: 'Удалить', onOk: () => {
        tombstone('pet', p.id);
        db.records.filter(r => r.pet === p.id).forEach(r => tombstone('record', r.id));
        db.weights.filter(w => w.pet === p.id).forEach(w => tombstone('weight', w.id));
        db.pets = db.pets.filter(x => x.id !== p.id);
        db.records = db.records.filter(r => r.pet !== p.id);
        db.weights = db.weights.filter(w => w.pet !== p.id);
        save(); closeSheet(); location.hash = '#/'; toast(`${p.name} удалён из журнала`);
      } });
      break;
    }
    case 'demo': db = demoData(); persist(); render(); toast('Загрузили пример. Его можно убрать одной кнопкой.'); break;
    case 'clear-demo': openConfirm({ title: 'Убрать пример?', text: 'Рекс, Мурка и все их записи удалятся.', ok: 'Убрать', onOk: () => { db = emptyData(); persist(); closeSheet(); render(); } }); break;
    case 'pick-photo': photoInput.click(); break;
    case 'remove-photo': setPhoto(location.hash, ''); break;
    case 'crop-ok': applyCrop(); break;
    case 'scan-doc': docInput.click(); break;
    case 'doc-rotate': rotateDoc(); break;
    case 'doc-cancel': sheet.doc = null; renderSheet(); break;
    case 'doc-ocr': runDocOcr(); break;
    case 'export': exportData(); break;
    case 'import': importInput.click(); break;
    case 'wipe':
      if (meta) {
        openConfirm({ title: 'Удалить журнал у всех?', text: 'Все питомцы и записи удалятся с сервера и со всех устройств семьи, а устройства отключатся. Если нужна копия, сначала скачайте её.', ok: 'Удалить журнал', onOk: () => busyConfirm(async () => {
          await api('DELETE', '/api/journal');
          meta = null; db = emptyData(); persist(); closeSheet(); location.hash = '#/'; render(); toast('Журнал удалён');
        }) });
      } else {
        openConfirm({ title: 'Удалить все данные?', text: 'Все питомцы и записи удалятся из этого браузера. Если нужна копия, сначала скачайте её.', ok: 'Удалить всё', onOk: () => { db = emptyData(); persist(); closeSheet(); location.hash = '#/'; render(); toast('Все данные удалены'); } });
      }
      break;
    case 'invite':
      api('POST', '/api/invites').then(r => { sheet = { kind: 'invite', code: r.code, expiresAt: r.expiresAt }; renderSheet(); })
        .catch(err => toast(err.status === 0 ? 'Нет связи с сервером. Приглашение можно сделать, когда появится интернет.' : err.code === 'too_many_invites' ? 'Слишком много неиспользованных приглашений. Подождите, пока они истекут.' : 'Не получилось сделать приглашение.'));
      break;
    case 'share-invite': navigator.share({ title: 'Хвостик', text: 'Присоединяйся к журналу наших питомцев в Хвостике', url: `${location.origin}/#/join/${sheet.code}` }).catch(() => {}); break;
    case 'copy': copyText(v); break;
    case 'kick': openConfirm({ title: `Отключить «${el.dataset.name}»?`, text: 'Это устройство потеряет доступ к журналу, а записи с него пропадут. Отметки, которые уже сделаны, останутся в журнале.', ok: 'Отключить', onOk: () => busyConfirm(async () => {
      const r = await api('DELETE', '/api/devices/' + el.dataset.id);
      meta.members = r.members; persist(); closeSheet(); render(); toast('Устройство отключено');
    }) }); break;
    case 'leave': openConfirm({ title: 'Отключить это устройство?', text: 'Записи останутся в журнале у остальных участников, а с этого устройства пропадут. Вернуться можно по новому приглашению или ключу восстановления.', ok: 'Отключить', onOk: () => busyConfirm(async () => {
      await api('POST', '/api/leave');
      meta = null; db = emptyData(); persist(); closeSheet(); location.hash = '#/'; render(); toast('Устройство отключено от журнала');
    }) }); break;
    case 'rotate': openConfirm({ title: 'Сделать новый ключ?', text: 'Старый ключ восстановления перестанет работать — у всех, кто его сохранил. Подключённые устройства это не затронет.', ok: 'Сделать новый', onOk: () => busyConfirm(async () => {
      const r = await api('POST', '/api/recovery');
      meta.recoveryKey = r.recoveryKey; persist(); closeSheet(); render(); toast('Новый ключ готов. Сохраните его.');
    }) }); break;
    case 'sync-now': sync(); toast('Пробуем подключиться…'); break;
    case 'sheet-cancel': closeSheetAnimated(); break;
    case 'confirm-ok': if (sheet && sheet.onOk && !sheet.busy) sheet.onOk(); break;
    case 'sheet-pet': sheet.pet = v; renderSheet(); break;
    case 'sheet-type': sheet.type = v; sheet.months = TYPES[v] ? TYPES[v].months : 3; sheet.rep = TYPES[v] && !TYPES[v].months ? 'none' : 'm'; sheet.error = ''; renderSheet(); break;
    case 'sheet-months': sheet.months = Number(v); sheet.rep = 'm'; renderSheet(); break;
    case 'sheet-rep': sheet.rep = v; renderSheet(); if (v === 'custom') { const n = document.getElementById('f-rep-n'); if (n) n.focus(); } break;
    case 'sheet-unit': sheet.repUnit = v; renderSheet(); break;
    case 'sheet-perday': sheet.perDay = Number(v); renderSheet(); break;
    case 'sheet-days': document.getElementById('f-days').value = v; break;
    case 'take': case 'untake': {
      const c = db.records.find(x => x.id === el.dataset.id && x.type === 'course');
      if (!c) break;
      const k = iso(T), n = (c.marks || {})[k] || 0;
      const m = { ...(c.marks || {}) };
      if (act === 'take') { if (n >= c.perDay) break; m[k] = n + 1; } else { if (n <= 1) delete m[k]; else m[k] = n - 1; }
      c.marks = m;
      touch('record', c);
      if (save()) toast(act === 'take' ? `${petById(c.pet).name}: отметили приём, сегодня ${n + 1} из ${c.perDay}` : 'Отметку убрали');
      render(); break;
    }
    case 'stop-course': {
      const c = db.records.find(x => x.id === el.dataset.id && x.type === 'course');
      if (!c) break;
      openConfirm({ title: 'Закончить курс?', text: `${c.title}: курс уйдёт в «Прошлые курсы», отметки сохранятся.`, ok: 'Закончить', onOk: () => {
        c.stopped = iso(T); touch('record', c); save(); closeSheet(); render(); toast('Курс закончен');
      } });
      break;
    }
    case 'suggest': document.getElementById('f-title').value = v; break;
  }
});

function formError(id, text) { const el = document.getElementById(id); if (el) { el.textContent = text; el.hidden = false; } }

document.addEventListener('submit', async e => {
  const f = e.target;
  if (f.id === 'add-form') { e.preventDefault(); saveAdd(); return; }

  if (f.id === 'pet-form') {
    e.preventDefault();
    const id = f.dataset.id;
    const name = f.elements.name.value.trim();
    if (!name) { formError('pf-err', 'Напишите кличку.'); f.elements.name.focus(); return; }
    const birth = f.elements.birth.value;
    if (birth && (!isIso(birth) || parseIso(birth) > T)) { formError('pf-err', 'Дата рождения не может быть в будущем.'); return; }
    const data = { name: name.slice(0, 40), kind: f.elements.kind.value || 'dog', breed: f.elements.breed.value.trim().slice(0, 60), birth: birth || '', color: Number(f.elements.color.value) || 0, photo: photoDraft.key === location.hash && okPhoto(photoDraft.value) ? photoDraft.value : '',
      sterile: STERILE[f.elements.sterile.value] ? f.elements.sterile.value : '', chip: f.elements.chip.value.trim().slice(0, 40), allergy: f.elements.allergy.value.trim().slice(0, 200) };
    if (!id && db.demo) db = emptyData(); // свой питомец заменяет пример
    let pet;
    if (id) { pet = petById(id); Object.assign(pet, data); }
    else { pet = { id: uid(), ...data }; db.pets.push(pet); }
    touch('pet', pet);
    photoDraft = { key: '', value: '' };
    if (!save()) return;
    toast(id ? 'Сохранили' : `${data.name} в журнале. Добавьте последнюю прививку или обработку.`);
    location.hash = '#/pet/' + pet.id;
    return;
  }

  if (f.id === 'setup-form') {
    e.preventDefault();
    const name = document.getElementById('setup-name').value.trim();
    try {
      if (name && name !== meta.name) { const r = await api('POST', '/api/me', { name }); meta.name = r.name; meta.members = r.members; }
      meta.setupDone = true; persist(); render();
    } catch (err) {
      toast(err.status === 0 ? 'Нет связи. Имя можно поменять позже в разделе «Семья».' : 'Не получилось сохранить имя.');
      meta.setupDone = true; persist(); render();
    }
    return;
  }

  if (f.id === 'rename-form') {
    e.preventDefault();
    const name = document.getElementById('rename').value.trim();
    if (!name) { toast('Напишите имя'); return; }
    try {
      const r = await api('POST', '/api/me', { name });
      meta.name = r.name; meta.members = r.members; persist(); render(); toast('Имя сохранено');
    } catch (err) {
      toast(err.status === 0 ? 'Нет связи с сервером.' : 'Не получилось сохранить имя.');
    }
    return;
  }

  if (f.id === 'join-form') {
    e.preventDefault();
    const code = document.getElementById('join-code').value.trim();
    const name = document.getElementById('join-name').value.trim();
    if (!code) { formError('join-err', 'Вставьте код из приглашения.'); return; }
    if (!name) { formError('join-err', 'Напишите, как вас подписывать.'); return; }
    const btn = f.querySelector('button[type="submit"]');
    btn.disabled = true; btn.textContent = 'Подключаемся…';
    try {
      const r = await api('POST', '/api/join', { code, name }, null);
      if (meta) api('POST', '/api/leave').catch(() => {}); // отключаемся от прежнего журнала
      meta = { token: r.token, deviceId: r.deviceId, name: r.name, recoveryKey: null, setupDone: true, cursor: 0, pending: {}, members: [] };
      db = emptyData();
      persist();
      location.hash = '#/';
      toast(r.viaRecovery ? 'Журнал восстановлен. Загружаем записи…' : 'Готово! Загружаем общий журнал…');
      sync();
    } catch (err) {
      btn.disabled = false; btn.textContent = 'Подключиться';
      formError('join-err', err.code === 'bad_code' ? 'Код не подошёл. Возможно, приглашение уже использовали или прошло 7 дней. Попросите новое.'
        : err.code === 'slow_down' ? 'Слишком много попыток. Попробуйте через час.'
        : err.status === 0 ? 'Нет связи с сервером. Проверьте интернет.' : 'Не получилось подключиться. Попробуйте ещё раз.');
    }
  }
});
document.addEventListener('change', e => { if (e.target.id === 'f-date' && sheet && sheet.kind === 'add') renderSheet(); });
// Сообщение об ошибке в форме прячется, как только человек начал исправлять
document.addEventListener('input', e => {
  const err = e.target.form && e.target.form.querySelector('.err'); if (err && err.id) err.hidden = true;
  if (e.target.id === 'f-rep-n' || e.target.id === 'f-date') updateRepHint();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && sheet) closeSheetAnimated(); });

// Если вкладка была открыта через полночь, пересчитываем «сегодня»; при возвращении — забираем изменения семьи
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  const now = todayDate();
  if (now.getTime() !== T.getTime()) { T = now; safeRender(); }
  sync();
});
window.addEventListener('online', () => sync());
window.addEventListener('offline', () => setSync('offline'));
// Раз в 45 секунд: забрать изменения семьи и, если наступила полночь, пересчитать «сегодня» (не трогая открытую форму)
setInterval(() => {
  if (document.visibilityState !== 'visible') return;
  const now = todayDate();
  if (now.getTime() !== T.getTime()) { T = now; safeRender(); }
  if (meta) sync();
}, 45000);
// Изменения из другой вкладки
window.addEventListener('storage', e => {
  if (e.key === STORE_KEY || e.key === SYNC_KEY) { db = load(); meta = loadMeta(); safeRender(); }
});

// ---------- Запуск ----------
try { localStorage.removeItem(THEME_KEY); } catch (e) { /* не страшно */ }
render();
sync();
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('/sw.js').catch(() => { /* без офлайна сайт всё равно работает */ });
}
