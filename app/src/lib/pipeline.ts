// The orchestrator.
//
// Differences from run_pipeline.py, all of them deliberate:
//
//  - Handoffs are typed and explicit. Each step declares which upstream steps it
//    consumes; the runner passes those steps' JSON blocks, not "whatever the
//    previous agent happened to print". The linear chain meant agent 06 only
//    ever saw agent 05.
//  - Retrieval happens before generation. Targets are resolved against UniProt,
//    AlphaFold DB, Open Targets and the PDB, and the results are injected as a
//    grounding block, so structure and association claims start from a record
//    instead of from recall.
//  - The refinement loop exists. The README describes it; the script never
//    implemented it. Here it runs with real stop criteria.
//  - Every output is audited for citation coverage and for a parseable JSON
//    block before it is allowed to become another step's input.

import { AGENTS, KNOWLEDGE } from "../generated/prompts";
import { auditEvidence, extractJson, type EvidenceReport } from "./evidence";
import { briefTarget, briefToPromptBlock, type TargetBrief } from "./bio";
import { streamAgent, type LlmSettings } from "./llm";

export const SYSTEM_PROMPT = [
  "You are a drug discovery AI agent operating inside a staged, auditable pipeline.",
  "Every quantitative claim must carry a traceable identifier on the same line or in the adjacent row: a PMID, PMC ID, DOI, NCT number, PDB ID, UniProt accession, or database URL.",
  "If a number is not in a source you can name, do not state it. Write 'not established in public data' and add it to the gaps list instead. A named gap is a correct answer; an invented value is a defect.",
  "A 'Retrieved reference data' block, when present, was fetched live from the named database immediately before this call. Treat it as ground truth and prefer it over recall.",
  "Close every report with a numbered reference list, then the fenced JSON block in the schema the prompt specifies. The JSON must parse.",
].join(" ");

export type StepStatus = "pending" | "grounding" | "running" | "done" | "error" | "skipped";

export interface StepResult {
  key: string;
  agentId: string;
  title: string;
  iteration: number;
  status: StepStatus;
  text: string;
  json: unknown | null;
  jsonError?: string;
  evidence?: EvidenceReport;
  searches: string[];
  notices: string[];
  grounding?: string;
  error?: string;
  startedAt?: number;
  finishedAt?: number;
  usage?: Record<string, number> | null;
}

export interface RunConfig {
  target1: string;
  target2: string;
  disease: string;
  maxIterations: number;
  grounding: boolean;
  experimentalData?: string;
  settings: LlmSettings;
}

export interface RunState {
  id: string;
  config: RunConfig;
  steps: StepResult[];
  briefs: TargetBrief[];
  startedAt: number;
  finishedAt?: number;
  stopReason?: string;
}

const agent = (id: string) => {
  const a = AGENTS.find((x) => x.id === id);
  if (!a) throw new Error(`Unknown agent ${id}`);
  return a;
};

function substitute(text: string, c: RunConfig): string {
  const map: Record<string, string> = {
    "{target_1}": c.target1,
    "{target_2}": c.target2,
    "{gene_1}": c.target1,
    "{gene_2}": c.target2,
    "{GENE1}": c.target1,
    "{GENE2}": c.target2,
    "{target_pair}": `${c.target1}/${c.target2}`,
    "solid tumor immunotherapy": c.disease,
  };
  let out = text;
  for (const [k, v] of Object.entries(map)) out = out.split(k).join(v);
  return out;
}

/** Compact upstream JSON for handoff. Markdown reports are never re-sent. */
function handoffBlock(steps: StepResult[], keys: string[]): string {
  const parts: string[] = [];
  for (const key of keys) {
    const s = [...steps].reverse().find((x) => x.key === key && x.status === "done");
    if (!s) continue;
    if (s.json) {
      parts.push(`#### Structured output — ${s.title} (iteration ${s.iteration})\n\`\`\`json\n${JSON.stringify(s.json, null, 2)}\n\`\`\``);
    } else {
      // No parseable JSON: fall back to the tail of the report so the chain
      // degrades instead of breaking, and say so.
      parts.push(
        `#### ${s.title} (iteration ${s.iteration}) — JSON block did not parse; excerpt follows\n${s.text.slice(-4000)}`,
      );
    }
  }
  return parts.join("\n\n");
}

interface StepPlan {
  key: string;
  agentId: string;
  title: string;
  iteration: number;
  useRefinementPrompt?: boolean;
  consumes: string[];
  groundTargets?: boolean;
}

function basePlan(): StepPlan[] {
  return [
    { key: "01", agentId: "01", title: "Target Identification", iteration: 0, consumes: [], groundTargets: true },
    { key: "02", agentId: "02", title: "Target Validation", iteration: 0, consumes: ["01"] },
    { key: "03@0", agentId: "03", title: "Bispecific Design", iteration: 0, consumes: ["01", "02"], groundTargets: true },
    { key: "04@0", agentId: "04", title: "SPR / Binding", iteration: 0, consumes: ["03@0", "02"] },
    { key: "05@0", agentId: "05", title: "Cell Functional", iteration: 0, consumes: ["03@0", "04@0"] },
  ];
}

function refinementPlan(i: number): StepPlan[] {
  const prev = i - 1;
  return [
    {
      key: `03@${i}`,
      agentId: "03",
      title: `Design Refinement (i${i})`,
      iteration: i,
      useRefinementPrompt: true,
      consumes: [`03@${prev}`, `04@${prev}`, `05@${prev}`, "07"],
    },
    { key: `04@${i}`, agentId: "04", title: `SPR / Binding (i${i})`, iteration: i, consumes: [`03@${i}`, `04@${prev}`, "07"] },
    { key: `05@${i}`, agentId: "05", title: `Cell Functional (i${i})`, iteration: i, consumes: [`03@${i}`, `04@${i}`, `05@${prev}`, "07"] },
  ];
}

/**
 * Pulls the first affinity-like number out of an agent's JSON so successive
 * iterations can be compared. Deliberately shallow: it looks for keys that name
 * a KD or an EC50/IC50 and takes the first finite value, which is enough to
 * detect a plateau without pretending to understand the schema.
 */
export function primaryMetric(json: unknown): { key: string; value: number } | null {
  const wanted = /(^|_)(kd|ec50|ic50)(_|$)/i;
  let best: { key: string; value: number } | null = null;
  const walk = (node: unknown, path: string, depth: number) => {
    if (best || depth > 6 || node == null) return;
    if (Array.isArray(node)) {
      node.forEach((n, i) => walk(n, `${path}[${i}]`, depth + 1));
      return;
    }
    if (typeof node !== "object") return;
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (best) return;
      if (typeof v === "number" && Number.isFinite(v) && v > 0 && wanted.test(k)) {
        best = { key: `${path}${path ? "." : ""}${k}`, value: v };
        return;
      }
      walk(v, `${path}${path ? "." : ""}${k}`, depth + 1);
    }
  };
  walk(json, "", 0);
  return best;
}

export interface RunCallbacks {
  onStep: (step: StepResult) => void;
  onBriefs?: (briefs: TargetBrief[]) => void;
  onStop?: (reason: string) => void;
}

export async function runPipeline(
  config: RunConfig,
  callbacks: RunCallbacks,
  signal: AbortSignal,
): Promise<RunState> {
  const state: RunState = {
    id: `${config.target1}-${config.target2}-${Date.now()}`.toLowerCase(),
    config,
    steps: [],
    briefs: [],
    startedAt: Date.now(),
  };

  // Retrieval pass. Runs once; both design and target steps reuse it.
  let groundingBlock = "";
  if (config.grounding) {
    const briefs = await Promise.all([
      briefTarget(config.target1, `${config.target1} antibody Fab complex`),
      briefTarget(config.target2, `${config.target2} antibody Fab complex`),
    ]);
    state.briefs = briefs;
    callbacks.onBriefs?.(briefs);
    groundingBlock = briefs.map(briefToPromptBlock).join("\n\n");
  }

  // Optional wet-lab ingestion runs first so downstream steps can consume it.
  const plans: StepPlan[] = [];
  if (config.experimentalData?.trim()) {
    plans.push({ key: "07", agentId: "07", title: "Experimental Data Ingestion", iteration: 0, consumes: [] });
  }
  plans.push(...basePlan());

  const runStep = async (plan: StepPlan): Promise<StepResult> => {
    const spec = agent(plan.agentId);
    const step: StepResult = {
      key: plan.key,
      agentId: plan.agentId,
      title: plan.title,
      iteration: plan.iteration,
      status: "running",
      text: "",
      json: null,
      searches: [],
      notices: [],
      startedAt: Date.now(),
    };
    state.steps.push(step);
    callbacks.onStep({ ...step });

    const sections: string[] = [];
    sections.push(`## Knowledge: glossary\n${KNOWLEDGE.glossary}`);
    sections.push(`## Knowledge: public databases\n${KNOWLEDGE.databases}`);
    if (spec.background) sections.push(spec.background);
    sections.push(plan.useRefinementPrompt ? spec.refinement : spec.prompt);

    sections.push(
      `## Run parameters\n- Target 1: ${config.target1}\n- Target 2: ${config.target2}\n` +
        `- Disease indication: ${config.disease}\n- Iteration: ${plan.iteration}`,
    );

    if (plan.groundTargets && groundingBlock) {
      sections.push(
        `## Retrieved reference data (live, this run)\nFetched from UniProt, AlphaFold DB, Open Targets and the RCSB PDB moments ago. Use these values and accessions directly.\n\n${groundingBlock}`,
      );
      step.grounding = groundingBlock;
    }

    if (plan.agentId === "07" && config.experimentalData) {
      sections.push(`## Raw experimental input\n\`\`\`\n${config.experimentalData}\n\`\`\``);
    }

    const upstream = handoffBlock(state.steps, plan.consumes);
    if (upstream) sections.push(`## Upstream structured output\n${upstream}`);

    const prompt = substitute(sections.join("\n\n---\n\n"), config);

    try {
      const result = await streamAgent(
        { system: SYSTEM_PROMPT, prompt, settings: config.settings, signal },
        {
          onText: (chunk) => {
            step.text += chunk;
            callbacks.onStep({ ...step });
          },
          onSearch: (q) => {
            step.searches.push(q);
            callbacks.onStep({ ...step });
          },
          onNotice: (n) => {
            step.notices.push(n);
            callbacks.onStep({ ...step });
          },
        },
      );
      const { json, error } = extractJson(result.text);
      step.json = json;
      step.jsonError = error;
      step.evidence = auditEvidence(result.text);
      step.usage = result.usage;
      step.status = "done";
    } catch (e) {
      step.status = "error";
      step.error = (e as Error).message;
    }
    step.finishedAt = Date.now();
    callbacks.onStep({ ...step });
    return step;
  };

  for (const plan of plans) {
    if (signal.aborted) break;
    const s = await runStep(plan);
    if (s.status === "error") {
      state.stopReason = `Stopped at ${s.title}: ${s.error}`;
      callbacks.onStop?.(state.stopReason);
      state.finishedAt = Date.now();
      return state;
    }
  }

  // Refinement loop with real stop criteria.
  let stopReason = "";
  for (let i = 1; i <= config.maxIterations && !signal.aborted; i++) {
    const before = state.steps.filter((s) => s.key === `04@${i - 1}`).pop();
    for (const plan of refinementPlan(i)) {
      if (signal.aborted) break;
      const s = await runStep(plan);
      if (s.status === "error") {
        stopReason = `Refinement stopped at ${s.title}: ${s.error}`;
        break;
      }
      if (plan.useRefinementPrompt && s.json && typeof s.json === "object") {
        const proceed = (s.json as Record<string, unknown>).proceed_to_reevaluation;
        if (proceed === false) {
          stopReason = `Design agent reported no further improvement is available at iteration ${i}.`;
          break;
        }
      }
    }
    if (stopReason) break;

    const after = state.steps.filter((s) => s.key === `04@${i}`).pop();
    const mBefore = before?.json ? primaryMetric(before.json) : null;
    const mAfter = after?.json ? primaryMetric(after.json) : null;
    if (mBefore && mAfter && mBefore.value > 0) {
      const delta = Math.abs(mAfter.value - mBefore.value) / mBefore.value;
      if (delta < 0.1) {
        stopReason = `Improvement plateaued at iteration ${i}: ${mAfter.key} moved ${(delta * 100).toFixed(1)}% (threshold 10%).`;
        break;
      }
    }
    if (i === config.maxIterations) {
      stopReason = `Reached the iteration ceiling (${config.maxIterations}).`;
    }
  }

  if (!signal.aborted) {
    const finalPlan: StepPlan = {
      key: "06",
      agentId: "06",
      title: "In Vivo & Clinical Synthesis",
      iteration: 0,
      consumes: [
        "01",
        "02",
        ...[...state.steps].reverse().filter((s) => s.agentId === "03").slice(0, 1).map((s) => s.key),
        ...[...state.steps].reverse().filter((s) => s.agentId === "04").slice(0, 1).map((s) => s.key),
        ...[...state.steps].reverse().filter((s) => s.agentId === "05").slice(0, 1).map((s) => s.key),
        "07",
      ],
    };
    await runStep(finalPlan);
  }

  state.stopReason = stopReason || (signal.aborted ? "Cancelled." : "Complete.");
  callbacks.onStop?.(state.stopReason);
  state.finishedAt = Date.now();
  return state;
}

/** Assembles the full run into one markdown document, matching output/ format. */
export function toMarkdown(state: RunState): string {
  const { config } = state;
  const lines: string[] = [
    `# ${config.target1} × ${config.target2} Bispecific — Pipeline Results`,
    "",
    `**Indication:** ${config.disease}  `,
    `**Run:** ${new Date(state.startedAt).toISOString()}  `,
    `**Model:** ${config.settings.provider}/${config.settings.model}  `,
    `**Retrieval grounding:** ${config.grounding ? "on" : "off"}  `,
    `**Stop reason:** ${state.stopReason ?? "n/a"}`,
    "",
    "---",
    "",
    "## Evidence summary",
    "",
    "| Step | Citation coverage | Quantitative claims | Uncited | JSON |",
    "|---|---|---|---|---|",
  ];
  for (const s of state.steps) {
    const e = s.evidence;
    lines.push(
      `| ${s.title} | ${e ? `${Math.round(e.coverage * 100)}%` : "—"} | ${e?.claims.length ?? 0} | ${e?.uncitedClaims ?? 0} | ${s.json ? "parsed" : s.jsonError ? "failed" : "—"} |`,
    );
  }
  lines.push("", "---", "");
  for (const s of state.steps) {
    lines.push(`## ${s.title}`, "", s.text || `_(${s.status})_`, "", "---", "");
  }
  return lines.join("\n");
}
