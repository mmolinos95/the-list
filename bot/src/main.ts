import { buildApp } from "./app";
import { Bot } from "./bot";
import { Pacer, pacedChat } from "./chat";
import { loadEnvFile, readConfig } from "./config";
import { WhatsApp } from "./whatsapp";

// `npm start`: the bot. Exits with 78 when WhatsApp logs it out, which
// listbot.service treats as "don't restart" (re-linking needs a person).

loadEnvFile();
let config: ReturnType<typeof readConfig>;
try {
  config = readConfig();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
const app = buildApp(config);
const log = (msg: string, err?: unknown) => (err ? console.error(`[${new Date().toISOString()}] ${msg}`, err) : console.log(`[${new Date().toISOString()}] ${msg}`));

if (config.allowedGroups.length === 0) log("ALLOWED_GROUPS is empty, so the bot will only answer linking DMs.");
log(`Features: ${[...config.features].join(", ")}. Groups: ${config.allowedGroups.join(", ") || "(none)"}.`);

let bot: Bot;
const wa = new WhatsApp({
  dataDir: config.dataDir,
  onMessage: (msg) => void bot.handle(msg),
  onLoggedOut: () => {
    app.state.close();
    process.exit(78);
  },
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

await wa.start();
