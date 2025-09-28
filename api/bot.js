import { Telegraf, Markup } from "telegraf";
import { kv } from "@vercel/kv";

const bot = new Telegraf(process.env.BOT_TOKEN);
const WEBAPP_URL = "https://weks-miniapp.vercel.app";

// ------------ Helpers (Redis schema) --------------
// Keys:
// user:<id> -> { id, name, referred_by?, joined_at }
// bal:<id>  -> integer balance
// ref_claimed:<inviteeId> -> inviterId  (marker to avoid double-credit)
// lb       -> sorted set (score=balance, member=userId)

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
  const balKey = `bal:${id}`;
  const newBal = await kv.incrby(balKey, amount);
  await kv.zadd("lb", { score: newBal, member: String(id) });
  return newBal;
}

async function getBalance(id) {
  return (await kv.get(`bal:${id}`)) ?? 0;
}

// ------------ /start (+referrals) -----------------
// referral link: t.me/WeksMathGameBot?start=ref_<inviterId>
bot.start(async (ctx) => {
  await ensureUser(ctx);

  const me = String(ctx.from.id);
  const payload = ctx.startPayload || ""; // e.g., "ref_1234"

  if (payload.startsWith("ref_")) {
    const inviter = payload.split("ref_")[1];
    if (inviter && inviter !== me) {
      const already = await kv.get(`ref_claimed:${me}`);
      if (!already) {
        await kv.set(`ref_claimed:${me}`, inviter);
        await addCoins(inviter, 2000);
        await ctx.telegram.sendMessage(
          inviter,
          `🎉 Your invite joined! +2,000 coins credited.`
        );
      }
    }
  }

  const name = ctx.from.first_name || "there";
  const bal = await getBalance(me);

  await ctx.reply(
    `👋 Hi ${name}!\n\nWelcome to *WEKS Tap-To-Math*.\n\n` +
    `• Earn 10 coins per correct answer (game coming next)\n` +
    `• Invite friends: +2,000 coins each\n` +
    `• Your balance: *${bal} coins*\n\n` +
    `Tap to play:`,
    {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([ Markup.button.webApp("▶️ Play WEKS", WEBAPP_URL) ])
    }
  );
});

// ------------ Commands ----------------------------
bot.command("balance", async (ctx) => {
  await ensureUser(ctx);
  const bal = await getBalance(ctx.from.id);
  return ctx.reply(`💰 Balance: ${bal} coins`);
});

bot.command("invite", async (ctx) => {
  await ensureUser(ctx);
  const uname = (await ctx.telegram.getMe()).username;
  const link = `https://t.me/${uname}?start=ref_${ctx.from.id}`;
  return ctx.reply(
    `👯 Invite friends and earn +2,000 coins each!\nYour link:\n${link}`
  );
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

// Placeholder: add +10 coins when Mini App posts a "correct" event
// Later we'll send real events from your WebApp using tg.sendData / web_app_data.
bot.on("message", async (ctx) => {
  if (ctx.message?.web_app_data?.data) {
    const data = ctx.message.web_app_data.data; // e.g., "correct"
    if (data === "correct") {
      const newBal = await addCoins(ctx.from.id, 10);
      return ctx.reply(`✅ +10 coins! New balance: ${newBal}`);
    }
  }
});

// ------------ Vercel serverless entry -------------
export default async function handler(req, res) {
  if (req.method === "POST") {
    try {
      await bot.handleUpdate(req.body);
      return res.status(200).end();
    } catch (e) {
      console.error(e);
      return res.status(200).end();
    }
  }
  return res.status(200).send("WEKS bot is running");
}
