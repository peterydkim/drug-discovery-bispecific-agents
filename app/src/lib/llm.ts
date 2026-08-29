// Streaming client for the /api/llm edge function.

export type Provider = "anthropic" | "openai";

export interface LlmSettings {
  provider: Provider;
  model: string;
  apiKey: string;
  webSearch: boolean;
  maxTokens: number;
  temperature: number;
}

export const MODELS: Record<Provider, { id: string; label: string }[]> = {
  anthropic: [
    { id: "claude-opus-5", label: "Claude Opus 5 — deepest reasoning" },
    { id: "claude-sonnet-5", label: "Claude Sonnet 5 — balanced" },
    { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5 — fastest" },
  ],
  openai: [
    { id: "gpt-4o", label: "GPT-4o" },
    { id: "gpt-4o-mini", label: "GPT-4o mini" },
  ],
};

export const DEFAULT_SETTINGS: LlmSettings = {
  provider: "anthropic",
  model: "claude-opus-5",
  apiKey: "",
  webSearch: true,
  maxTokens: 8192,
  temperature: 0.3,
};

export interface StreamHandlers {
  onText: (chunk: string) => void;
  onSearch?: (query: string) => void;
  onNotice?: (message: string) => void;
  onUsage?: (usage: Record<string, number>) => void;
}

export interface StreamResult {
  text: string;
  searches: string[];
  usage: Record<string, number> | null;
}

export async function streamAgent(
  args: { system: string; prompt: string; settings: LlmSettings; signal?: AbortSignal },
  handlers: StreamHandlers,
): Promise<StreamResult> {
  const { settings } = args;
  const res = await fetch("/api/llm", {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal: args.signal,
    body: JSON.stringify({
      provider: settings.provider,
      model: settings.model,
      system: args.system,
      prompt: args.prompt,
      apiKey: settings.apiKey || undefined,
      maxTokens: settings.maxTokens,
      temperature: settings.temperature,
      webSearch: settings.webSearch,
    }),
  });

  if (!res.body) throw new Error("The model endpoint returned no response body.");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  const searches: string[] = [];
  let usage: Record<string, number> | null = null;

  const handle = (line: string) => {
    if (!line.trim()) return;
    let evt: { t: string; v: unknown };
    try {
      evt = JSON.parse(line);
    } catch {
      return;
    }
    switch (evt.t) {
      case "text":
        text += evt.v as string;
        handlers.onText(evt.v as string);
        break;
      case "search":
        searches.push(evt.v as string);
        handlers.onSearch?.(evt.v as string);
        break;
      case "notice":
        handlers.onNotice?.(evt.v as string);
        break;
      case "usage":
        usage = evt.v as Record<string, number>;
        handlers.onUsage?.(usage);
        break;
      case "error":
        throw new Error(evt.v as string);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      handle(line);
    }
  }
  if (buffer.trim()) handle(buffer);

  return { text, searches, usage };
}
