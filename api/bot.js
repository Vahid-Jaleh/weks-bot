import { Telegraf, Markup } from "telegraf";

// IMPORTANT: set BOT_TOKEN in Vercel Project Settings → Environment Variables
const bot = new Telegraf(process.env.BOT_TOKEN);

// Your Mini App URL
const WEBAPP_URL = "https://weks-miniapp.vercel.app";

// /start welcome
bot.start(async (ctx) => {
  const name = ctx.from.first_name || "there";
  await ctx.reply(
    `👋 Hi ${name}!\n\nWelcome to *WEKS Tap-To-Math*.\n\n• Solve daily math to earn coins (10 per correct)\n• Invite friends (2,000 coins each)\n• Get ready for WEKS airdrops\n\nTap the button below to open the game.`,
    {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([
        Markup.button.webApp("▶️ Play WEKS", WEBAPP_URL)
      ])
    }
  );
});

// Fallback help
bot.hears(/help/i, (ctx) =>
  ctx.reply("Use /start to open the game, /balance to see your coins (coming soon).")
);

// Vercel serverless webhook handler
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
