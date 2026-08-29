import { useEffect, useState } from "react";
import { Pipeline } from "./components/Pipeline";
import { Bench } from "./components/Bench";
import { Integrations } from "./components/Integrations";
import { DEFAULT_SETTINGS, MODELS, type LlmSettings, type Provider } from "./lib/llm";

const STORAGE_KEY = "bispec-studio.settings";

function loadSettings(): LlmSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<LlmSettings>) };
  } catch {
    /* private browsing, blocked storage — fall through to defaults */
  }
  return DEFAULT_SETTINGS;
}

function Settings({
  settings,
  onChange,
  onClose,
}: {
  settings: LlmSettings;
  onChange: (s: LlmSettings) => void;
  onClose: () => void;
}) {
  const set = <K extends keyof LlmSettings>(k: K, v: LlmSettings[K]) =>
    onChange({ ...settings, [k]: v });

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="row between">
          <h3>Settings</h3>
          <button className="ghost sm" onClick={onClose}>
            Close
          </button>
        </div>

        <label>
          Provider
          <select
            value={settings.provider}
            onChange={(e) => {
              const p = e.target.value as Provider;
              onChange({ ...settings, provider: p, model: MODELS[p][0].id });
            }}
          >
            <option value="anthropic">Anthropic</option>
            <option value="openai">OpenAI</option>
          </select>
        </label>

        <label>
          Model
          <select value={settings.model} onChange={(e) => set("model", e.target.value)}>
            {MODELS[settings.provider].map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          API key
          <input
            type="password"
            value={settings.apiKey}
            onChange={(e) => set("apiKey", e.target.value)}
            placeholder={settings.provider === "anthropic" ? "sk-ant-…" : "sk-…"}
            spellCheck={false}
            autoComplete="off"
          />
        </label>
        <p className="hint">
          Kept in this browser only and sent with each request to the site's own proxy — never
          stored server-side. Leave it blank to use a key configured on the deployment as{" "}
          <code>{settings.provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY"}</code>.
        </p>

        {settings.provider === "anthropic" && (
          <label className="check">
            <input
              type="checkbox"
              checked={settings.webSearch}
              onChange={(e) => set("webSearch", e.target.checked)}
            />
            Let agents run server-side web search
          </label>
        )}

        <label>
          Max output tokens
          <input
            type="number"
            min={1024}
            max={32000}
            step={1024}
            value={settings.maxTokens}
            onChange={(e) => set("maxTokens", Number(e.target.value))}
          />
        </label>

        <label>
          Temperature — {settings.temperature}
          <input
            type="range"
            min={0}
            max={1}
            step={0.1}
            value={settings.temperature}
            onChange={(e) => set("temperature", Number(e.target.value))}
          />
        </label>
      </aside>
    </div>
  );
}

type Tab = "pipeline" | "bench" | "integrations";

export default function App() {
  const [settings, setSettings] = useState<LlmSettings>(loadSettings);
  const [tab, setTab] = useState<Tab>("pipeline");
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      /* storage unavailable — settings simply do not persist */
    }
  }, [settings]);

  return (
    <>
      <header>
        <div className="brand">
          <span className="mark" />
          <div>
            <h1>BiSpec Studio</h1>
            <p>Bispecific antibody discovery pipeline — grounded, audited, iterative</p>
          </div>
        </div>
        <nav className="tabs">
          {(
            [
              ["pipeline", "Pipeline"],
              ["bench", "In-silico bench"],
              ["integrations", "Integrations"],
            ] as const
          ).map(([k, label]) => (
            <button key={k} className={tab === k ? "active" : ""} onClick={() => setTab(k)}>
              {label}
            </button>
          ))}
          <button className="ghost sm" onClick={() => setShowSettings(true)}>
            Settings{!settings.apiKey && <em className="warn"> · no key</em>}
          </button>
        </nav>
      </header>

      <main>
        {tab === "pipeline" && <Pipeline settings={settings} />}
        {tab === "bench" && <Bench />}
        {tab === "integrations" && <Integrations />}
      </main>

      <footer>
        <span>
          Public data only. Every figure is a hypothesis to be tested at the bench — nothing here is
          a clinical or regulatory conclusion.
        </span>
        <a
          href="https://github.com/peterydkim/drug-discovery-bispecific-agents"
          target="_blank"
          rel="noreferrer"
        >
          Source
        </a>
      </footer>

      {showSettings && (
        <Settings settings={settings} onChange={setSettings} onClose={() => setShowSettings(false)} />
      )}
    </>
  );
}
