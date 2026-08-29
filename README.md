# Drug Discovery AI Agent Workflow — Bispecific Antibodies

A modular, reproducible workflow of AI agents for computational drug discovery. Each agent handles one stage of the drug discovery pipeline. Copy the folder, swap your target, and run.

**Live app: https://drug-discovery-bispecific-agents.netlify.app** — runs the pipeline in a browser, grounded against live public databases, with a citation audit on every step and an in-silico bench for structure and developability. Bring your own Anthropic or OpenAI key; it stays in your browser.

See [REVIEW.md](REVIEW.md) for the findings that motivated the app, including several defects in `run_pipeline.py`.

---

## Three ways to run this

| | What it is | Grounding | Best for |
|---|---|---|---|
| **Web app** (`app/`) | Vite SPA + Netlify edge functions | Live: UniProt, AlphaFold DB, Open Targets, RCSB PDB, ESMFold, ChEMBL, PubMed, ClinicalTrials.gov | Running the whole pipeline and reading the evidence audit |
| **MCP server** (`mcp/server.mjs`) | 10 tools over stdio | Same sources, as agent tools | Driving the pipeline from Claude Code or any MCP client |
| **Prompts** (`agents/`) | Markdown, self-contained | Whatever your LLM can reach | Running one stage by hand |

The prompts remain the single source of truth. `scripts/gen-prompts.mjs` bakes them into the app at build time, so the deployed site runs the same text a scientist would paste into a chat window.

### Web app

```bash
npm --prefix app install
netlify dev
```

Open the printed URL, add an API key in Settings, and run. To deploy your own copy, point Netlify at this repo — `netlify.toml` has the build command and the edge functions.

### MCP server

Project scope is preconfigured in `.mcp.json`, so Claude Code picks it up on start. To register it globally:

```bash
claude mcp add bispec -- node "$(pwd)/mcp/server.mjs"
```

Tools: `uniprot_lookup`, `open_targets_profile`, `alphafold_model`, `pdb_search`, `pdb_entry`, `esmfold_predict`, `sequence_properties`, `chembl_target`, `pubmed_search`, `clinical_trials`. See [mcp/README.md](mcp/README.md).

---

## Architecture

```
drug-discovery-bispecific-agents/
├── orchestrator/             # Master prompt — coordinates 7 agents in sequence
├── agents/
│   ├── 01-target-id/         # Target identification from disease indication
│   ├── 02-target-validation/ # Genetic, functional, and clinical validation
│   ├── 03-bispecific-design/ # Molecule design, format selection, structural analysis
│   │   ├── prompt.md         # Initial design (iteration 0)
│   │   └── refinement-prompt.md  # REFINEMENT: redesign based on binding/functional data
│   ├── 04-spr-binding/       # Biochemical binding data analysis (SPR, BLI, ELISA)
│   ├── 05-cell-functional/   # Cell-based assay binding and functional data
│   ├── 06-in-vivo/           # In vivo functional and clinical data synthesis
│   └── 07-experimental-data/ # Wet lab experimental data ingestion
├── knowledge/                # Reference materials, public databases, domain context
├── app/                      # Web app — orchestrator, in-silico bench, evidence audit
├── mcp/                      # MCP server exposing the data sources as tools
├── netlify/edge-functions/   # Streaming LLM proxy + public-database proxy
└── output/                   # Generated pipeline results
```

## Pipeline Sequence

```mermaid
flowchart LR
    A["01 Target ID"] --> B["02 Validation"]
    B --> C["03 Bispecific Design"]
    C --> D["04 SPR Binding"]
    D --> E["05 Cell Functional"]
    E -->|"Weaknesses + Gaps"| C
    E --> F["06 In Vivo / Clinical"]
    G["07 Experimental Data"] -.->|"Predicted vs Observed"| D
    G -.->|"Predicted vs Observed"| E
    G -.->|"Clinical Biomarkers"| F

    classDef main fill:#0D47A1,stroke:#000000,stroke-width:3px,color:#000000
    classDef optional fill:#E65100,stroke:#000000,stroke-width:3px,color:#000000,stroke-dasharray: 5 5
    class A,B,C,D,E,F main
    class G optional
```

Each agent outputs both:
1. A markdown report (human-readable)
2. A structured JSON block (machine-readable) with a defined schema

The JSON format enables:
- **Iterative refinement:** Binding (04) and functional (05) weaknesses are piped back to the design agent (03), which proposes improvements. Then binding and functional are re-evaluated
- **Quantitative comparison:** Diff binding affinities, functional EC50s, and safety profiles across iterations
- **Programmatic orchestration:** JSON handoffs can be parsed by an orchestrator script
- **Traceable history:** All iteration outputs are versioned, making improvements easy to audit

### Iterative Refinement Loop

```mermaid
flowchart TD
    A["03 Bispecific Design"] --> B["04 SPR Binding"]
    B --> C["05 Cell Functional"]
    C -->|"Binding weaknesses + Functional gaps"| A
    C --> D{"Stop Criteria?"}
    D -->|"Max iterations or plateau"| E["06 In Vivo / Clinical"]
    D -->|"Continue"| A

    classDef design fill:#1B5E20,stroke:#000000,stroke-width:3px,color:#000000
    classDef data fill:#0D47A1,stroke:#000000,stroke-width:3px,color:#000000
    classDef decision fill:#F57F17,stroke:#000000,stroke-width:3px,color:#000000
    classDef final fill:#C62828,stroke:#000000,stroke-width:3px,color:#000000
    class A design
    class B,C data
    class D decision
    class E final
```

The refinement prompt (`agents/03-bispecific-design/refinement-prompt.md`) receives binding and functional weaknesses and proposes targeted fixes: affinity maturation, format switching, valency adjustment, Fc engineering, epitope shifts, or linker optimization. Stop criteria: 3 iterations max, improvement plateau (<10% delta), or agent flags that the format cannot be salvaged.

## Running one stage by hand

Each module is a standalone prompt. Copy `agents/NN-*/background.md` and `agents/NN-*/prompt.md` into any LLM with web search, then paste the previous stage's JSON output as context.

## Command line

```bash
export ANTHROPIC_API_KEY=sk-ant-...      # or OPENAI_API_KEY
python run_pipeline.py PDCD1 LAG3 "metastatic melanoma"
```

Python 3.9+, no third-party packages. Resolves both targets against UniProt, Open Targets, AlphaFold DB and the RCSB PDB, injects those records into the prompts, then runs agents 01-06 in sequence. Writes each agent's markdown report **and** its parsed JSON to `output/iterations/i0/`.

It is deliberately a single pass: no refinement loop, no module 07, no web search. Structures and target associations are grounded; affinity and functional values are not. The full design-build-test cycle lives in the app and the orchestrator prompt, so there is only one implementation of it to keep correct.

```
--provider anthropic|openai   default: whichever API key is set
--model MODEL                 default: claude-opus-5 or gpt-4o
--no-grounding                skip the retrieval pass
```

## Module Summary

| Module | Role | Key Data Sources | Output |
|---|---|---|---|
| 01 Target ID | Disease → candidate targets | Open Targets, DisGeNET, GWAS Catalog | Markdown + JSON |
| 02 Validation | Genetic + functional evidence | ClinVar, gnomAD, UniProt, ClinGen, PubMed | Markdown + JSON |
| 03 Bispecific Design | Format, structure, developability | PDB, SAbDab, Thera-SAbDab, AlphaFold DB | Markdown + JSON |
| 03 Refinement | Data-driven redesign (iterative) | Binding JSON (04) + Functional JSON (05) + Experimental JSON (07) | Markdown + JSON |
| 04 SPR Binding | Kinetic/affinity data analysis + predicted vs observed | ChEMBL, BindingDB, PubChem, Module 07 | Markdown + JSON |
| 05 Cell Functional | Cell-based functional data + predicted vs observed | PubMed, PMC, Module 07 | Markdown + JSON |
| 06 In Vivo | In vivo efficacy, clinical synthesis, safety | ClinicalTrials.gov, PubMed, PMC | Markdown + JSON |
| 07 Experimental Data | Ingest wet lab results, structured metadata | SPR instruments, ELISA readers, in vivo study reports | Markdown + JSON |

## Output Structure

```mermaid
graph TD
    ROOT["Pipeline Output"] --> FINAL["{target}-workflow-results.md"]
    ROOT --> ITER["iterations/"]
    ITER --> I0["i0/"]
    ITER --> I1["i1/"]
    ITER --> I2["i2/ ..."]
    I0 --> F1["01-target-id.json"]
    I0 --> F2["02-validation.json"]
    I0 --> F3["03-design.json"]
    I0 --> F4["04-spr.json"]
    I0 --> F5["05-cell.json"]
    I0 --> F6["07-experiment-{id}.json"]
    I1 --> R1["03-refinement.json"]
    I1 --> R2["04-spr.json"]
    I1 --> R3["05-cell.json"]

    classDef dir fill:#0D47A1,stroke:#000000,stroke-width:3px,color:#000000
    classDef file fill:#E0E0E0,stroke:#000000,stroke-width:2px,color:#000000
    class ROOT,ITER,I0,I1,I2 dir
    class FINAL,F1,F2,F3,F4,F5,F6,R1,R2,R3 file
```

## Requirements

- Any LLM with web search capability (Tavily, web fetch)
- No proprietary data required. All sources are public
- For automated runs: `pip install openai` and set `OPENAI_API_KEY`

## Why This Matters

This pipeline is not a literature review tool. It mirrors how a real drug discovery team operates:

1. **Design a molecule** → predict its binding and function
2. **Run experiments** → get real SPR, cell, and in vivo data
3. **Compare predicted vs observed** → identify where the model was wrong
4. **Redesign** → fix the weak points, iterate until improvement plateaus
5. **Make a Go/No-Go decision** → with full traceability from target ID through clinical synthesis

The key differentiator is Module 07 (Experimental Data Ingestion). Most AI drug discovery workflows only read public databases. This pipeline ingests wet lab results, validates them (N, SD, controls), compares them against computational predictions, and feeds discrepancies back into the refinement loop. This is how real platforms like Insilico Medicine's Pharma.AI operate — not just literature synthesis, but the full design-build-test-learn cycle.

## Disclaimer

All data sourced from published public databases and peer-reviewed literature. No proprietary or internal company data is used. This is a demonstration of AI-assisted drug discovery workflow automation.

## What This Pipeline Produces

For any bispecific antibody target pair, the pipeline generates:

- Target identification and disease association rankings
- Genetic, functional, and pharmacological validation
- Format selection and structural analysis
- Published SPR/BLI binding data comparison
- Cell-based functional data from clinical candidates
- Clinical trial field and competitive analysis
- Iterative refinement with quantitative comparison across iterations

A worked PD-1 × VEGF analysis citing public data is available in the [output folder](https://github.com/peterydkim/drug-discovery-bispecific-agents/tree/main/output) for reference.

## License

MIT — use freely. Attribution appreciated.
