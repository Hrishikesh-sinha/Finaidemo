// The real Gemini call. The API key is read on the server only and never
// logged; without a key the app runs on its deterministic templates.

import { GoogleGenAI, Type } from '@google/genai';
import type { GenerateFn } from './app';

export function makeGeminiGenerator(apiKey: string | undefined): GenerateFn | null {
  if (!apiKey) return null;
  const ai = new GoogleGenAI({ apiKey, httpOptions: { headers: { 'User-Agent': 'aistudio-build' } } });
  return async ({ model, system, user, json, temperature }) => {
    const result = await ai.models.generateContent({
      model,
      contents: user,
      config: {
        systemInstruction: system,
        ...(temperature !== undefined ? { temperature } : {}),
        ...(json ? { responseMimeType: 'application/json', responseSchema: { type: Type.ARRAY, items: { type: Type.STRING } } } : {})
      }
    });
    return result.text ?? '';
  };
}
