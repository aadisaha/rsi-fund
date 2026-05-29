import "server-only";

import { envTrim } from "@/lib/env";

export type LlmProviderPreference = "auto" | "openai" | "openrouter";
export type LlmProvider = "openai" | "openrouter";

export type LlmResearchDecision = Record<string, unknown>;
export type LlmEnv = Record<string, string | undefined>;

export type LlmResearchPromptOptions = {
  objective?: string;
  maxDepth?: number;
  maxArrayItems?: number;
  maxStringLength?: number;
  env?: LlmEnv;
};

export type LlmResearchClientOptions = LlmResearchPromptOptions & {
  provider?: LlmProviderPreference;
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
  fetchFn?: typeof fetch;
};

export type LlmResearchResult = {
  provider: LlmProvider;
  model: string;
  prompt: string;
  text: string;
  decision: LlmResearchDecision;
};

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_OPENAI_MODEL = "gpt-4.1-mini";
const DEFAULT_OPENROUTER_MODEL = "openai/gpt-4.1-mini";
const DEFAULT_OBJECTIVE =
  "Decide whether the paper research evidence supports a paper-only allocation change.";

const CREDENTIAL_KEY_RE =
  /(^|[_-])(api[_-]?key|authorization|bearer|client[_-]?secret|cookie|credential|password|private[_-]?key|secret|session|token)([_-]|$)/i;
const ENV_CONTAINER_KEYS = new Set(["env", "environment", "processenv", "process.env"]);

function jsonKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9.]/g, "");
}

function isSensitiveKey(key: string): boolean {
  const normalized = jsonKey(key);
  return ENV_CONTAINER_KEYS.has(normalized) || CREDENTIAL_KEY_RE.test(key);
}

function envValues(env: LlmEnv): string[] {
  return Array.from(
    new Set(
      Object.values(env)
        .map((v) => envTrim(v))
        .filter((v) => v.length >= 8),
    ),
  ).sort((a, b) => b.length - a.length);
}

function redactEnvValues(value: string, values: string[]): string {
  return values.reduce(
    (s, envValue) => s.split(envValue).join("[REDACTED_ENV_VALUE]"),
    value,
  );
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  return values.map((v) => envTrim(v)).find(Boolean);
}

function sanitizeValue(
  value: unknown,
  options: Required<Pick<LlmResearchPromptOptions, "maxDepth" | "maxArrayItems" | "maxStringLength">> & {
    envValueList: string[];
  },
  depth: number,
  seen: WeakSet<object>,
): unknown {
  if (value == null || typeof value === "boolean" || typeof value === "number") return value;

  if (typeof value === "string") {
    const redacted = redactEnvValues(value, options.envValueList);
    return redacted.length > options.maxStringLength
      ? `${redacted.slice(0, options.maxStringLength)}...`
      : redacted;
  }

  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "object") return String(value);
  if (seen.has(value)) return "[Circular]";
  if (depth >= options.maxDepth) return "[MaxDepth]";

  seen.add(value);

  if (Array.isArray(value)) {
    return value
      .slice(0, options.maxArrayItems)
      .map((item) => sanitizeValue(item, options, depth + 1, seen));
  }

  const out: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
    if (isSensitiveKey(key)) continue;
    out[key] = sanitizeValue(nestedValue, options, depth + 1, seen);
  }
  return out;
}

export function sanitizeResearchContext(
  context: unknown,
  options: LlmResearchPromptOptions = {},
): unknown {
  return sanitizeValue(
    context,
    {
      maxDepth: options.maxDepth ?? 8,
      maxArrayItems: options.maxArrayItems ?? 40,
      maxStringLength: options.maxStringLength ?? 4_000,
      envValueList: envValues(options.env ?? process.env),
    },
    0,
    new WeakSet<object>(),
  );
}

export function buildResearchPrompt(
  context: unknown,
  options: LlmResearchPromptOptions = {},
): string {
  const sanitized = sanitizeResearchContext(context, options);
  return [
    "You are a paper-trading research reviewer. No live orders are allowed.",
    options.objective ?? DEFAULT_OBJECTIVE,
    "Return only valid JSON with: action, confidence, rationale, risks, and suggestedPaperTrades.",
    "Use null or an empty array when evidence is insufficient.",
    "",
    "Sanitized research context:",
    JSON.stringify(sanitized, null, 2),
  ].join("\n");
}

export function selectLlmProvider(
  env: LlmEnv = process.env,
  preference: LlmProviderPreference = (envTrim(env.LLM_PROVIDER) as LlmProviderPreference) || "auto",
): LlmProvider {
  if (!["auto", "openai", "openrouter"].includes(preference)) {
    throw new Error(`Unsupported LLM_PROVIDER: ${preference}`);
  }

  const hasOpenAi = Boolean(envTrim(env.OPENAI_API_KEY));
  const hasOpenRouter = Boolean(envTrim(env.OPENROUTER_API_KEY));

  if (preference === "openai") {
    if (!hasOpenAi) throw new Error("LLM_PROVIDER=openai requires OPENAI_API_KEY.");
    return "openai";
  }
  if (preference === "openrouter") {
    if (!hasOpenRouter) throw new Error("LLM_PROVIDER=openrouter requires OPENROUTER_API_KEY.");
    return "openrouter";
  }
  if (hasOpenAi) return "openai";
  if (hasOpenRouter) return "openrouter";
  throw new Error("No LLM provider configured. Set OPENAI_API_KEY or OPENROUTER_API_KEY.");
}

function findBalancedJson(text: string): string | null {
  const start = text.search(/[\[{]/);
  if (start < 0) return null;

  const open = text[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === "\"") {
        inString = false;
      }
      continue;
    }
    if (ch === "\"") {
      inString = true;
    } else if (ch === open) {
      depth += 1;
    } else if (ch === close) {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }

  return null;
}

export function parseResearchDecisionText(text: string): LlmResearchDecision {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const candidates = [trimmed, findBalancedJson(trimmed)].filter((v): v is string => Boolean(v));

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as LlmResearchDecision;
      }
    } catch {
      // Try the next candidate; model text often wraps JSON in prose.
    }
  }

  throw new Error("LLM decision was not a JSON object.");
}

function extractOpenAiOutputText(json: unknown): string {
  const data = json as {
    output_text?: unknown;
    output?: Array<{
      content?: Array<{ type?: string; text?: unknown }>;
    }>;
  };
  if (typeof data.output_text === "string") return data.output_text;

  const parts = data.output
    ?.flatMap((item) => item.content ?? [])
    .map((part) => part.text)
    .filter((part): part is string => typeof part === "string");
  if (parts?.length) return parts.join("\n");

  throw new Error("OpenAI response did not include output text.");
}

function extractOpenRouterOutputText(json: unknown): string {
  const data = json as {
    choices?: Array<{
      message?: {
        content?: unknown;
      };
    }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts = content
      .map((part) =>
        typeof part === "string"
          ? part
          : typeof part?.text === "string"
            ? part.text
            : "",
      )
      .filter(Boolean);
    if (parts.length) return parts.join("\n");
  }
  throw new Error("OpenRouter response did not include message content.");
}

async function postJson(fetchFn: typeof fetch, url: string, key: string, body: unknown): Promise<unknown> {
  const res = await fetchFn(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) {
    const bodyText = await res.text();
    throw new Error(`LLM request failed (${res.status}): ${bodyText.slice(0, 180)}`);
  }
  return res.json();
}

export async function requestLlmResearchDecision(
  context: unknown,
  options: LlmResearchClientOptions = {},
): Promise<LlmResearchResult> {
  const env = options.env ?? process.env;
  const provider = selectLlmProvider(env, options.provider);
  const fetchFn = options.fetchFn ?? fetch;
  const prompt = buildResearchPrompt(context, options);
  const temperature = options.temperature ?? 0.2;
  const maxOutputTokens = options.maxOutputTokens ?? 1_000;

  if (provider === "openai") {
    const model =
      firstNonEmpty(options.model, env.OPENAI_MODEL, env.LLM_MODEL) ?? DEFAULT_OPENAI_MODEL;
    const json = await postJson(fetchFn, OPENAI_RESPONSES_URL, envTrim(env.OPENAI_API_KEY), {
      model,
      input: prompt,
      temperature,
      max_output_tokens: maxOutputTokens,
    });
    const text = extractOpenAiOutputText(json);
    return { provider, model, prompt, text, decision: parseResearchDecisionText(text) };
  }

  const model =
    firstNonEmpty(options.model, env.OPENROUTER_MODEL, env.LLM_MODEL) ?? DEFAULT_OPENROUTER_MODEL;
  const json = await postJson(fetchFn, OPENROUTER_CHAT_URL, envTrim(env.OPENROUTER_API_KEY), {
    model,
    messages: [{ role: "user", content: prompt }],
    temperature,
    max_tokens: maxOutputTokens,
  });
  const text = extractOpenRouterOutputText(json);
  return { provider, model, prompt, text, decision: parseResearchDecisionText(text) };
}
