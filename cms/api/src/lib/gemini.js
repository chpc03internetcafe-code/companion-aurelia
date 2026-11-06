// Google Gemini (generateContent REST API), for the live chat assistant. No SDK: one fetch per call.
// GEMINI_API_KEY turns it on (Google AI Studio → Get API key); GEMINI_MODEL picks the model.
// Prompts and replies are never logged here: they contain visitors' messages.
import { HttpError } from './http.js';

const MODEL = () => process.env.GEMINI_MODEL || 'gemini-flash-lite-latest';
const TIMEOUT_MS = 20_000;

export const geminiConfigured = () => !!process.env.GEMINI_API_KEY;
export const geminiModel = MODEL;

/**
 * system: instructions; contents: [{ role: 'user' | 'model', text }] (consecutive turns of one role are merged).
 * schema: a JSON response schema (the reply is parsed), or none for plain text.
 */
export async function generate({ system, contents, schema = null, maxTokens = 2048, temperature = 0.4 }) {
  if (!geminiConfigured()) throw new HttpError(503, 'The AI assistant is not set up (GEMINI_API_KEY).');
  const turns = [];
  for (const t of contents) {
    const last = turns[turns.length - 1];
    if (last && last.role === t.role) last.parts[0].text += `\n\n${t.text}`;
    else turns.push({ role: t.role, parts: [{ text: t.text }] });
  }
  if (!turns.length || turns[0].role !== 'user') turns.unshift({ role: 'user', parts: [{ text: '(The conversation starts.)' }] });
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL())}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: turns,
      generationConfig: { temperature, maxOutputTokens: maxTokens, ...(schema ? { responseMimeType: 'application/json', responseSchema: schema } : {}) },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(`Gemini ${res.status}: ${detail.error?.message || res.statusText}`);
  }
  const data = await res.json();
  const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
  if (!text) throw new Error(`Gemini returned no text (${data.candidates?.[0]?.finishReason || data.promptFeedback?.blockReason || 'empty'})`);
  return schema ? JSON.parse(text) : text;
}
