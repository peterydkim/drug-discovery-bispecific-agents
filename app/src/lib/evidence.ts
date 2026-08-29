// Citation auditing for agent output.
//
// The pipeline's own constraint is "every data point must be traceable to a
// PMID, DOI, database accession, or URL". Nothing enforced it. This module reads
// the generated markdown, finds the quantitative claims, and checks whether an
// identifier appears close enough to the claim to plausibly be its source.
//
// It is deliberately a lint, not a verifier: a nearby PMID does not prove the
// number came from that paper. What it does catch is the common failure, which
// is a table of affinities and potencies with no identifier anywhere near it.

export interface Citation {
  kind: "pmid" | "pmc" | "doi" | "nct" | "pdb" | "uniprot" | "chembl" | "ensembl" | "url";
  id: string;
  url: string;
}

export interface Claim {
  /** The line the number appeared on, trimmed. */
  text: string;
  line: number;
  values: string[];
  cited: boolean;
  citations: Citation[];
}

export interface EvidenceReport {
  citations: Citation[];
  claims: Claim[];
  citedClaims: number;
  uncitedClaims: number;
  coverage: number;
}

const PATTERNS: { kind: Citation["kind"]; re: RegExp; url: (id: string) => string }[] = [
  {
    kind: "pmid",
    re: /\bPMID:?\s*(\d{6,9})\b/gi,
    url: (id) => `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
  },
  {
    kind: "pmc",
    re: /\b(PMC\d{6,9})\b/g,
    url: (id) => `https://pmc.ncbi.nlm.nih.gov/articles/${id}/`,
  },
  {
    kind: "doi",
    re: /\b(10\.\d{4,9}\/[-._;()/:A-Z0-9]+)/gi,
    url: (id) => `https://doi.org/${id.replace(/[.,;)]+$/, "")}`,
  },
  {
    kind: "nct",
    re: /\b(NCT\d{8})\b/g,
    url: (id) => `https://clinicaltrials.gov/study/${id}`,
  },
  {
    // PDB IDs are 4 characters starting with a digit. Require a cue word nearby
    // so ordinary tokens like "2019" are not mistaken for structures.
    kind: "pdb",
    re: /\bPDB[:\s]+([1-9][A-Z0-9]{3})\b/gi,
    url: (id) => `https://www.rcsb.org/structure/${id.toUpperCase()}`,
  },
  {
    kind: "uniprot",
    re: /\b([OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9]([A-Z][A-Z0-9]{2}[0-9]){1,2})\b/g,
    url: (id) => `https://www.uniprot.org/uniprotkb/${id}`,
  },
  {
    kind: "chembl",
    re: /\b(CHEMBL\d+)\b/gi,
    url: (id) => `https://www.ebi.ac.uk/chembl/compound_report_card/${id.toUpperCase()}/`,
  },
  {
    kind: "ensembl",
    re: /\b(ENSG\d{11})\b/g,
    url: (id) => `https://platform.opentargets.org/target/${id}`,
  },
  {
    kind: "url",
    re: /\bhttps?:\/\/[^\s)\]<>"']+/g,
    url: (id) => id,
  },
];

function citationsIn(text: string): Citation[] {
  const found = new Map<string, Citation>();
  for (const { kind, re, url } of PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const id = (m[1] ?? m[0]).replace(/[.,;]+$/, "");
      const key = `${kind}:${id.toLowerCase()}`;
      if (!found.has(key)) found.set(key, { kind, id, url: url(id) });
    }
  }
  return [...found.values()];
}

// A quantitative claim is a number carrying a unit that the pipeline actually
// trades in. Bare integers, years, and section numbers are ignored.
const QUANT =
  /(\d+(?:\.\d+)?(?:\s*[×x]\s*10[⁻\-−]?[\d⁰¹²³⁴⁵⁶⁷⁸⁹]+)?)\s*(pM|nM|µM|uM|mM|kDa|Da|%|fold|×|days?|hours?|h\b|mg\/mL|g\/L|°C|M⁻¹s⁻¹|s⁻¹)/gi;

const SKIP_LINE = /^\s*(\||#{1,6}\s|```|>\s|\d+\.\s+\[)/;

export function auditEvidence(markdown: string): EvidenceReport {
  const lines = markdown.split("\n");
  const allCitations = citationsIn(markdown);
  const claims: Claim[] = [];

  // A reference list at the end covers claims that name their source inline.
  // Scan a window around each claim rather than the whole document, so a single
  // bibliography cannot launder an entire report.
  const WINDOW = 6;

  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line || (SKIP_LINE.test(line) && !line.startsWith("|"))) return;

    QUANT.lastIndex = 0;
    const values = [...line.matchAll(QUANT)].map((m) => `${m[1]} ${m[2]}`);
    if (!values.length) return;

    const context = lines.slice(Math.max(0, i - WINDOW), i + WINDOW + 1).join("\n");
    const near = citationsIn(context).filter((c) => c.kind !== "url" || /pubmed|doi|rcsb|clinicaltrials|uniprot|ebi\.ac\.uk|alphafold/i.test(c.url));

    claims.push({
      text: line.length > 240 ? line.slice(0, 240) + "…" : line,
      line: i + 1,
      values,
      cited: near.length > 0,
      citations: near.slice(0, 4),
    });
  });

  const citedClaims = claims.filter((c) => c.cited).length;
  return {
    citations: allCitations,
    claims,
    citedClaims,
    uncitedClaims: claims.length - citedClaims,
    coverage: claims.length ? citedClaims / claims.length : 1,
  };
}

/** Pulls the last fenced JSON block out of an agent report. */
export function extractJson(markdown: string): { json: unknown | null; error?: string } {
  const blocks = [...markdown.matchAll(/```json\s*\n([\s\S]*?)```/g)].map((m) => m[1]);
  if (!blocks.length) {
    // Some models drop the language tag; fall back to the last fenced block that
    // parses as an object.
    const anyBlocks = [...markdown.matchAll(/```\s*\n([\s\S]*?)```/g)].map((m) => m[1]);
    for (const b of anyBlocks.reverse()) {
      try {
        const parsed = JSON.parse(b);
        if (parsed && typeof parsed === "object") return { json: parsed };
      } catch {
        /* keep looking */
      }
    }
    return { json: null, error: "No JSON block found in the report." };
  }
  const last = blocks[blocks.length - 1];
  try {
    return { json: JSON.parse(last) };
  } catch (e) {
    return { json: null, error: `JSON block failed to parse: ${(e as Error).message}` };
  }
}
