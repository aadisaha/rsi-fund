import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  buildResearchPrompt,
  parseResearchDecisionText,
  requestLlmResearchDecision,
  sanitizeResearchContext,
  selectLlmProvider,
} from "../lib/llm-research";

const originalFetch = globalThis.fetch;
const originalEnv = {
  LLM_PROVIDER: process.env.LLM_PROVIDER,
  LLM_MODEL: process.env.LLM_MODEL,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_MODEL: process.env.OPENAI_MODEL,
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  OPENROUTER_MODEL: process.env.OPENROUTER_MODEL,
};

function resetEnv() {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value == null) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function mockJsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
  } as unknown as Response;
}

afterEach(() => {
  resetEnv();
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("llm research provider selection", () => {
  it("prefers OpenAI in auto mode when both keys exist", () => {
    expect(
      selectLlmProvider({
        LLM_PROVIDER: "auto",
        OPENAI_API_KEY: "openai-key",
        OPENROUTER_API_KEY: "openrouter-key",
      }),
    ).toBe("openai");
  });

  it("falls back to OpenRouter in auto mode when OpenAI is absent", () => {
    expect(
      selectLlmProvider({
        LLM_PROVIDER: "auto",
        OPENROUTER_API_KEY: "openrouter-key",
      }),
    ).toBe("openrouter");
  });

  it("requires a key for explicit providers", () => {
    expect(() => selectLlmProvider({ LLM_PROVIDER: "openai" })).toThrow(/OPENAI_API_KEY/);
    expect(() => selectLlmProvider({ LLM_PROVIDER: "openrouter" })).toThrow(/OPENROUTER_API_KEY/);
  });
});

describe("llm research prompt safety", () => {
  it("removes credential fields and env values from the prompt payload", () => {
    process.env.OPENAI_API_KEY = "sk-test-should-not-leak";
    process.env.SOME_PRIVATE_VALUE = "private-env-value";

    const prompt = buildResearchPrompt({
      symbol: "BTC/USD",
      apiKey: "inline-secret",
      credentials: { token: "nested-token" },
      processEnv: { OPENAI_API_KEY: process.env.OPENAI_API_KEY },
      note: `contains ${process.env.SOME_PRIVATE_VALUE}`,
    });

    expect(prompt).toContain("BTC/USD");
    expect(prompt).not.toContain("sk-test-should-not-leak");
    expect(prompt).not.toContain("private-env-value");
    expect(prompt).not.toContain("inline-secret");
    expect(prompt).not.toContain("nested-token");
    expect(prompt).toContain("[REDACTED_ENV_VALUE]");
  });

  it("handles circular context without throwing", () => {
    const context: Record<string, unknown> = { symbol: "SPY" };
    context.self = context;

    expect(sanitizeResearchContext(context)).toEqual({
      symbol: "SPY",
      self: "[Circular]",
    });
  });
});

describe("llm research decision parsing", () => {
  it("parses fenced JSON decision text", () => {
    expect(
      parseResearchDecisionText('```json\n{"action":"hold","confidence":0.4}\n```'),
    ).toEqual({ action: "hold", confidence: 0.4 });
  });

  it("extracts a balanced JSON object from surrounding text", () => {
    expect(
      parseResearchDecisionText(
        'Decision follows: {"action":"paper_buy","rationale":"brace } in string"} Done.',
      ),
    ).toEqual({ action: "paper_buy", rationale: "brace } in string" });
  });

  it("rejects non-object JSON decisions", () => {
    expect(() => parseResearchDecisionText('[{"action":"hold"}]')).toThrow(/JSON object/);
  });
});

describe("llm research client", () => {
  it("posts to OpenAI responses and extracts output_text", async () => {
    process.env.LLM_PROVIDER = "auto";
    process.env.OPENAI_API_KEY = "openai-key";
    process.env.OPENROUTER_API_KEY = "openrouter-key";
    process.env.OPENAI_MODEL = "openai-test-model";
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({
        output_text: '{"action":"hold","confidence":0.7}',
      }),
    );
    globalThis.fetch = fetchMock;

    const result = await requestLlmResearchDecision({ symbol: "ETH/USD" });

    expect(result.provider).toBe("openai");
    expect(result.model).toBe("openai-test-model");
    expect(result.decision).toEqual({ action: "hold", confidence: 0.7 });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/responses",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer openai-key",
          "Content-Type": "application/json",
        }),
      }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      model: "openai-test-model",
      input: expect.stringContaining("ETH/USD"),
      max_output_tokens: 1000,
    });
  });

  it("posts to OpenRouter chat completions and extracts message content", async () => {
    process.env.LLM_PROVIDER = "openrouter";
    delete process.env.OPENAI_API_KEY;
    process.env.OPENROUTER_API_KEY = "openrouter-key";
    process.env.OPENROUTER_MODEL = "router-test-model";
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({
        choices: [{ message: { content: '{"action":"paper_buy","confidence":0.8}' } }],
      }),
    );
    globalThis.fetch = fetchMock;

    const result = await requestLlmResearchDecision({ symbol: "SOL/USD" });

    expect(result.provider).toBe("openrouter");
    expect(result.model).toBe("router-test-model");
    expect(result.decision).toEqual({ action: "paper_buy", confidence: 0.8 });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer openrouter-key",
          "Content-Type": "application/json",
        }),
      }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      model: "router-test-model",
      messages: [{ role: "user", content: expect.stringContaining("SOL/USD") }],
      max_tokens: 1000,
    });
  });

  it("reports provider HTTP errors without leaking long bodies", async () => {
    process.env.LLM_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "openai-key";
    globalThis.fetch = vi.fn().mockResolvedValue(mockJsonResponse({ error: "x".repeat(300) }, { ok: false, status: 429 }));

    await expect(requestLlmResearchDecision({ symbol: "SPY" })).rejects.toThrow(
      /LLM request failed \(429\)/,
    );
  });
});
