import { useRef, useState } from "react";
import { runPipeline, toMarkdown, type RunConfig, type StepResult, type RunState } from "../lib/pipeline";
import type { LlmSettings } from "../lib/llm";
import type { TargetBrief } from "../lib/bio";
import { Markdown } from "./Markdown";

const PRESETS = [
  { label: "PD-1 × LAG-3", t1: "PDCD1", t2: "LAG3", disease: "metastatic melanoma" },
  { label: "PD-1 × VEGF-A", t1: "PDCD1", t2: "VEGFA", disease: "non-small cell lung cancer" },
  { label: "PD-L1 × TIGIT", t1: "CD274", t2: "TIGIT", disease: "solid tumor immunotherapy" },
  { label: "FcγRIIB × CD79b", t1: "FCGR2B", t2: "CD79B", disease: "B-cell non-Hodgkin lymphoma" },
];

function CoverageBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const tone = pct >= 80 ? "pass" : pct >= 50 ? "watch" : "fail";
  return (
    <div className="coverage" title={`${pct}% of quantitative claims have a nearby identifier`}>
      <div className={`coverage-fill ${tone}`} style={{ width: `${pct}%` }} />
      <span>{pct}%</span>
    </div>
  );
}

function StepCard({ step, open, onToggle }: { step: StepResult; open: boolean; onToggle: () => void }) {
  const [tab, setTab] = useState<"report" | "json" | "evidence" | "grounding">("report");
  const e = step.evidence;
  const secs = step.startedAt && step.finishedAt ? Math.round((step.finishedAt - step.startedAt) / 1000) : null;

  return (
    <div className={`step ${step.status}`}>
      <button className="step-head" onClick={onToggle}>
        <span className={`dot ${step.status}`} />
        <strong>{step.title}</strong>
        <span className="muted">agent {step.agentId}</span>
        {step.searches.length > 0 && <span className="tag">{step.searches.length} searches</span>}
        {step.json ? <span className="tag ok">JSON ok</span> : step.jsonError ? <span className="tag bad">JSON failed</span> : null}
        {e && <CoverageBar value={e.coverage} />}
        <span className="grow" />
        {secs !== null && <span className="muted">{secs}s</span>}
        <span className="muted">{step.text.length.toLocaleString()} chars</span>
        <span className="chev">{open ? "▾" : "▸"}</span>
      </button>

      {step.status === "error" && <p className="error step-error">{step.error}</p>}
      {step.notices.map((n, i) => (
        <p key={i} className="warn step-error">{n}</p>
      ))}

      {open && (
        <div className="step-body">
          <div className="tabs sm">
            {(["report", "json", "evidence", "grounding"] as const).map((t) => (
              <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
                {t}
                {t === "evidence" && e && e.uncitedClaims > 0 && <em className="bad"> {e.uncitedClaims}</em>}
              </button>
            ))}
          </div>

          {tab === "report" && (step.text ? <Markdown source={step.text} /> : <p className="muted">Waiting for output…</p>)}

          {tab === "json" &&
            (step.json ? (
              <pre className="code">{JSON.stringify(step.json, null, 2)}</pre>
            ) : (
              <p className="warn">{step.jsonError ?? "No JSON yet."}</p>
            ))}

          {tab === "evidence" && (
            <div>
              {!e ? (
                <p className="muted">The audit runs when the step finishes.</p>
              ) : (
                <>
                  <p className="hint">
                    {e.claims.length} quantitative claims · {e.citedClaims} with an identifier within
                    six lines · {e.citations.length} distinct sources cited.
                  </p>
                  {e.uncitedClaims > 0 && (
                    <>
                      <h4 className="bad">Unsourced numbers</h4>
                      <ul className="list tight">
                        {e.claims
                          .filter((c) => !c.cited)
                          .slice(0, 25)
                          .map((c, i) => (
                            <li key={i}>
                              <code>{c.values.join(", ")}</code>
                              <div className="muted">
                                line {c.line}: {c.text}
                              </div>
                            </li>
                          ))}
                      </ul>
                    </>
                  )}
                  <h4>Sources</h4>
                  <div className="chips">
                    {e.citations.slice(0, 60).map((c, i) => (
                      <a key={i} className="chip" href={c.url} target="_blank" rel="noreferrer">
                        {c.kind}
                        <em>{c.id.length > 28 ? c.id.slice(0, 28) + "…" : c.id}</em>
                      </a>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {tab === "grounding" &&
            (step.grounding ? (
              <pre className="code">{step.grounding}</pre>
            ) : (
              <p className="muted">This step consumed upstream JSON only; no live retrieval was injected.</p>
            ))}
        </div>
      )}
    </div>
  );
}

export function Pipeline({ settings }: { settings: LlmSettings }) {
  const [t1, setT1] = useState("PDCD1");
  const [t2, setT2] = useState("LAG3");
  const [disease, setDisease] = useState("metastatic melanoma");
  const [maxIterations, setMaxIterations] = useState(1);
  const [grounding, setGrounding] = useState(true);
  const [experimental, setExperimental] = useState("");
  const [showExp, setShowExp] = useState(false);

  const [steps, setSteps] = useState<StepResult[]>([]);
  const [briefs, setBriefs] = useState<TargetBrief[]>([]);
  const [running, setRunning] = useState(false);
  const [stopReason, setStopReason] = useState("");
  const [openKey, setOpenKey] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const stateRef = useRef<RunState | null>(null);

  const start = async () => {
    setSteps([]);
    setBriefs([]);
    setStopReason("");
    setRunning(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const config: RunConfig = {
      target1: t1.trim().toUpperCase(),
      target2: t2.trim().toUpperCase(),
      disease: disease.trim(),
      maxIterations,
      grounding,
      experimentalData: experimental.trim() || undefined,
      settings,
    };

    try {
      const state = await runPipeline(
        config,
        {
          onStep: (s) => {
            setOpenKey((k) => k ?? s.key);
            setSteps((prev) => {
              const i = prev.findIndex((p) => p.key === s.key && p.iteration === s.iteration);
              if (i === -1) return [...prev, s];
              const next = [...prev];
              next[i] = s;
              return next;
            });
          },
          onBriefs: setBriefs,
          onStop: setStopReason,
        },
        ctrl.signal,
      );
      stateRef.current = state;
    } catch (e) {
      setStopReason((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const download = () => {
    const state = stateRef.current;
    const md = state
      ? toMarkdown(state)
      : steps.map((s) => `## ${s.title}\n\n${s.text}`).join("\n\n---\n\n");
    const blob = new Blob([md], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${t1.toLowerCase()}-${t2.toLowerCase()}-workflow-results.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const totalUncited = steps.reduce((n, s) => n + (s.evidence?.uncitedClaims ?? 0), 0);

  return (
    <div className="stack-lg">
      <section className="card">
        <h3>Run configuration</h3>
        <div className="presets">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              className="ghost sm"
              onClick={() => {
                setT1(p.t1);
                setT2(p.t2);
                setDisease(p.disease);
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="grid3">
          <label>
            Target 1 (HGNC)
            <input value={t1} onChange={(e) => setT1(e.target.value)} spellCheck={false} />
          </label>
          <label>
            Target 2 (HGNC)
            <input value={t2} onChange={(e) => setT2(e.target.value)} spellCheck={false} />
          </label>
          <label>
            Indication
            <input value={disease} onChange={(e) => setDisease(e.target.value)} />
          </label>
        </div>
        <div className="grid3">
          <label>
            Refinement iterations
            <select value={maxIterations} onChange={(e) => setMaxIterations(Number(e.target.value))}>
              <option value={0}>0 — single pass</option>
              <option value={1}>1</option>
              <option value={2}>2</option>
              <option value={3}>3 (hard ceiling)</option>
            </select>
          </label>
          <label className="check">
            <input type="checkbox" checked={grounding} onChange={(e) => setGrounding(e.target.checked)} />
            Retrieve live database records before generating
          </label>
          <label className="check">
            <input type="checkbox" checked={showExp} onChange={(e) => setShowExp(e.target.checked)} />
            Attach wet-lab data (module 07)
          </label>
        </div>

        {showExp && (
          <label>
            Experimental results — a table, an instrument export, or a plain-English summary
            <textarea
              rows={5}
              value={experimental}
              onChange={(e) => setExperimental(e.target.value)}
              placeholder={
                "EXP-2026-014, 2026-08-20, Biacore T200 (BT200-0042), SOP-SPR-003 v2.1, tech J. Chen\n" +
                "CrossMab i1 anti-PD-1 arm: ka 4.2e5 1/Ms, kd 1.8e-4 1/s, KD 0.43 nM, n=3, SD 0.05\n" +
                "Reference pembrolizumab control: KD 5.8 nM (historical range 5-7 nM) — PASS"
              }
            />
          </label>
        )}

        <div className="row between">
          <div className="row">
            <button onClick={start} disabled={running || !t1.trim() || !t2.trim()}>
              {running ? "Running…" : "Run pipeline"}
            </button>
            {running && (
              <button
                className="ghost"
                onClick={() => {
                  abortRef.current?.abort();
                  setRunning(false);
                }}
              >
                Stop
              </button>
            )}
            {steps.length > 0 && !running && (
              <button className="ghost" onClick={download}>
                Download report
              </button>
            )}
          </div>
          <span className="muted">
            {settings.provider}/{settings.model}
            {settings.provider === "anthropic" && settings.webSearch ? " · web search on" : ""}
          </span>
        </div>
      </section>

      {briefs.length > 0 && (
        <section className="card">
          <h3>Retrieval pass</h3>
          <div className="grid2">
            {briefs.map((b) => (
              <div key={b.gene} className="brief compact">
                <strong>{b.gene}</strong>
                <div className="muted">
                  {b.uniprot?.accession ?? "no UniProt"} ·{" "}
                  {b.alphafold?.found ? `AlphaFold pLDDT ${b.alphafold.meanPlddt}` : "no AlphaFold model"} ·{" "}
                  {b.structures.length} PDB entries ·{" "}
                  {b.openTargets?.diseaseCount ?? 0} disease associations
                </div>
                {b.errors.length > 0 && <div className="warn">{b.errors.join(" · ")}</div>}
              </div>
            ))}
          </div>
        </section>
      )}

      {steps.length > 0 && (
        <section className="card">
          <div className="row between">
            <h3>Pipeline</h3>
            {totalUncited > 0 && (
              <span className="tag bad">{totalUncited} unsourced numbers across the run</span>
            )}
          </div>
          <div className="steps">
            {steps.map((s) => (
              <StepCard
                key={`${s.key}-${s.iteration}`}
                step={s}
                open={openKey === s.key}
                onToggle={() => setOpenKey(openKey === s.key ? null : s.key)}
              />
            ))}
          </div>
          {stopReason && <p className="stop">{stopReason}</p>}
        </section>
      )}
    </div>
  );
}
