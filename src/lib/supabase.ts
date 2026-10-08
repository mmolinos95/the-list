import "server-only";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { env } from "./env";

/**
 * Database access with full rights. Every table has Row Level Security on and
 * no policies, so this server-side client is the only way in. Never import it
 * into a client component.
 */
export function db() {
  return createClient(env.supabaseUrl, env.supabaseSecretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Supabase Auth bound to the request's cookies. Used only for board login sessions. */
export async function authClient() {
  const cookieStore = await cookies();
  return createServerClient(env.supabaseUrl, env.supabasePublishableKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          for (const { name, value, options } of toSet) cookieStore.set(name, value, options);
        } catch {
          // Called from a Server Component, where cookies are read-only. proxy.ts refreshes sessions.
        }
      },
    },
  });
}

/** Turns a Postgres `raise exception 'code'` from an rpc call into that code. */
export function errorCode(error: { message?: string } | null): string | null {
  if (!error) return null;
  return error.message ?? "unknown_error";
}
