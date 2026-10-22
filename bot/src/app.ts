import { join } from "node:path";
import { Commands } from "./commands";
import type { Config } from "./config";
import { supabaseData } from "./data/supabase";
import type { Data } from "./data/types";
import { mailerFor, type Mailer } from "./mailer";
import { LocalState } from "./state";

// Wiring shared by the bot (main.ts) and the terminal (cli.ts).

export type App = { config: Config; data: Data; state: LocalState; mailer: Mailer; commands: Commands };

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
  });
  return { config, data, state, mailer, commands };
}
