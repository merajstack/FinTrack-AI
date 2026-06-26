import type { Transaction, MonthlyInsight } from './db';
import type { AIProvider } from './db';

const GEMINI_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
const NVIDIA_DEFAULT_BASE_URL = 'https://integrate.api.nvidia.com/v1';
const NVIDIA_DEFAULT_MODEL    = 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning';
const GROQ_DEFAULT_MODEL      = 'llama-3.3-70b-versatile';

function getApiKey(overrideKey?: string): string {
  const key = overrideKey?.trim() || process.env.NEXT_PUBLIC_GEMINI_API_KEY || '';
  if (!key) throw new Error('Gemini API key not set. Add it in Profile settings.');
  return key;
}

function getProviderConfig(
  provider: AIProvider | undefined,
  apiKey?: string,
  baseUrl?: string,
  model?: string
) {
  const normalized: AIProvider =
    provider === 'nvidia' ? 'nvidia' : provider === 'groq' ? 'groq' : 'gemini';
  const key = (apiKey || '').trim();

  if (normalized === 'nvidia') {
    if (!key) throw new Error('NVIDIA API key not set. Add it in Profile settings.');
    return {
      provider: normalized,
      key,
      baseUrl: (baseUrl || NVIDIA_DEFAULT_BASE_URL).replace(/\/+$/, ''),
      model: (model || NVIDIA_DEFAULT_MODEL).trim(),
    };
  }

  if (normalized === 'groq') {
    const groqKey = key || process.env.NEXT_PUBLIC_GROQ_API_KEY || '';
    if (!groqKey) throw new Error('Groq API key not set. Add it in Profile settings.');
    return {
      provider: normalized,
      key: groqKey,
      baseUrl: '',
      model: (model || process.env.NEXT_PUBLIC_GROQ_MODEL || GROQ_DEFAULT_MODEL).trim(),
    };
  }

  return {
    provider: normalized,
    key: getApiKey(key || undefined),
    baseUrl: '',
    model: '',
  };
}

function extractJsonObject(rawText: string): string | null {
  const trimmed = rawText.trim();
  const candidates: string[] = [];

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch) {
    candidates.push(fencedMatch[1].trim());
  }

  candidates.push(trimmed);

  const seen = new Set<string>();
  for (const candidateText of candidates) {
    if (!candidateText || seen.has(candidateText)) continue;
    seen.add(candidateText);

    let start = -1;
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = 0; i < candidateText.length; i += 1) {
      const ch = candidateText[i];

      if (inString) {
        if (escaped) { escaped = false; continue; }
        if (ch === '\\') { escaped = true; continue; }
        if (ch === '"') { inString = false; }
        continue;
      }

      if (ch === '"') { inString = true; continue; }

      if (ch === '{') {
        if (start === -1) start = i;
        depth += 1;
      } else if (ch === '}') {
        depth -= 1;
        if (start !== -1 && depth === 0) {
          const obj = candidateText.slice(start, i + 1);
          if (obj.trim().startsWith('{')) return obj;
        }
      }
    }

    const firstBrace = candidateText.indexOf('{');
    const lastBrace  = candidateText.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      const fallback = candidateText.slice(firstBrace, lastBrace + 1);
      if (fallback.trim().startsWith('{')) return fallback;
    }
  }

  return null;
}

function getResponseText(payload: any): string {
  const candidate = payload?.choices?.[0]?.message?.content;

  if (typeof candidate === 'string') return candidate;

  if (Array.isArray(candidate)) {
    return candidate
      .map((part: any) => {
        if (typeof part === 'string') return part;
        if (typeof part?.text === 'string') return part.text;
        return '';
      })
      .join('');
  }

  if (typeof candidate?.text === 'string') return candidate.text;

  const fallback =
    payload?.choices?.[0]?.message?.reasoning_content ||
    payload?.choices?.[0]?.message?.reasoning;
  if (typeof fallback === 'string') return fallback;

  return payload?.output_text || payload?.text || '';
}

function repairJsonPayload(rawText: string): string {
  let repaired = rawText.trim();
  const fencedMatch = repaired.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch) repaired = fencedMatch[1].trim();

  let result = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < repaired.length; i += 1) {
    const ch = repaired[i];

    if (inString) {
      if (escaped) { result += ch; escaped = false; continue; }
      if (ch === '\\') { result += ch; escaped = true; continue; }
      if (ch === '"') { inString = false; result += ch; continue; }
      if (ch === '\n' || ch === '\r') { result += '\\n'; continue; }
      if (ch === '\t') { result += '\\t'; continue; }
      result += ch;
      continue;
    }

    if (ch === '"') { inString = true; result += ch; continue; }
    result += ch;
  }

  return result.replace(/,\s*([}\]])/g, '$1').trim();
}

function balanceJsonCandidate(rawText: string): string {
  let repaired = rawText.trim();
  const fencedMatch = repaired.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch) repaired = fencedMatch[1].trim();

  const normalized = repaired.replace(/,\s*([}\]])/g, '$1').trim();
  if (!normalized) return normalized;

  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (const ch of normalized) {
    if (inString) {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{' || ch === '[') {
      stack.push(ch);
    } else if (ch === '}' || ch === ']') {
      const last = stack[stack.length - 1];
      if ((ch === '}' && last === '{') || (ch === ']' && last === '[')) stack.pop();
    }
  }

  let suffix = '';
  while (stack.length > 0) {
    const opener = stack.pop();
    suffix += opener === '[' ? ']' : '}';
  }

  return normalized + suffix;
}

function findLongestValidJsonPrefix(rawText: string): string | null {
  const trimmed = rawText.trim();
  if (!trimmed) return null;

  const candidates: string[] = [];
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch) candidates.push(fencedMatch[1].trim());
  candidates.push(trimmed);

  const seen = new Set<string>();
  for (const candidateText of candidates) {
    if (!candidateText || seen.has(candidateText)) continue;
    seen.add(candidateText);

    const start = candidateText.search(/[\[{]/);
    if (start === -1) continue;

    const sliced = candidateText.slice(start).trim();
    for (let end = sliced.length; end >= 1; end -= 1) {
      const prefix = sliced.slice(0, end).trim();
      if (!prefix) continue;
      try {
        JSON.parse(prefix);
        return prefix;
      } catch {
        // Try a shorter prefix.
      }
    }
  }

  return null;
}

// ── Helper: call the OpenAI-compatible proxy (/api/ai) ────────────────────────
async function callOpenAIProxy(
  provider: 'nvidia' | 'groq',
  apiKey: string,
  model: string,
  messages: { role: string; content: string }[],
  temperature: number,
  max_tokens: number
): Promise<string> {
  const res = await fetch('/api/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider,
      apiKey,
      model,
      messages,
      temperature,
      max_tokens,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    const label = provider === 'groq' ? 'Groq' : 'NVIDIA';
    throw new Error(`${label} API error ${res.status}: ${err}`);
  }

  const json = await res.json();
  return getResponseText(json);
}

// ── Statement analysis prompt ──────────────────────────────────────────────
const ANALYSIS_PROMPT = `
You are FinTrack AI — a specialist financial analyst. Your job is to analyse raw bank statement text and return structured JSON.

Given raw bank statement text:
1. Extract every transaction (date, description, amount).
2. Clean and simplify the description (e.g. change "UPI-CR/SALARY MAY 2025/INFOSYS LTD" to "Salary - Infosys" and "Swiggy food delivery order" to "Swiggy"). Do NOT copy raw transaction codes or reference numbers verbatim to avoid recitation blocks.
3. Categorize each into: Food, Transport, Shopping, Entertainment, Utilities, Health, Salary, Freelance, Investment, Savings, Transfer, Other.
4. Determine whether each entry is "income" or "expense".
5. Flag any transaction as isFlagged=true if it looks potentially fraudulent (duplicate high-value charges, unusual merchant, abnormally large amount).
6. Compute a monthly summary.
7. Generate personalised budget recommendations based on spending patterns and the user profile.

To optimize token usage and avoid truncation, the "transactions" field MUST be returned as a compact array of arrays, where each transaction is a 6-element list:
[date, description, amount, category, type, isFlagged]
- date: YYYY-MM-DD string
- description: simplified description string (e.g. "Salary - Infosys")
- amount: positive number
- category: category string (e.g. Food, Utilities, Salary)
- type: "income" or "expense"
- isFlagged: boolean (true or false)

Return ONLY valid JSON with this exact shape — no markdown, no explanation. If the statement is long, keep the response compact and valid, prioritizing the transactions you can confidently extract.
{
  "transactions": [
    ["YYYY-MM-DD", "description", amount, "category", "income|expense", false]
  ],
  "insight": {
    "id": "<YYYY-MM>",
    "totalIncome": <number>,
    "totalExpense": <number>,
    "savingsRate": <0-100>,
    "healthScore": <0-100>,
    "categoryBreakdown": { "<category>": <total_spent> },
    "recommendations": "<multiline string with bullet points>",
    "fraudFlags": ["<description of flagged transactions>"]
  }
}
`.trim();

export interface GeminiResult {
  transactions: Transaction[];
  insight: MonthlyInsight;
}

type TransactionTuple = [string, string, number, string, 'income' | 'expense', boolean];
type RawAIResponse = { transactions: TransactionTuple[]; insight: MonthlyInsight };

function parseAIJson(rawOutput: string, label: string): RawAIResponse {
  const candidates = [rawOutput.trim()];
  const fencedMatch = rawOutput.trim().match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch) candidates.unshift(fencedMatch[1].trim());

  let rawObj: RawAIResponse | null = null;

  for (const candidate of candidates) {
    if (!candidate) continue;

    // Direct parse
    try { rawObj = JSON.parse(candidate) as RawAIResponse; break; } catch { /* next */ }

    const repaired  = repairJsonPayload(candidate);
    const balanced  = balanceJsonCandidate(repaired);

    try { rawObj = JSON.parse(repaired)  as RawAIResponse; break; } catch { /* next */ }
    try { rawObj = JSON.parse(balanced)  as RawAIResponse; break; } catch { /* next */ }

    const prefix = findLongestValidJsonPrefix(balanced);
    if (prefix) {
      try { rawObj = JSON.parse(prefix) as RawAIResponse; break; } catch { /* next */ }
    }
  }

  if (!rawObj) {
    const jsonObject = extractJsonObject(rawOutput);
    if (!jsonObject) {
      console.error('AI response contained no extractable JSON object.', { label, rawOutput });
      throw new Error(`No JSON object found in ${label} response: ` + rawOutput.slice(0, 600));
    }

    const cleaned  = repairJsonPayload(jsonObject);
    const balanced = balanceJsonCandidate(cleaned);

    try { rawObj = JSON.parse(cleaned)  as RawAIResponse; } catch { /* next */ }
    if (!rawObj) {
      try { rawObj = JSON.parse(balanced) as RawAIResponse; } catch { /* next */ }
    }
    if (!rawObj) {
      const prefix = findLongestValidJsonPrefix(balanced);
      if (prefix) {
        try { rawObj = JSON.parse(prefix) as RawAIResponse; } catch {
          throw new Error(`Failed to parse ${label} response as JSON.\nSnippet: ${cleaned.slice(0, 300)}`);
        }
      } else {
        throw new Error(`Failed to parse ${label} response as JSON.\nSnippet: ${cleaned.slice(0, 300)}`);
      }
    }
  }

  return rawObj!;
}

export async function analyzeStatement(
  rawText: string,
  apiKey: string,
  userContext: string,
  provider: AIProvider = 'gemini',
  baseUrl?: string,
  model?: string
): Promise<GeminiResult> {
  const cfg = getProviderConfig(provider, apiKey, baseUrl, model);
  const normalizedText = (rawText || '').replace(/\s+/g, ' ').trim();
  const limitedText    = normalizedText.length > 14000 ? normalizedText.slice(0, 14000) : normalizedText;
  const prompt         = `${ANALYSIS_PROMPT}\n\nUser Profile: ${userContext}\n\nBank Statement Text:\n${limitedText}`;

  let rawOutput = '';

  if (cfg.provider === 'nvidia' || cfg.provider === 'groq') {
    const label = cfg.provider === 'groq' ? 'Groq' : 'NVIDIA';
    rawOutput = await callOpenAIProxy(
      cfg.provider,
      cfg.key,
      cfg.model,
      [
        { role: 'system',    content: 'Return only valid JSON matching the requested schema.' },
        { role: 'user',      content: prompt },
      ],
      0.2,
      8192
    );
    const parsed = parseAIJson(rawOutput, label);
    return mapToResult(parsed);
  }

  // ── Gemini ────────────────────────────────────────────────────────────────
  const res = await fetch(`${GEMINI_ENDPOINT}?key=${cfg.key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        topK: 40,
        topP: 0.9,
        maxOutputTokens: 8192,
        responseMimeType: 'application/json',
      },
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
      ],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${err}`);
  }

  const json = await res.json();
  rawOutput = json.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

  const parsed = parseAIJson(rawOutput, 'Gemini');
  return mapToResult(parsed);
}

function mapToResult(parsed: RawAIResponse): GeminiResult {
  const transactions: Transaction[] = (parsed.transactions || []).map((t) => ({
    id: crypto.randomUUID?.() ?? Math.random().toString(36).slice(2),
    date:        t[0] || new Date().toISOString().substring(0, 10),
    description: t[1] || 'Unknown Transaction',
    amount:      typeof t[2] === 'number' ? t[2] : 0,
    category:    t[3] || 'Other',
    type:        t[4] || 'expense',
    isFlagged:   !!t[5],
  }));

  const rawInsight = parsed.insight || {};
  const firstTxDate = transactions[0]?.date;
  const fallbackId = firstTxDate && /^\d{4}-\d{2}/.test(firstTxDate)
    ? firstTxDate.substring(0, 7)
    : new Date().toISOString().substring(0, 7);

  const insight: MonthlyInsight = {
    id: rawInsight.id || fallbackId,
    totalIncome: typeof rawInsight.totalIncome === 'number' ? rawInsight.totalIncome : 0,
    totalExpense: typeof rawInsight.totalExpense === 'number' ? rawInsight.totalExpense : 0,
    savingsRate: typeof rawInsight.savingsRate === 'number' ? rawInsight.savingsRate : 0,
    healthScore: typeof rawInsight.healthScore === 'number' ? rawInsight.healthScore : 0,
    categoryBreakdown: rawInsight.categoryBreakdown || {},
    recommendations: rawInsight.recommendations || '',
    fraudFlags: rawInsight.fraudFlags || [],
  };

  return { transactions, insight };
}

// ── Chatbot ──────────────────────────────────────────────────────────────────
export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

const CHAT_SYSTEM = `You are FinTrack AI, a friendly and knowledgeable personal finance advisor.
You help users understand their spending patterns, savings goals, and financial health.
Keep answers concise, practical, and motivating. Use ₹ for currency when amounts are mentioned.
If the user shares financial data, analyse it and give specific actionable advice.
Do NOT make up transaction data — only reference what the user tells you.`;

export async function chatWithAI(
  messages: ChatMessage[],
  apiKey: string,
  provider: AIProvider = 'gemini',
  baseUrl?: string,
  model?: string
): Promise<string> {
  const cfg = getProviderConfig(provider, apiKey, baseUrl, model);

  if (cfg.provider === 'nvidia' || cfg.provider === 'groq') {
    const reply = await callOpenAIProxy(
      cfg.provider,
      cfg.key,
      cfg.model,
      [
        { role: 'system',    content: CHAT_SYSTEM },
        { role: 'assistant', content: "Understood! I'm FinTrack AI, your personal finance advisor. How can I help you today?" },
        ...messages.map((m) => ({
          role:    m.role === 'model' ? 'assistant' : 'user',
          content: m.text,
        })),
      ],
      0.7,
      1024
    );
    return reply || 'Sorry, I could not generate a response.';
  }

  // ── Gemini ────────────────────────────────────────────────────────────────
  const contents = [
    { role: 'user',  parts: [{ text: CHAT_SYSTEM }] },
    { role: 'model', parts: [{ text: "Understood! I'm FinTrack AI, your personal finance advisor. How can I help you today?" }] },
    ...messages.map((m) => ({
      role:  m.role,
      parts: [{ text: m.text }],
    })),
  ];

  const res = await fetch(`${GEMINI_ENDPOINT}?key=${cfg.key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents,
      generationConfig: { temperature: 0.7, topK: 40, topP: 0.95, maxOutputTokens: 1024 },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${err}`);
  }

  const json = await res.json();
  return json.candidates?.[0]?.content?.parts?.[0]?.text ?? 'Sorry, I could not generate a response.';
}
