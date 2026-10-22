import { FunctionCallingConfigMode, GoogleGenAI } from "@google/genai";
import type { AiModel } from "./ai";

// The real AiModel: Gemini through @google/genai, on the free tier.
// GEMINI_MODEL defaults to "gemini-flash-latest", Google's alias for the
// current Flash model, so the bot doesn't pin a model that gets retired.

export function geminiModel(apiKey: string, model: string): AiModel {
  const ai = new GoogleGenAI({ apiKey });
  return {
    async generate({ system, prompt, tools, signal }) {
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
    },
  };
}
