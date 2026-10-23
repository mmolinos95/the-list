import makeWASocket, { Browsers, DisconnectReason, fetchLatestBaileysVersion, useMultiFileAuthState } from "@whiskeysockets/baileys";
import pino from "pino";
import { loadEnvFile, readConfig } from "./config";
import { authDir } from "./whatsapp";

// `npm run link`: links the bot as a device of its WhatsApp account with a
// pairing code (no QR). On the bot phone: WhatsApp → Settings → Linked devices →
// Link a device → Link with phone number instead, then type the code.

loadEnvFile();
const cfg = readConfig(process.env, { needSupabase: false });
if (!cfg.botPhone) {
  console.error("Set BOT_PHONE in bot/.env (E.164, like +12125550148) first.");
  process.exit(1);
}
const number = cfg.botPhone.replace(/^\+/, "");
let asked = false;

async function connect() {
  const { state, saveCreds } = await useMultiFileAuthState(authDir(cfg.dataDir));
  const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));
  const sock = makeWASocket({
    auth: state,
    version,
    logger: pino({ level: "warn" }),
    browser: Browsers.ubuntu("Chrome"),
    markOnlineOnConnect: false,
    syncFullHistory: false,
  });
  sock.ev.on("creds.update", saveCreds);
  sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
    if (qr && !asked && !sock.authState.creds.registered) {
      asked = true;
      const code = await sock.requestPairingCode(number);
      console.log(`\nPairing code for ${cfg.botPhone}:\n\n    ${code.slice(0, 4)}-${code.slice(4)}\n`);
      console.log("On the bot phone: WhatsApp → Settings → Linked devices → Link a device →");
      console.log("“Link with phone number instead”, then type the code. Waiting…\n");
    }
    if (connection === "open") {
      console.log(`Linked! Auth state saved in ${authDir(cfg.dataDir)}. Start the bot with \`npm start\`.`);
      setTimeout(() => process.exit(0), 3_000); // let the last creds save
    }
    if (connection === "close") {
      const code = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
      if (code === DisconnectReason.restartRequired) return void connect(); // normal right after pairing
      if (code === DisconnectReason.loggedOut) {
        console.error("WhatsApp refused the link (logged out). Delete the auth folder and try again.");
        process.exit(1);
      }
      console.error(`Connection closed (${code}). Run \`npm run link\` again.`);
      process.exit(1);
    }
  });
}

if ((await useMultiFileAuthState(authDir(cfg.dataDir))).state.creds.registered) {
  console.log(`Already linked (${authDir(cfg.dataDir)}). To re-link, delete that folder first.`);
  process.exit(0);
}
await connect();
