// 문의 저장·조회 (Vercel 서버리스 함수)
// POST /api/inquiry            문의 저장 (누구나)
// GET  /api/inquiry            문의 목록 (헤더 x-admin-key = ADMIN_KEY)
// POST /api/inquiry?action=done 처리 표시 (관리자) body: { id, done }
//
// 필요한 환경 변수
//   KV_REST_API_URL / KV_REST_API_TOKEN  (Vercel에서 Upstash를 연결하면 자동으로 들어옴)
//   또는 UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
//   ADMIN_KEY  관리자 화면 비밀번호 (직접 정함)
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";

const LIST = "market:inquiries"; // 최신이 앞
const DONE = "market:done"; // 처리한 문의 id 모음
const KEEP = 2000; // 이보다 오래된 문의는 지움
const PER_HOUR = 5; // 같은 접속 주소에서 1시간에 보낼 수 있는 문의 수

const LIMITS = { name: 40, contact: 100, product: 80, budget: 80, message: 2000, page: 200 };

const KEEP_MS = 365 * 24 * 60 * 60 * 1000; // 1년 지난 문의는 지움(동의 문구와 같게)

// 가장 오래된 쪽(리스트 끝)부터 1년 지난 것을 지운다. 문의가 들어올 때마다 조금씩.
async function pruneOld() {
  for (let i = 0; i < 10; i++) {
    const last = await redis(["LINDEX", LIST, "-1"]);
    if (!last) return;
    let at = 0;
    try {
      at = JSON.parse(last).at || 0;
    } catch {}
    if (Date.now() - at < KEEP_MS) return;
    const gone = await redis(["RPOP", LIST]);
    try {
      await redis(["SREM", DONE, JSON.parse(gone).id]);
    } catch {}
  }
}

function redisConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}

async function redis(command) {
  const cfg = redisConfig();
  const res = await fetch(cfg.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || `redis ${res.status}`);
  return data.result;
}

function clean(value, max) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, max);
}

function isAdmin(req) {
  const key = process.env.ADMIN_KEY || "";
  const given = String(req.headers["x-admin-key"] || "");
  if (key.length < 8 || !given) return false;
  const a = createHash("sha256").update(key).digest();
  const b = createHash("sha256").update(given).digest();
  return timingSafeEqual(a, b);
}

function clientIp(req) {
  const fwd = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return fwd || req.socket?.remoteAddress || "unknown";
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  if (!redisConfig()) return send(res, 503, { error: "STORE_NOT_SET" });

  try {
    if (req.method === "GET") {
      if (!isAdmin(req)) return send(res, 401, { error: "NOT_ADMIN" });
      const [raw, done] = await Promise.all([redis(["LRANGE", LIST, "0", "499"]), redis(["SMEMBERS", DONE])]);
      const doneSet = new Set(done || []);
      const items = (raw || [])
        .map((s) => {
          try {
            return JSON.parse(s);
          } catch {
            return null;
          }
        })
        .filter(Boolean)
        .map((it) => ({ ...it, done: doneSet.has(it.id) }));
      return send(res, 200, { items });
    }

    if (req.method !== "POST") return send(res, 405, { error: "METHOD" });

    const url = new URL(req.url, "http://x");
    let body;
    try {
      body = await readBody(req);
    } catch {
      return send(res, 400, { error: "BAD_JSON" });
    }

    if (url.searchParams.get("action") === "done") {
      if (!isAdmin(req)) return send(res, 401, { error: "NOT_ADMIN" });
      const id = clean(body.id, 64);
      if (!id) return send(res, 400, { error: "NO_ID" });
      await redis([body.done ? "SADD" : "SREM", DONE, id]);
      return send(res, 200, { ok: true });
    }

    // 봇이 채우는 숨은 칸
    if (clean(body.website, 200)) return send(res, 200, { ok: true });

    const item = {
      name: clean(body.name, LIMITS.name),
      contact: clean(body.contact, LIMITS.contact),
      product: clean(body.product, LIMITS.product),
      budget: clean(body.budget, LIMITS.budget),
      message: clean(body.message, LIMITS.message),
      page: clean(body.page, LIMITS.page),
    };
    if (!item.contact || item.contact.length < 5) return send(res, 400, { error: "NO_CONTACT" });
    if (!item.message || item.message.length < 5) return send(res, 400, { error: "NO_MESSAGE" });
    if (body.agree !== true) return send(res, 400, { error: "NO_AGREE" });

    const ipKey = "market:rl:" + createHash("sha256").update(clientIp(req)).digest("hex").slice(0, 24);
    const count = await redis(["INCR", ipKey]);
    if (count === 1) await redis(["EXPIRE", ipKey, "3600"]);
    if (count > PER_HOUR) return send(res, 429, { error: "TOO_MANY" });

    const record = { id: randomUUID(), at: Date.now(), ...item };
    await redis(["LPUSH", LIST, JSON.stringify(record)]);
    await redis(["LTRIM", LIST, "0", String(KEEP - 1)]);
    await pruneOld();
    return send(res, 200, { ok: true });
  } catch (err) {
    console.error("inquiry", err);
    return send(res, 500, { error: "SERVER" });
  }
}
