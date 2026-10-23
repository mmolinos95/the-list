import { describe, expect, it } from "vitest";
import type { WAMessage } from "@whiskeysockets/baileys";
import { toIncoming } from "../src/whatsapp";

const bot = { botIds: ["12125550100:7@s.whatsapp.net", "88888888@lid"], groupName: "CBS FC" };
const base = (over: Partial<WAMessage["key"]>, message: WAMessage["message"]): WAMessage =>
  ({ key: { id: "ABC", remoteJid: "120363000000000001@g.us", fromMe: false, ...over }, message, messageTimestamp: 1_800_000_000 }) as WAMessage;

describe("toIncoming (Baileys → IncomingMessage)", () => {
  it("reads a group message from a hidden-number sender with a known phone", () => {
    const m = toIncoming(base({ participant: "123456@lid", participantAlt: "12125550111@s.whatsapp.net" }, { conversation: "!list thu" }), bot);
    expect(m).toEqual({
      id: "ABC",
      chatId: "120363000000000001@g.us",
      isGroup: true,
      groupName: "CBS FC",
      senderIds: ["123456@lid", "12125550111@s.whatsapp.net"],
      senderPhone: "+12125550111",
      text: "!list thu",
      mentionsBot: false,
      timestamp: 1_800_000_000,
    });
  });

  it("uses the LID-to-phone mapping when the message has no phone", () => {
    const m = toIncoming(base({ participant: "123456@lid" }, { conversation: "!list" }), { ...bot, phoneForLid: "+12125550122" });
    expect(m?.senderPhone).toBe("+12125550122");
    expect(toIncoming(base({ participant: "123456@lid" }, { conversation: "!list" }), bot)?.senderPhone).toBeNull();
  });

  it("detects @mentions of the bot by phone or LID and strips them", () => {
    const byLid = toIncoming(
      base({ participant: "1@lid" }, { extendedTextMessage: { text: "@88888888 when is practice?", contextInfo: { mentionedJid: ["88888888@lid"] } } }),
      bot,
    );
    expect(byLid).toMatchObject({ mentionsBot: true, text: "when is practice?" });
    const byPhone = toIncoming(
      base({ participant: "1@lid" }, { extendedTextMessage: { text: "hey @12125550100 thu?", contextInfo: { mentionedJid: ["12125550100@s.whatsapp.net"] } } }),
      bot,
    );
    expect(byPhone).toMatchObject({ mentionsBot: true, text: "hey thu?" });
    const other = toIncoming(base({ participant: "1@lid" }, { extendedTextMessage: { text: "@555 hi", contextInfo: { mentionedJid: ["555@lid"] } } }), bot);
    expect(other).toMatchObject({ mentionsBot: false, text: "@555 hi" });
  });

  it("counts a swipe-reply to one of the bot's messages as talking to the bot", () => {
    const reply = (participant: string) =>
      toIncoming(base({ participant: "1@lid" }, { extendedTextMessage: { text: "and friday?", contextInfo: { stanzaId: "X", participant } } }), bot);
    expect(reply("88888888@lid")).toMatchObject({ repliesToBot: true, mentionsBot: false, text: "and friday?" });
    expect(reply("12125550100@s.whatsapp.net")).toMatchObject({ repliesToBot: true });
    expect(reply("555@lid")?.repliesToBot).toBeUndefined();
  });

  it("reads DMs from the chat ID", () => {
    const m = toIncoming(base({ remoteJid: "4444@lid", remoteJidAlt: "12125550133@s.whatsapp.net" }, { conversation: "link" }), bot);
    expect(m).toMatchObject({ isGroup: false, chatId: "4444@lid", senderIds: ["4444@lid", "12125550133@s.whatsapp.net"], senderPhone: "+12125550133", groupName: undefined });
  });

  it("skips its own messages, status, channels and messages without text", () => {
    expect(toIncoming(base({ fromMe: true, participant: "1@lid" }, { conversation: "!list" }), bot)).toBeNull();
    expect(toIncoming(base({ remoteJid: "status@broadcast", participant: "1@lid" }, { conversation: "!list" }), bot)).toBeNull();
    expect(toIncoming(base({ remoteJid: "123@newsletter" }, { conversation: "!list" }), bot)).toBeNull();
    expect(toIncoming(base({ participant: "1@lid" }, { stickerMessage: {} }), bot)).toBeNull();
  });
});
