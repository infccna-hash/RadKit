import { config } from '../config.js';
import { HttpError } from './http.js';

export const aiEnabled = () => Boolean(config.ai.apiKey);

/**
 * Call DeepSeek (OpenAI-compatible chat completions).
 * Only de-identified clinical context is ever sent: no names, IDs, dates of birth or institutions.
 */
export async function chat(system, user, { maxTokens = 1500, temperature = 0.3 } = {}) {
  if (!aiEnabled()) throw new HttpError(503, "L'assistant IA n'est pas configuré (DEEPSEEK_API_KEY).");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 90_000);
  try {
    const res = await fetch(`${config.ai.baseUrl}/chat/completions`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.ai.apiKey}` },
      body: JSON.stringify({
        model: config.ai.model,
        temperature,
        max_tokens: maxTokens,
        stream: false,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new HttpError(502, `DeepSeek: ${data?.error?.message || res.status}`);
    return data.choices?.[0]?.message?.content?.trim() || '';
  } catch (e) {
    if (e.name === 'AbortError') throw new HttpError(504, 'DeepSeek ne répond pas (délai dépassé).');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export function ageBand(birthDate, studyDate) {
  if (!birthDate) return null;
  const ref = studyDate ? new Date(studyDate) : new Date();
  const age = Math.floor((ref - new Date(birthDate)) / (365.25 * 864e5));
  return Number.isFinite(age) && age >= 0 ? `${age} ans` : null;
}

/** Pull a JSON object out of a model reply (tolerates ```json fences) */
export function parseJsonReply(text) {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}
