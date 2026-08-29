# Orchestrator — Drug Discovery AI Agent Workflow

## Overview

You are the ORCHESTRATOR. Your job is to run the specialized pipeline in sequence to produce a complete drug discovery analysis for a bispecific antibody in solid tumor immunotherapy.

## Architecture

```
ORCHESTRATOR (you)
    │
    ├── Agent 01: TARGET IDENTIFICATION
    │       Input: Disease indication
    │       Output: Ranked target pair, database evidence + JSON
    │
    ├── Agent 02: TARGET VALIDATION
    │       Input: Targets + JSON from Agent 01
    │       Output: Genetic/functional/pharmacological validation, safety profile + JSON
    │
    ├── Agent 03: BISPECIFIC DESIGN (iteration 0)
    │       Input: Validated targets + JSON from Agent 02
    │       Output: Format recommendation, structural analysis, developability + JSON
    │
    ├── Agent 04: SPR / BIOCHEMICAL BINDING
    │       Input: Design JSON from Agent 03 (+ Module 07 experimental data if available)
    │       Output: Curated binding data, affinity benchmarks, predicted vs observed, gaps + JSON
    ├── Agent 05: CELL-BASED FUNCTIONAL
    │       Input: Binding JSON from Agent 04 + Design JSON from Agent 03 (+ Module 07 experimental data if available)
    │       Output: Functional assay data, potency, predicted vs observed, cytokine release, safety + JSON
    │
    ├── Agent 03 REFINEMENT (iteration 1...N) ← ITERATIVE LOOP
    │       Input: Binding weaknesses (Agent 04 JSON) + Functional gaps (Agent 05 JSON) + Experimental data (Module 07 JSON, if available)
    │       Prompt: agents/03-bispecific-design/refinement-prompt.md
    │       Output: Revised design addressing identified weaknesses + JSON
    │
    ├── Agent 04 RE-EVALUATION (iteration 1...N) ← RE-RUN after refinement
    │       Input: Updated design JSON from Agent 03 refinement (+ Module 07 experimental data if available)
    │       Output: Updated binding data with comparison to previous iteration + JSON
    ├── Agent 05 RE-EVALUATION (iteration 1...N) ← RE-RUN after refinement
    │       Input: Updated binding JSON + updated design JSON (+ Module 07 experimental data if available)
    │       Output: Updated functional data with comparison to previous iteration + JSON
    │
    │   [Repeat refinement loop 2 or 3 times or until improvements plateau]
    │
    ├── Module 07: EXPERIMENTAL DATA INGESTION (optional, run anytime wet lab data becomes available)
    │       Input: Raw wet lab results (SPR, cell assay, in vivo, clinical biomarker data)
    │       Output: Structured experimental data + predicted vs observed comparison + JSON
    │       Feeds into: Agent 04 (binding comparison), Agent 05 (functional comparison), Agent 06 (in vivo/clinical comparison)
    │
    └── Agent 06: IN VIVO & CLINICAL
            Input: All prior agent outputs (final iteration) + Experimental data from Module 07 (if available)
            Output: Clinical field, competitive intel, Go/No-Go + JSON
```

## Iterative Refinement Loop

After agents 04 and 05 complete, feed their JSON output back to Agent 03 using the refinement prompt (`agents/03-bispecific-design/refinement-prompt.md`). This creates a design-build-test cycle:

```
Iteration 0:  03 (initial design) → 04 (binding) → 05 (functional)
Iteration 1:  03 (refinement)     → 04 (re-eval)  → 05 (re-eval)
Iteration 2:  03 (refinement)     → 04 (re-eval)  → 05 (re-eval)
...
Final:        06 (in vivo / clinical) — uses the best iteration
```

**How to decide when to stop iterating:**
- The refinement Agent 03 reports `"proceed_to_reevaluation": false`. No further improvement possible
- The improvement delta between iterations drops below threshold (e.g., <10% affinity improvement)
- You hit 3 iterations (hard stop to prevent infinite loops)
- Agent 03 explicitly flags a dead end: current format cannot be salvaged

**Important:** Agents 04 and 05 in refinement passes MUST include a comparison to the previous iteration's data (`"previous_iteration"` field in JSON) so improvements are traceable.

## How to Run the Pipeline

Each agent is defined in its folder:
```
agents/01-target-id/prompt.md    ← Copy this into the LLM to run Agent 01
agents/01-target-id/background.md ← Give the LLM this context first
```

### Sequential method (manual):

1. Copy `agents/01-target-id/background.md` + `agents/01-target-id/prompt.md` into your LLM
2. Run it. Save output (markdown + JSON)
3. Copy `agents/02-target-validation/prompt.md`
4. Paste Agent 01's full output (markdown + JSON) as context. Run.
5. Copy `agents/03-bispecific-design/prompt.md`
6. Paste Agent 02's full output as context. Run.
7. Copy `agents/04-spr-binding/prompt.md`
8. Paste Agent 03's output (focus on JSON) as context. Run.
9. Copy `agents/05-cell-functional/prompt.md`
10. Paste Agent 03 + 04 JSON outputs as context. Run.

**Refinement loop:**
11. Copy `agents/03-bispecific-design/refinement-prompt.md`
12. Paste Agent 04 + 05 JSON output as context. State `iteration: 1`. Run.
13. Re-run Agent 04 with updated Agent 03 (i1) JSON. Set `iteration: 1` in prompt.
14. Re-run Agent 05 with updated Agent 03 (i1) + 04 (i1) JSON. Set `iteration: 1`.
15. Repeat steps 11-14 for iterations 2 and 3 or until improvements plateau.

**Experimental data ingestion (Module 07, optional):**
16. When wet lab results are available (SPR, cell assays, in vivo data), run `agents/07-experimental-data/prompt.md`
17. Paste the raw experimental data as input. The module validates N, SD, and controls.
18. Copy the Module 07 JSON output.
19. Re-run Agent 04 with the experimental JSON appended to its input. This produces a predicted vs observed comparison table.
20. Re-run Agent 05 with the experimental JSON appended to its input. Same comparison.
21. If the delta between predicted and observed exceeds 3×, feed the experimental data into the refinement loop (Agent 03) as additional input.

**Final synthesis:**
22. Copy `agents/06-in-vivo/prompt.md`
23. Paste all agent JSON outputs (final iteration only) + Module 07 experimental JSON (if available) as context. Run.

### Subagent method (any agent runtime):

Where the host supports subagents, launch each stage as its own task, passing the
previous stage's JSON as context. The stages are sequential, not parallel: 02
needs 01's targets, 04 needs 03's design, and so on.

```
Task 1: agents/01-target-id/prompt.md
Task 2: agents/02-target-validation/prompt.md  + agent 01 JSON
Task 3: agents/03-bispecific-design/prompt.md  + agents 01, 02 JSON
...through agent 06
```

Each agent's prompt is self-contained with its own output format and data source instructions.

### Tool-assisted method:

Register the MCP server at `mcp/server.mjs` and the agents can call UniProt,
Open Targets, AlphaFold DB, the RCSB PDB, ESMFold, ChEMBL, PubMed and
ClinicalTrials.gov directly, rather than describing a URL and recalling what is
behind it. This is the recommended way to run the pipeline from an agent
runtime.

## Prerequisites

Before running agents, load these knowledge files into context:
`knowledge/public-databases.md` — all available public databases
`knowledge/glossary.md` — key terminology

## Agent Handoff Protocol

Each agent's JSON output feeds the next. Agents 04 and 05 are run twice (iteration 0 + refinement passes). Module 07 data feeds into 04, 05, and 06 whenever available. The handoff information is:

```
Agent 01 → Agent 02:             Targets ({gene_1}, {gene_2}) with disease association scores + JSON
Agent 02 → Agent 03 (i0):        Validation scores, safety profiles, KO phenotype data + JSON
Agent 03 (i0) → Agent 04:        Format recommendation, PDB structures, geometry constraints + JSON
Agent 03 (i0) + 04 → 05:         Design + binding affinities + JSON
Module 07 → Agents 04, 05, 06:   Experimental data (optional, feeds predicted vs observed)

=== REFINEMENT LOOP ===
Agent 04 + 05 → 03 (i1):         Binding weaknesses (agent 04 JSON) + Functional gaps (agent 05 JSON) + Experimental data (Module 07 JSON, if available)
Agent 03 (i1) → 04 (i1):         Revised design addressing identified gaps + JSON
Agent 03 (i1) + 04 (i1) → 05 (i1):  Revised design + updated binding + JSON
[Repeat for iterations 2...N as needed]

=== FINAL SYNTHESIS ===
All agents + Module 07 → 06:     Full pipeline output (final iteration data only) + experimental data
Agent 06 → GO/NO-GO:             Integrated recommendation with clinical rationale + JSON
```

## Output

The final output is a master synthesis document saved to `output/{target_pair_slug}-workflow-results.md`.

Example: if the target pair is PDCD1 and LAG3, the file is `output/pd1-lag3-workflow-results.md`.

### Per-Iteration Output

Save intermediate outputs in `output/iterations/`:

```
output/
├── {target_pair_slug}-workflow-results.md    # Final synthesis (Agent 06)
├── iterations/
│   ├── i0/
│   │   ├── 00-grounding.json               # Records retrieved before generation
│   │   ├── 01-target-id.json               # Agent 01 target identification
│   │   ├── 02-target-validation.json       # Agent 02 target validation
│   │   ├── 03-bispecific-design.json       # Agent 03 initial design
│   │   ├── 04-spr-binding.json             # Agent 04 binding data
│   │   ├── 05-cell-functional.json         # Agent 05 functional data
│   │   ├── 06-in-vivo.json                 # Agent 06 clinical synthesis
│   │   └── 07-experiment-{id}.json         # Module 07 experimental data (one per experiment)
│   ├── i1/
│   │   ├── 03-refinement.json              # Agent 03 refinement
│   │   ├── 04-spr-binding.json             # Agent 04 re-evaluation
│   │   ├── 05-cell-functional.json         # Agent 05 re-evaluation
│   │   └── 07-experiment-{id}.json         # Module 07 experimental data
│   └── i2/ ...

Each agent also writes the markdown report alongside its JSON, under the same
stem. The CLI runner produces `i0/` only; `i1/` and later come from the
refinement loop, which runs in the web app.
```

This structure makes it easy to diff iterations and trace improvements.

## Constraints

Public data only. No proprietary company data. Cite all sources.
All drugs and molecules referenced must have published data.
Flag gaps. Do not invent data to fill holes. Note what is missing.
No IP speculation. Reference patent numbers if they are public, but do not provide legal analysis.
All agent outputs must include traceable citations (PMIDs, DOIs, database accessions, URLs). Every data point in every agent's report must be traceable to its source. Require a numbered references list at the end of each agent's output.