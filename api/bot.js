// api/bot.js
import { Telegraf, Markup } from "telegraf";
import { kv } from "@vercel/kv";

/** ====== Config ====== */
const WEBAPP_URL = "https://weks-miniapp.vercel.app"; // your Mini App URL
const DAILY_CAP = 100;                 // questions/day credited
const COINS_PER_CORRECT = 10;          // coins per correct answer

/** ====== Bot ====== */
const bot = new Telegraf(process.env.BOT_TOKEN);

/** ====== Helpers (KV schema) ======
 * user:<id>          -> { id, name, joined_at, referred_by? }
 * bal:<id>           -> integer balance
 * daily:<id>:<date>  -> integer questions_credited_today
 * ref_claimed:<id>   -> inviterId   (prevents double credit)
 * lb                 -> sorted set (score=balance, member=userId)
 */
const todayStr = () => new Date().toISOString().slice(0, 10);

async function ensureUser(ctx) {
  const id = String(ctx.from.id);
  const key = `user:${id}`;
  let u = await kv.get(key);
  if (!u) {
    u = { id, name: ctx.from.first_name || "Player", joined_at: Date.now() };
    await kv.set(key, u);
    await kv.set(`bal:${id}`, 0);
    await kv.zadd("lb", { score: 0, member: id });
  }
  return u;
}

async function addCoins(id, amount) {
  const newBal = await kv.incrby(`bal:${id}`, amount);
  await kv.zadd("lb", { score: newBal, member: String(id) });
  return newBal;
}

const getBalance = (id) => kv.get(`bal:${id}`).then(v => v ?? 0);
const getTodayCount = (id) => kv.get(`daily:${id}:${todayStr()}`).then(v => v ?? 0);
const addTodayCount = (id, n) => kv.incrby(`daily:${id}:${todayStr()}`, n);

/** ====== /start (with referrals) ====== */
bot.start(async (ctx) => {
  await ensureUser(ctx);
  const me = String(ctx.from.id);

  // referral payload pattern: start=ref_<inviterId>
  const payload = ctx.startPayload || "";
  if (payload.startsWith("ref_")) {
    const inviter = payload.slice(4);
    if (inviter && inviter !== me) {
      const already = await kv.get(`ref_claimed:${me}`);
      if (!already) {
        await kv.set(`ref_claimed:${me}`, inviter);
        await addCoins(inviter, 2000);
        await ctx.telegram.sendMessage(inviter, "🎉 Your invite joined! +2,000 coins credited.");
      }
    }
  }

  const bal = await getBalance(me);
  const done = await getTodayCount(me);

  await ctx.reply(
    `👋 Hi ${ctx.from.first_name || "there"}!\n\n` +
    `Welcome to *WEKS Tap-To-Math*.\n\n` +
    `• Earn ${COINS_PER_CORRECT} coins per correct answer\n` +
    `• Daily cap: ${DAILY_CAP} questions\n` +
    `• Invite friends: +2,000 coins each\n\n` +
    `Today: *${done}/${DAILY_CAP}* — Balance: *${bal}*\n\nTap to play:`,
    {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([Markup.button.webApp("▶️ Play WEKS", WEBAPP_URL)])
    }
  );
});

/** ====== Commands ====== */
bot.command("balance", async (ctx) => {
  await ensureUser(ctx);
  const bal = await getBalance(ctx.from.id);
  return ctx.reply(`💰 Balance: ${bal} coins`);
});

bot.command("invite", async (ctx) => {
  await ensureUser(ctx);
  const uname = (await ctx.telegram.getMe()).username;
  const link = `https://t.me/${uname}?start=ref_${ctx.from.id}`;
  return ctx.reply(`👯 Invite friends and earn +2,000 each!\nYour link:\n${link}`);
});

bot.command("leaderboard", async (ctx) => {
  const top = await kv.zrevrange("lb", 0, 9, { withScores: true });
  if (!top || top.length === 0) return ctx.reply("No players yet.");
  let out = "🏆 Top Players\n";
  for (let i = 0; i < top.length; i += 2) {
    const uid = top[i], score = top[i + 1];
    const u = await kv.get(`user:${uid}`);
    out += `${i/2 + 1}. ${u?.name || uid} — ${score} coins\n`;
  }
  return ctx.reply(out);
});

bot.command("tasks", async (ctx) => {
  await ensureUser(ctx);
  const done = await getTodayCount(ctx.from.id);
  return ctx.reply(`🗓️ Today credited: ${done}/${DAILY_CAP} questions`);
});

/** ====== WebApp Claim Handler ======
 * Mini App sends: tg.sendData(JSON.stringify({ t:'claim', correct }))
 * We cap by remaining allowance, credit coins, and reply.
 */
bot.on("message", async (ctx) => {
  const data = ctx.message?.web_app_data?.data;
  if (!data) return; // ignore other messages

  try {
    const msg = JSON.parse(data);
    if (msg?.t !== "claim") return;

    const me = String(ctx.from.id);
    await ensureUser(ctx);

    const correctRaw = Number(msg.correct || 0);
    if (!Number.isFinite(correctRaw) || correctRaw <= 0) {
      return ctx.reply("❓ Nothing to claim.");
    }

    const done = await getTodayCount(me);
    const remaining = Math.max(DAILY_CAP - done, 0);
    const creditedQ = Math.min(correctRaw, remaining);

    if (creditedQ <= 0) {
      return ctx.reply(`✔️ Daily cap reached (${DAILY_CAP}/day). Come back tomorrow!`);
    }

    await addTodayCount(me, creditedQ);
    const coins = creditedQ * COINS_PER_CORRECT;
    const newBal = await addCoins(me, coins);

    return ctx.reply(
      `✅ Claimed ${creditedQ} correct answers (+${coins} coins).\n` +
      `Today: ${done + creditedQ}/${DAILY_CAP}\n` +
      `💰 Balance: ${newBal}`
    );
  } catch (e) {
    console.error("web_app_data parse error:", e);
    // soft fail (no throw), avoid webhook retries
  }
});

/** ====== Vercel Serverless entry ====== */
export default async function handler(req, res) {
  if (req.method === "POST") {
    try { await bot.handleUpdate(req.body); } catch (e) { console.error(e); }
    return res.status(200).end();
  }
  return res.status(200).send("WEKS bot is running");
}
