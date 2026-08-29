# Workflow review — findings and what changed

A pass over the seven-module pipeline as it stood, the defects found, and the
work done in response. Every claim below was checked against the code or against
a live API call, not inferred from the documentation.

---

## 1. The gap between the documentation and the code

*This section records `run_pipeline.py` **as found**, at commit `77efdbf`. The
script has since been rewritten — see §4 and §5.8. The findings are kept because
they are the argument for the rewrite, and because the same failure modes are
worth recognising elsewhere.*

The README, `DESIGN.md` and `orchestrator/prompt.md` describe a design-build-test-learn
loop with JSON handoffs, iteration diffing and wet-lab ingestion. `run_pipeline.py`
implements a single linear pass. The two do not meet.

| Documented | In `run_pipeline.py` | Evidence |
|---|---|---|
| Refinement loop 03 → 04 → 05 → 03, up to 3 iterations | Never runs. `AGENT_SEQUENCE` is 01–06, once. | `REFINEMENT_PROMPT` is assigned at line 40 and referenced nowhere else. |
| Module 07 ingests wet-lab data | Unreachable. | `EXPERIMENTAL_PROMPT` assigned at line 41, never used. `run_pipeline()` takes `experimental_data_path` and never reads it. |
| JSON handoffs, parsed by the orchestrator | No JSON is ever parsed or written. | Output is `.md` only; `output/iterations/i0/` contains six `.md` files and zero `.json`. |
| "Quantitative comparison: diff affinities across iterations" | Nothing compares anything. | No iteration beyond `i0` is ever produced. |
| Each agent receives the prior agents' output | Each agent receives **only its immediate predecessor**. | `prev_output = result.get("response", "")` overwrites each pass. Agent 06, whose prompt says "synthesise all prior agent outputs", sees agent 05 alone. |
| Final synthesis is a master document | The file is agent 06's raw response. | `final_file.write_text(prev_output)`. The compile-all branch below it is unreachable whenever any agent returned text. |

### The one that silently corrupts results

`build_prompt(agent, target_pair, disease, prev_output)` accepts `disease` and
never uses it. There is no `disease` key in the substitution map. Meanwhile
`"solid tumor immunotherapy"` is hardcoded in five places across the prompts.

So this:

```bash
python run_pipeline.py FCGR2B CD79B "systemic lupus erythematosus"
```

runs target identification, validation and design against **solid tumour
immunotherapy**, with no warning. The indication argument is accepted, printed
in the banner, and discarded. A lupus B-cell programme would come back analysed
as an oncology programme.

### Smaller drift

- `skills/SKILL.md` says "6-agent" and `compatibility: opencode`; the README says
  seven modules. Module 07 is missing from the skill entirely.
- `output/pd1-vegf-workflow-results.md` cannot have been produced by this script:
  `slug()` would have named it `pdcd1-vegfa-workflow-results.md`. The committed
  outputs came from interactive runs, not from the runner.
- `.gitignore` excludes `output/iterations/`, which both the README and
  `DESIGN.md` present as the audit trail. The traceability story and the ignore
  file contradict each other.

---

## 2. The scientific problem underneath

**Every agent prompt names databases the model cannot reach.** `call_llm` issues
a bare chat completion — no tools, no retrieval, no web access. Agent 01 is told
to "search Open Targets, DisGeNET, GWAS Catalog, COSMIC"; agent 03 to "search PDB
for structures"; agent 06 to query ClinicalTrials.gov. None of that can happen.
The model produces database-shaped output from training recall, and the pipeline
prints it under headings that say the databases were consulted.

The prompts' own constraint — "every data point must be traceable to a PMID, DOI,
database accession, or URL" — makes this worse rather than better, because it
instructs the model to attach identifiers to numbers it recalled. A wrong PMID
next to a plausible K<sub>D</sub> is more dangerous than a bare number, because it
reads as verified.

**Nothing is falsifiable.** There is no eval set, no held-out benchmark, no check
that a cited PMID resolves, no comparison against a known answer. The pipeline
cannot distinguish a good run from a bad one, so neither can its user.

**The schemas contain answers.** The JSON templates ship fully populated with
PD-1/LAG-3-specific values presented as the output format — nivolumab at 290 pM,
pembrolizumab at 29 pM, relatlimab at 110 pM in agent 04; CrossMab at 150 kDa,
DART at a 7-day half-life, FIT-Ig at 0.5 g/L in agent 03; tobemstomig at
IC<sub>50</sub> 0.5 nM in agent 05. Substitution then turns
`"antibody_name": "nivolumab", "target": "{target_1}"` into a claim that
nivolumab binds whatever target you passed in.

This is a latent contamination risk, not an observed failure: the committed
`fcgr2b-cd79b` run contains none of those anchors. But that run was produced
interactively by a strong model, not by the runner, so it is not evidence the
prompt design is safe — it is evidence the outputs did not come from the code.

**Agent 02 pre-writes its own conclusion.** The schema ships with
`"interpretation": "{GENE1} can tolerate loss-of-function mutations; immuno
oncology target genes often handle heterozygous LoF..."` already filled in. The
template tells the model what to conclude about gnomAD constraint before it looks
at any constraint data.

**Developability is asserted where it could be computed.** Predicted T<sub>m</sub>,
pI, expression yield and aggregation risk are LLM free-text. pI, molecular weight,
extinction coefficient, GRAVY, charge and PTM liabilities are exact arithmetic on
a sequence. The background file even names the SAbPred TAP score; nothing ever
computed it.

**The stop criteria are prose.** "Delta greater than 3× triggers redesign" and
"plateau below 10%" appear in three documents and in no code path.

---

## 3. Security

`.git/config` carries a live GitHub OAuth token embedded in the remote URL:

```
origin  https://gho_****@github.com/peterydkim/drug-discovery-bispecific-agents.git
```

Anyone who reads the working directory, a backup, or a process dump has push
access to that repository. **Rotate it**: revoke the token in GitHub → Settings →
Developer settings, then reset the remote to a bare URL and let the credential
helper hold the secret.

```bash
git remote set-url origin https://github.com/peterydkim/drug-discovery-bispecific-agents.git
```

---

## 4. What was built in response

### Retrieval before generation

Eight public, keyless sources are now called live, and their results are injected
into the prompt as a grounding block before the model writes anything. All eight
were verified end to end against real queries.

| Source | Feeds | Verified with |
|---|---|---|
| UniProt REST | 01 · 02 · 03 | `LAG3` → P18627, 525 aa, 6 domains |
| Open Targets GraphQL | 01 · 02 | `PDCD1` → ENSG00000188389, 2,122 disease associations, 26 clinical candidates, gnomAD LoF pLI |
| AlphaFold DB | 03 | `P18627` → AF-P18627-F1 v6, mean pLDDT 78.4 |
| RCSB PDB search + data | 03 | `LAG-3 Fab complex` → 7UM3 (2.40 Å), 8SO3, 8SR0 |
| ESMFold | 03 | 120-residue VH → mean pLDDT 90.9, 82.5% very high |
| ChEMBL REST | 04 | Single-protein target resolution |
| PubMed E-utilities | 02 · 05 · 06 | `tebotelimab` → real PMIDs with DOIs |
| ClinicalTrials.gov v2 | 06 | `tebotelimab` → NCT04634825 Ph2 TERMINATED, NCT04082364 Ph2/3 COMPLETED |

Open Targets turned out to carry most of what agents 01 and 02 ask for in prose
and could not previously obtain: gnomAD loss-of-function constraint, curated
safety liabilities, mouse knockout phenotypes, and the clinical-candidate table
with mechanism and maximum stage.

### A citation audit that actually runs

Each agent's output is parsed for quantitative claims — a number carrying a unit
the pipeline trades in (pM, nM, kDa, %, fold, days, g/L, °C, M⁻¹s⁻¹) — and each
is checked for a PMID, PMC ID, DOI, NCT number, PDB ID, UniProt accession or
database URL within six lines. Coverage is reported per step and the unsourced
numbers are listed individually.

It is a lint, not a verifier: a nearby PMID does not prove the number came from
that paper. What it catches is the common failure, which is a table of affinities
with no identifier anywhere near it. That was previously invisible.

### Computed developability

pI, molecular weight, net charge at pH 7.4, ε₂₈₀, A₂₈₀, GRAVY, aliphatic index,
cysteine parity, N-glycosylation sequons, deamidation (NG/NS/NN) and
isomerisation (DG/DS/DD) hotspots, acid-labile DP bonds and oxidation-prone
residues — all computed from the sequence, following ProtParam (Gasteiger 2005)
and Pace 1995. Same implementation in the app and the MCP server, so they cannot
drift.

### The refinement loop, implemented

Typed handoffs (each step declares which upstream steps it consumes; only their
JSON is passed, never whole markdown reports), then iterations 1..N with three
real stop conditions: the design agent returning `proceed_to_reevaluation: false`,
an affinity metric moving less than 10% between iterations, or the hard ceiling.
Module 07 runs first when wet-lab data is supplied and is consumed by 04, 05, 06
and the refinement pass.

### An MCP server

`mcp/server.mjs` exposes the same ten functions to Claude Code or any MCP client,
so an agent run can call a database instead of recalling one. Dependency-free
JSON-RPC over stdio; registered project-wide in `.mcp.json`. All ten tools tested
over the wire.

---

## 5. What is still open

Ordered by how much each would change the science.

1. **ANARCI** (BSD-3, OPIG) — IMGT/Kabat/Chothia numbering. Without it, liability
   motifs cannot be localised to CDRs, so "NG in framework 3" and "NG in CDR-H3"
   are reported identically. They are not remotely the same risk. This is the
   highest-value missing piece and it is a small Python service.
2. **Boltz-2** (MIT) — co-folding with a binding-affinity head. This is what would
   let module 04 *predict* a K<sub>D</sub> rather than curate published ones, which
   is the precondition for module 07's predicted-vs-observed comparison to mean
   anything. Needs a GPU.
3. **ImmuneBuilder / ABodyBuilder2** (BSD-3) — Fv structures in seconds on CPU,
   more accurate on CDR loops than a general folder. ESMFold is the stand-in.
4. **ProteinMPNN** (MIT) — turns "suggest CDR mutagenesis targets" into a ranked
   substitution list on a fixed backbone.
5. **BioPhi / OASis** (MIT) — humanness scoring, a computable proxy for
   anti-drug-antibody risk.
6. **An eval set.** Ten target pairs with known answers — approved or failed
   molecules, published affinities, known trial outcomes — scored per agent. Until
   this exists, no claim about the pipeline's accuracy is testable.
7. **Fix the prompts.** Strip the worked PD-1/LAG-3 values out of the JSON
   schemas and replace them with types and units. Remove the pre-written
   `interpretation` conclusion from agent 02. Parameterise the indication instead
   of hardcoding "solid tumor immunotherapy".
8. **Retire `run_pipeline.py`'s remaining gap.** Rewritten: the indication now
   substitutes, JSON is written per agent, every prior agent's JSON is passed
   forward rather than only the predecessor, the retrieval pass runs, and the
   scope is stated on startup. It is stdlib-only and supports both providers.
   What it still does not do is web search, so affinity and functional values
   remain ungrounded there — same limit as the app.

---

## 6. Honest limits of what was built

- The web app's grounding covers targets, structures, associations, literature and
  trials. It does not ground **affinity values** — no public API returns a
  bispecific's K<sub>D</sub>, so agent 04 still depends on the model plus optional
  web search.
- ESMFold is single-chain. It says nothing about an epitope or about whether two
  arms can co-engage. Any geometry claim in agent 03 remains an assertion.
- AlphaFold DB is a lookup of precomputed monomer models. Calling it "AlphaFold2
  integration" is accurate but narrower than it sounds — it is retrieval, not
  inference, and monomers, not complexes.
- The citation audit checks proximity, not truth. Verifying that a PMID says what
  the agent claims it says needs full-text retrieval and a second model pass.
- Nothing here has been validated against a wet lab. Every number the pipeline
  produces is a hypothesis for the bench.
