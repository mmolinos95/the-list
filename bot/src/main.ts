import { Alerts, memoryAlertLog, type AlertLog } from "./alerts";
import { buildApp } from "./app";
import { realTimers } from "./batch";
import { Bot } from "./bot";
import { Pacer, pacedChat } from "./chat";
import { loadEnvFile, readConfig } from "./config";
import { mailerFor } from "./mailer";
import { NotLinked, WhatsApp } from "./whatsapp";

// `npm start`: the bot. Exits with 78 when WhatsApp logged it out or it was
// never linked, which listbot.service treats as "don't restart" (linking needs a person).
// ALERT_EMAILS get an email when it's logged out, offline 10+ minutes, or crashes on start (alerts.ts).

loadEnvFile();
let config: ReturnType<typeof readConfig>;
try {
  config = readConfig();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
const log = (msg: string, err?: unknown) => (err ? console.error(`[${new Date().toISOString()}] ${msg}`, err) : console.log(`[${new Date().toISOString()}] ${msg}`));
const mailer = mailerFor(config);
const alertsWith = (alertLog: AlertLog) => new Alerts({ to: config.alertEmails, mailer, log: alertLog, timers: realTimers, now: Date.now, onError: log });
/** Waits for an alert email, but never more than 20 s: the bot is about to exit. */
const settle = (p: Promise<unknown>) => Promise.race([p.catch((err) => log("Alert failed", err)), new Promise((r) => setTimeout(r, 20_000))]);

let app: ReturnType<typeof buildApp>;
try {
  app = buildApp(config, { mailer });
} catch (err) {
  log("Failed to start", err);
  await settle(alertsWith(memoryAlertLog()).crashed(err));
  process.exit(1);
}
const alerts = alertsWith(app.state);
if (config.alertEmails.length === 0) log("ALERT_EMAILS is empty, so nobody gets an email if the bot goes down.");

if (config.allowedGroups.length === 0) log("ALLOWED_GROUPS is empty, so the bot will only answer linking DMs.");
if (config.features.has("ai") && !config.geminiApiKey) log("BOT_FEATURES has ai but GEMINI_API_KEY is empty, so free questions get the help text.");
if (config.features.has("post") && !config.dropLinkSecret) log("DROP_LINK_SECRET is empty, so !post can't make sign-up links.");
log(`Features: ${[...config.features].join(", ")}. Groups: ${config.allowedGroups.join(", ") || "(none)"}.`);

let bot: Bot;
const wa = new WhatsApp({
  dataDir: config.dataDir,
  onMessage: (msg) => void bot.handle(msg),
  onLoggedOut: () =>
    void settle(alerts.loggedOut()).then(() => {
      app.state.close();
      process.exit(78);
    }),
  onConnection: (up) => (up ? void alerts.connected().catch((err) => log("Alert failed", err)) : alerts.disconnected()),
  log,
});
bot = new Bot({
  chat: pacedChat(wa, new Pacer({ minGapMs: 2_500, perMinute: 12 })),
  data: app.data,
  state: app.state,
  mailer: app.mailer,
  commands: app.commands,
  allowedGroups: config.allowedGroups,
  now: Date.now,
  log,
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    log(`${signal}: stopping.`);
    wa.stop();
    app.state.close();
    process.exit(0);
  });
}

await wa.start().catch(async (err) => {
  log(err instanceof Error ? err.message : String(err));
  if (err instanceof NotLinked) process.exit(78);
  await settle(alerts.crashed(err));
  process.exit(1);
});
