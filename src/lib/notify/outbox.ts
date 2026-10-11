import "server-only";
import { after } from "next/server";
import { boardActionUrl } from "../board-action";
import { dropUrl } from "../drop-link";
import { env } from "../env";
import { signupUrl } from "../signup-link";
import { db } from "../supabase";
import { emailChannel } from "./email";
import { render, type EmailContext } from "./templates";

// Emails are queued in the `emails` table by the database functions, in the
// same transaction as the change. This file sends them.

/** Gmail allows ~500/day. Stop a little short so login links still get through. */
const DAILY_LIMIT = 450;

/** Kinds sent to members, which get a personal drop-out link. */
const MEMBER_KINDS = new Set(["signup", "promoted", "team", "changed", "board_message"]);

/** Kinds sent to a board member, which can carry one-tap action links bound to that member. */
const BOARD_ACTION_KINDS = new Set(["late_drop", "board_daily"]);

type EmailRow = {
  id: string;
  kind: string;
  to_address: string;
  member_id: string | null;
  event_id: string | null;
  payload: Record<string, unknown>;
};

export async function processOutbox(limit = 100) {
  const supabase = db();

  const since = new Date(Date.now() - 86_400_000).toISOString();
  const { count } = await supabase.from("emails").select("id", { count: "exact", head: true }).eq("status", "sent").gte("sent_at", since);
  const room = Math.max(0, DAILY_LIMIT - (count ?? 0));
  if (room === 0) {
    console.warn("Email daily limit reached; pending emails will go out later.");
    return { sent: 0, failed: 0 };
  }

  const { data, error } = await supabase.rpc("claim_emails", { p_limit: Math.min(limit, room) });
  if (error) throw error;
  const rows = (data ?? []) as EmailRow[];

  const channel = emailChannel();
  let sent = 0;
  let failed = 0;
  // A few at a time keeps Gmail happy and finishes 40 team emails in seconds.
  for (let i = 0; i < rows.length; i += 5) {
    await Promise.all(
      rows.slice(i, i + 5).map(async (row) => {
        try {
          const ctx: EmailContext = {
            siteUrl: env.siteUrl,
            dropUrl: MEMBER_KINDS.has(row.kind) && row.member_id && row.event_id ? dropUrl(row.event_id, row.member_id) : undefined,
            practiceUrl: practiceUrl(row.payload),
            act: BOARD_ACTION_KINDS.has(row.kind) ? (a) => boardActionUrl({ ...a, to: row.to_address }) : undefined,
          };
          const message = render(row.kind, row.payload, ctx);
          await channel.send({ to: row.to_address, ...message });
          await supabase.from("emails").update({ status: "sent", sent_at: new Date().toISOString(), last_error: null }).eq("id", row.id);
          sent++;
        } catch (err) {
          console.error(`Email ${row.id} (${row.kind}) failed`, err);
          await supabase
            .from("emails")
            .update({ status: "failed", last_error: String(err).slice(0, 500), claimed_at: null })
            .eq("id", row.id);
          failed++;
        }
      }),
    );
  }
  return { sent, failed };
}

/** Send queued emails right after the response, so nobody waits on Gmail. */
export function flushOutboxSoon() {
  after(async () => {
    try {
      await processOutbox();
    } catch (err) {
      console.error("Outbox flush failed", err);
    }
  });
}

function practiceUrl(payload: Record<string, unknown>) {
  const event = payload.event as { slug?: string } | undefined;
  return event?.slug ? signupUrl({ slug: event.slug }) : undefined;
}
