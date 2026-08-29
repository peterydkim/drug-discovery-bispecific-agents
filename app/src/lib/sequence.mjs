// Deterministic sequence analytics — shared by the web app and the MCP server.
//
// Plain JavaScript so mcp/server.mjs can import it directly under Node while the
// app's insilico.ts re-exports it with TypeScript types. One implementation, two
// consumers, no drift.
//
// Deterministic sequence analytics.
//
// Everything in this file is arithmetic on a sequence — no model, no LLM, no
// network. That is the point: the pipeline's developability section currently
// asserts pI, aggregation risk and expression yield in prose, and nothing checks
// it. These functions produce the subset of those numbers that can be computed
// exactly, so the report can separate "computed" from "asserted".
//
// Methods follow ExPASy ProtParam (Gasteiger et al., 2005, The Proteomics
// Protocols Handbook, pp. 571-607) and Pace et al. 1995 (Protein Sci 4:2411) for
// the extinction coefficient.

/** Average residue masses in Da (monomer mass minus water). */
const RESIDUE_MASS = {
  A: 71.0788, R: 156.1875, N: 114.1038, D: 115.0886, C: 103.1388,
  E: 129.1155, Q: 128.1307, G: 57.0519, H: 137.1411, I: 113.1594,
  L: 113.1594, K: 128.1741, M: 131.1926, F: 147.1766, P: 97.1167,
  S: 87.0782, T: 101.1051, W: 186.2132, Y: 163.1760, V: 99.1326,
};
const WATER = 18.01524;

/** Kyte & Doolittle 1982 hydropathy. */
const KD = {
  A: 1.8, R: -4.5, N: -3.5, D: -3.5, C: 2.5, E: -3.5, Q: -3.5, G: -0.4,
  H: -3.2, I: 4.5, L: 3.8, K: -3.9, M: 1.9, F: 2.8, P: -1.6, S: -0.8,
  T: -0.7, W: -0.9, Y: -1.3, V: 4.2,
};

/** EMBOSS pK values, as used by ProtParam. */
const PK = {
  nTerm: 8.6, cTerm: 3.6,
  positive: { K: 10.8, R: 12.5, H: 6.5 },
  negative: { D: 3.9, E: 4.1, C: 8.5, Y: 10.1 },
};

const VALID = new Set(Object.keys(RESIDUE_MASS));

export function cleanSequence(raw) {
  // Accept FASTA: drop any header lines, then all non-letters.
  return raw
    .split("\n")
    .filter((l) => !l.startsWith(">"))
    .join("")
    .replace(/[^A-Za-z]/g, "")
    .toUpperCase();
}

function netCharge(counts, pH, length) {
  let charge = 0;
  // Termini
  charge += 1 / (1 + 10 ** (pH - PK.nTerm));
  charge -= 1 / (1 + 10 ** (PK.cTerm - pH));
  for (const [aa, pk] of Object.entries(PK.positive)) {
    charge += (counts[aa] ?? 0) / (1 + 10 ** (pH - pk));
  }
  for (const [aa, pk] of Object.entries(PK.negative)) {
    charge -= (counts[aa] ?? 0) / (1 + 10 ** (pk - pH));
  }
  return length ? charge : 0;
}

function isoelectricPoint(counts, length) {
  let lo = 0;
  let hi = 14;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (netCharge(counts, mid, length) > 0) lo = mid;
    else hi = mid;
  }
  return Math.round(((lo + hi) / 2) * 100) / 100;
}

/**
 * Sequence liabilities that matter for a biologic: post-translational
 * modification hotspots and chemistry that shows up as heterogeneity on a
 * stability study. Positions are 1-based.
 */
export function findLiabilities(seq) {
  const hits = [];
  const push = (motif, position, risk, label) =>
    hits.push({ motif, position, risk, label });

  for (let i = 0; i < seq.length; i++) {
    const a = seq[i];
    const b = seq[i + 1];
    const c = seq[i + 2];
    const pos = i + 1;

    // N-linked glycosylation sequon N-X-S/T where X is not proline.
    if (a === "N" && b && b !== "P" && (c === "S" || c === "T")) {
      push(`${a}${b}${c}`, pos, "high", "N-glycosylation sequon");
    }
    // Asparagine deamidation — NG is the fast one.
    if (a === "N" && b === "G") push("NG", pos, "high", "Deamidation hotspot (fast)");
    else if (a === "N" && (b === "S" || b === "T" || b === "N" || b === "H")) {
      push(`N${b}`, pos, "moderate", "Deamidation hotspot");
    }
    // Aspartate isomerisation.
    if (a === "D" && b === "G") push("DG", pos, "high", "Isomerisation hotspot");
    else if (a === "D" && (b === "S" || b === "T" || b === "D")) {
      push(`D${b}`, pos, "moderate", "Isomerisation hotspot");
    }
    // Acid-catalysed backbone cleavage.
    if (a === "D" && b === "P") push("DP", pos, "moderate", "Acid-labile peptide bond");
    // Oxidation-prone residues.
    if (a === "M") push("M", pos, "moderate", "Methionine oxidation");
    if (a === "W") push("W", pos, "low", "Tryptophan oxidation");
    // Free thiol / scrambling risk is reported separately via cysteine parity.
  }
  return hits;
}

export function analyseSequence(raw) {
  const seq = cleanSequence(raw);
  const empty = {
    valid: false, length: 0, molecularWeightDa: 0, molecularWeightKDa: 0,
    theoreticalPI: 0, netChargeAtPH74: 0, extinctionCoeffReduced: 0,
    extinctionCoeffCystine: 0, a280OneGramPerLitre: 0, gravy: 0,
    aliphaticIndex: 0, aromaticity: 0, cysteineCount: 0,
    unpairedCysteine: false, composition: {}, liabilities: [],
  };

  if (!seq.length) return { ...empty, error: "Empty sequence." };
  const invalid = [...new Set([...seq].filter((c) => !VALID.has(c)))];
  if (invalid.length) {
    return { ...empty, error: `Non-standard residue(s): ${invalid.join(", ")}` };
  }

  const counts = {};
  for (const c of seq) counts[c] = (counts[c] ?? 0) + 1;

  const mass = [...seq].reduce((sum, c) => sum + RESIDUE_MASS[c], 0) + WATER;
  const W = counts.W ?? 0;
  const Y = counts.Y ?? 0;
  const C = counts.C ?? 0;
  // Pace et al. 1995: Trp 5500, Tyr 1490, cystine 125 M^-1 cm^-1.
  const extReduced = W * 5500 + Y * 1490;
  const extCystine = extReduced + Math.floor(C / 2) * 125;

  const gravy = [...seq].reduce((s, c) => s + KD[c], 0) / seq.length;
  const f = (aa) => (counts[aa] ?? 0) / seq.length;
  // Ikai 1980 aliphatic index.
  const aliphatic = (f("A") * 100 + 2.9 * f("V") * 100 + 3.9 * (f("I") + f("L")) * 100);

  return {
    valid: true,
    length: seq.length,
    molecularWeightDa: Math.round(mass * 100) / 100,
    molecularWeightKDa: Math.round((mass / 1000) * 100) / 100,
    theoreticalPI: isoelectricPoint(counts, seq.length),
    netChargeAtPH74: Math.round(netCharge(counts, 7.4, seq.length) * 10) / 10,
    extinctionCoeffReduced: extReduced,
    extinctionCoeffCystine: extCystine,
    a280OneGramPerLitre: Math.round((extCystine / mass) * 1000) / 1000,
    gravy: Math.round(gravy * 1000) / 1000,
    aliphaticIndex: Math.round(aliphatic * 10) / 10,
    aromaticity: Math.round(((W + Y + (counts.F ?? 0)) / seq.length) * 1000) / 1000,
    cysteineCount: C,
    unpairedCysteine: C % 2 === 1,
    composition: counts,
    liabilities: findLiabilities(seq),
  };
}

/**
 * Coarse developability flags derived only from computed values. Thresholds are
 * the ones commonly used for platform mAb screening; they are heuristics for
 * triage, not a substitute for TAP, CamSol or a wet-lab stability study.
 */
export function developabilityFlags(r) {
  if (!r.valid) return [];
  const flags = [];

  const pi = r.theoreticalPI;
  flags.push({
    metric: "Theoretical pI",
    value: pi.toFixed(2),
    verdict: pi >= 6.5 && pi <= 9.0 ? "pass" : pi < 5.5 || pi > 9.5 ? "fail" : "watch",
    basis: "Approved mAbs cluster at pI 6.5-9.0; outside that range raises formulation and clearance risk.",
  });

  flags.push({
    metric: "GRAVY (hydropathy)",
    value: r.gravy.toFixed(3),
    verdict: r.gravy < -0.2 ? "pass" : r.gravy < 0 ? "watch" : "fail",
    basis: "Soluble antibody domains are net hydrophilic. GRAVY above 0 flags aggregation-prone surface.",
  });

  flags.push({
    metric: "Free cysteine",
    value: `${r.cysteineCount} Cys${r.unpairedCysteine ? " (odd count)" : ""}`,
    verdict: r.unpairedCysteine ? "fail" : "pass",
    basis: "An odd cysteine count implies a free thiol: disulfide scrambling and covalent dimer risk.",
  });

  const glyc = r.liabilities.filter((l) => l.label.startsWith("N-glyc")).length;
  flags.push({
    metric: "N-glycosylation sequons",
    value: String(glyc),
    verdict: glyc === 0 ? "pass" : glyc <= 1 ? "watch" : "fail",
    basis: "Sequons in the variable domain give glycoform heterogeneity and can occlude the paratope.",
  });

  const highRisk = r.liabilities.filter((l) => l.risk === "high").length;
  flags.push({
    metric: "High-risk PTM motifs",
    value: String(highRisk),
    verdict: highRisk === 0 ? "pass" : highRisk <= 2 ? "watch" : "fail",
    basis: "NG deamidation and DG isomerisation drive charge-variant growth on stability.",
  });

  return flags;
}

/** Confidence banding used for both AlphaFold and ESMFold pLDDT. */
export function plddtBand(v) {
  if (v >= 90) return { label: "Very high", tone: "pass" };
  if (v >= 70) return { label: "Confident", tone: "watch" };
  if (v >= 50) return { label: "Low", tone: "fail" };
  return { label: "Very low / disordered", tone: "fail" };
}
