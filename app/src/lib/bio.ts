// Typed client for the /api/bio edge function.

export interface UniprotHit {
  found: boolean;
  gene: string;
  accession?: string;
  entryName?: string;
  proteinName?: string | null;
  length?: number | null;
  sequence?: string | null;
  domains?: { type: string; description: string; start: number; end: number }[];
  url?: string;
}

export interface AlphaFoldHit {
  found: boolean;
  accession: string;
  modelId?: string;
  version?: number;
  method?: string;
  meanPlddt?: number;
  fractions?: { veryHigh: number; confident: number; low: number; veryLow: number };
  pdbUrl?: string;
  cifUrl?: string;
  paeUrl?: string;
  sequence?: string;
  url?: string;
}

export interface PdbEntry {
  id: string;
  title: string | null;
  method: string | null;
  resolution: number | null;
  depositDate: string | null;
  polymerEntities: number | null;
  url: string;
  coordinatesUrl: string;
}

export interface OpenTargetsHit {
  found: boolean;
  gene: string;
  ensemblId?: string;
  symbol?: string;
  name?: string;
  uniprot?: string[];
  diseaseCount?: number;
  topDiseases?: { id: string; name: string; score: number }[];
  knownDrugCount?: number;
  knownDrugs?: { id: string; name: string; phase: number; status: string; moa: string }[];
  url?: string;
}

export interface TrialRecord {
  nctId: string;
  title: string;
  phases: string[];
  status: string;
  sponsor?: string;
  conditions: string[];
  interventions: string[];
  enrollment: number | null;
  startDate: string | null;
  url: string;
}

export interface PubmedArticle {
  pmid: string;
  title: string;
  journal: string;
  year: string;
  doi: string | null;
  url: string;
}

export interface FoldResult {
  length: number;
  model: string;
  confidence: {
    residues: number;
    mean: number;
    track: number[];
    fractions: { veryHigh: number; confident: number; low: number; veryLow: number };
  } | null;
  pdb: string;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`/api/bio/${path}`);
  const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data as T;
}

export const bio = {
  uniprot: (gene: string) => get<UniprotHit>(`uniprot?gene=${encodeURIComponent(gene)}`),
  alphafold: (acc: string) => get<AlphaFoldHit>(`alphafold?acc=${encodeURIComponent(acc)}`),
  pdbSearch: (q: string, n = 10) =>
    get<{ query: string; total: number; ids: string[] }>(
      `pdb-search?q=${encodeURIComponent(q)}&n=${n}`,
    ),
  pdbEntry: (id: string) => get<PdbEntry>(`pdb-entry?id=${encodeURIComponent(id)}`),
  openTargets: (gene: string) => get<OpenTargetsHit>(`opentargets?gene=${encodeURIComponent(gene)}`),
  chembl: (q: string) =>
    get<{ query: string; total: number; targets: { chemblId: string; name: string; organism: string; url: string }[] }>(
      `chembl?q=${encodeURIComponent(q)}`,
    ),
  trials: (q: string, n = 20) =>
    get<{ query: string; studies: TrialRecord[] }>(`trials?q=${encodeURIComponent(q)}&n=${n}`),
  pubmed: (q: string, n = 10) =>
    get<{ query: string; count: number; articles: PubmedArticle[] }>(
      `pubmed?q=${encodeURIComponent(q)}&n=${n}`,
    ),
  coordinates: async (url: string): Promise<string> => {
    const res = await fetch(`/api/bio/pdbfile?url=${encodeURIComponent(url)}`);
    if (!res.ok) throw new Error(`Could not fetch coordinates (HTTP ${res.status})`);
    return res.text();
  },
  esmfold: async (sequence: string): Promise<FoldResult> => {
    const res = await fetch("/api/bio/esmfold", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sequence }),
    });
    const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
    return data as FoldResult;
  },
};

/**
 * Resolves a gene symbol to everything the design agent needs about the target:
 * canonical accession, sequence, an AlphaFold model, candidate structures and
 * the Open Targets association profile. Failures are isolated — a dead ChEMBL
 * call must not take the target briefing down with it.
 */
export interface TargetBrief {
  gene: string;
  uniprot?: UniprotHit;
  alphafold?: AlphaFoldHit;
  openTargets?: OpenTargetsHit;
  structures: PdbEntry[];
  errors: string[];
}

export async function briefTarget(gene: string, structureQuery?: string): Promise<TargetBrief> {
  const errors: string[] = [];
  const settle = async <T>(label: string, p: Promise<T>): Promise<T | undefined> => {
    try {
      return await p;
    } catch (e) {
      errors.push(`${label}: ${(e as Error).message}`);
      return undefined;
    }
  };

  const [uniprotHit, otHit, search] = await Promise.all([
    settle("UniProt", bio.uniprot(gene)),
    settle("Open Targets", bio.openTargets(gene)),
    settle("PDB search", bio.pdbSearch(structureQuery ?? `${gene} antibody complex`, 6)),
  ]);

  const acc = uniprotHit?.accession ?? otHit?.uniprot?.[0];
  const alphafoldHit = acc ? await settle("AlphaFold", bio.alphafold(acc)) : undefined;

  const structures: PdbEntry[] = [];
  for (const id of search?.ids ?? []) {
    const entry = await settle(`PDB ${id}`, bio.pdbEntry(id));
    if (entry) structures.push(entry);
  }

  return { gene, uniprot: uniprotHit, alphafold: alphafoldHit, openTargets: otHit, structures, errors };
}

/** Renders a target brief as the grounding block injected into an agent prompt. */
export function briefToPromptBlock(b: TargetBrief): string {
  const lines: string[] = [`### Retrieved reference data — ${b.gene}`];

  if (b.uniprot?.found) {
    lines.push(
      `- UniProt ${b.uniprot.accession} (${b.uniprot.entryName}) — ${b.uniprot.proteinName}, ${b.uniprot.length} aa. ${b.uniprot.url}`,
    );
    const doms = (b.uniprot.domains ?? []).slice(0, 6);
    if (doms.length) {
      lines.push(
        `- Domain architecture: ${doms.map((d) => `${d.description} (${d.start}-${d.end})`).join("; ")}`,
      );
    }
  }
  if (b.alphafold?.found) {
    lines.push(
      `- AlphaFold DB ${b.alphafold.modelId} v${b.alphafold.version} — mean pLDDT ${b.alphafold.meanPlddt}, ` +
        `${Math.round((b.alphafold.fractions?.veryHigh ?? 0) * 100)}% very high / ` +
        `${Math.round((b.alphafold.fractions?.veryLow ?? 0) * 100)}% very low. ${b.alphafold.url}`,
    );
  }
  if (b.openTargets?.found) {
    const d = (b.openTargets.topDiseases ?? []).slice(0, 5);
    lines.push(
      `- Open Targets ${b.openTargets.ensemblId}: ${b.openTargets.diseaseCount} associated diseases. ` +
        `Top: ${d.map((x) => `${x.name} (${x.score})`).join(", ")}. ${b.openTargets.url}`,
    );
    const drugs = (b.openTargets.knownDrugs ?? []).slice(0, 6);
    if (drugs.length) {
      lines.push(
        `- Known drugs (${b.openTargets.knownDrugCount} records): ` +
          drugs.map((x) => `${x.name} (Ph${x.phase}, ${x.moa})`).join("; "),
      );
    }
  }
  if (b.structures.length) {
    lines.push("- PDB entries retrieved live:");
    for (const s of b.structures) {
      lines.push(
        `  - ${s.id}: ${s.title} — ${s.method}${s.resolution ? `, ${s.resolution} Å` : ""}. ${s.url}`,
      );
    }
  }
  if (b.errors.length) lines.push(`- Retrieval gaps: ${b.errors.join("; ")}`);

  return lines.join("\n");
}
