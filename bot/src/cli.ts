import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { buildApp } from "./app";
import { loadEnvFile, readConfig } from "./config";
import { askerFor } from "./identity";
import { parseCommand, triggerBody } from "./parse";

// `npm run cli -- --as someone@example.com ["!list thu"]`
// Runs commands in the terminal as a member, against whatever SUPABASE_URL
// points to, with no WhatsApp. Without a command, reads them line by line.
// Writes are real: point it at a test project, or keep BOT_FEATURES=read.

loadEnvFile();
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    as: { type: "string" },
    name: { type: "string" },
    phone: { type: "string" },
    features: { type: "string" },
  },
});
if (values.features) process.env.BOT_FEATURES = values.features;
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
let app: ReturnType<typeof buildApp>;
try {
  app = buildApp(readConfig());
} catch (err) {
  console.error(message(err));
  process.exit(1);
}

async function run(line: string) {
  const body = triggerBody(line, true) ?? line;
  const asker = values.as ? await askerFor(values.as.trim().toLowerCase(), app.data, { name: values.name ?? null, phone: values.phone ?? null }) : null;
  const outs = await app.commands.run(parseCommand(body), { asker, chatKey: `cli|${values.as ?? "anon"}` });
  for (const o of outs) console.log(`\n${o.quote ? "↪ " : ""}${o.text.replace(/\n/g, "\n  ")}\n`);
}

try {
  if (positionals.length) {
    await run(positionals.join(" ")).catch((err) => {
      console.error(message(err));
      process.exitCode = 1;
    });
  } else {
    console.log(`The List bot, in the terminal${values.as ? ` as ${values.as}` : " (not linked; add --as email)"}. Features: ${[...app.config.features].join(",")}. Ctrl-D to quit.`);
    const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: "> " });
    rl.prompt();
    for await (const line of rl) {
      if (line.trim()) await run(line).catch((err) => console.error(message(err)));
      rl.prompt();
    }
  }
} finally {
  app.state.close();
}
