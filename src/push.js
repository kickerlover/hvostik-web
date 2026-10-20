// Web Push без сторонних библиотек: шифрование сообщения (RFC 8291, aes128gcm) и подпись сервера VAPID (RFC 8292).
// Ключ сервера — секрет VAPID_PRIVATE_JWK (закрытый ключ P-256 в формате JWK), открытая часть выводится из него.

const enc = new TextEncoder();

export const b64u = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) { out.set(p, i); i += p.length; }
  return out;
};

async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

// Открытый ключ P-256 в виде 65 байт (0x04 || x || y) из JWK
const rawFromJwk = jwk => concat(new Uint8Array([4]), unb64u(jwk.x), unb64u(jwk.y));

export function vapidPublicKey(env) {
  return b64u(rawFromJwk(JSON.parse(env.VAPID_PRIVATE_JWK)));
}

// Зашифровать сообщение для подписки браузера. salt и serverKeys можно передать для проверки на примере из RFC 8291.
export async function encrypt(payload, p256dh, authSecret, { salt, serverKeys } = {}) {
  const uaPublic = unb64u(p256dh);
  const auth = unb64u(authSecret);
  salt = salt || crypto.getRandomValues(new Uint8Array(16));
  const keys = serverKeys || await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, keys.privateKey, 256));
  const ikm = await hkdf(auth, shared, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const plain = concat(typeof payload === 'string' ? enc.encode(payload) : payload, new Uint8Array([2])); // 2 — последняя запись
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, plain));
  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  return concat(header, asPublic, cipher);
}

// Подпись сервера для службы уведомлений (Apple, Google, Mozilla, Microsoft)
async function vapidHeader(endpoint, env) {
  const jwk = JSON.parse(env.VAPID_PRIVATE_JWK);
  const key = await crypto.subtle.importKey('jwk', { ...jwk, key_ops: ['sign'] }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const head = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT || 'https://hvostik.daniil-projects.workers.dev' })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(head + '.' + body));
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${b64u(rawFromJwk(jwk))}`;
}

// Отправить одно уведомление. Возвращает статус ответа службы: 201 — принято, 404/410 — подписки больше нет.
export async function sendPush(sub, message, env) {
  const body = await encrypt(JSON.stringify(message), sub.p256dh, sub.auth);
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      authorization: await vapidHeader(sub.endpoint, env),
      'content-encoding': 'aes128gcm',
      'content-type': 'application/octet-stream',
      ttl: '43200',      // если телефон выключен, служба хранит сообщение 12 часов
      urgency: 'normal'
    },
    body
  });
  return res.status;
}

// Только известные службы уведомлений: сервер не должен слать запросы по произвольным адресам
const PUSH_HOSTS = [/\.push\.apple\.com$/, /^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /\.push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/];
export function okEndpoint(v) {
  if (typeof v !== 'string' || v.length > 1000) return false;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' && PUSH_HOSTS.some(re => re.test(u.hostname));
  } catch { return false; }
}
