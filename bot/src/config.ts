import { DEFAULT_MODELS } from "./gemini";
import { resolve } from "node:path";

// Settings come from bot/.env (gitignored) or the environment. See .env.example.

export const FEATURES = ["read", "post", "signup", "board", "ai"] as const;
export type Feature = (typeof FEATURES)[number];

export type Config = {
  supabaseUrl: string;
  supabaseSecretKey: string;
  dropLinkSecret: string | null;
  siteUrl: string;
  gmailUser: string | null;
  gmailAppPassword: string | null;
  geminiApiKey: string | null;
  geminiModel: string;
  /** E.164, e.g. +12125550148. */
  botPhone: string | null;
  allowedGroups: string[];
  features: Set<Feature>;
  dataDir: string;
};

/** Loads bot/.env into process.env if it exists. Real environment variables win. */
export function loadEnvFile(path = resolve(import.meta.dirname, "../.env")) {
  try {
    process.loadEnvFile(path);
  } catch {
    // No .env file: use the environment as is.
  }
}

export function parseFeatures(raw: string | undefined): Set<Feature> {
  const set = new Set<Feature>();
  for (const f of (raw ?? "read").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)) {
    if (!(FEATURES as readonly string[]).includes(f)) throw new Error(`Unknown BOT_FEATURES value "${f}". Use any of: ${FEATURES.join(",")}`);
    set.add(f as Feature);
  }
  return set;
}

const blank = (v: string | undefined) => (v && v.trim() ? v.trim() : null);

export function readConfig(env: NodeJS.ProcessEnv = process.env, opts: { needSupabase?: boolean } = {}): Config {
  const need = (name: string) => {
    const v = blank(env[name]);
    if (!v && opts.needSupabase !== false) throw new Error(`Missing ${name}. Copy bot/.env.example to bot/.env and fill it in.`);
    return v ?? "";
  };
  const phone = blank(env.BOT_PHONE);
  if (phone && !/^\+[1-9]\d{6,14}$/.test(phone)) throw new Error("BOT_PHONE must be E.164, like +12125550148.");
  return {
    supabaseUrl: need("SUPABASE_URL"),
    supabaseSecretKey: need("SUPABASE_SECRET_KEY"),
    dropLinkSecret: blank(env.DROP_LINK_SECRET),
    siteUrl: (blank(env.SITE_URL) ?? "https://cbsfc-the-list.vercel.app").replace(/\/$/, ""),
    gmailUser: blank(env.GMAIL_USER),
    gmailAppPassword: blank(env.GMAIL_APP_PASSWORD),
    geminiApiKey: blank(env.GEMINI_API_KEY),
    geminiModel: blank(env.GEMINI_MODEL) ?? DEFAULT_MODELS,
    botPhone: phone,
    allowedGroups: (env.ALLOWED_GROUPS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    features: parseFeatures(env.BOT_FEATURES),
    dataDir: resolve(blank(env.DATA_DIR) ?? "./data"),
  };
}
