// Хвостик: журнал здоровья для собак и кошек.
// Всё приложение в одном файле: данные хранятся в браузере (localStorage), экраны рисуются из шаблонов.

const STORE_KEY = 'hvostik:data:v1';
const THEME_KEY = 'hvostik:theme';
const APP_VERSION = '1.0.0';

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
const fmt = d => `${d.getDate()} ${MON[d.getMonth()]}`;
const fmtFull = d => `${d.getDate()} ${MONF[d.getMonth()]}${d.getFullYear() !== T.getFullYear() ? ' ' + d.getFullYear() : ''}`;

// ---------- Слова ----------
const plural = (n, a, b, c) => { n = Math.abs(n) % 100; const n1 = n % 10; if (n > 10 && n < 20) return c; if (n1 > 1 && n1 < 5) return b; if (n1 === 1) return a; return c; };
const dayWord = n => plural(n, 'день', 'дня', 'дней');
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
const TYPE_ACC = { vaccine: 'прививку', treatment: 'обработку' };

// Пастельный цвет питомца и его насыщенная пара для точек на графиках
const PET_COLORS = [
  { bg: '#F6B27A', strong: '#E07A2C', name: 'Персиковый' },
  { bg: '#B9CFFF', strong: '#4F7BDB', name: 'Голубой' },
  { bg: '#B7E4C7', strong: '#2F8F5B', name: 'Мятный' },
  { bg: '#F5B8D0', strong: '#C9497E', name: 'Розовый' },
  { bg: '#FFE08A', strong: '#B8860B', name: 'Жёлтый' }
];
const petColor = p => PET_COLORS[p.color] || PET_COLORS[0];

// ---------- Хранилище ----------
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const emptyData = () => ({ version: 1, demo: false, pets: [], records: [], weights: [] });

// Проверяет и чистит данные: из localStorage или из файла копии. Битые записи отбрасываются.
function normalize(d) {
  if (!d || typeof d !== 'object' || !Array.isArray(d.pets)) throw new Error('not hvostik data');
  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const pets = d.pets.filter(p => p && typeof p.id === 'string' && str(p.name, 40)).map(p => ({
    id: p.id, name: str(p.name, 40), kind: KIND[p.kind] ? p.kind : 'other', breed: str(p.breed, 60),
    birth: isIso(p.birth) ? p.birth : '', color: Number.isInteger(p.color) && PET_COLORS[p.color] ? p.color : 0
  }));
  const ids = new Set(pets.map(p => p.id));
  const records = (Array.isArray(d.records) ? d.records : []).filter(r => r && typeof r.id === 'string' && ids.has(r.pet) && (r.type === 'vaccine' || r.type === 'treatment') && str(r.title, 80) && isIso(r.date)).map(r => ({
    id: r.id, pet: r.pet, type: r.type, title: str(r.title, 80), date: r.date,
    months: Number.isInteger(r.months) && r.months >= 0 && r.months <= 36 ? r.months : 0,
    note: str(r.note, 120), snooze: isIso(r.snooze) ? r.snooze : null, created: Number.isFinite(r.created) ? r.created : 0
  }));
  const weights = (Array.isArray(d.weights) ? d.weights : []).filter(w => w && typeof w.id === 'string' && ids.has(w.pet) && isIso(w.date) && Number.isFinite(w.kg) && w.kg > 0 && w.kg < 200).map(w => ({ id: w.id, pet: w.pet, date: w.date, kg: w.kg }));
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

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(db));
    return true;
  } catch (e) {
    toast('Не получилось сохранить. Возможно, браузер в режиме инкогнито или память заполнена.');
    return false;
  }
}

// Пример с Рексом и Муркой, даты считаются от сегодняшнего дня
function demoData() {
  const d = emptyData();
  d.demo = true;
  const rex = { id: uid(), name: 'Рекс', kind: 'dog', breed: 'Бигль', birth: iso(addMonths(T, -53)), color: 0 };
  const mura = { id: uid(), name: 'Мурка', kind: 'cat', breed: 'Британская', birth: iso(addMonths(T, -74)), color: 1 };
  d.pets.push(rex, mura);
  const rec = (pet, type, title, date, months, note = '') => d.records.push({ id: uid(), pet: pet.id, type, title, date: iso(date), months, note, snooze: null, created: Date.now() });
  rec(rex, 'vaccine', 'Комплексная прививка', addDays(addMonths(T, -12), 12), 12);
  rec(rex, 'vaccine', 'Бешенство', addDays(addMonths(T, -12), 40), 12);
  rec(rex, 'treatment', 'Клещи и блохи', addDays(T, -64), 1, 'Капли на холку');
  rec(rex, 'treatment', 'Клещи и блохи', addDays(T, -34), 1, 'Капли на холку');
  rec(rex, 'treatment', 'Глисты', addDays(T, -80), 3, 'Таблетка');
  rec(mura, 'vaccine', 'Комплексная прививка', addDays(addMonths(T, -12), 75), 12);
  rec(mura, 'treatment', 'Глисты', addDays(T, -150), 6, 'Таблетка');
  rec(mura, 'treatment', 'Блохи', addDays(T, -82), 3, 'Капли на холку');
  [11.2, 11.5, 11.4, 11.8, 12.1, 12.0, 12.4, 12.6].forEach((v, i, a) => d.weights.push({ id: uid(), pet: rex.id, date: iso(addDays(addMonths(T, -(a.length - 1 - i)), -3)), kg: v }));
  [4.6, 4.7, 4.9, 5.0, 5.2, 5.1, 5.3].forEach((v, i, a) => d.weights.push({ id: uid(), pet: mura.id, date: iso(addDays(addMonths(T, -(a.length - 1 - i)), -9)), kg: v }));
  return d;
}

// ---------- Расчёт сроков ----------
const petById = id => db.pets.find(p => p.id === id);
const petWeights = id => db.weights.filter(w => w.pet === id).sort((a, b) => a.date.localeCompare(b.date));

// Для каждой процедуры питомца берётся последняя запись; следующий срок = дата + интервал,
// или дата переноса, если хозяин нажал «Завтра»
function upcoming({ pet, type } = {}) {
  const latest = new Map();
  for (const r of db.records) {
    if (pet && r.pet !== pet) continue;
    if (type && r.type !== type) continue;
    const k = r.pet + '|' + r.type + '|' + r.title.toLowerCase();
    const cur = latest.get(k);
    if (!cur || r.date > cur.date || (r.date === cur.date && r.created > cur.created)) latest.set(k, r);
  }
  return [...latest.values()].filter(r => r.months > 0).map(r => {
    const last = parseIso(r.date);
    const planned = addMonths(last, r.months);
    const snoozed = r.snooze ? parseIso(r.snooze) : null;
    const next = snoozed && snoozed > planned ? snoozed : planned;
    const d = diffDays(next, T);
    const pct = Math.min(1, Math.max(0, diffDays(T, last) / Math.max(1, diffDays(next, last))));
    return { ...r, next, d, pct, moved: next !== planned, status: d <= 0 ? 'hot' : d <= 14 ? 'soon' : 'later' };
  }).sort((a, b) => a.d - b.d);
}

// ---------- Мелкие части интерфейса ----------
const avatar = (p, size) => `<span class="avatar" style="background:${petColor(p).bg};width:${size}px;height:${size}px;font-size:${Math.round(size * 0.45)}px" aria-hidden="true">${esc(p.name[0].toUpperCase())}</span>`;
const ICONS = {
  check: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  back: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  edit: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20l4-1 11-11-3-3L5 16z"/></svg>',
  trash: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>',
  vaccine: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 3l3 3M16 5l3 3M14 7l-8 8-2 5 5-2 8-8z"/></svg>',
  treatment: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 3c3 4 5 7 5 10a5 5 0 0 1-10 0c0-3 2-6 5-10z"/></svg>',
  weight: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="3" y="5" width="18" height="15" rx="3"/><path d="M8 11a4 4 0 0 1 8 0M12 11l2-2"/></svg>'
};

function spark(ws, p) {
  if (ws.length < 2) return '';
  const W = 140, H = 32, vals = ws.map(w => w.kg), lo = Math.min(...vals), hi = Math.max(...vals), span = Math.max(hi - lo, 0.1);
  const pts = ws.map((w, i) => [4 + i / (ws.length - 1) * (W - 10), 5 + (1 - (w.kg - lo) / span) * (H - 10)]);
  const last = pts.at(-1);
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts.map(q => q.map(n => n.toFixed(1)).join(',')).join(' ')}" fill="none" stroke="var(--ink)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${last[0]}" cy="${last[1]}" r="4" fill="${petColor(p).strong}"/></svg>`;
}
const deltaText = ws => {
  if (ws.length < 2) return ws.length ? 'для графика нужно ещё одно взвешивание' : 'вес ещё не записан';
  const d = ws.at(-1).kg - ws[0].kg, m = Math.max(1, Math.round(diffDays(parseIso(ws.at(-1).date), parseIso(ws[0].date)) / 30.4));
  return `${d >= 0 ? '+' : '−'}${kg(Math.abs(d))} кг за ${m} мес`;
};

function hotCard(u, showPet) {
  const p = petById(u.pet), n = -u.d;
  const box = n === 0 ? '<div class="daybox big alarm"><b>0</b><span>сегодня</span></div>' : `<div class="daybox big alarm"><b>−${n}</b><span>${dayWord(n)}</span></div>`;
  const sub = [showPet ? p.name : '', u.note.toLowerCase(), every(u.months)].filter(Boolean);
  const subText = showPet ? sub[0] + (sub.length > 1 ? ' · ' + sub.slice(1).join(', ') : '') : sub.join(', ');
  return `<div class="hot">
    <div class="hot-row">${box}<div class="grow" style="gap:2px"><span class="title">${esc(u.title)}</span><span class="sub">${esc(subText)}${u.moved ? ' · перенесено' : ''}</span></div></div>
    <div class="hot-actions"><button class="btn-dark" data-act="done" data-id="${u.id}">Готово</button><button class="btn-light" data-act="snooze" data-id="${u.id}">Завтра</button></div>
  </div>`;
}
function itemRow(u, showPet) {
  const p = petById(u.pet);
  return `<div class="item">
    <div class="daybox ${u.status === 'later' ? 'calm' : ''}"><b>${u.d}</b><span>${dayWord(u.d)}</span></div>
    <div class="grow">
      <div class="meta"><span class="title">${esc(u.title)}</span><span class="small">${showPet ? esc(p.name) : fmt(u.next)}</span></div>
      <div class="bar" role="img" aria-label="Прошло ${Math.round(u.pct * 100)}% срока"><i style="width:${Math.round(u.pct * 100)}%"></i></div>
    </div>
    <button class="btn-check" data-act="done" data-id="${u.id}" aria-label="Отметить: ${esc(u.title)}, сделано" title="Отметить сделанным">${ICONS.check}</button>
  </div>`;
}

// ---------- Экраны ----------
const state = { seg: 'treatment', segPet: null };

function viewWelcome() {
  return `<header class="top"><span class="eyebrow">${WD[T.getDay()]}, ${fmtFull(T)}</span><h1 class="h1">Привет! Это Хвостик</h1></header>
    <div class="card pad stack">
      <p class="para">Хвостик помнит, когда пора делать прививку или обработку от клещей и глистов, и показывает, как меняется вес питомца.</p>
      <p class="para small">Записи хранятся только в этом браузере. Мы их никуда не отправляем.</p>
      <div class="row-btns"><a class="btn-dark" href="#/pets/new">Добавить питомца</a><button class="btn-light" style="box-shadow:inset 0 0 0 1.5px var(--divider)" data-act="demo">Посмотреть на примере</button></div>
    </div>`;
}

function viewFeed() {
  if (!db.pets.length) return viewWelcome();
  const all = upcoming();
  const hot = all.filter(u => u.status === 'hot'), soon = all.filter(u => u.status === 'soon'), later = all.filter(u => u.status === 'later');
  const near = hot.length + soon.length;
  const petCards = db.pets.map(p => {
    const ws = petWeights(p.id), w = ws.at(-1);
    return `<a class="card pet-card" href="#/pet/${p.id}">
      <span class="pet-name">${avatar(p, 28)}<span>${esc(p.name)}</span></span>
      <span class="big-num">${w ? kg(w.kg) + ' кг' : '—'}</span>
      ${spark(ws, p)}
      <span class="small">${deltaText(ws)}</span>
    </a>`;
  }).join('');
  const noRecords = !db.records.length;
  const tasks = `
    ${hot.map(u => hotCard(u, true)).join('')}
    ${!hot.length && !noRecords ? '<div class="card pad"><span class="title">Всё вовремя</span><br><span class="small">Просроченных дел нет</span></div>' : ''}
    ${noRecords ? '<div class="card pad stack"><span class="title">Пока нет ни одной прививки или обработки</span><span class="small">Добавьте последнюю, и Хвостик посчитает, когда нужна следующая.</span><div class="row-btns"><button class="btn-dark" data-act="add">Добавить запись</button></div></div>' : ''}
    ${soon.length ? `<h2 class="h2">Скоро</h2><div class="card list">${soon.map(u => itemRow(u, true)).join('')}</div>` : ''}
    ${later.length ? `<h2 class="h2">Потом</h2><div class="card list">${later.map(u => itemRow(u, true)).join('')}</div>` : ''}`;
  return `${db.demo ? '<div class="banner"><span>Это пример с Рексом и Муркой.</span><button class="btn-light" style="height:38px;box-shadow:inset 0 0 0 1.5px var(--divider)" data-act="clear-demo">Убрать пример</button></div>' : ''}
    <header class="head"><div class="top"><span class="eyebrow">${WD[T.getDay()]}, ${fmtFull(T)}</span><h1 class="h1">Что дальше</h1></div>
      <span class="count">${near ? `${near} ${plural(near, 'дело', 'дела', 'дел')} на 2 недели` : 'Всё спокойно'}</span></header>
    <div class="feed-grid">
      <div class="pets feed-pets">${petCards}</div>
      <div class="stack feed-tasks">${tasks}</div>
    </div>`;
}

function viewPets() {
  return `<header class="head"><div class="top"><span class="eyebrow">${db.pets.length ? `${db.pets.length} ${plural(db.pets.length, 'питомец', 'питомца', 'питомцев')}` : 'Пока никого'}</span><h1 class="h1">Питомцы</h1></div>
      <a class="btn-dark" href="#/pets/new">Добавить</a></header>
    ${db.pets.map(p => {
      const w = petWeights(p.id).at(-1), next = upcoming({ pet: p.id })[0];
      const when = next ? (next.d < 0 ? 'просрочено на ' + (-next.d) + ' ' + dayWord(-next.d) : next.d === 0 ? 'сегодня' : 'через ' + next.d + ' ' + dayWord(next.d)) : '';
      const metaLine = [p.breed || KIND[p.kind], age(p.birth), w ? kg(w.kg) + ' кг' : ''].filter(Boolean).join(' · ');
      return `<a class="card pet-row" href="#/pet/${p.id}">
        ${avatar(p, 56)}
        <span class="grow" style="gap:2px"><span class="title" style="font-size:18px;font-weight:700">${esc(p.name)}</span>
        <span class="small">${esc(metaLine)}</span>
        ${next ? `<span class="small" style="color:${next.d <= 0 ? 'var(--danger)' : 'var(--ink)'};font-weight:600">${esc(next.title)}: ${when}</span>` : ''}</span>
      </a>`;
    }).join('')}
    ${!db.pets.length ? '<div class="card pad"><span class="small">Добавьте первого питомца, чтобы начать вести журнал.</span></div>' : ''}`;
}

function weightChart(ws, p) {
  if (ws.length < 2) {
    return `<div class="card chart"><span class="big-num">${ws.length ? kg(ws[0].kg) + ' кг' : 'Вес не записан'}</span><span class="small">Чтобы появился график, нужно хотя бы два взвешивания.</span></div>`;
  }
  const shown = ws.slice(-12);
  const W = 316, H = 130, vals = shown.map(w => w.kg), lo = Math.min(...vals), hi = Math.max(...vals), span = Math.max(hi - lo, 0.1);
  const pts = shown.map((w, i) => [10 + i / (shown.length - 1) * (W - 22), 14 + (1 - (w.kg - lo) / span) * (H - 30)]);
  const line = pts.map(q => q.map(n => n.toFixed(1)).join(',')).join(' ');
  const last = pts.at(-1);
  const c = petColor(p);
  return `<div class="card chart">
    <div class="meta"><span class="big-num" style="font-size:28px">${kg(ws.at(-1).kg)} кг</span><span class="pill">${deltaText(ws)}</span></div>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Вес: от ${kg(shown[0].kg)} до ${kg(shown.at(-1).kg)} кг">
      <path d="M${pts[0][0]},${H} L${line.replace(/ /g, ' L')} L${last[0]},${H} Z" fill="${c.bg}" style="fill-opacity:var(--area-opacity)"/>
      <polyline points="${line}" fill="none" stroke="var(--ink)" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
      ${pts.slice(0, -1).map(q => `<circle cx="${q[0]}" cy="${q[1]}" r="3.5" fill="var(--card)" stroke="var(--ink)" stroke-width="2"/>`).join('')}
      <circle cx="${last[0]}" cy="${last[1]}" r="7" fill="${c.strong}"/>
    </svg>
    <div class="months">${shown.map((w, i) => { const m = parseIso(w.date).getMonth(); return `<span>${i && parseIso(shown[i - 1].date).getMonth() === m ? '' : MON1[m]}</span>`; }).join('')}</div>
  </div>`;
}

function viewPet(id) {
  const p = petById(id);
  if (!p) return viewMissing();
  if (state.segPet !== id) { state.seg = 'treatment'; state.segPet = id; }
  const ws = petWeights(p.id);
  const segBtn = (v, label) => `<button data-act="seg" data-v="${v}" aria-pressed="${state.seg === v}">${label}</button>`;
  let body;
  if (state.seg === 'weight') {
    body = `${ws.length ? `<div class="card list">${ws.slice().reverse().map(w => `<div class="line"><span class="title">${kg(w.kg)} кг</span><span class="row-btns" style="align-items:center"><span class="small">${fmtFull(parseIso(w.date))}</span><button class="btn-icon plain" data-act="del-weight" data-id="${w.id}" aria-label="Удалить взвешивание ${kg(w.kg)} кг">${ICONS.trash}</button></span></div>`).join('')}</div>` : ''}
      <button class="btn-wide" data-act="add" data-type="weight" data-pet="${p.id}">Записать вес</button>`;
  } else {
    const next = upcoming({ pet: p.id, type: state.seg });
    const hot = next.filter(u => u.status === 'hot'), rest = next.filter(u => u.status !== 'hot');
    const hist = db.records.filter(r => r.pet === p.id && r.type === state.seg).sort((a, b) => b.date.localeCompare(a.date) || b.created - a.created);
    body = `${hot.map(u => hotCard(u, false)).join('')}
      ${rest.length ? `<div class="card list">${rest.map(u => itemRow(u, false)).join('')}</div>` : ''}
      ${!next.length ? '<div class="card list"><div class="empty">Ничего не запланировано.</div></div>' : ''}
      ${hist.length ? `<h2 class="h2">История</h2>
      <div class="card list">${hist.map(r => `<div class="line"><span class="grow" style="gap:0"><span class="title">${esc(r.title)}</span><span class="small">${esc([r.note, r.months ? every(r.months) : 'без напоминания'].filter(Boolean).join(' · '))}</span></span><span class="row-btns" style="align-items:center;flex-wrap:nowrap"><span class="small">${fmtFull(parseIso(r.date))}</span><button class="btn-icon plain" data-act="del-record" data-id="${r.id}" aria-label="Удалить запись ${esc(r.title)} от ${fmtFull(parseIso(r.date))}">${ICONS.trash}</button></span></div>`).join('')}</div>` : ''}
      <button class="btn-wide" data-act="add" data-type="${state.seg}" data-pet="${p.id}">Добавить ${TYPE_ACC[state.seg]}</button>`;
  }
  const metaLine = [p.breed || KIND[p.kind], age(p.birth)].filter(Boolean).join(' · ');
  return `<div class="head"><a class="round" href="#/pets" aria-label="Назад к питомцам">${ICONS.back}</a><a class="round" href="#/pet/${p.id}/edit" aria-label="Изменить данные питомца">${ICONS.edit}</a></div>
    <header class="pet-head">${avatar(p, 80)}<div class="top"><h1 class="h1" style="font-size:34px">${esc(p.name)}</h1><span class="eyebrow">${esc(metaLine)}</span></div></header>
    ${weightChart(ws, p)}
    <div class="seg" role="group" aria-label="Раздел">${segBtn('treatment', 'Обработки')}${segBtn('vaccine', 'Прививки')}${segBtn('weight', 'Вес')}</div>
    ${body}
    <p class="note">Сроки указываете вы, по совету врача или инструкции препарата. Хвостик напоминает, но не заменяет ветеринара.</p>`;
}

function viewPetForm(id) {
  const p = id ? petById(id) : null;
  if (id && !p) return viewMissing();
  const v = p || { name: '', kind: 'dog', breed: '', birth: '', color: db.pets.length % PET_COLORS.length };
  const kindOpt = (k, label) => `<label class="opt"><input type="radio" name="kind" value="${k}" ${v.kind === k ? 'checked' : ''}><span>${label}</span></label>`;
  return `<div class="head"><a class="round" href="${p ? '#/pet/' + p.id : '#/pets'}" aria-label="Назад">${ICONS.back}</a></div>
    <h1 class="h1">${p ? 'Изменить данные' : 'Новый питомец'}</h1>
    <form class="card pad form" id="pet-form" data-id="${p ? p.id : ''}" novalidate>
      <div class="field"><label for="pf-name">Кличка</label><input id="pf-name" name="name" type="text" maxlength="40" autocomplete="off" value="${esc(v.name)}" required></div>
      <fieldset class="field"><legend>Кто это</legend><div class="chips">${kindOpt('dog', 'Собака')}${kindOpt('cat', 'Кошка')}${kindOpt('other', 'Другой')}</div></fieldset>
      <div class="field"><label for="pf-breed">Порода (если знаете)</label><input id="pf-breed" name="breed" type="text" maxlength="60" autocomplete="off" value="${esc(v.breed)}"></div>
      <div class="field"><label for="pf-birth">Дата рождения (можно примерно)</label><input id="pf-birth" name="birth" type="date" max="${iso(T)}" value="${esc(v.birth)}"></div>
      <fieldset class="field"><legend>Цвет в приложении</legend><div class="chips">${PET_COLORS.map((c, i) => `<label class="opt swatch" title="${c.name}"><input type="radio" name="color" value="${i}" ${v.color === i ? 'checked' : ''} aria-label="${c.name}"><span style="background:${c.bg}"></span></label>`).join('')}</div></fieldset>
      <p class="err" id="pf-err" hidden></p>
      <button class="btn-primary" type="submit">${p ? 'Сохранить' : 'Добавить питомца'}</button>
    </form>
    ${p ? `<button class="btn-danger" data-act="del-pet" data-id="${p.id}">Удалить ${esc(p.name)} и все записи</button>` : ''}`;
}

function viewSettings() {
  const theme = getTheme();
  const themeBtn = (v, label) => `<button class="chip" data-act="theme" data-v="${v}" aria-pressed="${theme === v}">${label}</button>`;
  const counts = `${db.pets.length} ${plural(db.pets.length, 'питомец', 'питомца', 'питомцев')}, ${db.records.length} ${plural(db.records.length, 'запись', 'записи', 'записей')}, ${db.weights.length} ${plural(db.weights.length, 'взвешивание', 'взвешивания', 'взвешиваний')}`;
  return `<h1 class="h1">Настройки</h1>
    <section class="card pad stack"><span class="title">Тема</span><div class="chips">${themeBtn('system', 'Как в системе')}${themeBtn('light', 'Светлая')}${themeBtn('dark', 'Тёмная')}</div></section>
    <section class="card pad stack">
      <span class="title">Резервная копия</span>
      <p class="para small">Записи хранятся только в этом браузере: ${counts}. Если очистить данные браузера или сменить устройство, они пропадут. Скачивайте копию время от времени.</p>
      <div class="row-btns"><button class="btn-dark" data-act="export" ${db.pets.length ? '' : 'disabled style="opacity:.5"'}>Скачать копию</button><button class="btn-light" style="box-shadow:inset 0 0 0 1.5px var(--divider)" data-act="import">Загрузить из файла</button></div>
    </section>
    <section class="card pad stack">
      <span class="title">Установить на телефон</span>
      <p class="para small">iPhone: откройте сайт в Safari, нажмите «Поделиться» и выберите «На экран Домой». Android: в меню Chrome выберите «Добавить на главный экран». Хвостик откроется как отдельное приложение и будет работать без интернета.</p>
    </section>
    <section class="card pad stack">
      <span class="title">Скоро</span>
      <p class="para small">Вход с разных устройств, напоминания на телефон и общий доступ для семьи.</p>
    </section>
    <button class="btn-danger" data-act="wipe" ${db.pets.length ? '' : 'disabled style="opacity:.5"'}>Удалить все данные</button>
    <p class="note">Хвостик ${APP_VERSION}. Напоминает о сроках, но не заменяет ветеринара.</p>`;
}

const viewMissing = () => `<h1 class="h1">Такой страницы нет</h1><div class="card pad stack"><span class="small">Возможно, питомца удалили.</span><div class="row-btns"><a class="btn-dark" href="#/">На главную</a></div></div>`;

// ---------- Маршруты ----------
function currentRoute() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (!parts.length) return { name: 'feed' };
  if (parts[0] === 'pets' && parts[1] === 'new') return { name: 'pet-new', tab: 'pets' };
  if (parts[0] === 'pets') return { name: 'pets', tab: 'pets' };
  if (parts[0] === 'pet' && parts[1] && parts[2] === 'edit') return { name: 'pet-edit', id: parts[1], tab: 'pets' };
  if (parts[0] === 'pet' && parts[1]) return { name: 'pet', id: parts[1], tab: 'pets' };
  if (parts[0] === 'settings') return { name: 'settings', tab: 'settings' };
  return { name: 'missing' };
}

const main = document.getElementById('main');
let lastRouteKey = '';
function render() {
  const r = currentRoute();
  const html = r.name === 'feed' ? viewFeed()
    : r.name === 'pets' ? viewPets()
    : r.name === 'pet' ? viewPet(r.id)
    : r.name === 'pet-new' ? viewPetForm(null)
    : r.name === 'pet-edit' ? viewPetForm(r.id)
    : r.name === 'settings' ? viewSettings()
    : viewMissing();
  main.innerHTML = html;
  main.classList.toggle('narrow', ['pet', 'pet-new', 'pet-edit', 'settings'].includes(r.name));
  const tab = r.tab || 'feed';
  document.querySelectorAll('.nav [data-route]').forEach(a => {
    if (a.dataset.route === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  const key = location.hash;
  if (key !== lastRouteKey) { window.scrollTo(0, 0); lastRouteKey = key; }
  const overdue = db.pets.length ? upcoming().filter(u => u.status === 'hot').length : 0;
  document.title = overdue ? `(${overdue}) Хвостик` : 'Хвостик';
}
window.addEventListener('hashchange', () => { closeSheet(); render(); main.focus({ preventScroll: true }); });

// ---------- Уведомление внизу ----------
let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
}

// ---------- Нижний лист: новая запись и подтверждения ----------
const sheetHost = document.getElementById('sheet');
let sheet = null;
const SUGGEST = { vaccine: ['Комплексная прививка', 'Бешенство'], treatment: ['Клещи и блохи', 'Глисты', 'Блохи'] };

function closeSheet() { sheet = null; sheetHost.innerHTML = ''; }

function openAdd(type, pet) {
  if (!db.pets.length) { toast('Сначала добавьте питомца'); location.hash = '#/pets/new'; return; }
  const r = currentRoute();
  const t = type || (r.name === 'pet' ? state.seg : 'treatment');
  sheet = { kind: 'add', type: t, pet: pet || (r.name === 'pet' && petById(r.id) ? r.id : db.pets[0].id), months: t === 'vaccine' ? 12 : 3, error: '' };
  sheetHost.innerHTML = '';
  renderSheet();
  setTimeout(() => { const f = document.getElementById(sheet && sheet.type === 'weight' ? 'f-kg' : 'f-title'); if (f) f.focus(); }, 30);
}

function openConfirm({ title, text, ok, onOk }) {
  sheet = { kind: 'confirm', title, text, ok, onOk };
  renderSheet();
}

function renderSheet() {
  if (!sheet) { sheetHost.innerHTML = ''; return; }
  if (sheet.kind === 'confirm') {
    sheetHost.innerHTML = `<div class="scrim" data-act="sheet-cancel"><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sh-title">
      <div class="grip"></div><h3 id="sh-title">${esc(sheet.title)}</h3><p class="para">${esc(sheet.text)}</p>
      <div class="actions"><button type="button" class="btn-light" data-act="sheet-cancel">Отмена</button><button type="button" class="btn-primary" style="background:var(--danger);color:#fff" data-act="confirm-ok">${esc(sheet.ok)}</button></div>
    </div></div>`;
    return;
  }
  const prev = id => { const el = document.getElementById(id); return el ? el.value : null; };
  const title = prev('f-title') ?? '', date = prev('f-date') ?? iso(T), note = prev('f-note') ?? '', w = prev('f-kg') ?? '';
  const isW = sheet.type === 'weight';
  const tile = (v, label) => `<button type="button" data-act="sheet-type" data-v="${v}" aria-pressed="${sheet.type === v}">${ICONS[v]}${label}</button>`;
  const remindBase = isIso(date) ? parseIso(date) : T;
  const remind = sheet.months ? `Напомним ${fmtFull(addMonths(remindBase, sheet.months))}.` : 'Без напоминания.';
  sheetHost.innerHTML = `<div class="scrim" data-act="sheet-cancel"><form class="sheet" id="add-form" role="dialog" aria-modal="true" aria-labelledby="sh-title" novalidate>
    <div class="grip"></div>
    <h3 id="sh-title">Новая запись</h3>
    <fieldset class="field"><legend>Кто</legend><div class="who">${db.pets.map(p => `<button type="button" data-act="sheet-pet" data-v="${p.id}" aria-pressed="${sheet.pet === p.id}" style="${sheet.pet === p.id ? 'background:' + petColor(p).bg : ''}">${esc(p.name)}</button>`).join('')}</div></fieldset>
    <fieldset class="field"><legend>Что</legend><div class="tiles">${tile('vaccine', 'Прививка')}${tile('treatment', 'Обработка')}${tile('weight', 'Вес')}</div></fieldset>
    ${isW ? `<div class="field"><label for="f-kg">Сколько весит, кг</label><input id="f-kg" type="text" inputmode="decimal" placeholder="Например, 12,4" value="${esc(w)}" autocomplete="off"></div>`
      : `<div class="field"><label for="f-title">${sheet.type === 'vaccine' ? 'Какая прививка' : 'От чего обработка'}</label><input id="f-title" type="text" maxlength="80" autocomplete="off" placeholder="${sheet.type === 'vaccine' ? 'Например, бешенство' : 'Например, клещи и блохи'}" value="${esc(title)}">
         <div class="chips">${SUGGEST[sheet.type].map(s => `<button type="button" class="chip ghost" data-act="suggest" data-v="${esc(s)}">${esc(s)}</button>`).join('')}</div></div>`}
    <div class="field"><label for="f-date">Когда</label><input id="f-date" type="date" value="${esc(date)}" max="${iso(T)}"></div>
    ${isW ? '' : `<fieldset class="field"><legend>Напомнить снова через</legend><div class="chips">${[[1, '1 мес'], [3, '3 мес'], [6, '6 мес'], [12, '1 год']].map(([m, l]) => `<button type="button" class="chip" data-act="sheet-months" data-v="${m}" aria-pressed="${sheet.months === m}">${l}</button>`).join('')}<button type="button" class="chip" data-act="sheet-months" data-v="0" aria-pressed="${sheet.months === 0}">не надо</button></div><span class="small">${remind} Срок подскажет ветеринар или инструкция.</span></fieldset>
    <div class="field"><label for="f-note">Заметка</label><input id="f-note" type="text" maxlength="120" autocomplete="off" placeholder="Препарат, клиника" value="${esc(note)}"></div>`}
    ${sheet.error ? `<p class="err" role="alert">${esc(sheet.error)}</p>` : ''}
    <div class="actions"><button type="button" class="btn-light" data-act="sheet-cancel">Отмена</button><button type="submit" class="btn-primary">Сохранить</button></div>
  </form></div>`;
}

function saveAdd() {
  const dateVal = document.getElementById('f-date').value;
  if (!isIso(dateVal)) { sheet.error = 'Укажите дату.'; renderSheet(); return; }
  if (parseIso(dateVal) > T) { sheet.error = 'Дата не может быть в будущем.'; renderSheet(); return; }
  const p = petById(sheet.pet);
  if (sheet.type === 'weight') {
    const v = parseFloat(String(document.getElementById('f-kg').value).replace(',', '.').replace(/\s/g, ''));
    if (!(v > 0 && v < 200)) { sheet.error = 'Напишите вес в килограммах, например 12,4.'; renderSheet(); return; }
    db.weights.push({ id: uid(), pet: p.id, date: dateVal, kg: Math.round(v * 100) / 100 });
    if (!save()) return;
    toast(`${p.name}: записали ${kg(v)} кг`);
  } else {
    const title = document.getElementById('f-title').value.trim();
    if (!title) { sheet.error = sheet.type === 'vaccine' ? 'Напишите, какая это прививка.' : 'Напишите, от чего обработка.'; renderSheet(); return; }
    db.records.push({ id: uid(), pet: p.id, type: sheet.type, title: title.slice(0, 80), date: dateVal, months: sheet.months, note: document.getElementById('f-note').value.trim().slice(0, 120), snooze: null, created: Date.now() });
    if (!save()) return;
    toast(sheet.months ? `Записали. Напомним ${fmtFull(addMonths(parseIso(dateVal), sheet.months))}` : 'Записали без напоминания');
  }
  closeSheet(); render();
}

// ---------- Тема ----------
function getTheme() { try { const t = localStorage.getItem(THEME_KEY); return t === 'light' || t === 'dark' ? t : 'system'; } catch (e) { return 'system'; } }
function applyTheme() {
  const t = getTheme(), root = document.documentElement;
  if (t === 'system') delete root.dataset.theme; else root.dataset.theme = t;
  const dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]').setAttribute('content', dark ? '#161A18' : '#D4F0DE');
}
window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);

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
    const apply = () => { db = data; save(); closeSheet(); render(); toast(`Загрузили: ${data.pets.length} ${plural(data.pets.length, 'питомец', 'питомца', 'питомцев')}`); };
    if (!db.pets.length) apply();
    else openConfirm({ title: 'Заменить данные?', text: `Сейчас в Хвостике ${db.pets.length} ${plural(db.pets.length, 'питомец', 'питомца', 'питомцев')}. Они заменятся данными из файла (${data.pets.length} ${plural(data.pets.length, 'питомец', 'питомца', 'питомцев')}).`, ok: 'Заменить', onOk: apply });
  };
  reader.onerror = () => toast('Не получилось прочитать файл.');
  reader.readAsText(file);
});

// ---------- Действия ----------
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  if (el.classList.contains('scrim') && e.target !== el) return;
  const act = el.dataset.act, v = el.dataset.v;
  switch (act) {
    case 'add': openAdd(el.dataset.type, el.dataset.pet); break;
    case 'seg': state.seg = v; render(); break;
    case 'done': {
      const r = db.records.find(x => x.id === el.dataset.id);
      if (!r) break;
      db.records.push({ id: uid(), pet: r.pet, type: r.type, title: r.title, date: iso(T), months: r.months, note: r.note, snooze: null, created: Date.now() });
      if (save()) toast(`${petById(r.pet).name}: отмечено. Следующий раз ${fmtFull(addMonths(T, r.months))}`);
      render(); break;
    }
    case 'snooze': {
      const r = db.records.find(x => x.id === el.dataset.id);
      if (!r) break;
      r.snooze = iso(addDays(T, 1));
      if (save()) toast(`Хорошо, напомним завтра, ${fmtFull(addDays(T, 1))}`);
      render(); break;
    }
    case 'del-record': {
      const r = db.records.find(x => x.id === el.dataset.id);
      if (!r) break;
      openConfirm({ title: 'Удалить запись?', text: `${r.title}, ${fmtFull(parseIso(r.date))}. Это действие не отменить.`, ok: 'Удалить', onOk: () => { db.records = db.records.filter(x => x.id !== r.id); save(); closeSheet(); render(); toast('Запись удалена'); } });
      break;
    }
    case 'del-weight': {
      const w = db.weights.find(x => x.id === el.dataset.id);
      if (!w) break;
      openConfirm({ title: 'Удалить взвешивание?', text: `${kg(w.kg)} кг, ${fmtFull(parseIso(w.date))}.`, ok: 'Удалить', onOk: () => { db.weights = db.weights.filter(x => x.id !== w.id); save(); closeSheet(); render(); toast('Взвешивание удалено'); } });
      break;
    }
    case 'del-pet': {
      const p = petById(el.dataset.id);
      if (!p) break;
      const n = db.records.filter(r => r.pet === p.id).length + db.weights.filter(w => w.pet === p.id).length;
      openConfirm({ title: `Удалить ${p.name}?`, text: `Вместе с питомцем удалятся все его записи (${n}). Это действие не отменить.`, ok: 'Удалить', onOk: () => {
        db.pets = db.pets.filter(x => x.id !== p.id);
        db.records = db.records.filter(r => r.pet !== p.id);
        db.weights = db.weights.filter(w => w.pet !== p.id);
        if (!db.pets.length) db.demo = false;
        save(); closeSheet(); location.hash = '#/pets'; toast(`${p.name} удалён из журнала`);
      } });
      break;
    }
    case 'demo': db = demoData(); save(); render(); toast('Загрузили пример. Его можно убрать одной кнопкой.'); break;
    case 'clear-demo': openConfirm({ title: 'Убрать пример?', text: 'Рекс, Мурка и все их записи удалятся. Если вы добавили что-то своё, оно тоже удалится.', ok: 'Убрать', onOk: () => { db = emptyData(); save(); closeSheet(); render(); } }); break;
    case 'theme': try { if (v === 'system') localStorage.removeItem(THEME_KEY); else localStorage.setItem(THEME_KEY, v); } catch (err) { /* тема просто не запомнится */ } applyTheme(); render(); break;
    case 'export': exportData(); break;
    case 'import': importInput.click(); break;
    case 'wipe': openConfirm({ title: 'Удалить все данные?', text: 'Все питомцы и записи удалятся из этого браузера. Если нужна копия, сначала скачайте её.', ok: 'Удалить всё', onOk: () => { db = emptyData(); save(); closeSheet(); location.hash = '#/'; render(); toast('Все данные удалены'); } }); break;
    case 'sheet-cancel': closeSheet(); break;
    case 'confirm-ok': if (sheet && sheet.onOk) sheet.onOk(); break;
    case 'sheet-pet': sheet.pet = v; renderSheet(); break;
    case 'sheet-type': sheet.type = v; sheet.months = v === 'vaccine' ? 12 : 3; sheet.error = ''; renderSheet(); break;
    case 'sheet-months': sheet.months = Number(v); renderSheet(); break;
    case 'suggest': document.getElementById('f-title').value = v; break;
  }
});

document.addEventListener('submit', e => {
  if (e.target.id === 'add-form') { e.preventDefault(); saveAdd(); return; }
  if (e.target.id === 'pet-form') {
    e.preventDefault();
    const f = e.target, id = f.dataset.id;
    const name = f.elements.name.value.trim();
    const err = document.getElementById('pf-err');
    if (!name) { err.textContent = 'Напишите кличку.'; err.hidden = false; f.elements.name.focus(); return; }
    const birth = f.elements.birth.value;
    if (birth && (!isIso(birth) || parseIso(birth) > T)) { err.textContent = 'Дата рождения не может быть в будущем.'; err.hidden = false; return; }
    const data = { name: name.slice(0, 40), kind: f.elements.kind.value || 'dog', breed: f.elements.breed.value.trim().slice(0, 60), birth: birth || '', color: Number(f.elements.color.value) || 0 };
    let pid = id;
    if (id) Object.assign(petById(id), data);
    else { pid = uid(); db.pets.push({ id: pid, ...data }); }
    if (!save()) return;
    toast(id ? 'Сохранили' : `${data.name} в журнале. Добавьте последнюю прививку или обработку.`);
    location.hash = '#/pet/' + pid;
  }
});
document.addEventListener('change', e => { if (e.target.id === 'f-date' && sheet && sheet.kind === 'add') renderSheet(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && sheet) closeSheet(); });

// Если вкладка была открыта через полночь, пересчитываем «сегодня»
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  const now = todayDate();
  if (now.getTime() !== T.getTime()) { T = now; render(); }
});
// Данные, изменённые в другой вкладке
window.addEventListener('storage', e => { if (e.key === STORE_KEY) { db = load(); render(); } });

// ---------- Запуск ----------
applyTheme();
render();
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('/sw.js').catch(() => { /* без офлайна сайт всё равно работает */ });
}
