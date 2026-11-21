// 사이트 카드 결제 (Vercel 서버리스 함수, 포트원 V2)
// GET  /api/pay                    상품·결제 수단 목록 + 결제 준비 여부 (누구나)
// POST /api/pay?action=start       주문 만들기 → 결제창에 넘길 값 (누구나) body: { item, channel, name, phone, email, org, agree }
// POST /api/pay?action=confirm     결제 확인 (누구나) body: { paymentId } — 서버가 포트원에서 직접 PAID·금액·KRW를 확인
// GET  /api/pay?list=1             결제된 주문 목록 (헤더 x-admin-key = ADMIN_KEY)
//
// 금액은 여기 ITEMS가 정한다. 화면이 보낸 금액·상태는 믿지 않는다.
// 필요한 환경 변수: Upstash(문의와 같은 것), PORTONE_API_SECRET(포트원 V2 API Secret — 채팅·코드에 넣지 않는다), ADMIN_KEY
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";

// 포트원 상점·채널 — 결제창에 쓰는 공개 값. 실연동 채널로 바꿀 때 여기만 고친다.
const STORE_ID = "store-3506bf74-71cf-4152-99e7-c81269e7c275";
const CHANNELS = [
  { id: "inicis", label: "신용·체크카드 (KG이니시스)", key: "channel-key-e7646789-b54a-4347-b50f-abd687b24d72" },
  { id: "kpn", label: "신용·체크카드 (한국결제네트웍스)", key: "channel-key-0b212ef6-ba3c-4991-9dca-86f2469de3af" },
];

// 카드로 받는 상품 — 작은 금액만(고액 납품형은 견적·계좌). 한 번 결제, 자동 결제 없음.
const ITEMS = [
  { id: "sys-month", title: "조직 운영 시스템 월 구독 1개월", desc: "업종 패키지 · 서버·업데이트·백업 포함", amount: 29000 },
  { id: "academy-lite", title: "학원 학습 진단 라이트 1개월", desc: "학생 30명까지 · 진단·맞춤 시험지·학생 앱", amount: 69000 },
];

const ORDER = (id) => "market:order:" + id; // 주문 한 건(JSON)
const PAID = "market:orders"; // 결제된 주문 id, 최신이 앞
const PENDING_SEC = 7 * 24 * 60 * 60; // 결제 안 된 주문은 7일 뒤 지움
const PER_HOUR = 10; // 같은 접속 주소에서 1시간에 만들 수 있는 주문 수
const API = () => process.env.PORTONE_API_BASE || "https://api.portone.io"; // 로컬 확인용으로만 바꿈

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

const secret = () => (process.env.PORTONE_API_SECRET || "").trim();

function clean(value, max) {
  return String(value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, "")
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

// 포트원에서 결제 한 건 읽기
async function fetchPayment(paymentId) {
  const res = await fetch(`${API()}/payments/${encodeURIComponent(paymentId)}`, {
    headers: { Authorization: `PortOne ${secret()}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  const d = await res.json();
  return {
    status: d.status || "UNKNOWN",
    amount: Number(d.amount?.total ?? -1),
    currency: d.currency || "",
    paidAt: d.paidAt || null,
    method: d.method?.card?.name || d.method?.type || null,
  };
}

async function cancelPayment(paymentId, reason) {
  try {
    const res = await fetch(`${API()}/payments/${encodeURIComponent(paymentId)}/cancel`, {
      method: "POST",
      headers: { Authorization: `PortOne ${secret()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
      signal: AbortSignal.timeout(15_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// 화면에 돌려줄 주문 요약(연락처는 빼고)
const view = (o) => ({ id: o.id, title: o.title, amount: o.amount, status: o.status, paidAt: o.paidAt, name: o.name });

async function loadOrder(id) {
  const raw = await redis(["GET", ORDER(id)]);
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function saveOrder(order, keep) {
  if (keep) await redis(["SET", ORDER(order.id), JSON.stringify(order)]);
  else await redis(["SET", ORDER(order.id), JSON.stringify(order), "EX", String(PENDING_SEC)]);
}

export default async function handler(req, res) {
  const url = new URL(req.url, "http://x");
  const ready = Boolean(redisConfig() && secret());

  try {
    if (req.method === "GET" && !url.searchParams.get("list")) {
      return send(res, 200, {
        ready,
        items: ITEMS.map(({ id, title, desc, amount }) => ({ id, title, desc, amount })),
        channels: CHANNELS.map(({ id, label }) => ({ id, label })),
      });
    }
    if (!redisConfig()) return send(res, 503, { error: "STORE_NOT_SET" });

    if (req.method === "GET") {
      if (!isAdmin(req)) return send(res, 401, { error: "NOT_ADMIN" });
      const ids = (await redis(["LRANGE", PAID, "0", "199"])) || [];
      const orders = (await Promise.all(ids.map(loadOrder))).filter(Boolean);
      return send(res, 200, { orders });
    }

    if (req.method !== "POST") return send(res, 405, { error: "METHOD" });
    if (!secret()) return send(res, 503, { error: "PAY_NOT_SET" });

    let body;
    try {
      body = await readBody(req);
    } catch {
      return send(res, 400, { error: "BAD_JSON" });
    }
    const action = url.searchParams.get("action");

    if (action === "start") {
      const item = ITEMS.find((i) => i.id === body.item);
      const channel = CHANNELS.find((c) => c.id === body.channel) || CHANNELS[0];
      if (!item) return send(res, 400, { error: "NO_ITEM" });
      const name = clean(body.name, 40);
      const phone = clean(body.phone, 20).replace(/[^0-9]/g, "");
      const email = clean(body.email, 100);
      const org = clean(body.org, 60);
      if (name.length < 2) return send(res, 400, { error: "NO_NAME" });
      if (!/^01[0-9]{8,9}$/.test(phone)) return send(res, 400, { error: "BAD_PHONE" });
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return send(res, 400, { error: "BAD_EMAIL" });
      if (body.agree !== true) return send(res, 400, { error: "NO_AGREE" });

      const ipKey = "market:rlpay:" + createHash("sha256").update(clientIp(req)).digest("hex").slice(0, 24);
      const count = await redis(["INCR", ipKey]);
      if (count === 1) await redis(["EXPIRE", ipKey, "3600"]);
      if (count > PER_HOUR) return send(res, 429, { error: "TOO_MANY" });

      // 주문 번호는 영문·숫자만(KPN은 하이픈 등 특수문자를 받지 않음)
      const id = "ord" + Date.now().toString(36) + randomUUID().replace(/-/g, "").slice(0, 10);
      const order = { id, at: Date.now(), item: item.id, title: item.title, amount: item.amount, channel: channel.id, name, phone, email, org, status: "READY", paidAt: null };
      await saveOrder(order, false);
      return send(res, 200, {
        storeId: STORE_ID,
        channelKey: channel.key,
        paymentId: id,
        orderName: item.title,
        amount: item.amount,
        // 구매자 ID: KPN은 필수. 휴대폰 번호로 만든 고정 값(번호 자체는 넣지 않음)
        customer: { customerId: "c-" + createHash("sha256").update(phone).digest("hex").slice(0, 20), fullName: name, phoneNumber: phone, email },
      });
    }

    if (action === "confirm") {
      const id = clean(body.paymentId, 64);
      const order = id && (await loadOrder(id));
      if (!order) return send(res, 404, { error: "NO_ORDER" });
      if (order.status === "PAID") return send(res, 200, { order: view(order) });

      const pay = await fetchPayment(id);
      if (!pay) return send(res, 502, { error: "PORTONE" });
      if (pay.status !== "PAID") return send(res, 200, { order: view({ ...order, status: pay.status }) });
      if (pay.amount !== order.amount || pay.currency !== "KRW") {
        // 금액이 다르면 받지 않고 바로 취소
        await cancelPayment(id, "결제 금액 불일치");
        order.status = "MISMATCH";
        await saveOrder(order, true);
        return send(res, 409, { error: "AMOUNT_MISMATCH" });
      }
      order.status = "PAID";
      order.paidAt = pay.paidAt || new Date().toISOString();
      order.method = pay.method;
      await saveOrder(order, true); // 결제 기록은 지우지 않음(전자상거래법 5년 보관)
      // 확인이 두 번 겹쳐도 목록에는 한 번만
      if ((await redis(["SADD", PAID + ":ids", id])) === 1) await redis(["LPUSH", PAID, id]);
      return send(res, 200, { order: view(order) });
    }

    return send(res, 400, { error: "ACTION" });
  } catch (err) {
    console.error("pay", err);
    return send(res, 500, { error: "SERVER" });
  }
}
