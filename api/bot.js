// api/bot.js  (diagnostic-safe version)
import { Telegraf } from "telegraf";

const bot = new Telegraf(process.env.BOT_TOKEN || "");

bot.command("ping", (ctx) => ctx.reply("pong 🏓"));
bot.command("balance", (ctx) => ctx.reply("💰 Balance test OK (webhook healthy)"));
bot.on("text", (ctx) => {
  if (!ctx.message.text.startsWith("/")) {
    return ctx.reply("👋 Webhook alive. Try /ping or /balance.");
  }
});

// Vercel serverless entry — guard EVERYTHING
export default async function handler(req, res) {
  try {
    if (req.method === "POST") {
      try {
        await bot.handleUpdate(req.body);
      } catch (err) {
        console.error("handleUpdate error:", err);
      }
      // Always 200 so Telegram never sees 500
      return res.status(200).end();
    }
    return res.status(200).send("WEKS bot webhook OK");
  } catch (err) {
    console.error("top-level error:", err);
    // Still return 200 to avoid Telegram 500s
    return res.status(200).end();
  }
}
