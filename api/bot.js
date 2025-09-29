// api/bot.js  (stable full version)
import { Telegraf, Markup } from "telegraf";
import { kv } from "@vercel/kv";

const WEBAPP_URL = "https://weks-miniapp.vercel.app";
const DAILY_CAP = 100;
const COINS_PER_CORRECT = 10;

const BOT_TOKEN = process.env.BOT_TOKEN || "";
const bot = new Telegraf(BOT_TOKEN);

const todayStr = () => new Date().toISOString().slice(0, 10);

async function ensureUser(ctx) {
  try {
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
  } catch (e) {
    console.error("ensureUser error:", e);
    return null;
  }
}
async function addCoins(id, n) {
  try {
    const newBal = await kv.incrby(`bal:${id}`, n);
    await kv.zadd("lb", { score: newBal, member: String(id) });
    return newBal;
  } catch (e) { console.error("addCoins error:", e); return null; }
}
const getBalance   = async (id) => (await kv.get(`bal:${id}`)) ?? 0;
const getToday     = async (id) => (await kv.get(`daily:${id}:${todayStr()}`)) ?? 0;
const addToday     = async (id,n)=> await kv.incrby(`daily:${id}:${todayStr()}`, n);

// basic health
bot.command("ping", (ctx) => ctx.reply("pong 🏓"));

// start (with referral)
bot.start(async (ctx) => {
  try {
    await ensureUser(ctx);
    const me = String(ctx.from.id);
    const payload = ctx.startPayload || "";
    if (payload.startsWith("ref_")) {
      const inviter = payload.slice(4);
      if (inviter && inviter !== me) {
        const already = await kv.get(`ref_claimed:${me}`).catch(()=>null);
        if (!already) {
          await kv.set(`ref_claimed:${me}`, inviter);
          await addCoins(inviter, 2000);
          await ctx.telegram.sendMessage(inviter, "🎉 Your invite joined! +2,000 coins credited.");
        }
      }
    }
    const bal = await getBalance(me);
    const done = await getToday(me);
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
  } catch (e) { console.error("/start error:", e); }
});

bot.command("balance", async (ctx) => {
  try {
    await ensureUser(ctx);
    const bal = await getBalance(ctx.from.id);
    return ctx.reply(`💰 Balance: ${bal} coins`);
  } catch (e) { console.error("/balance error:", e); }
});

bot.command("invite", async (ctx) => {
  try {
    await ensureUser(ctx);
    const uname = (await ctx.telegram.getMe()).username;
    return ctx.reply(`👯 Invite friends and earn +2,000 each!\nYour link:\nhttps://t.me/${uname}?start=ref_${ctx.from.id}`);
  } catch (e) { console.error("/invite error:", e); }
});

bot.command("leaderboard", async (ctx) => {
  try {
    const top = await kv.zrevrange("lb", 0, 9, { withScores: true });
    if (!top || top.length === 0) return ctx.reply("No players yet.");
    let out = "🏆 Top Players\n";
    for (let i = 0; i < top.length; i += 2) {
      const uid = top[i], score = top[i + 1];
      const u = await kv.get(`user:${uid}`).catch(()=>null);
      out += `${i/2 + 1}. ${u?.name || uid} — ${score} coins\n`;
    }
    return ctx.reply(out);
  } catch (e) { console.error("/leaderboard error:", e); }
});

bot.command("tasks", async (ctx) => {
  try {
    await ensureUser(ctx);
    const done = await getToday(ctx.from.id);
    return ctx.reply(`🗓️ Today credited: ${done}/${DAILY_CAP} questions`);
  } catch (e) { console.error("/tasks error:", e); }
});

// claim via web_app_data (still supported, though fetch /api/claim works too)
bot.on("message", async (ctx) => {
  try {
    const data = ctx.message?.web_app_data?.data;
    if (!data) return;
    const msg = JSON.parse(data);
    if (msg?.t !== "claim") return;

    const me = String(ctx.from.id);
    await ensureUser(ctx);
    const correctRaw = Number(msg.correct || 0);
    if (!Number.isFinite(correctRaw) || correctRaw <= 0) {
      return ctx.reply("❓ Nothing to claim.");
    }
    const done = await getToday(me);
    const remaining = Math.max(DAILY_CAP - done, 0);
    const creditedQ = Math.min(correctRaw, remaining);
    if (creditedQ <= 0) {
      return ctx.reply(`✔️ Daily cap reached (${DAILY_CAP}/day). Come back tomorrow!`);
    }
    await addToday(me, creditedQ);
    const coins = creditedQ *  COINS_PER_CORRECT;
    const newBal = await addCoins(me, coins);
    return ctx.reply(
      `✅ Claimed ${creditedQ} correct answers (+${coins} coins).\n` +
      `Today: ${done + creditedQ}/${DAILY_CAP}\n` +
      `💰 Balance: ${newBal}`
    );
  } catch (e) { console.error("web_app_data error:", e); }
});

// fallback visibility
bot.on("text", (ctx) => {
  if (!ctx.message.text.startsWith("/")) {
    return ctx.reply("Use /start, /balance, /invite, /leaderboard, /tasks");
  }
});

// Vercel entry — ALWAYS 200
export default async function handler(req, res) {
  try {
    if (req.method === "POST") {
      try { await bot.handleUpdate(req.body); } catch (e) { console.error("handleUpdate error:", e); }
      return res.status(200).end();
    }
    return res.status(200).send("WEKS bot is running");
  } catch (e) {
    console.error("top-level error:", e);
    return res.status(200).end();
  }
}
