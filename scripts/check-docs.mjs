#!/usr/bin/env node
// Verifies that the documentation describes what the code does.
//
// The repo's recurring defect has been prose and diagrams claiming behaviour the
// code lacks: a refinement loop that never ran, JSON files never written, output
// filenames that did not exist. Fixing those by hand fixes them once. This
// checks them on every build.
//
//   node scripts/check-docs.mjs
//
// Exits non-zero on any mismatch. Add a check here rather than fixing a doc
// twice.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const failures = [];
const checks = [];
const fail = (name, detail) => failures.push({ name, detail });
const check = (name, fn) => {
  checks.push(name);
  try {
    fn();
  } catch (err) {
    fail(name, err.message);
  }
};

// ── Source-of-truth extraction ───────────────────────────────────────────────

const runner = read("run_pipeline.py");
const bioFn = read("netlify/edge-functions/bio.ts");
const llmFn = read("netlify/edge-functions/llm.ts");
const mcp = read("mcp/server.mjs");
const appPipeline = read("app/src/lib/pipeline.ts");
const appLlm = read("app/src/lib/llm.ts");
const integrations = read("app/src/components/Integrations.tsx");
const genPrompts = read("scripts/gen-prompts.mjs");

const readme = read("README.md");
const design = read("DESIGN.md");
const review = read("REVIEW.md");
const skill = read("skills/SKILL.md");
const orchestrator = read("orchestrator/prompt.md");
const outputReadme = read("output/README.md");
const mcpReadme = read("mcp/README.md");

/** Agent directories that actually exist. */
const agentDirs = readdirSync(join(ROOT, "agents"))
  .filter((d) => /^\d\d-/.test(d))
  .sort();

/** AGENT_SEQUENCE entries in the runner: [id, name]. */
const runnerAgents = [...runner.matchAll(/\{"id": "(\d\d)", "name": "([a-z-]+)"/g)].map((m) => [m[1], m[2]]);

/** Files the runner writes into output/iterations/i0/. */
const runnerOutputs = [
  "00-grounding.json",
  ...runnerAgents.flatMap(([id, name]) => [`${id}-${name}.md`, `${id}-${name}.json`]),
];

/** Route names served by the bio edge function. */
const bioRoutes = [...bioFn.matchAll(/^\s{6}case "([a-z-]+)": \{/gm)].map((m) => m[1]);

/** Tool names exposed by the MCP server. */
const mcpTools = [...mcp.matchAll(/^\s{4}name: "([a-z_]+)",$/gm)].map((m) => m[1]);

// ── Checks ───────────────────────────────────────────────────────────────────

check("agents/ on disk match the runner's AGENT_SEQUENCE", () => {
  // The runner deliberately stops at 06; 07 is not in its sequence.
  const onDisk = agentDirs.map((d) => d.slice(0, 2));
  const inRunner = runnerAgents.map(([id]) => id);
  const expected = onDisk.filter((id) => id !== "07");
  if (JSON.stringify(expected) !== JSON.stringify(inRunner)) {
    throw new Error(`disk ${expected.join(",")} vs runner ${inRunner.join(",")}`);
  }
});

check("gen-prompts.mjs covers every agent directory", () => {
  const listed = [...genPrompts.matchAll(/dir: "agents\/(\d\d-[a-z-]+)"/g)].map((m) => m[1]).sort();
  const missing = agentDirs.filter((d) => !listed.includes(d));
  if (missing.length) throw new Error(`not baked into the app: ${missing.join(", ")}`);
});

check("every agent directory has a prompt.md", () => {
  const missing = agentDirs.filter((d) => !existsSync(join(ROOT, "agents", d, "prompt.md")));
  if (missing.length) throw new Error(`missing prompt.md: ${missing.join(", ")}`);
});

check("README output diagram names exactly the files the runner writes", () => {
  const section = readme.slice(readme.indexOf("## Output Structure"), readme.indexOf("## Requirements"));
  const stems = new Set(runnerOutputs.map((f) => f.replace(/\.(md|json)$/, "")));
  const named = new Set([...section.matchAll(/"(\d\d-[a-z-]+)/g)].map((m) => m[1]));
  const ghost = [...named].filter((n) => !stems.has(n));
  const absent = [...stems].filter((n) => !named.has(n));
  if (ghost.length || absent.length) {
    throw new Error(`in diagram but never written: ${ghost.join(", ") || "none"}; written but undocumented: ${absent.join(", ") || "none"}`);
  }
});

check("orchestrator output layout names real files", () => {
  const stems = new Set(runnerOutputs.map((f) => f.replace(/\.(md|json)$/, "")));
  // The orchestrator describes the full loop, so it may legitimately name
  // refinement and module-07 artefacts. It must not name a non-existent agent.
  const allowed = new Set([...stems, "03-refinement", "07-experiment"]);
  const named = [...orchestrator.matchAll(/(\d\d-[a-z-]+)\.json/g)].map((m) => m[1]);
  const ghost = [...new Set(named)].filter((n) => !allowed.has(n));
  if (ghost.length) throw new Error(`names files nothing produces: ${ghost.join(", ")}`);
});

check("agent count is stated consistently across all docs", () => {
  const total = agentDirs.length;
  const bad = [];
  for (const [label, text] of [["README.md", readme], ["skills/SKILL.md", skill], ["DESIGN.md", design]]) {
    for (const m of text.matchAll(/(\d+)[- ](?:specialized )?(?:agent|module)s?\b/gi)) {
      const n = Number(m[1]);
      // Only flag counts that claim to describe the whole pipeline.
      if (n >= 5 && n <= 9 && n !== total) bad.push(`${label}: "${m[0]}" (pipeline has ${total})`);
    }
  }
  if (bad.length) throw new Error(bad.join("; "));
});

check("sources README calls live are served by the bio edge function", () => {
  const claimed = {
    UniProt: "uniprot",
    "AlphaFold DB": "alphafold",
    "RCSB PDB": "pdb-search",
    "Open Targets": "opentargets",
    ESMFold: "esmfold",
    ChEMBL: "chembl",
    PubMed: "pubmed",
    "ClinicalTrials.gov": "trials",
  };
  const missing = Object.entries(claimed)
    .filter(([name, route]) => readme.includes(name) && !bioRoutes.includes(route))
    .map(([name, route]) => `${name} -> /api/bio/${route}`);
  if (missing.length) throw new Error(`claimed in README, no route: ${missing.join(", ")}`);
});

check("Integrations tab marks live only what the edge function serves", () => {
  const wired = [...integrations.matchAll(/name: "([^"]+)",\s*\n\s*agents:[^]*?status: "wired"/g)].map((m) => m[1]);
  // Every "wired" entry must correspond to a real route, or be the in-browser
  // calculators, which have no route by design.
  const routeless = wired.filter(
    (n) => !/ProtParam/.test(n) && ![...bioRoutes].some((r) => n.toLowerCase().replace(/[^a-z]/g, "").includes(r.replace(/-.*/, ""))),
  );
  if (routeless.length) throw new Error(`marked live with no backing route: ${routeless.join(", ")}`);
});

check("MCP README documents exactly the tools the server exposes", () => {
  const documented = [...mcpReadme.matchAll(/`([a-z_]+)`/g)].map((m) => m[1]);
  const undocumented = mcpTools.filter((t) => !documented.includes(t));
  const phantom = documented.filter((d) => d.includes("_") && !mcpTools.includes(d) && !["mcp_servers", "info_exclude"].includes(d));
  if (undocumented.length || phantom.length) {
    throw new Error(`undocumented: ${undocumented.join(", ") || "none"}; documented but absent: ${phantom.join(", ") || "none"}`);
  }
});

check("README tool list matches the MCP server", () => {
  const listed = [...readme.matchAll(/`([a-z]+_[a-z_]+)`/g)].map((m) => m[1]).filter((t) => mcpTools.includes(t) || t.endsWith("_search") || t.endsWith("_lookup"));
  const missing = mcpTools.filter((t) => !readme.includes(t));
  if (missing.length) throw new Error(`MCP tools absent from README: ${missing.join(", ")}`);
  if (!listed.length) throw new Error("README lists no MCP tools at all");
});

check("refinement stop criteria in docs match pipeline.ts", () => {
  const plateau = appPipeline.match(/delta < (0\.\d+)/);
  if (!plateau) throw new Error("could not find the plateau threshold in app/src/lib/pipeline.ts");
  const pct = `${Number(plateau[1]) * 100}%`;
  for (const [label, text] of [["README.md", readme], ["orchestrator/prompt.md", orchestrator]]) {
    if (/plateau/i.test(text) && !text.includes(pct) && !text.includes("<10%")) {
      throw new Error(`${label} describes a plateau rule but not ${pct}`);
    }
  }
  const ceiling = appPipeline.match(/iteration ceiling/);
  if (!ceiling) throw new Error("pipeline.ts no longer reports an iteration ceiling");
});

check("model ids in docs exist in the code", () => {
  const codeModels = new Set([
    ...[...appLlm.matchAll(/id: "([a-z0-9.-]+)"/g)].map((m) => m[1]),
    ...[...runner.matchAll(/"(?:anthropic|openai)": "([a-z0-9.-]+)"/g)].map((m) => m[1]),
  ]);
  const docModels = new Set([...readme.matchAll(/`(claude-[a-z0-9.-]+|gpt-[a-z0-9.-]+)`/g)].map((m) => m[1]));
  const unknown = [...docModels].filter((m) => !codeModels.has(m));
  if (unknown.length) throw new Error(`README names models the code does not offer: ${unknown.join(", ")}`);
});

check("no doc still requires the removed openai package", () => {
  const offenders = [
    ["README.md", readme],
    ["DESIGN.md", design],
    ["skills/SKILL.md", skill],
    ["output/README.md", outputReadme],
    ["orchestrator/prompt.md", orchestrator],
  ].filter(([, t]) => /pip install openai/.test(t));
  if (offenders.length) throw new Error(`stale dependency: ${offenders.map(([n]) => n).join(", ")}`);
});

check("the runner's stated scope matches its behaviour", () => {
  // It must not claim a refinement loop or module 07 it does not run.
  const hasRefinement = /REFINEMENT_PROMPT|refinement_plan|for iteration in/.test(runner);
  if (hasRefinement) throw new Error("runner appears to implement refinement; docs say it does not");
  if (!/no refinement loop/i.test(runner)) throw new Error("runner does not state its single-pass scope");
  if (!/no refinement loop/i.test(readme)) throw new Error("README does not state the runner's single-pass scope");
});

check("live site URL is consistent wherever it appears", () => {
  const urls = new Set([...readme.matchAll(/https:\/\/([a-z0-9-]+)\.netlify\.app/g)].map((m) => m[1]));
  if (urls.size > 1) throw new Error(`README names more than one site: ${[...urls].join(", ")}`);
});

check("markdown code fences are balanced", () => {
  for (const [label, text] of [
    ["README.md", readme],
    ["REVIEW.md", review],
    ["DESIGN.md", design],
    ["mcp/README.md", mcpReadme],
    ["orchestrator/prompt.md", orchestrator],
  ]) {
    const n = (text.match(/^```/gm) || []).length;
    if (n % 2 !== 0) throw new Error(`${label} has ${n} fences (unbalanced)`);
  }
});

check("every mermaid class target is a declared node", () => {
  for (const block of readme.matchAll(/```mermaid\n([\s\S]*?)```/g)) {
    const body = block[1];
    const declared = new Set([...body.matchAll(/\b([A-Z][A-Z0-9]*)\s*[[{(]/g)].map((m) => m[1]));
    const targets = [...body.matchAll(/^\s*class ([A-Za-z0-9_,]+) /gm)].flatMap((m) => m[1].split(","));
    const missing = targets.filter((t) => !declared.has(t));
    if (missing.length) throw new Error(`undeclared node(s) in class statement: ${missing.join(", ")}`);
  }
});

check("mermaid node text is readable against its fill", () => {
  // A previous commit set dark fills with black text, which parses and renders
  // but is illegible: #0D47A1 against #000000 is 2.43:1. WCAG AA wants 4.5:1 for
  // body text. Contrast is arithmetic, so it can be enforced rather than eyeballed.
  const relLum = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  };
  const contrast = (a, b) => {
    const [x, y] = [relLum(a), relLum(b)].sort((m, n) => n - m);
    return (x + 0.05) / (y + 0.05);
  };

  const bad = [];
  for (const block of readme.matchAll(/```mermaid\n([\s\S]*?)```/g)) {
    for (const def of block[1].matchAll(/classDef (\w+) ([^\n]+)/g)) {
      const fill = def[2].match(/fill:(#[0-9A-Fa-f]{6})/);
      const color = def[2].match(/color:(#[0-9A-Fa-f]{6})/);
      if (!fill || !color) continue;
      const ratio = contrast(fill[1], color[1]);
      if (ratio < 4.5) {
        bad.push(`${def[1]}: text ${color[1]} on fill ${fill[1]} is ${ratio.toFixed(2)}:1 (needs 4.5:1)`);
      }
    }
  }
  if (bad.length) throw new Error(bad.join("; "));
});

check("every mermaid classDef sets both a fill and a text colour", () => {
  // A classDef with a fill but no colour inherits the theme's text colour, which
  // flips between GitHub's light and dark modes and can land unreadable on one.
  const bad = [];
  for (const block of readme.matchAll(/```mermaid\n([\s\S]*?)```/g)) {
    for (const def of block[1].matchAll(/classDef (\w+) ([^\n]+)/g)) {
      const hasFill = /fill:#/.test(def[2]);
      const hasColor = /color:#/.test(def[2]);
      if (hasFill !== hasColor) bad.push(`${def[1]} sets ${hasFill ? "fill without color" : "color without fill"}`);
    }
  }
  if (bad.length) throw new Error(bad.join("; "));
});

check("edge function routes are all reachable from the app client", () => {
  const client = read("app/src/lib/bio.ts");
  const unused = bioRoutes.filter((r) => !client.includes(r) && r !== "pdbfile");
  if (unused.length) throw new Error(`routes the app never calls: ${unused.join(", ")}`);
});

check("llm proxy providers match the app's model list", () => {
  const proxyProviders = new Set([...llmFn.matchAll(/DEFAULT_MODEL = \{ (\w+): /g)].map((m) => m[1]));
  if (!llmFn.includes("anthropic") || !llmFn.includes("openai")) {
    throw new Error("llm.ts no longer supports both providers");
  }
  for (const p of ["anthropic", "openai"]) {
    if (!appLlm.includes(`${p}:`)) throw new Error(`app/src/lib/llm.ts is missing provider ${p}`);
  }
  void proxyProviders;
});

// ── Report ───────────────────────────────────────────────────────────────────

if (failures.length) {
  console.error(`check-docs: ${failures.length} of ${checks.length} checks failed\n`);
  for (const f of failures) console.error(`  ✗ ${f.name}\n      ${f.detail}\n`);
  process.exit(1);
}
console.log(`check-docs: ${checks.length} checks passed`);
