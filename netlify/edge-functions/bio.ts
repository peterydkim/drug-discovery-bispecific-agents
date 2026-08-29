// Public bioinformatics data proxy.
//
// Every source below is free, keyless and public. The proxy exists for three
// reasons: several of these hosts send no CORS headers, the allow-list keeps the
// browser from being turned into an open relay, and routing through one place
// gives every call a uniform shape the pipeline can cite.
//
//   GET  /api/bio/uniprot?gene=PDCD1            → accession, sequence, features
//   GET  /api/bio/alphafold?acc=Q15116          → model URLs + pLDDT summary
//   GET  /api/bio/pdb-search?q=PD-1%20Fab       → ranked PDB entry IDs
//   GET  /api/bio/pdb-entry?id=5GGS             → title, resolution, method
//   GET  /api/bio/opentargets?gene=PDCD1        → association scores, known drugs
//   GET  /api/bio/chembl?q=PD-1                 → ChEMBL targets
//   GET  /api/bio/trials?q=PD-1%20LAG-3&n=20    → ClinicalTrials.gov v2 studies
//   GET  /api/bio/pubmed?q=tobemstomig&n=10     → PMIDs + titles
//   POST /api/bio/esmfold  {sequence}           → predicted PDB + per-residue pLDDT
//   GET  /api/bio/pdbfile?url=<alphafold url>   → raw coordinate passthrough

import type { Config, Context } from "@netlify/edge-functions";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
const CACHE_1H = { ...JSON_HEADERS, "cache-control": "public, max-age=3600" };

// Hosts the pdbfile passthrough is allowed to fetch. Without this the endpoint
// would proxy arbitrary URLs on the caller's behalf.
const COORDINATE_HOSTS = new Set([
  "alphafold.ebi.ac.uk",
  "files.rcsb.org",
  "www.ebi.ac.uk",
]);

const ok = (data: unknown, headers = CACHE_1H) =>
  new Response(JSON.stringify(data), { headers });
const bad = (message: string, status = 400) =>
  new Response(JSON.stringify({ error: message }), { status, headers: JSON_HEADERS });

async function getJson(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${new URL(url).host} returned ${res.status}`);
  return res.json();
}

/** Mean pLDDT and the per-residue track, read out of a PDB file's B-factor column. */
function plddtFromPdb(pdb: string) {
  const scores: number[] = [];
  for (const line of pdb.split("\n")) {
    if (!line.startsWith("ATOM")) continue;
    if (line.slice(12, 16).trim() !== "CA") continue;
    const b = Number.parseFloat(line.slice(60, 66));
    if (Number.isFinite(b)) scores.push(b);
  }
  if (!scores.length) return null;
  // ESMFold writes 0-1, AlphaFold writes 0-100. Normalise to 0-100.
  const scale = Math.max(...scores) <= 1.5 ? 100 : 1;
  const track = scores.map((s) => Math.round(s * scale * 10) / 10);
  const mean = track.reduce((a, b) => a + b, 0) / track.length;
  const bucket = (lo: number, hi: number) =>
    track.filter((s) => s >= lo && s < hi).length / track.length;
  return {
    residues: track.length,
    mean: Math.round(mean * 10) / 10,
    track,
    fractions: {
      veryHigh: bucket(90, 101),
      confident: bucket(70, 90),
      low: bucket(50, 70),
      veryLow: bucket(0, 50),
    },
  };
}

async function uniprot(gene: string) {
  const url =
    "https://rest.uniprot.org/uniprotkb/search?" +
    new URLSearchParams({
      query: `gene_exact:${gene} AND organism_id:9606 AND reviewed:true`,
      fields: "accession,id,protein_name,gene_names,length,sequence,ft_domain,ft_topo_dom,cc_subcellular_location",
      format: "json",
      size: "1",
    });
  const data: any = await getJson(url);
  const hit = data.results?.[0];
  if (!hit) return { found: false, gene };
  const domains = (hit.features ?? [])
    .filter((f: any) => f.type === "Domain" || f.type === "Topological domain")
    .map((f: any) => ({
      type: f.type,
      description: f.description,
      start: f.location?.start?.value,
      end: f.location?.end?.value,
    }));
  return {
    found: true,
    gene,
    accession: hit.primaryAccession,
    entryName: hit.uniProtkbId,
    proteinName: hit.proteinDescription?.recommendedName?.fullName?.value ?? null,
    length: hit.sequence?.length ?? null,
    sequence: hit.sequence?.value ?? null,
    domains,
    url: `https://www.uniprot.org/uniprotkb/${hit.primaryAccession}`,
  };
}

async function alphafold(acc: string) {
  const data: any = await getJson(`https://alphafold.ebi.ac.uk/api/prediction/${acc}`);
  const m = Array.isArray(data) ? data[0] : data;
  if (!m) return { found: false, accession: acc };
  return {
    found: true,
    accession: acc,
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
    paeUrl: m.paeImageUrl,
    sequence: m.sequence,
    url: `https://alphafold.ebi.ac.uk/entry/${acc}`,
  };
}

async function pdbSearch(q: string, rows: number) {
  const query = {
    query: { type: "terminal", service: "full_text", parameters: { value: q } },
    return_type: "entry",
    request_options: { paginate: { start: 0, rows } },
  };
  const url =
    "https://search.rcsb.org/rcsbsearch/v2/query?json=" +
    encodeURIComponent(JSON.stringify(query));
  const data: any = await getJson(url);
  return {
    query: q,
    total: data.total_count ?? 0,
    ids: (data.result_set ?? []).map((r: any) => r.identifier),
  };
}

async function pdbEntry(id: string) {
  const d: any = await getJson(`https://data.rcsb.org/rest/v1/core/entry/${id.toUpperCase()}`);
  return {
    id: id.toUpperCase(),
    title: d.struct?.title ?? null,
    method: d.exptl?.[0]?.method ?? null,
    resolution: d.rcsb_entry_info?.resolution_combined?.[0] ?? null,
    depositDate: d.rcsb_accession_info?.deposit_date ?? null,
    polymerEntities: d.rcsb_entry_info?.polymer_entity_count_protein ?? null,
    url: `https://www.rcsb.org/structure/${id.toUpperCase()}`,
    coordinatesUrl: `https://files.rcsb.org/download/${id.toUpperCase()}.pdb`,
  };
}

// Open Targets carries most of what agents 01 and 02 ask for in prose: gnomAD
// constraint, curated safety liabilities, mouse knockout phenotypes and the
// clinical-candidate table. Pulling them here means the validation agent starts
// from records rather than from recall.
async function openTargets(gene: string) {
  const query = `query T($q:String!){
    search(queryString:$q, entityNames:["target"], page:{index:0,size:1}){
      hits{ object{ ... on Target {
        id approvedSymbol approvedName biotype
        proteinIds { id source }
        geneticConstraint { constraintType score exp obs upperRank }
        safetyLiabilities { event datasource url }
        mousePhenotypes { modelPhenotypeLabel }
        associatedDiseases(page:{index:0,size:10}){
          count rows{ score disease{ id name } }
        }
        drugAndClinicalCandidates {
          count
          rows {
            maxClinicalStage
            drug {
              id name drugType maximumClinicalStage
              mechanismsOfAction { rows { mechanismOfAction } }
            }
          }
        }
      } } }
    }
  }`;
  const data: any = await getJson("https://api.platform.opentargets.org/api/v4/graphql", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ query, variables: { q: gene } }),
  });
  if (data.errors?.length) throw new Error(`Open Targets: ${data.errors[0].message.split("\n")[0]}`);
  const t = data.data?.search?.hits?.[0]?.object;
  if (!t) return { found: false, gene };

  const lof = (t.geneticConstraint ?? []).find((c: any) => c.constraintType === "lof");
  const mis = (t.geneticConstraint ?? []).find((c: any) => c.constraintType === "mis");

  return {
    found: true,
    gene,
    ensemblId: t.id,
    symbol: t.approvedSymbol,
    name: t.approvedName,
    biotype: t.biotype,
    uniprot: (t.proteinIds ?? [])
      .filter((p: any) => p.source === "uniprot_swissprot")
      .map((p: any) => p.id),
    constraint: {
      // gnomAD LoF constraint. `score` is pLI for the lof row; obs/exp is the
      // observed:expected ratio the LOEUF bound is derived from.
      lofPLI: lof?.score ?? null,
      lofObserved: lof?.obs ?? null,
      lofExpected: lof?.exp ?? null,
      lofObsExpRatio: lof && lof.exp ? Math.round((lof.obs / lof.exp) * 1000) / 1000 : null,
      lofUpperRank: lof?.upperRank ?? null,
      misZ: mis?.score ?? null,
    },
    safetyLiabilities: (t.safetyLiabilities ?? []).slice(0, 12).map((s: any) => ({
      event: s.event,
      source: s.datasource,
      url: s.url,
    })),
    mousePhenotypes: [
      ...new Set((t.mousePhenotypes ?? []).map((m: any) => m.modelPhenotypeLabel).filter(Boolean)),
    ].slice(0, 15),
    diseaseCount: t.associatedDiseases?.count ?? 0,
    topDiseases: (t.associatedDiseases?.rows ?? []).map((r: any) => ({
      id: r.disease.id,
      name: r.disease.name,
      score: Math.round(r.score * 1000) / 1000,
    })),
    knownDrugCount: t.drugAndClinicalCandidates?.count ?? 0,
    knownDrugs: (t.drugAndClinicalCandidates?.rows ?? []).slice(0, 12).map((r: any) => ({
      id: r.drug?.id,
      name: r.drug?.name,
      type: r.drug?.drugType,
      maxStage: r.drug?.maximumClinicalStage ?? r.maxClinicalStage ?? null,
      moa: (r.drug?.mechanismsOfAction?.rows ?? [])
        .map((m: any) => m.mechanismOfAction)
        .filter(Boolean)
        .slice(0, 2)
        .join("; "),
    })),
    url: `https://platform.opentargets.org/target/${t.id}`,
  };
}

async function chembl(q: string) {
  const data: any = await getJson(
    `https://www.ebi.ac.uk/chembl/api/data/target/search?q=${encodeURIComponent(q)}&format=json&limit=10`,
  );
  return {
    query: q,
    total: data.page_meta?.total_count ?? 0,
    targets: (data.targets ?? [])
      .filter((t: any) => t.target_type === "SINGLE PROTEIN")
      .map((t: any) => ({
        chemblId: t.target_chembl_id,
        name: t.pref_name,
        organism: t.organism,
        type: t.target_type,
        url: `https://www.ebi.ac.uk/chembl/target_report_card/${t.target_chembl_id}/`,
      })),
  };
}

async function trials(q: string, n: number) {
  const url =
    "https://clinicaltrials.gov/api/v2/studies?" +
    new URLSearchParams({
      "query.term": q,
      pageSize: String(n),
      fields:
        "NCTId,BriefTitle,Phase,OverallStatus,LeadSponsorName,Condition,InterventionName,StartDate,EnrollmentCount",
    });
  const data: any = await getJson(url);
  return {
    query: q,
    studies: (data.studies ?? []).map((s: any) => {
      const p = s.protocolSection ?? {};
      return {
        nctId: p.identificationModule?.nctId,
        title: p.identificationModule?.briefTitle,
        phases: p.designModule?.phases ?? [],
        status: p.statusModule?.overallStatus,
        sponsor: p.sponsorCollaboratorsModule?.leadSponsor?.name,
        conditions: p.conditionsModule?.conditions ?? [],
        interventions: (p.armsInterventionsModule?.interventions ?? []).map((i: any) => i.name),
        enrollment: p.designModule?.enrollmentInfo?.count ?? null,
        startDate: p.statusModule?.startDateStruct?.date ?? null,
        url: `https://clinicaltrials.gov/study/${p.identificationModule?.nctId}`,
      };
    }),
  };
}

async function pubmed(q: string, n: number) {
  const search: any = await getJson(
    "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?" +
      new URLSearchParams({ db: "pubmed", term: q, retmode: "json", retmax: String(n) }),
  );
  const ids: string[] = search.esearchresult?.idlist ?? [];
  if (!ids.length) return { query: q, count: 0, articles: [] };
  const summary: any = await getJson(
    "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?" +
      new URLSearchParams({ db: "pubmed", id: ids.join(","), retmode: "json" }),
  );
  return {
    query: q,
    count: Number(search.esearchresult?.count ?? 0),
    articles: ids.map((id) => {
      const r = summary.result?.[id] ?? {};
      return {
        pmid: id,
        title: r.title,
        journal: r.fulljournalname ?? r.source,
        year: (r.pubdate ?? "").slice(0, 4),
        doi: (r.articleids ?? []).find((a: any) => a.idtype === "doi")?.value ?? null,
        url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
      };
    }),
  };
}

async function esmfold(sequence: string) {
  const clean = sequence.replace(/[^A-Za-z]/g, "").toUpperCase();
  if (clean.length < 20) throw new Error("sequence too short (min 20 residues)");
  if (clean.length > 400) throw new Error("sequence too long for the public ESMFold endpoint (max 400)");
  const res = await fetch("https://api.esmatlas.com/foldSequence/v1/pdb/", {
    method: "POST",
    body: clean,
  });
  if (!res.ok) throw new Error(`ESMFold returned ${res.status}`);
  const pdb = await res.text();
  return {
    length: clean.length,
    model: "ESMFold v1 (esmatlas.com public endpoint)",
    confidence: plddtFromPdb(pdb),
    pdb,
  };
}

export default async (request: Request, _context: Context) => {
  const url = new URL(request.url);
  // Take only the first segment: some static-server configurations append an
  // index file to paths they cannot resolve before the request reaches here.
  const route = url.pathname.replace(/^\/api\/bio\/?/, "").split("/")[0];
  const p = url.searchParams;
  const int = (k: string, d: number, max: number) =>
    Math.min(max, Math.max(1, Number.parseInt(p.get(k) ?? "", 10) || d));

  try {
    switch (route) {
      case "uniprot": {
        const gene = p.get("gene");
        return gene ? ok(await uniprot(gene)) : bad("gene is required");
      }
      case "alphafold": {
        const acc = p.get("acc");
        return acc ? ok(await alphafold(acc)) : bad("acc is required");
      }
      case "pdb-search": {
        const q = p.get("q");
        return q ? ok(await pdbSearch(q, int("n", 10, 50))) : bad("q is required");
      }
      case "pdb-entry": {
        const id = p.get("id");
        return id ? ok(await pdbEntry(id)) : bad("id is required");
      }
      case "opentargets": {
        const gene = p.get("gene");
        return gene ? ok(await openTargets(gene)) : bad("gene is required");
      }
      case "chembl": {
        const q = p.get("q");
        return q ? ok(await chembl(q)) : bad("q is required");
      }
      case "trials": {
        const q = p.get("q");
        return q ? ok(await trials(q, int("n", 20, 100))) : bad("q is required");
      }
      case "pubmed": {
        const q = p.get("q");
        return q ? ok(await pubmed(q, int("n", 10, 50))) : bad("q is required");
      }
      case "esmfold": {
        if (request.method !== "POST") return bad("POST only", 405);
        const body = (await request.json()) as { sequence?: string };
        if (!body.sequence) return bad("sequence is required");
        // Folding is slow and uncacheable at the CDN; mark it no-store.
        return ok(await esmfold(body.sequence), { ...JSON_HEADERS, "cache-control": "no-store" });
      }
      case "pdbfile": {
        const target = p.get("url");
        if (!target) return bad("url is required");
        let parsed: URL;
        try {
          parsed = new URL(target);
        } catch {
          return bad("url is not a valid URL");
        }
        if (parsed.protocol !== "https:" || !COORDINATE_HOSTS.has(parsed.host)) {
          return bad(`host not allowed: ${parsed.host}`, 403);
        }
        const res = await fetch(parsed.toString());
        if (!res.ok) return bad(`upstream returned ${res.status}`, 502);
        const text = await res.text();
        return new Response(text, {
          headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=86400" },
        });
      }
      default:
        return bad(`unknown route: ${route || "(none)"}`, 404);
    }
  } catch (err) {
    return bad(err instanceof Error ? err.message : String(err), 502);
  }
};

export const config: Config = { path: "/api/bio/*" };
