import { FunctionCallingConfigMode, GoogleGenAI } from "@google/genai";
import type { AiModel } from "./ai";

// The real AiModel: Gemini through @google/genai, on the free tier.
// GEMINI_MODEL is a comma-separated list tried in order: free-tier models are
// often "high demand" (503) or out of quota (429), so the next one takes over.
// The defaults are Google's "-latest" aliases, so no retired model is pinned.

export const DEFAULT_MODELS = "gemini-flash-lite-latest,gemini-flash-latest";

/** Errors worth trying the next model for: overloaded, out of quota, or a server hiccup. */
const retryable = (err: unknown) => {
  const status = (err as { status?: number }).status;
  return status === 429 || (status !== undefined && status >= 500);
};

export function geminiModel(apiKey: string, models: string): AiModel {
  const ai = new GoogleGenAI({ apiKey });
  const list = models.split(",").map((m) => m.trim()).filter(Boolean);
  return {
    async generate({ system, prompt, tools, signal }) {
      let last: unknown;
      for (const model of list) {
        try {
          const res = await ai.models.generateContent({
            model,
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            config: {
              systemInstruction: system,
              temperature: 0.2,
              maxOutputTokens: 400,
              tools: tools.length ? [{ functionDeclarations: tools.map(({ name, description, parametersJsonSchema }) => ({ name, description, parametersJsonSchema })) }] : undefined,
              toolConfig: tools.length ? { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } } : undefined,
              abortSignal: signal,
            },
          });
          const call = res.functionCalls?.[0];
          if (call?.name) return { call: { name: call.name, args: (call.args ?? {}) as Record<string, unknown> } };
          return { text: res.text ?? "" };
        } catch (err) {
          last = err;
          if (!retryable(err) || signal.aborted) throw err;
        }
      }
      throw last;
    },
  };
}
