#!/usr/bin/env node
// bispec-mcp — a stdio MCP server exposing the pipeline's data sources as tools.
//
// The web app reaches these sources over HTTP because a browser cannot speak
// MCP. This server is the other half: it hands the same functions to Claude
// Code, or any MCP client, so an agent run can call a database instead of
// recalling one.
//
//   node mcp/server.mjs
//   claude mcp add bispec -- node /absolute/path/to/mcp/server.mjs
//
// Dependency-free on purpose: JSON-RPC 2.0 over line-delimited stdio, which is
// all the transport requires.

import { createInterface } from "node:readline";

const PROTOCOL_VERSION = "2024-11-05";
const SERVER_INFO = { name: "bispec-mcp", version: "1.0.0" };
const UA = { "user-agent": "bispec-mcp/1.0 (drug-discovery-bispecific-agents)" };

// ── Data sources ─────────────────────────────────────────────────────────────

async function getJson(url, init = {}) {
  const res = await fetch(url, { ...init, headers: { ...UA, ...(init.headers ?? {}) } });
  if (!res.ok) throw new Error(`${new URL(url).host} returned HTTP ${res.status}`);
  return res.json();
}

async function graphql(url, query, variables) {
  const data = await getJson(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (data.errors?.length) throw new Error(data.errors[0].message.split("\n")[0]);
  return data.data;
}

const sources = {
  async uniprot({ gene }) {
    const data = await getJson(
      "https://rest.uniprot.org/uniprotkb/search?" +
        new URLSearchParams({
          query: `gene_exact:${gene} AND organism_id:9606 AND reviewed:true`,
          fields: "accession,id,protein_name,length,sequence,ft_domain,ft_topo_dom",
          format: "json",
          size: "1",
        }),
    );
    const hit = data.results?.[0];
    if (!hit) return { found: false, gene };
    return {
      found: true,
      gene,
      accession: hit.primaryAccession,
      entryName: hit.uniProtkbId,
      proteinName: hit.proteinDescription?.recommendedName?.fullName?.value ?? null,
      length: hit.sequence?.length ?? null,
      sequence: hit.sequence?.value ?? null,
      domains: (hit.features ?? [])
        .filter((f) => f.type === "Domain" || f.type === "Topological domain")
        .map((f) => ({
          type: f.type,
          description: f.description,
          start: f.location?.start?.value,
          end: f.location?.end?.value,
        })),
      url: `https://www.uniprot.org/uniprotkb/${hit.primaryAccession}`,
    };
  },

  async alphafold({ accession }) {
    const data = await getJson(`https://alphafold.ebi.ac.uk/api/prediction/${accession}`);
    const m = Array.isArray(data) ? data[0] : data;
    if (!m) return { found: false, accession };
    return {
      found: true,
      accession,
      modelId: m.modelEntityId,
      version: m.latestVersion,
      method: m.toolUsed,
      meanPlddt: m.globalMetricValue,
      fractions: {
        veryHigh: m.fractionPlddtVeryHigh,
        confident: m.fractionPlddtConfident,
        low: m.fractionPlddtLow,
        veryLow: m.fractionPlddtVeryLow,
      },
      pdbUrl: m.pdbUrl,
      cifUrl: m.cifUrl,
      url: `https://alphafold.ebi.ac.uk/entry/${accession}`,
    };
  },

  async pdb_search({ query, limit = 10 }) {
    const body = {
      query: { type: "terminal", service: "full_text", parameters: { value: query } },
      return_type: "entry",
      request_options: { paginate: { start: 0, rows: Math.min(limit, 50) } },
    };
    const data = await getJson(
      "https://search.rcsb.org/rcsbsearch/v2/query?json=" + encodeURIComponent(JSON.stringify(body)),
    );
    const ids = (data.result_set ?? []).map((r) => r.identifier);
    const entries = await Promise.all(ids.map((id) => sources.pdb_entry({ pdbId: id }).catch(() => null)));
    return { query, total: data.total_count ?? 0, entries: entries.filter(Boolean) };
  },

  async pdb_entry({ pdbId }) {
    const d = await getJson(`https://data.rcsb.org/rest/v1/core/entry/${pdbId.toUpperCase()}`);
    return {
      id: pdbId.toUpperCase(),
      title: d.struct?.title ?? null,
      method: d.exptl?.[0]?.method ?? null,
      resolution: d.rcsb_entry_info?.resolution_combined?.[0] ?? null,
      depositDate: d.rcsb_accession_info?.deposit_date ?? null,
      url: `https://www.rcsb.org/structure/${pdbId.toUpperCase()}`,
      coordinatesUrl: `https://files.rcsb.org/download/${pdbId.toUpperCase()}.pdb`,
    };
  },

  async open_targets({ gene }) {
    const data = await graphql(
      "https://api.platform.opentargets.org/api/v4/graphql",
      `query T($q:String!){
        search(queryString:$q, entityNames:["target"], page:{index:0,size:1}){
          hits{ object{ ... on Target {
            id approvedSymbol approvedName biotype
            proteinIds { id source }
            geneticConstraint { constraintType score exp obs upperRank }
            safetyLiabilities { event datasource url }
            mousePhenotypes { modelPhenotypeLabel }
            associatedDiseases(page:{index:0,size:10}){ count rows{ score disease{ id name } } }
            drugAndClinicalCandidates {
              count
              rows { drug { id name drugType maximumClinicalStage mechanismsOfAction { rows { mechanismOfAction } } } }
            }
          } } }
        }
      }`,
      { q: gene },
    );
    const t = data.search?.hits?.[0]?.object;
    if (!t) return { found: false, gene };
    const lof = (t.geneticConstraint ?? []).find((c) => c.constraintType === "lof");
    return {
      found: true,
      gene,
      ensemblId: t.id,
      symbol: t.approvedSymbol,
      name: t.approvedName,
      uniprot: (t.proteinIds ?? []).filter((p) => p.source === "uniprot_swissprot").map((p) => p.id),
      gnomadLofConstraint: lof
        ? { pLI: lof.score, observed: lof.obs, expected: lof.exp, upperRank: lof.upperRank }
        : null,
      safetyLiabilities: (t.safetyLiabilities ?? []).slice(0, 12),
      mousePhenotypes: [...new Set((t.mousePhenotypes ?? []).map((m) => m.modelPhenotypeLabel))].slice(0, 15),
      diseaseCount: t.associatedDiseases?.count ?? 0,
      topDiseases: (t.associatedDiseases?.rows ?? []).map((r) => ({
        id: r.disease.id,
        name: r.disease.name,
        score: Math.round(r.score * 1000) / 1000,
      })),
      knownDrugCount: t.drugAndClinicalCandidates?.count ?? 0,
      knownDrugs: (t.drugAndClinicalCandidates?.rows ?? []).slice(0, 12).map((r) => ({
        id: r.drug?.id,
        name: r.drug?.name,
        type: r.drug?.drugType,
        maxStage: r.drug?.maximumClinicalStage,
        moa: (r.drug?.mechanismsOfAction?.rows ?? []).map((m) => m.mechanismOfAction).join("; "),
      })),
      url: `https://platform.opentargets.org/target/${t.id}`,
    };
  },

  async chembl_target({ query }) {
    const d = await getJson(
      `https://www.ebi.ac.uk/chembl/api/data/target/search?q=${encodeURIComponent(query)}&format=json&limit=10`,
    );
    return {
      query,
      total: d.page_meta?.total_count ?? 0,
      targets: (d.targets ?? [])
        .filter((t) => t.target_type === "SINGLE PROTEIN")
        .map((t) => ({
          chemblId: t.target_chembl_id,
          name: t.pref_name,
          organism: t.organism,
          url: `https://www.ebi.ac.uk/chembl/target_report_card/${t.target_chembl_id}/`,
        })),
    };
  },

  async pubmed_search({ query, limit = 10 }) {
    const s = await getJson(
      "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?" +
        new URLSearchParams({ db: "pubmed", term: query, retmode: "json", retmax: String(Math.min(limit, 50)) }),
    );
    const ids = s.esearchresult?.idlist ?? [];
    if (!ids.length) return { query, count: 0, articles: [] };
    const sum = await getJson(
      "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?" +
        new URLSearchParams({ db: "pubmed", id: ids.join(","), retmode: "json" }),
    );
    return {
      query,
      count: Number(s.esearchresult?.count ?? 0),
      articles: ids.map((id) => {
        const r = sum.result?.[id] ?? {};
        return {
          pmid: id,
          title: r.title,
          journal: r.fulljournalname ?? r.source,
          year: (r.pubdate ?? "").slice(0, 4),
          doi: (r.articleids ?? []).find((a) => a.idtype === "doi")?.value ?? null,
          url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
        };
      }),
    };
  },

  async clinical_trials({ query, limit = 20 }) {
    const d = await getJson(
      "https://clinicaltrials.gov/api/v2/studies?" +
        new URLSearchParams({
          "query.term": query,
          pageSize: String(Math.min(limit, 100)),
          fields:
            "NCTId,BriefTitle,Phase,OverallStatus,LeadSponsorName,Condition,InterventionName,StartDate,EnrollmentCount",
        }),
    );
    return {
      query,
      studies: (d.studies ?? []).map((s) => {
        const p = s.protocolSection ?? {};
        return {
          nctId: p.identificationModule?.nctId,
          title: p.identificationModule?.briefTitle,
          phases: p.designModule?.phases ?? [],
          status: p.statusModule?.overallStatus,
          sponsor: p.sponsorCollaboratorsModule?.leadSponsor?.name,
          conditions: p.conditionsModule?.conditions ?? [],
          interventions: (p.armsInterventionsModule?.interventions ?? []).map((i) => i.name),
          enrollment: p.designModule?.enrollmentInfo?.count ?? null,
          url: `https://clinicaltrials.gov/study/${p.identificationModule?.nctId}`,
        };
      }),
    };
  },

  async esmfold({ sequence, includeCoordinates = false }) {
    const clean = sequence.replace(/[^A-Za-z]/g, "").toUpperCase();
    if (clean.length < 20) throw new Error("Sequence too short (minimum 20 residues).");
    if (clean.length > 400) {
      throw new Error("Sequence exceeds the 400-residue cap on the public ESMFold endpoint.");
    }
    const res = await fetch("https://api.esmatlas.com/foldSequence/v1/pdb/", {
      method: "POST",
      headers: UA,
      body: clean,
    });
    if (!res.ok) throw new Error(`ESMFold returned HTTP ${res.status}`);
    const pdb = await res.text();
    const ca = pdb
      .split("\n")
      .filter((l) => l.startsWith("ATOM") && l.slice(12, 16).trim() === "CA")
      .map((l) => Number.parseFloat(l.slice(60, 66)))
      .filter(Number.isFinite);
    const scale = ca.length && Math.max(...ca) <= 1.5 ? 100 : 1;
    const track = ca.map((v) => v * scale);
    const mean = track.length ? track.reduce((a, b) => a + b, 0) / track.length : 0;
    const frac = (lo, hi) => (track.length ? track.filter((v) => v >= lo && v < hi).length / track.length : 0);
    return {
      length: clean.length,
      model: "ESMFold v1 (esmatlas.com public endpoint)",
      meanPlddt: Math.round(mean * 10) / 10,
      fractions: {
        veryHigh: Math.round(frac(90, 101) * 1000) / 1000,
        confident: Math.round(frac(70, 90) * 1000) / 1000,
        low: Math.round(frac(50, 70) * 1000) / 1000,
        veryLow: Math.round(frac(0, 50) * 1000) / 1000,
      },
      ...(includeCoordinates ? { pdb } : { note: "Set includeCoordinates to receive the PDB file." }),
    };
  },

  async sequence_properties({ sequence }) {
    const { analyseSequence, developabilityFlags } = await import("../app/src/lib/sequence.mjs");
    const report = analyseSequence(sequence);
    if (!report.valid) throw new Error(report.error ?? "Invalid sequence.");
    const { composition, liabilities, ...scalars } = report;
    return {
      ...scalars,
      developability: developabilityFlags(report),
      liabilities: liabilities.map((l) => `${l.motif}@${l.position} — ${l.label} (${l.risk})`),
    };
  },
};

// ── Tool definitions ─────────────────────────────────────────────────────────

const str = (description) => ({ type: "string", description });
const num = (description) => ({ type: "number", description });

const TOOLS = [
  {
    name: "uniprot_lookup",
    description:
      "Resolve a human gene symbol to its reviewed UniProt entry: accession, canonical sequence, length and domain/topology features. Use before any structure or sequence work so downstream calls cite one canonical accession.",
    inputSchema: { type: "object", properties: { gene: str("HGNC gene symbol, e.g. PDCD1") }, required: ["gene"] },
    handler: sources.uniprot,
  },
  {
    name: "alphafold_model",
    description:
      "Fetch the AlphaFold DB entry for a UniProt accession: mean pLDDT, the confidence breakdown, and coordinate URLs. This is a lookup of a precomputed monomer model, not an inference run — it says nothing about a complex or an epitope.",
    inputSchema: { type: "object", properties: { accession: str("UniProt accession, e.g. Q15116") }, required: ["accession"] },
    handler: sources.alphafold,
  },
  {
    name: "pdb_search",
    description:
      "Full-text search the RCSB PDB and return matching entries with title, experimental method and resolution. Use for antigen structures and antibody-antigen co-crystals.",
    inputSchema: {
      type: "object",
      properties: { query: str("Free text, e.g. 'PD-1 pembrolizumab Fab'"), limit: num("Max entries, default 10") },
      required: ["query"],
    },
    handler: sources.pdb_search,
  },
  {
    name: "pdb_entry",
    description: "Fetch one PDB entry's metadata by ID.",
    inputSchema: { type: "object", properties: { pdbId: str("Four-character PDB ID, e.g. 5GGS") }, required: ["pdbId"] },
    handler: sources.pdb_entry,
  },
  {
    name: "open_targets_profile",
    description:
      "Open Targets profile for a gene: disease association scores, gnomAD loss-of-function constraint, curated safety liabilities, mouse knockout phenotypes, and the clinical-candidate table with mechanism and maximum stage. Covers most of what target identification and validation need.",
    inputSchema: { type: "object", properties: { gene: str("HGNC gene symbol") }, required: ["gene"] },
    handler: sources.open_targets,
  },
  {
    name: "chembl_target",
    description: "Search ChEMBL for single-protein targets matching a name, to anchor bioactivity lookups.",
    inputSchema: { type: "object", properties: { query: str("Target name or synonym") }, required: ["query"] },
    handler: sources.chembl_target,
  },
  {
    name: "pubmed_search",
    description:
      "Search PubMed and return PMIDs with title, journal, year and DOI. Use to obtain real identifiers for citations, and to verify that a PMID you are about to cite exists.",
    inputSchema: {
      type: "object",
      properties: { query: str("PubMed query"), limit: num("Max articles, default 10") },
      required: ["query"],
    },
    handler: sources.pubmed_search,
  },
  {
    name: "clinical_trials",
    description:
      "Search ClinicalTrials.gov (API v2) for studies: NCT ID, phase, status, sponsor, conditions, interventions and enrolment.",
    inputSchema: {
      type: "object",
      properties: { query: str("Search term, e.g. a drug or target pair"), limit: num("Max studies, default 20") },
      required: ["query"],
    },
    handler: sources.clinical_trials,
  },
  {
    name: "esmfold_predict",
    description:
      "Predict a structure for a protein sequence with ESMFold and return mean pLDDT plus the confidence breakdown. Works on scFv, VH, VL and antigen ectodomains up to 400 residues. Single-chain only — it cannot model an antibody-antigen complex.",
    inputSchema: {
      type: "object",
      properties: {
        sequence: str("Amino-acid sequence or FASTA, 20-400 residues"),
        includeCoordinates: { type: "boolean", description: "Return the full PDB file. Large; default false." },
      },
      required: ["sequence"],
    },
    handler: sources.esmfold,
  },
  {
    name: "sequence_properties",
    description:
      "Compute exact physicochemical properties and developability liabilities for a protein sequence: molecular weight, theoretical pI, net charge, extinction coefficient, GRAVY, aliphatic index, cysteine parity, N-glycosylation sequons, deamidation and isomerisation hotspots. Arithmetic, not prediction — use it instead of asserting these values.",
    inputSchema: { type: "object", properties: { sequence: str("Amino-acid sequence or FASTA") }, required: ["sequence"] },
    handler: sources.sequence_properties,
  },
];

// ── JSON-RPC plumbing ────────────────────────────────────────────────────────

const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
const reply = (id, result) => send({ jsonrpc: "2.0", id, result });
const replyError = (id, code, message) => send({ jsonrpc: "2.0", id, error: { code, message } });

async function handle(msg) {
  const { id, method, params } = msg;
  const isNotification = id === undefined || id === null;

  switch (method) {
    case "initialize":
      return reply(id, {
        protocolVersion: params?.protocolVersion ?? PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
      });

    case "notifications/initialized":
    case "notifications/cancelled":
      return;

    case "ping":
      return reply(id, {});

    case "tools/list":
      return reply(id, {
        tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
      });

    case "tools/call": {
      const tool = TOOLS.find((t) => t.name === params?.name);
      if (!tool) return replyError(id, -32602, `Unknown tool: ${params?.name}`);
      try {
        const result = await tool.handler(params.arguments ?? {});
        return reply(id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
      } catch (err) {
        // Tool failures are results, not protocol errors: the model should see
        // the message and decide what to do, rather than the call blowing up.
        return reply(id, {
          isError: true,
          content: [{ type: "text", text: `${tool.name} failed: ${err.message}` }],
        });
      }
    }

    default:
      if (isNotification) return;
      return replyError(id, -32601, `Method not found: ${method}`);
  }
}

// Tool calls are async and outlive the line that triggered them, so closing
// stdin must not kill the process while requests are still in flight.
let inFlight = 0;
let inputClosed = false;
const exitWhenIdle = () => {
  if (inputClosed && inFlight === 0) process.exit(0);
};

createInterface({ input: process.stdin })
  .on("line", async (line) => {
    const text = line.trim();
    if (!text) return;
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      return replyError(null, -32700, "Parse error");
    }
    inFlight++;
    try {
      await handle(msg);
    } catch (err) {
      if (msg.id != null) replyError(msg.id, -32603, err.message);
    } finally {
      inFlight--;
      exitWhenIdle();
    }
  })
  .on("close", () => {
    inputClosed = true;
    exitWhenIdle();
  });
