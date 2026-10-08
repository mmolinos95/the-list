import "server-only";

/** Reads a required environment variable, with a clear message if it is missing. */
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable ${name}. See .env.example and README.md.`);
  }
  return value;
}

export const env = {
  get supabaseUrl() {
    return required("SUPABASE_URL");
  },
  get supabasePublishableKey() {
    return required("SUPABASE_PUBLISHABLE_KEY");
  },
  get supabaseSecretKey() {
    return required("SUPABASE_SECRET_KEY");
  },
  /** Signs drop-out, sign-up and one-tap board links. Any long random string. */
  get dropLinkSecret() {
    return required("DROP_LINK_SECRET");
  },
  /** Protects /api/cron. Vercel sends it automatically as a Bearer token. */
  get cronSecret() {
    return required("CRON_SECRET");
  },
  /** Public URL of the app, used in email links. */
  get siteUrl() {
    return (process.env.SITE_URL ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000")).replace(/\/$/, "");
  },
  /** Gmail sender. When unset, emails are printed to the server log instead. */
  get gmailUser() {
    return process.env.GMAIL_USER;
  },
  get gmailAppPassword() {
    return process.env.GMAIL_APP_PASSWORD;
  },
};
