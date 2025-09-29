// api/claim.js
import crypto from "crypto";
import { kv } from "@vercel/kv";

// ===== config (keep in sync with bot.js) =====
const DAILY_CAP = 100;
const COINS_PER_CORRECT = 10;

// ----- KV helpers (same as in bot.js) -----
const todayStr = () => new Date().toISOString().slice(0, 10);
const getUserKey = (id) => `user:${id}`;

async function ensureUser(id, name = "Player") {
  const key = getUserKey(id);
  let u = await kv.get(key);
  if (!u) {
    u = { id, name, joined_at: Date.now() };
    await kv.set(key, u);
    await kv.set(`bal:${id}`, 0);
    await kv.zadd("lb", { score: 0, member: String(id) });
  }
  return u;
}

async function addCoins(id, amount) {
  const newBal = await kv.incrby(`bal:${id}`, amount);
  await kv.zadd("lb", { score: newBal, member: String(id) });
  return newBal;
}
const getBalance   = (id) => kv.get(`bal:${id}`).then(v => v ?? 0);
const getToday     = (id) => kv.get(`daily:${id}:${todayStr()}`).then(v => v ?? 0);
const addToday     = (id,n)=> kv.incrby(`daily:${id}:${todayStr()}`, n);

// ----- Telegram WebApp initData verification -----
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-web-app
function verifyInitData(initData, botToken) {
  if (!initData || !botToken) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;

  // Build data_check_string (all params except 'hash', sorted)
  const entries = [];
  for (const [k, v] of params.entries()) {
    if (k === "hash") continue;
    entries.push(`${k}=${v}`);
  }
  entries.sort();
  const dataCheckString = entries.join("\n");

  const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const calcHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  if (calcHash !== hash) return null;

  // Parse user payload
  const userJson = params.get("user");
  if (!userJson) return null;

  try {
    const user = JSON.parse(userJson);
    return {
      id: String(user.id),
      name: user.first_name || "Player"
    };
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
  }

  try {
    const { initData, correct } = req.body || {};
    const auth = verifyInitData(initData, process.env.BOT_TOKEN);
    if (!auth) {
      return res.status(401).json({ ok: false, error: "INVALID_INITDATA" });
    }

    const uid = auth.id;
    await ensureUser(uid, auth.name);

    const correctRaw = Number(correct || 0);
    if (!Number.isFinite(correctRaw) || correctRaw <= 0) {
      return res.status(400).json({ ok: false, error: "NOTHING_TO_CLAIM" });
    }

    const done = await getToday(uid);
    const remaining = Math.max(DAILY_CAP - done, 0);
    const creditedQ = Math.min(correctRaw, remaining);

    if (creditedQ <= 0) {
      const bal = await getBalance(uid);
      return res.status(200).json({
        ok: true,
        creditedQ: 0,
        coins: 0,
        today: done,
        dailyCap: DAILY_CAP,
        balance: bal,
        message: "DAILY_CAP_REACHED"
      });
    }

    await addToday(uid, creditedQ);
    const coins = creditedQ * COINS_PER_CORRECT;
    const newBal = await addCoins(uid, coins);

    return res.status(200).json({
      ok: true,
      creditedQ,
      coins,
      today: done + creditedQ,
      dailyCap: DAILY_CAP,
      balance: newBal
    });
  } catch (e) {
    console.error("claim error:", e);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
}
