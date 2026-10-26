import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  jidNormalizedUser,
  useMultiFileAuthState,
  type GroupMetadata,
  type WAMessage,
  type WASocket,
  type proto,
} from "@whiskeysockets/baileys";
import { join } from "node:path";
import pino from "pino";
import type { Chat, IncomingMessage } from "./chat";
import { phoneFromJid } from "./phone";

// Baileys behind the Chat interface. Logged in as a linked device of the bot's
// WhatsApp account (see link.ts). Everything WhatsApp-specific stays here.

export const authDir = (dataDir: string) => join(dataDir, "auth");

/** Thrown by start() before `npm run link` was done. Needs a person, so the service shouldn't retry. */
export class NotLinked extends Error {}

const logger = pino({ level: process.env.BAILEYS_LOG ?? "warn" });

function textOf(m: proto.IMessage) {
  return m.conversation ?? m.extendedTextMessage?.text ?? m.imageMessage?.caption ?? m.videoMessage?.caption ?? null;
}

function contextOf(m: proto.IMessage) {
  return m.extendedTextMessage?.contextInfo ?? m.imageMessage?.contextInfo ?? m.videoMessage?.contextInfo ?? null;
}

const norm = (jid: string | null | undefined) => (jid ? jidNormalizedUser(jid) : "");

/**
 * Turns a Baileys message into an IncomingMessage, or null for anything the
 * bot never answers (its own messages, status updates, channels, no text).
 * `botIds` are the bot's own phone JID and LID; `phoneForLid` is the sender's
 * phone if WhatsApp shared the LID-to-phone mapping.
 */
export function toIncoming(m: WAMessage, ctx: { botIds: string[]; groupName?: string; phoneForLid?: string | null }): IncomingMessage | null {
  const jid = m.key.remoteJid;
  if (!jid || m.key.fromMe || !m.message) return null;
  if (jid === "status@broadcast" || jid.endsWith("@broadcast") || jid.endsWith("@newsletter")) return null;
  let text = textOf(m.message);
  if (text === null) return null;

  const isGroup = jid.endsWith("@g.us");
  const bots = new Set(ctx.botIds.map(norm).filter(Boolean));
  const mentioned = (contextOf(m.message)?.mentionedJid ?? []).map(norm);
  const mentionsBot = mentioned.some((j) => bots.has(j));
  const quotedAuthor = norm(contextOf(m.message)?.participant);
  const repliesToBot = !!quotedAuthor && bots.has(quotedAuthor);
  if (mentionsBot) {
    for (const b of bots) text = text.replaceAll(`@${b.split("@")[0]}`, " ");
    text = text.replace(/\s+/g, " ").trim();
  }

  const raw = isGroup ? [m.key.participant, m.key.participantAlt] : [jid, m.key.remoteJidAlt];
  const senderIds = [...new Set(raw.map(norm).filter(Boolean))];
  if (senderIds.length === 0) return null;
  const senderPhone = senderIds.map(phoneFromJid).find(Boolean) ?? ctx.phoneForLid ?? null;

  return {
    id: m.key.id ?? "",
    chatId: jid,
    isGroup,
    groupName: isGroup ? ctx.groupName : undefined,
    senderIds,
    senderPhone,
    text,
    mentionsBot,
    ...(repliesToBot ? { repliesToBot } : {}),
    timestamp: Number(m.messageTimestamp ?? 0),
  };
}

export type WhatsAppOptions = {
  dataDir: string;
  onMessage: (msg: IncomingMessage) => void;
  /** Called when WhatsApp logged the bot out. The bot must stop, not loop. */
  onLoggedOut: () => void;
  /** Called when the connection opens (true) or drops and will be retried (false). */
  onConnection?: (up: boolean) => void;
  log: (msg: string, err?: unknown) => void;
};

/** A live WhatsApp connection that reconnects with backoff after disconnects. */
export class WhatsApp implements Chat {
  private sock: WASocket | null = null;
  private groups = new Map<string, GroupMetadata>();
  private sent = new Map<string, proto.IMessage>();
  private raw = new Map<string, WAMessage>();
  private attempt = 0;
  private stopped = false;

  constructor(private opts: WhatsAppOptions) {}

  async start() {
    const { state, saveCreds } = await useMultiFileAuthState(authDir(this.opts.dataDir));
    if (!state.creds.registered) throw new NotLinked("WhatsApp isn't linked yet. Run `npm run link` first.");
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));

    const sock = makeWASocket({
      auth: state,
      version,
      logger,
      browser: Browsers.ubuntu("Chrome"),
      markOnlineOnConnect: false,
      syncFullHistory: false,
      shouldSyncHistoryMessage: () => false,
      cachedGroupMetadata: async (jid) => this.groups.get(jid),
      getMessage: async (key) => (key.id ? this.sent.get(key.id) : undefined),
    });
    this.sock = sock;

    sock.ev.on("creds.update", saveCreds);
    sock.ev.on("connection.update", ({ connection, lastDisconnect }) => {
      if (connection === "open") {
        this.attempt = 0;
        this.opts.log("WhatsApp connected.");
        this.opts.onConnection?.(true);
        void this.logGroups();
      }
      if (connection !== "close" || this.stopped) return;
      const code = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        this.opts.log("!!! WhatsApp LOGGED OUT the bot. Run `npm run link` again to re-link it. Stopping. !!!");
        this.stopped = true;
        this.opts.onLoggedOut();
        return;
      }
      this.opts.onConnection?.(false);
      const delay = Math.min(5 * 60_000, 2_000 * 2 ** this.attempt++) * (0.75 + Math.random() / 2);
      this.opts.log(`WhatsApp disconnected (${code ?? "unknown"}). Reconnecting in ${Math.round(delay / 1000)}s.`);
      setTimeout(() => void this.start().catch((err) => this.opts.log("Reconnect failed", err)), delay);
    });
    sock.ev.on("groups.update", (updates) => {
      for (const u of updates) if (u.id) this.groups.delete(u.id);
    });
    sock.ev.on("group-participants.update", ({ id }) => this.groups.delete(id));
    sock.ev.on("messages.upsert", ({ messages, type }) => {
      if (type !== "notify") return;
      for (const m of messages) void this.incoming(m).catch((err) => this.opts.log("Couldn't read a message", err));
    });
  }

  /** Lists the groups the bot is in with their IDs, so ALLOWED_GROUPS can use the ID (which survives renames). */
  private async logGroups() {
    try {
      const groups = Object.values(await this.socket().groupFetchAllParticipating());
      for (const g of groups) this.groups.set(g.id, g);
      this.opts.log(`In ${groups.length} group(s): ${groups.map((g) => `"${g.subject}" = ${g.id}`).join(", ") || "none"}.`);
    } catch (err) {
      this.opts.log("Couldn't list the groups", err);
    }
  }

  stop() {
    this.stopped = true;
    this.sock?.end(undefined);
  }

  private botIds() {
    const me = this.sock?.authState.creds.me;
    return [me?.id, me?.lid].filter((x): x is string => !!x);
  }

  private async groupName(jid: string) {
    let meta = this.groups.get(jid);
    if (!meta && this.sock) {
      meta = await this.sock.groupMetadata(jid);
      this.groups.set(jid, meta);
    }
    return meta?.subject;
  }

  private async incoming(m: WAMessage) {
    const jid = m.key.remoteJid ?? "";
    if (!this.sock || m.key.fromMe || !m.message) return;
    const isGroup = jid.endsWith("@g.us");
    const groupName = isGroup ? await this.groupName(jid) : undefined;
    const lid = [isGroup ? m.key.participant : jid, isGroup ? m.key.participantAlt : m.key.remoteJidAlt].find((j) => j?.endsWith("@lid"));
    let phoneForLid: string | null = null;
    if (lid) {
      const pn = await this.sock.signalRepository.lidMapping.getPNForLID(lid).catch(() => null);
      phoneForLid = phoneFromJid(pn ? jidNormalizedUser(pn) : null);
    }
    const msg = toIncoming(m, { botIds: this.botIds(), groupName, phoneForLid });
    if (!msg) return;
    this.raw.set(msg.id, m);
    if (this.raw.size > 500) this.raw.delete(this.raw.keys().next().value!);
    this.opts.onMessage(msg);
  }

  private remember(sent: WAMessage | undefined) {
    if (sent?.key.id && sent.message) {
      this.sent.set(sent.key.id, sent.message);
      if (this.sent.size > 200) this.sent.delete(this.sent.keys().next().value!);
    }
    return sent?.key.id ?? null;
  }

  private socket() {
    if (!this.sock) throw new Error("WhatsApp isn't connected.");
    return this.sock;
  }

  async reply(to: IncomingMessage, text: string, mentions?: string[]) {
    const quoted = this.raw.get(to.id);
    return this.remember(await this.socket().sendMessage(to.chatId, { text, mentions }, quoted ? { quoted } : undefined));
  }

  async send(chatId: string, text: string, mentions?: string[]) {
    return this.remember(await this.socket().sendMessage(chatId, { text, mentions }));
  }

  async delete(chatId: string, msgId: string) {
    await this.socket().sendMessage(chatId, { delete: { remoteJid: chatId, fromMe: true, id: msgId } });
  }

  async typing(chatId: string, on: boolean) {
    await this.socket()
      .sendPresenceUpdate(on ? "composing" : "paused", chatId)
      .catch(() => undefined);
  }
}
