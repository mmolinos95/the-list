import { join } from "node:path";
import { Commands } from "./commands";
import type { Config } from "./config";
import { supabaseData } from "./data/supabase";
import type { Data } from "./data/types";
import { mailerFor, type Mailer } from "./mailer";
import { processOutbox } from "./outbox";
import { LocalState } from "./state";

// Wiring shared by the bot (main.ts) and the terminal (cli.ts).

export type App = { config: Config; data: Data; state: LocalState; mailer: Mailer; commands: Commands };

const log = (msg: string, err?: unknown) => console.error(`[${new Date().toISOString()}] ${msg}`, err ?? "");

export function buildApp(config: Config, overrides: Partial<Pick<App, "data" | "state" | "mailer">> = {}): App {
  const data = overrides.data ?? supabaseData(config.supabaseUrl, config.supabaseSecretKey);
  const state = overrides.state ?? new LocalState(join(config.dataDir, "bot.sqlite"));
  const mailer = overrides.mailer ?? mailerFor(config);
  const commands = new Commands({
    data,
    features: config.features,
    botPhone: config.botPhone,
    siteUrl: config.siteUrl,
    dropLinkSecret: config.dropLinkSecret,
    now: () => new Date(),
    // Without the link secret the emails can't carry their links, so they wait for the app's daily job.
    afterWrite: config.dropLinkSecret
      ? () => void processOutbox({ data, mailer, secret: config.dropLinkSecret!, siteUrl: config.siteUrl, log }).catch((err) => log("Outbox failed", err))
      : undefined,
  });
  return { config, data, state, mailer, commands };
}
