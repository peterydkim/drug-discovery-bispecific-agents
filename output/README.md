# Output

Generated pipeline results. Nothing here is committed except the worked examples —
`output/iterations/` is gitignored, since it is regenerated on every run.

## What lands here

The CLI runner (`python run_pipeline.py GENE1 GENE2 "indication"`) writes:

```
output/
├── {gene1}-{gene2}-workflow-results.md     # assembled synthesis
└── iterations/i0/
    ├── 00-grounding.json                   # records retrieved before generation
    ├── 01-target-id.md          + .json
    ├── 02-target-validation.md   + .json
    ├── 03-bispecific-design.md   + .json
    ├── 04-spr-binding.md         + .json
    ├── 05-cell-functional.md     + .json
    └── 06-in-vivo.md             + .json
```

Only `i0/` — the runner is a single pass. `i1/` and later come from the
refinement loop, which runs in the web app.

The web app keeps its run in the browser and exports the whole thing, including
the per-step citation audit, as one markdown file.

## Reading the output

Each agent produces a markdown report and a JSON block. The JSON is what the next
stage consumes; the markdown is for you. If an agent's JSON failed to parse, the
runner says so and the downstream stage falls back to a text excerpt — check that
before trusting a run.

Every quantitative claim should carry a PMID, DOI, NCT number, PDB ID or
accession. Where one does not, that number came from the model rather than from a
source. The app flags these per step; on a CLI run you check by hand.
