// Streaming LLM proxy.
//
// Runs on the edge so the browser never holds a server-side key and the response
// streams token-by-token: a single agent turn can take minutes, which no
// request/response serverless function would survive. Edge functions cap CPU
// (50ms), not wall clock, and this handler is pure I/O.
//
// Key resolution order:
//   1. `apiKey` in the request body   — bring-your-own-key, never persisted
//   2. ANTHROPIC_API_KEY / OPENAI_API_KEY environment variable
//
// The response body is a newline-delimited JSON stream of events:
//   {"t":"text","v":"..."}      incremental assistant text
//   {"t":"search","v":"query"}  the model ran a server-side web search
//   {"t":"usage","v":{...}}     token accounting, once, at the end
//   {"t":"error","v":"..."}     terminal error

import type { Config, Context } from "@netlify/edge-functions";

interface LlmRequest {
  provider?: "anthropic" | "openai";
  model?: string;
  system?: string;
  prompt?: string;
  apiKey?: string;
  maxTokens?: number;
  temperature?: number;
  webSearch?: boolean;
  maxSearches?: number;
}

const DEFAULT_MODEL = { anthropic: "claude-opus-5", openai: "gpt-4o" } as const;
const ANTHROPIC_VERSION = "2023-06-01";
const WEB_SEARCH_TOOL = "web_search_20250305";

function ndjson(obj: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(obj) + "\n");
}

function fail(message: string, status = 400): Response {
  return new Response(ndjson({ t: "error", v: message }), {
    status,
    headers: { "content-type": "application/x-ndjson" },
  });
}

/** Splits a raw SSE byte stream into complete `data:` payload strings. */
async function* sseLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (line.startsWith("data:")) yield line.slice(5).trim();
    }
  }
}

async function callAnthropic(req: LlmRequest, key: string, allowSearch: boolean) {
  const body: Record<string, unknown> = {
    model: req.model || DEFAULT_MODEL.anthropic,
    max_tokens: req.maxTokens ?? 8192,
    temperature: req.temperature ?? 0.3,
    stream: true,
    system: req.system,
    messages: [{ role: "user", content: req.prompt }],
  };
  if (allowSearch) {
    body.tools = [{ type: WEB_SEARCH_TOOL, name: "web_search", max_uses: req.maxSearches ?? 8 }];
  }
  return fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
  });
}

async function callOpenAI(req: LlmRequest, key: string) {
  return fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: req.model || DEFAULT_MODEL.openai,
      max_tokens: req.maxTokens ?? 8192,
      temperature: req.temperature ?? 0.3,
      stream: true,
      stream_options: { include_usage: true },
      messages: [
        ...(req.system ? [{ role: "system", content: req.system }] : []),
        { role: "user", content: req.prompt },
      ],
    }),
  });
}

export default async (request: Request, _context: Context) => {
  if (request.method !== "POST") return fail("POST only", 405);

  let req: LlmRequest;
  try {
    req = (await request.json()) as LlmRequest;
  } catch {
    return fail("malformed JSON body");
  }

  const provider = req.provider === "openai" ? "openai" : "anthropic";
  if (!req.prompt) return fail("prompt is required");

  const envKey =
    provider === "anthropic"
      ? Netlify.env.get("ANTHROPIC_API_KEY")
      : Netlify.env.get("OPENAI_API_KEY");
  const usedOwnKey = Boolean(req.apiKey?.trim());
  const key = req.apiKey?.trim() || envKey;
  if (!key) {
    return fail(
      `No ${provider} API key. Add one in Settings, or set ${
        provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY"
      } on the site.`,
      401,
    );
  }

  // Anthropic rejects the web-search tool on keys without it enabled. Rather than
  // failing the whole run, drop the tool and retry once without it.
  let upstream: Response;
  let searchEnabled = provider === "anthropic" && req.webSearch !== false;
  if (provider === "anthropic") {
    upstream = await callAnthropic(req, key, searchEnabled);
    if (!upstream.ok && searchEnabled) {
      searchEnabled = false;
      upstream = await callAnthropic(req, key, false);
    }
  } else {
    upstream = await callOpenAI(req, key);
  }

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    // Netlify can inject a gateway-scoped provider key into the environment. It
    // is rejected when sent straight to the provider, which otherwise surfaces as
    // a bare 401 and reads as "your key is wrong" to someone who never set one.
    if (upstream.status === 401 && !usedOwnKey) {
      return fail(
        `This deployment has no usable ${provider} key. Open Settings and paste your own — it stays in your browser.`,
        401,
      );
    }
    return fail(`${provider} API ${upstream.status}: ${detail.slice(0, 600)}`, 502);
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        if (!searchEnabled && provider === "anthropic" && req.webSearch !== false) {
          controller.enqueue(ndjson({ t: "notice", v: "web search unavailable on this key" }));
        }
        for await (const payload of sseLines(upstream.body!)) {
          if (payload === "[DONE]") break;
          let evt: any;
          try {
            evt = JSON.parse(payload);
          } catch {
            continue;
          }

          if (provider === "anthropic") {
            if (evt.type === "content_block_delta") {
              if (evt.delta?.type === "text_delta") {
                controller.enqueue(ndjson({ t: "text", v: evt.delta.text }));
              }
            } else if (evt.type === "content_block_start") {
              const b = evt.content_block;
              if (b?.type === "server_tool_use" && b?.name === "web_search") {
                controller.enqueue(ndjson({ t: "search", v: b.input?.query ?? "" }));
              }
            } else if (evt.type === "message_delta" && evt.usage) {
              controller.enqueue(ndjson({ t: "usage", v: evt.usage }));
            } else if (evt.type === "error") {
              controller.enqueue(ndjson({ t: "error", v: evt.error?.message ?? "stream error" }));
            }
          } else {
            const delta = evt.choices?.[0]?.delta?.content;
            if (delta) controller.enqueue(ndjson({ t: "text", v: delta }));
            if (evt.usage) controller.enqueue(ndjson({ t: "usage", v: evt.usage }));
          }
        }
      } catch (err) {
        controller.enqueue(ndjson({ t: "error", v: String(err) }));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
    },
  });
};

export const config: Config = { path: "/api/llm", method: "POST" };
