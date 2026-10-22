import { render, type EmailContext } from "../../src/lib/notify/templates";
import type { Data } from "./data/types";
import { boardActionUrl, dropUrl, signupUrl } from "./links";
import type { Mailer } from "./mailer";

// Sends the emails the database queued with a change (sign-up confirmations,
// promotions, cancellations...), the way the app does right after its own
// actions (src/lib/notify/outbox.ts). Same templates, same links, same daily
// limit; claim_emails() makes sure the bot and the app never send one twice.

const DAILY_LIMIT = 450;
const MEMBER_KINDS = new Set(["signup", "promoted", "team", "changed", "board_message"]);
const BOARD_ACTION_KINDS = new Set(["late_drop", "board_daily"]);

export type OutboxDeps = { data: Data; mailer: Mailer; secret: string; siteUrl: string; log?: (msg: string, err?: unknown) => void };

export async function processOutbox({ data, mailer, secret, siteUrl, log }: OutboxDeps, limit = 100) {
  const room = Math.max(0, DAILY_LIMIT - (await data.sentSince(new Date(Date.now() - 86_400_000).toISOString())));
  if (room === 0) {
    log?.("Email daily limit reached; pending emails will go out later.");
    return { sent: 0, failed: 0 };
  }
  const rows = await data.claimEmails(Math.min(limit, room));
  let sent = 0;
  let failed = 0;
  for (let i = 0; i < rows.length; i += 5) {
    await Promise.all(
      rows.slice(i, i + 5).map(async (row) => {
        try {
          const slug = (row.payload.event as { slug?: string } | undefined)?.slug;
          const ctx: EmailContext = {
            siteUrl,
            dropUrl: MEMBER_KINDS.has(row.kind) && row.member_id && row.event_id ? dropUrl(secret, siteUrl, row.event_id, row.member_id) : undefined,
            practiceUrl: slug ? signupUrl(secret, siteUrl, { slug }) : undefined,
            act: BOARD_ACTION_KINDS.has(row.kind) ? (a) => boardActionUrl(secret, siteUrl, { ...a, to: row.to_address }) : undefined,
          };
          const message = render(row.kind, row.payload, ctx);
          await mailer.send({ to: row.to_address, ...message });
          await data.markSent(row.id);
          sent++;
        } catch (err) {
          log?.(`Email ${row.id} (${row.kind}) failed`, err);
          await data.markFailed(row.id, String(err));
          failed++;
        }
      }),
    );
  }
  return { sent, failed };
}
