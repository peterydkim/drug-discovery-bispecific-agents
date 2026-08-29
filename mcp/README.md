# bispec-mcp

A stdio MCP server that hands this pipeline's data sources to any MCP client as
callable tools. The web app reaches the same sources over HTTP (a browser cannot
speak MCP); this is the agent-side half.

## Use it

Project scope is already configured in `.mcp.json` at the repo root, so any MCP
client that reads it — Claude Code included — picks the server up on start.

To register it globally instead:

```bash
claude mcp add bispec -- node "$(pwd)/mcp/server.mjs"
```

To drive it by hand:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node mcp/server.mjs
```

## Tools

| Tool | Serves agent | Returns |
|---|---|---|
| `uniprot_lookup` | 01 · 02 · 03 | Reviewed accession, canonical sequence, domain and topology features |
| `open_targets_profile` | 01 · 02 | Association scores, gnomAD LoF constraint, safety liabilities, mouse KO phenotypes, clinical candidates with mechanism and stage |
| `alphafold_model` | 03 | AlphaFold DB entry: mean pLDDT, confidence breakdown, coordinate URLs |
| `pdb_search` / `pdb_entry` | 03 | RCSB entries with method and resolution |
| `esmfold_predict` | 03 | Structure prediction for a pasted sequence, with pLDDT — 20–400 residues |
| `sequence_properties` | 03 | MW, theoretical pI, net charge, ε₂₈₀, GRAVY, aliphatic index, PTM and degradation liabilities |
| `chembl_target` | 04 | ChEMBL single-protein targets |
| `pubmed_search` | 02 · 05 · 06 | PMIDs with title, journal, year and DOI |
| `clinical_trials` | 06 | ClinicalTrials.gov v2 studies |

Every source is public and keyless. `sequence_properties` shares its
implementation with the web app (`app/src/lib/sequence.mjs`) so the two cannot
drift apart.

## Limits worth knowing

- `esmfold_predict` uses the public esmatlas endpoint: single chain, 400 residues,
  no complexes. For an antibody–antigen complex with a predicted affinity you need
  Boltz-2 or Chai-1 on a GPU — see the Integrations tab in the app.
- `alphafold_model` is a **lookup**, not an inference run. If a UniProt accession
  has no precomputed model, it returns `found: false` rather than folding anything.
- Tool failures come back as `isError` results with the message attached, not as
  protocol errors, so the calling model can decide what to do.
