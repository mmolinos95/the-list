import { timingSafeEqual } from "node:crypto";
import { queueBoardDaily } from "@/lib/board-daily";
import { env } from "@/lib/env";
import { processOutbox } from "@/lib/notify/outbox";
import { db } from "@/lib/supabase";

// Daily job (see vercel.json). Vercel calls it with "Authorization: Bearer
// $CRON_SECRET" at 6 AM New York time. It creates the next two weeks of
// practices, queues the board's morning email (lib/board-daily.ts), sends and
// retries emails, and deletes members idle for 12 months. Running it every day
// also keeps the free Supabase project from pausing.

export const maxDuration = 60;

function authorized(header: string | null) {
  const expected = Buffer.from(`Bearer ${env.cronSecret}`);
  const given = Buffer.from(header ?? "");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function GET(request: Request) {
  if (!authorized(request.headers.get("authorization"))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = db();
  const created = await supabase.rpc("create_upcoming_events", { p_days: 14 });
  if (created.error) console.error("create_upcoming_events failed", created.error);

  let boardEmails = 0;
  try {
    boardEmails = await queueBoardDaily();
  } catch (err) {
    console.error("Board morning email failed", err);
  }

  let emails = { sent: 0, failed: 0 };
  try {
    emails = await processOutbox(200);
  } catch (err) {
    console.error("Outbox failed", err);
  }

  const cleaned = await supabase.rpc("cleanup_inactive_members");
  if (cleaned.error) console.error("cleanup_inactive_members failed", cleaned.error);

  const ok = !created.error && !cleaned.error;
  return Response.json(
    { ok, practicesCreated: created.data ?? 0, boardEmails, emails, membersDeleted: cleaned.data ?? 0 },
    { status: ok ? 200 : 500 },
  );
}
