import { join } from "node:path";
import { Commands } from "./commands";
import type { Config } from "./config";
import { supabaseData } from "./data/supabase";
import type { Data } from "./data/types";
import { mailerFor, type Mailer } from "./mailer";
import { loadFaq } from "./faq";
import { geminiModel } from "./gemini";
import { ChatMemory } from "./memory";
import { LocalState } from "./state";
import { Weather } from "./weather";

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
    ai: config.features.has("ai") && config.geminiApiKey ? geminiModel(config.geminiApiKey, config.geminiModel) : undefined,
    mentionFor: (who) => state.mentionFor(who),
    forgetLocal: (who) => state.forget(who),
    memory: new ChatMemory(),
    weather: new Weather(),
    faq: loadFaq(),
  });
  return { config, data, state, mailer, commands };
}
