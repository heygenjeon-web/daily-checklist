// 주간 체크리스트 알림 서버 (Cloudflare Workers, 무료 요금제)
// 페이지가 「시간 정한 항목」과 「오늘 체크한 항목」을 보내 두면, 1분마다 그 시각에 아직 안 한 항목을 웹 푸시로 알린다.
// 저장(KV): users = 알림 받는 계정 uid 목록 · u:<uid> = { subs: 기기들, items: 시간 정한 항목, done: 오늘 끝낸 항목, tz }
// 로그인 확인은 Firebase ID 토큰(페이지와 같은 계정)으로 한다. 비밀 키(VAPID_PRIVATE)는 wrangler secret 으로만 넣는다.
const PROJECT = "my-checklist-90eda";
const APP_URL = "https://heygenjeon-web.github.io/daily-checklist/weekly/";
const ORIGINS = ["https://heygenjeon-web.github.io"];
const SUBJECT = "https://heygenjeon-web.github.io/daily-checklist/";
const GOOGLE_JWKS = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
// 알림 서비스 주소만 받는다 (애플 · 구글 크롬 · 모질라 · 마이크로소프트 엣지)
const PUSH_HOSTS = /(^|\.)(push\.apple\.com|fcm\.googleapis\.com|push\.services\.mozilla\.com|notify\.windows\.com)$/;

const te = new TextEncoder(), td = new TextDecoder();
export const b64u = {
  enc: b => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
  dec: s => Uint8Array.from(atob(String(s).replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(String(s).length / 4) * 4, "=")), c => c.charCodeAt(0)),
};
const cat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; a.forEach(x => { o.set(x, i); i += x.length; }); return o; };
const fail = (msg, status = 400) => Object.assign(new Error(msg), { status });

export default {
  async fetch(req, env, ctx) {
    const origin = req.headers.get("Origin") || "";
    const ok = ORIGINS.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    const cors = { "Access-Control-Allow-Origin": ok ? origin : ORIGINS[0], "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", Vary: "Origin" };
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    if (req.method !== "POST") return new Response("주간 체크 알림 서버", { headers: { ...cors, "Content-Type": "text/plain; charset=utf-8" } });
    try {
      const body = await req.json();
      const uid = await verify(body.token, env);
      return Response.json(await route(new URL(req.url).pathname, body, uid, env, ctx), { headers: cors });
    } catch (e) {
      return Response.json({ error: String((e && e.message) || e) }, { status: (e && e.status) || 500, headers: cors });
    }
  },
  async scheduled(event, env, ctx) { ctx.waitUntil(tick(event.scheduledTime, env)); },
};

// ---------- 로그인 확인 (Firebase ID 토큰 = RS256 JWT) ----------
let keyCache = { at: 0, keys: {} };
export async function verify(token, env) {
  const [h, p, s] = String(token || "").split(".");
  if (!s) throw fail("로그인 정보가 없습니다", 401);
  let head, claims;
  try { head = JSON.parse(td.decode(b64u.dec(h))); claims = JSON.parse(td.decode(b64u.dec(p))); } catch (e) { throw fail("로그인 정보를 읽지 못했습니다", 401); }
  const project = env.PROJECT || PROJECT, now = Date.now() / 1000;
  if (head.alg !== "RS256" || claims.aud !== project || claims.iss !== `https://securetoken.google.com/${project}`
    || !(claims.exp > now) || !(claims.iat < now + 300) || !claims.sub) throw fail("로그인이 만료되었습니다 — 페이지를 다시 여세요", 401);
  if (Date.now() - keyCache.at > 3600e3 || !keyCache.keys[head.kid]) {
    const { keys } = await (await fetch(env.JWKS_URL || GOOGLE_JWKS)).json();
    keyCache = { at: Date.now(), keys: Object.fromEntries(keys.map(k => [k.kid, k])) };
  }
  const jwk = keyCache.keys[head.kid];
  if (!jwk) throw fail("로그인 정보를 확인하지 못했습니다", 401);
  const key = await crypto.subtle.importKey("jwk", { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  if (!await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64u.dec(s), te.encode(`${h}.${p}`))) throw fail("로그인 정보를 확인하지 못했습니다", 401);
  return claims.sub;
}

// ---------- 페이지 요청 ----------
// /sub 이 기기 등록 · /unsub 해제 · /sched 항목만 · /test 이 기기로 시험 알림 — 어느 요청이든 sched(항목 · 오늘 끝낸 것)를 같이 받는다
async function route(path, b, uid, env, ctx) {
  const key = "u:" + uid, stored = await env.KV.get(key, "json");
  const u = stored || { subs: [], items: [], done: null, tz: -540 };
  const before = JSON.stringify(u);
  if (path === "/sub") {
    const s = cleanSub(b.sub, env);
    const old = u.subs.find(x => x.endpoint === s.endpoint);
    u.subs = u.subs.filter(x => x.endpoint !== s.endpoint).concat({ ...s, dev: String(b.dev || "").slice(0, 30), at: old ? old.at : Date.now() }).slice(-10);
  } else if (path === "/unsub") {
    u.subs = u.subs.filter(x => x.endpoint !== b.endpoint);
  } else if (!["/sched", "/test"].includes(path)) throw fail("없는 주소", 404);
  if (b.sched) Object.assign(u, cleanSched(b.sched));
  if (!u.subs.length) {  // 알림 받는 기기가 없으면 아무것도 남기지 않는다
    if (stored) { await env.KV.delete(key); await index(env, uid, false); }
    if (path === "/test") throw fail("이 기기 알림이 등록되어 있지 않습니다 — 알림을 다시 켜세요");
    return { ok: true, subs: 0 };
  }
  if (JSON.stringify(u) !== before) { await env.KV.put(key, JSON.stringify(u)); await index(env, uid, true); }
  if (path === "/test") {
    const s = u.subs.find(x => x.endpoint === b.endpoint);
    if (!s) throw fail("이 기기 알림이 등록되어 있지 않습니다 — 알림을 다시 켜세요");
    // 5초 뒤에 보낸다 — 앱이 화면에 떠 있으면 아이폰이 알림을 띄우지 않아서, 그 사이 홈 화면으로 나가 보게
    const later = async () => {
      await new Promise(r => setTimeout(r, env.TEST_DELAY ?? 5000));
      const r = await send(s, { title: "알림이 잘 옵니다", body: "항목에 정한 시간이 되면 이렇게 알려 드려요.", tag: "test" }, env);
      console.log("시험 알림", new URL(s.endpoint).hostname, r.status);
      if (r.status === 404 || r.status === 410) await drop(env, uid, [s.endpoint]);  // 지워진 기기 — 다음 시험에서 「다시 켜세요」
    };
    if (ctx) ctx.waitUntil(later().catch(e => console.log("시험 알림 실패", String(e)))); else await later();
    return { ok: true, subs: u.subs.length, delay: 5 };
  }
  return { ok: true, subs: u.subs.length };
}
function cleanSub(s, env) {
  let host = "";
  try { const url = new URL(s.endpoint); if (url.protocol === "https:" || env.TEST_PUSH) host = url.hostname; } catch (e) {}
  if (!host || !(PUSH_HOSTS.test(host) || (env.TEST_PUSH && host === env.TEST_PUSH))) throw fail("알림 주소가 올바르지 않습니다");
  const p256dh = String((s.keys || {}).p256dh || ""), auth = String((s.keys || {}).auth || "");
  if (b64u.dec(p256dh).length !== 65 || b64u.dec(auth).length !== 16) throw fail("알림 키가 올바르지 않습니다");
  return { endpoint: s.endpoint, keys: { p256dh, auth } };
}
function cleanSched(x) {
  const items = (Array.isArray(x.items) ? x.items : []).slice(0, 400)
    .filter(i => i && /^\d\d:\d\d$/.test(i.t) && (i.d === null || (Number.isInteger(i.d) && i.d >= 0 && i.d <= 6)))
    .map(i => ({ id: String(i.id).slice(0, 40), d: i.d, t: i.t, x: String(i.x || "").slice(0, 200) }));
  const done = x.done && /^\d{4}-\d\d-\d\d$/.test(x.done.date) ? { date: x.done.date, ids: (x.done.ids || []).slice(0, 600).map(v => String(v).slice(0, 40)) } : null;
  const tz = Number.isInteger(x.tz) && Math.abs(x.tz) <= 840 ? x.tz : -540;
  return { items, done, tz };
}
async function index(env, uid, on) {
  const list = (await env.KV.get("users", "json")) || [];
  if (list.includes(uid) === on) return;
  await env.KV.put("users", JSON.stringify(on ? [...list, uid].slice(-50) : list.filter(x => x !== uid)));
}

// ---------- 1분마다: 지금 시각에 아직 안 한 항목 알리기 ----------
export async function tick(when, env) {
  const uids = (await env.KV.get("users", "json")) || [];
  for (const uid of uids) {
    const key = "u:" + uid, u = await env.KV.get(key, "json");
    if (!u || !u.subs.length) continue;
    const local = new Date(Math.floor(when / 60000) * 60000 - (u.tz ?? -540) * 60000);  // 그 사람 시각을 UTC 자리에 담음
    const iso = local.toISOString(), date = iso.slice(0, 10), hm = iso.slice(11, 16), wd = (local.getUTCDay() + 6) % 7;
    const done = new Set(u.done && u.done.date === date ? u.done.ids : []);
    const seen = new Set();
    const due = u.items.filter(i => i.t === hm && (i.d === null || i.d === wd) && !done.has(i.id) && !seen.has(i.x) && seen.add(i.x));
    if (!due.length) continue;
    const msg = due.length === 1 ? { title: due[0].x, body: `${hm} · 지금 할 일` }
      : { title: `${hm} 할 일 ${due.length}개`, body: due.map(i => "· " + i.x).join("\n") };
    msg.tag = `${date} ${hm}`;
    const gone = [];
    for (const s of u.subs) {
      const r = await send(s, msg, env).catch(() => null);
      if (r && (r.status === 404 || r.status === 410)) gone.push(s.endpoint);  // 지워진 기기
    }
    if (gone.length) await drop(env, uid, gone);
  }
}
async function drop(env, uid, gone) {
  const key = "u:" + uid, u = await env.KV.get(key, "json");
  if (!u) return;
  u.subs = u.subs.filter(s => !gone.includes(s.endpoint));
  if (u.subs.length) await env.KV.put(key, JSON.stringify(u)); else { await env.KV.delete(key); await index(env, uid, false); }
}

// ---------- 웹 푸시 (RFC 8291 aes128gcm 암호화 + RFC 8292 VAPID) ----------
export async function send(sub, msg, env) {
  const body = await encrypt(sub.keys, te.encode(JSON.stringify({ ...msg, url: APP_URL })));
  return fetch(sub.endpoint, { method: "POST", body, headers: {
    Authorization: `vapid t=${await vapidJwt(new URL(sub.endpoint).origin, env)}, k=${env.VAPID_PUBLIC}`,
    "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", TTL: "900", Urgency: "high",
  } });
}
async function vapidJwt(aud, env) {
  const key = await crypto.subtle.importKey("jwk", JSON.parse(env.VAPID_PRIVATE), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const part = o => b64u.enc(te.encode(JSON.stringify(o)));
  const unsigned = `${part({ typ: "JWT", alg: "ES256" })}.${part({ aud, exp: Math.floor(Date.now() / 1000) + 3600, sub: SUBJECT })}`;
  return `${unsigned}.${b64u.enc(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, te.encode(unsigned)))}`;
}
const hkdf = async (salt, ikm, info, bytes) => new Uint8Array(await crypto.subtle.deriveBits(
  { name: "HKDF", hash: "SHA-256", salt, info }, await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]), bytes * 8));
// fixed 는 시험용(RFC 8291 부록 A 값) — 평소에는 새 키와 소금을 그때그때 만든다
export async function encrypt(keys, plain, fixed) {
  const ua = b64u.dec(keys.p256dh), auth = b64u.dec(keys.auth);
  const uaKey = await crypto.subtle.importKey("raw", ua, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const as = fixed ? fixed.pair : await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPub = new Uint8Array(await crypto.subtle.exportKey("raw", as.publicKey));
  const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, as.privateKey, 256));
  const salt = fixed ? fixed.salt : crypto.getRandomValues(new Uint8Array(16));
  const ikm = await hkdf(auth, secret, cat(te.encode("WebPush: info\0"), ua, asPub), 32);
  const cek = await hkdf(salt, ikm, te.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, te.encode("Content-Encoding: nonce\0"), 12);
  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aes, cat(plain, new Uint8Array([2]))));
  const head = new Uint8Array(21);
  head.set(salt); new DataView(head.buffer).setUint32(16, 4096); head[20] = 65;
  return cat(head, asPub, ct);
}
