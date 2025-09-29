// api/balance.js
import crypto from "crypto";
import { kv } from "@vercel/kv";

function verifyInitData(initData, botToken) {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;

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

  const userJson = params.get("user");
  if (!userJson) return null;
  try {
    const user = JSON.parse(userJson);
    return { id: String(user.id), name: user.first_name || "Player" };
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const { initData } = body;
    const auth = verifyInitData(initData, process.env.BOT_TOKEN);
    if (!auth) return res.status(401).json({ ok: false, error: "INVALID_INITDATA" });

    const bal = (await kv.get(`bal:${auth.id}`)) ?? 0;
    return res.status(200).json({ ok: true, balance: bal });
  } catch (e) {
    console.error("balance error:", e);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
}
