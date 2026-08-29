import { useState } from "react";

type Status = "wired" | "mcp" | "next";

interface Entry {
  name: string;
  agents: string;
  what: string;
  license: string;
  status: Status;
  note?: string;
  url: string;
}

const ENTRIES: Entry[] = [
  // ── Live in this app ────────────────────────────────────────────────────────
  {
    name: "UniProt REST",
    agents: "01 · 02 · 03",
    what: "Canonical accession, reviewed sequence, domain and topology features.",
    license: "CC BY 4.0",
    status: "wired",
    url: "https://www.uniprot.org/help/api",
  },
  {
    name: "Open Targets Platform GraphQL",
    agents: "01 · 02",
    what: "Target-disease association scores, known-drug records with phase and mechanism.",
    license: "Open, no key",
    status: "wired",
    url: "https://platform-docs.opentargets.org/data-access/graphql-api",
  },
  {
    name: "AlphaFold DB API",
    agents: "03",
    what: "Precomputed monomer models with mean pLDDT and the confidence breakdown, plus coordinates.",
    license: "CC BY 4.0",
    status: "wired",
    note: "Answers the AlphaFold2 question directly: DB lookup, not inference. 200M+ models, instant, free.",
    url: "https://alphafold.ebi.ac.uk/api-docs",
  },
  {
    name: "ESMFold (esmatlas endpoint)",
    agents: "03",
    what: "Single-sequence structure prediction for any construct you paste — scFv, VH, VL, ectodomain.",
    license: "MIT (model)",
    status: "wired",
    note: "This is the actual in-silico step: fold a designed sequence, read pLDDT, no GPU needed. Capped at 400 residues.",
    url: "https://esmatlas.com/about",
  },
  {
    name: "RCSB PDB Search + Data API",
    agents: "03",
    what: "Full-text structure search, then per-entry method, resolution and coordinates.",
    license: "CC0",
    status: "wired",
    url: "https://search.rcsb.org/",
  },
  {
    name: "ChEMBL REST",
    agents: "04",
    what: "Target records and the bioactivity tables behind published affinity values.",
    license: "CC BY-SA 3.0",
    status: "wired",
    url: "https://www.ebi.ac.uk/chembl/api/data/docs",
  },
  {
    name: "ClinicalTrials.gov API v2",
    agents: "06",
    what: "Live trial records — phase, status, sponsor, enrolment, interventions.",
    license: "Public domain",
    status: "wired",
    url: "https://clinicaltrials.gov/data-api/api",
  },
  {
    name: "NCBI E-utilities (PubMed)",
    agents: "02 · 05 · 06",
    what: "PMID resolution and article metadata, used to check whether a cited PMID exists.",
    license: "Public domain",
    status: "wired",
    url: "https://www.ncbi.nlm.nih.gov/books/NBK25501/",
  },
  {
    name: "ProtParam-equivalent calculators",
    agents: "03",
    what: "pI, MW, ε₂₈₀, GRAVY, aliphatic index, net charge, PTM and degradation motifs — computed, not asserted.",
    license: "Reimplemented (Gasteiger 2005, Pace 1995)",
    status: "wired",
    note: "Runs in the browser. Replaces the prose developability section with numbers that can be reproduced.",
    url: "https://web.expasy.org/protparam/",
  },

  // ── MCP servers usable on the agent side ────────────────────────────────────
  {
    name: "Open Targets · ChEMBL · ClinicalTrials.gov · PubMed · bioRxiv · Consensus",
    agents: "01 · 02 · 04 · 05 · 06",
    what: "Existing MCP servers from the Claude Code bio-research plugin — the agent calls them as tools instead of describing a URL in prose.",
    license: "Varies by source",
    status: "mcp",
    note: "Already available in Claude Code. Use these when you drive the pipeline from an agent runtime; the app uses the same sources over HTTP because a browser cannot speak MCP.",
    url: "https://modelcontextprotocol.io",
  },
  {
    name: "bispec-mcp (in this repo)",
    agents: "01 – 06",
    what: "Stdio MCP server exposing UniProt, AlphaFold, PDB, ESMFold, Open Targets, ChEMBL, PubMed, trials and the sequence calculators as MCP tools.",
    license: "MIT",
    status: "mcp",
    note: "Run: node mcp/server.mjs — or register it with claude mcp add. Same functions the app calls, offered to any MCP client.",
    url: "https://modelcontextprotocol.io/docs/concepts/tools",
  },

  // ── The next tier: needs a Python service ───────────────────────────────────
  {
    name: "ANARCI",
    agents: "03",
    what: "IMGT / Kabat / Chothia numbering and germline assignment for antibody sequences.",
    license: "BSD-3 (OPIG)",
    status: "next",
    note: "The highest-value missing piece. Without numbering, liability motifs cannot be localised to CDRs, and 'liability in FR3' and 'liability in CDR-H3' are treated the same.",
    url: "https://github.com/oxpig/ANARCI",
  },
  {
    name: "ImmuneBuilder / ABodyBuilder2",
    agents: "03",
    what: "Antibody Fv structure prediction in seconds on CPU, more accurate on CDR loops than general folders.",
    license: "BSD-3 (OPIG)",
    status: "next",
    note: "The right tool for Fv geometry; ESMFold is the general-purpose stand-in currently wired.",
    url: "https://github.com/oxpig/ImmuneBuilder",
  },
  {
    name: "Boltz-2",
    agents: "03 · 04",
    what: "Open-weight co-folding with a binding-affinity head — a predicted KD to compare against the SPR agent's numbers.",
    license: "MIT",
    status: "next",
    note: "This is what turns module 04 from literature curation into prediction: predict affinity, then let module 07 falsify it.",
    url: "https://github.com/jwohlwend/boltz",
  },
  {
    name: "BioPhi (OASis / Hu-mAb)",
    agents: "03",
    what: "Humanness scoring and humanisation — a computable proxy for anti-drug-antibody risk.",
    license: "MIT",
    status: "next",
    url: "https://github.com/Merck/BioPhi",
  },
  {
    name: "ProteinMPNN / LigandMPNN",
    agents: "03 refinement",
    what: "Sequence design on a fixed backbone — concrete mutation sets for the affinity-maturation step.",
    license: "MIT",
    status: "next",
    note: "Turns 'suggest CDR mutagenesis targets' from a sentence into a ranked list of substitutions.",
    url: "https://github.com/dauparas/ProteinMPNN",
  },
  {
    name: "TAP (Therapeutic Antibody Profiler)",
    agents: "03",
    what: "Five developability flags benchmarked against clinical-stage antibodies.",
    license: "Academic use (SAbPred)",
    status: "next",
    note: "The background file already names TAP; nothing in the pipeline ever computed it.",
    url: "https://opig.stats.ox.ac.uk/webapps/sabdab-sabpred/sabpred/tap",
  },
  {
    name: "Thera-SAbDab",
    agents: "03",
    what: "WHO-recognised therapeutic antibodies with sequences and formats — the parental Fv source table.",
    license: "Academic use (OPIG)",
    status: "next",
    note: "No JSON API; served as HTML. Needs a scheduled scrape into a local table rather than a live call.",
    url: "https://opig.stats.ox.ac.uk/webapps/sabdab-sabpred/therasabdab/search/",
  },
  {
    name: "OpenMM / GROMACS",
    agents: "03",
    what: "Molecular dynamics for conformational stability and hydrophobic-patch behaviour over time.",
    license: "MIT / LGPL",
    status: "next",
    note: "Only worth it once a candidate is real — hours of GPU per construct.",
    url: "https://openmm.org/",
  },
];

const STATUS_LABEL: Record<Status, string> = {
  wired: "Live in this app",
  mcp: "MCP",
  next: "Needs a service",
};

export function Integrations() {
  const [filter, setFilter] = useState<Status | "all">("all");
  const shown = ENTRIES.filter((e) => filter === "all" || e.status === filter);

  return (
    <div className="stack-lg">
      <section className="card">
        <h3>Integration surface</h3>
        <p className="hint">
          The original pipeline listed database URLs inside prompts and hoped the model would honour
          them. Everything marked <em>live</em> below is a real request this app makes and cites.
          Everything marked <em>needs a service</em> is open source but needs a Python process — the
          browser and the edge runtime cannot host it, so it belongs in a sidecar container.
        </p>
        <div className="row">
          {(["all", "wired", "mcp", "next"] as const).map((f) => (
            <button
              key={f}
              className={`ghost sm ${filter === f ? "on" : ""}`}
              onClick={() => setFilter(f)}
            >
              {f === "all" ? "All" : STATUS_LABEL[f]}
              <em> {f === "all" ? ENTRIES.length : ENTRIES.filter((e) => e.status === f).length}</em>
            </button>
          ))}
        </div>
      </section>

      <section className="card">
        <table className="data wide">
          <thead>
            <tr>
              <th>Source</th>
              <th>Agents</th>
              <th>What it gives you</th>
              <th>Licence</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((e) => (
              <tr key={e.name}>
                <td>
                  <a href={e.url} target="_blank" rel="noreferrer">
                    {e.name}
                  </a>
                </td>
                <td className="nowrap muted">{e.agents}</td>
                <td>
                  {e.what}
                  {e.note && <div className="basis">{e.note}</div>}
                </td>
                <td className="muted">{e.license}</td>
                <td>
                  <span className={`pill ${e.status === "wired" ? "pass" : e.status === "mcp" ? "watch" : "neutral"}`}>
                    {STATUS_LABEL[e.status]}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h3>Why AlphaFold2 alone does not close agent 03</h3>
        <p>
          AlphaFold DB is a lookup of precomputed <strong>monomer</strong> models. It tells you what
          the target ectodomain looks like and how confident the prediction is — genuinely useful,
          and wired in above. What it does not do is the thing a bispecific design actually turns
          on: the <strong>antibody–antigen complex</strong>, the epitope, and whether two arms can
          engage two receptors on the same cell at once.
        </p>
        <p>
          The honest split is three tiers. <strong>Retrieval</strong> — AlphaFold DB, PDB, UniProt —
          is free, instant, and running today. <strong>Single-chain prediction</strong> — ESMFold
          here, ABodyBuilder2 in a sidecar — folds your own construct and is fast enough to sit in
          the loop. <strong>Complex prediction with affinity</strong> — Boltz-2, Chai-1,
          AlphaFold 3 — is where a predicted K<sub>D</sub> comes from, needs a GPU, and is the only
          tier that would let module 04 predict rather than curate. Module 07 then does what it was
          built for: falsify the prediction against the instrument.
        </p>
      </section>
    </div>
  );
}
