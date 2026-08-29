import { useState } from "react";
import { bio, type TargetBrief, briefTarget } from "../lib/bio";
import { analyseSequence, developabilityFlags, plddtBand, cleanSequence } from "../lib/insilico";
import { StructureViewer, ConfidenceTrack } from "./Structure";

type Tone = "pass" | "watch" | "fail";
const Pill = ({ tone, children }: { tone: Tone; children: React.ReactNode }) => (
  <span className={`pill ${tone}`}>{children}</span>
);

// ── Target briefing ────────────────────────────────────────────────────────────

function TargetPanel() {
  const [gene, setGene] = useState("PDCD1");
  const [busy, setBusy] = useState(false);
  const [brief, setBrief] = useState<TargetBrief | null>(null);
  const [pdb, setPdb] = useState<string>("");
  const [err, setErr] = useState("");

  const run = async () => {
    setBusy(true);
    setErr("");
    setPdb("");
    setBrief(null);
    try {
      const b = await briefTarget(gene.trim().toUpperCase(), `${gene.trim()} antibody Fab complex`);
      setBrief(b);
      if (b.alphafold?.pdbUrl) {
        setPdb(await bio.coordinates(b.alphafold.pdbUrl));
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const af = brief?.alphafold;
  const band = af?.meanPlddt != null ? plddtBand(af.meanPlddt) : null;

  return (
    <section className="card">
      <h3>Target briefing</h3>
      <p className="hint">
        Resolves an HGNC symbol against UniProt, AlphaFold DB, Open Targets and the RCSB PDB. This
        is the block the design agent receives as grounding.
      </p>
      <div className="row">
        <input
          value={gene}
          onChange={(e) => setGene(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && run()}
          placeholder="Gene symbol, e.g. PDCD1"
          spellCheck={false}
        />
        <button onClick={run} disabled={busy || !gene.trim()}>
          {busy ? "Retrieving…" : "Retrieve"}
        </button>
      </div>
      {err && <p className="error">{err}</p>}

      {brief && (
        <div className="brief">
          {brief.uniprot?.found ? (
            <div className="kv">
              <span>UniProt</span>
              <span>
                <a href={brief.uniprot.url} target="_blank" rel="noreferrer">
                  {brief.uniprot.accession}
                </a>{" "}
                · {brief.uniprot.proteinName} · {brief.uniprot.length} aa
              </span>
            </div>
          ) : (
            <div className="kv">
              <span>UniProt</span>
              <span className="muted">no reviewed human entry</span>
            </div>
          )}

          {af?.found && (
            <>
              <div className="kv">
                <span>AlphaFold</span>
                <span>
                  <a href={af.url} target="_blank" rel="noreferrer">
                    {af.modelId}
                  </a>{" "}
                  v{af.version} · mean pLDDT {af.meanPlddt}{" "}
                  {band && <Pill tone={band.tone as Tone}>{band.label}</Pill>}
                </span>
              </div>
              <div className="kv">
                <span>Confidence split</span>
                <span className="muted">
                  {Math.round((af.fractions?.veryHigh ?? 0) * 100)}% very high ·{" "}
                  {Math.round((af.fractions?.confident ?? 0) * 100)}% confident ·{" "}
                  {Math.round((af.fractions?.low ?? 0) * 100)}% low ·{" "}
                  {Math.round((af.fractions?.veryLow ?? 0) * 100)}% very low
                </span>
              </div>
            </>
          )}

          {brief.openTargets?.found && (
            <>
              <div className="kv">
                <span>Open Targets</span>
                <span>
                  <a href={brief.openTargets.url} target="_blank" rel="noreferrer">
                    {brief.openTargets.ensemblId}
                  </a>{" "}
                  · {brief.openTargets.diseaseCount} associations ·{" "}
                  {brief.openTargets.knownDrugCount} known-drug records
                </span>
              </div>
              <div className="kv">
                <span>Top associations</span>
                <span className="muted">
                  {(brief.openTargets.topDiseases ?? [])
                    .slice(0, 5)
                    .map((d) => `${d.name} (${d.score})`)
                    .join(" · ")}
                </span>
              </div>
            </>
          )}

          {brief.structures.length > 0 && (
            <div className="kv">
              <span>PDB</span>
              <span className="stack">
                {brief.structures.map((s) => (
                  <a key={s.id} href={s.url} target="_blank" rel="noreferrer" className="chip">
                    {s.id}
                    <em>
                      {s.method?.replace("X-RAY DIFFRACTION", "X-ray")}
                      {s.resolution ? ` ${s.resolution} Å` : ""}
                    </em>
                  </a>
                ))}
              </span>
            </div>
          )}

          {brief.errors.length > 0 && (
            <div className="kv">
              <span>Gaps</span>
              <span className="warn">{brief.errors.join(" · ")}</span>
            </div>
          )}

          {pdb && (
            <>
              <StructureViewer pdb={pdb} colorBy="plddt" />
              <p className="hint">
                AlphaFold monomer model, coloured by pLDDT. Low-confidence regions are typically
                the signal peptide, the transmembrane segment and the disordered cytoplasmic tail —
                which is expected for a receptor and is not a defect in the model.
              </p>
            </>
          )}
        </div>
      )}
    </section>
  );
}

// ── Sequence bench ─────────────────────────────────────────────────────────────

const EXAMPLE_SCFV =
  "EIVLTQSPATLSLSPGERATLSCRASKGVSTSGYSYLHWYQQKPGQAPRLLIYLASYLESGVPARFSGSGSGTDFTLTISSLEPEDFAVYYCQHSRDLPLTFGGGTKVEIK" +
  "GGGGSGGGGSGGGGS" +
  "QVQLVQSGVEVKKPGASVKVSCKASGYTFTNYYMYWVRQAPGQGLEWMGGINPSNGGTNFNEKFKNRVTLTTDSSTTTAYMELKSLQFDDTAVYYCARRDYRFDMGFDYWGQGTTVTVSS";

function SequencePanel() {
  const [seq, setSeq] = useState(EXAMPLE_SCFV);
  const [folding, setFolding] = useState(false);
  const [fold, setFold] = useState<{ pdb: string; mean: number; track: number[]; model: string } | null>(null);
  const [err, setErr] = useState("");

  const clean = cleanSequence(seq);
  const report = analyseSequence(seq);
  const flags = developabilityFlags(report);

  const runFold = async () => {
    setFolding(true);
    setErr("");
    setFold(null);
    try {
      const r = await bio.esmfold(clean);
      setFold({
        pdb: r.pdb,
        mean: r.confidence?.mean ?? 0,
        track: r.confidence?.track ?? [],
        model: r.model,
      });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setFolding(false);
    }
  };

  return (
    <section className="card">
      <h3>Sequence bench</h3>
      <p className="hint">
        Paste an scFv, VH, VL or antigen ectodomain. Everything on the left is computed
        arithmetically from the sequence — no model, no guess. Folding calls the public ESMFold
        endpoint.
      </p>

      <textarea
        value={seq}
        onChange={(e) => setSeq(e.target.value)}
        spellCheck={false}
        rows={6}
        placeholder="Paste a protein sequence or FASTA…"
      />
      <div className="row between">
        <span className="muted">{clean.length} residues</span>
        <div className="row">
          <button className="ghost" onClick={() => setSeq(EXAMPLE_SCFV)}>
            Load example scFv
          </button>
          <button onClick={runFold} disabled={folding || clean.length < 20 || clean.length > 400}>
            {folding ? "Folding… (~20 s)" : "Fold with ESMFold"}
          </button>
        </div>
      </div>
      {clean.length > 400 && (
        <p className="warn">
          The public ESMFold endpoint caps at 400 residues. Split the construct into VH and VL, or
          run ESMFold / ABodyBuilder2 locally.
        </p>
      )}
      {err && <p className="error">{err}</p>}

      {!report.valid && report.error && <p className="error">{report.error}</p>}

      {report.valid && (
        <div className="split">
          <div>
            <h4>Computed properties</h4>
            <table className="data">
              <tbody>
                <tr>
                  <td>Molecular weight</td>
                  <td>{report.molecularWeightKDa} kDa</td>
                </tr>
                <tr>
                  <td>Theoretical pI</td>
                  <td>{report.theoreticalPI}</td>
                </tr>
                <tr>
                  <td>Net charge at pH 7.4</td>
                  <td>{report.netChargeAtPH74 > 0 ? `+${report.netChargeAtPH74}` : report.netChargeAtPH74}</td>
                </tr>
                <tr>
                  <td>ε₂₈₀ (cystine)</td>
                  <td>{report.extinctionCoeffCystine.toLocaleString()} M⁻¹cm⁻¹</td>
                </tr>
                <tr>
                  <td>A₂₈₀ at 1 g/L</td>
                  <td>{report.a280OneGramPerLitre}</td>
                </tr>
                <tr>
                  <td>GRAVY</td>
                  <td>{report.gravy}</td>
                </tr>
                <tr>
                  <td>Aliphatic index</td>
                  <td>{report.aliphaticIndex}</td>
                </tr>
                <tr>
                  <td>Cysteines</td>
                  <td>
                    {report.cysteineCount}
                    {report.unpairedCysteine && <> — <span className="warn">odd count</span></>}
                  </td>
                </tr>
              </tbody>
            </table>

            <h4>Developability triage</h4>
            <table className="data">
              <tbody>
                {flags.map((f) => (
                  <tr key={f.metric}>
                    <td>{f.metric}</td>
                    <td>
                      {f.value} <Pill tone={f.verdict}>{f.verdict}</Pill>
                      <div className="basis">{f.basis}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div>
            <h4>
              Sequence liabilities{" "}
              <span className="muted">({report.liabilities.length} sites)</span>
            </h4>
            {report.liabilities.length === 0 ? (
              <p className="muted">No PTM or chemical-degradation motifs found.</p>
            ) : (
              <div className="liabilities">
                {(["high", "moderate", "low"] as const).map((risk) => {
                  const hits = report.liabilities.filter((l) => l.risk === risk);
                  if (!hits.length) return null;
                  return (
                    <div key={risk}>
                      <strong className={`risk-${risk}`}>{risk} risk — {hits.length}</strong>
                      <div className="chips">
                        {hits.slice(0, 40).map((l, i) => (
                          <span key={i} className={`chip risk-${risk}`} title={l.label}>
                            {l.motif}
                            <em>{l.position}</em>
                          </span>
                        ))}
                        {hits.length > 40 && <span className="muted">+{hits.length - 40} more</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <p className="hint">
              Positions are sequence-wide. Localising these to CDRs, where they actually threaten
              the paratope, needs IMGT/Kabat numbering — see the Integrations tab for the ANARCI
              service that closes this gap.
            </p>

            {fold && (
              <>
                <h4>
                  ESMFold model{" "}
                  <Pill tone={plddtBand(fold.mean).tone as Tone}>
                    mean pLDDT {fold.mean} · {plddtBand(fold.mean).label}
                  </Pill>
                </h4>
                <StructureViewer pdb={fold.pdb} colorBy="plddt" height={280} />
                <ConfidenceTrack track={fold.track} />
                <div className="row">
                  <button
                    className="ghost sm"
                    onClick={() => {
                      const blob = new Blob([fold.pdb], { type: "chemical/x-pdb" });
                      const a = document.createElement("a");
                      a.href = URL.createObjectURL(blob);
                      a.download = "esmfold-model.pdb";
                      a.click();
                      URL.revokeObjectURL(a.href);
                    }}
                  >
                    Download PDB
                  </button>
                  <span className="muted">{fold.model}</span>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

// ── Literature and trial lookups ───────────────────────────────────────────────

function EvidencePanel() {
  const [q, setQ] = useState("PD-1 LAG-3 bispecific antibody");
  const [busy, setBusy] = useState(false);
  const [pm, setPm] = useState<Awaited<ReturnType<typeof bio.pubmed>> | null>(null);
  const [ct, setCt] = useState<Awaited<ReturnType<typeof bio.trials>> | null>(null);
  const [err, setErr] = useState("");

  const run = async () => {
    setBusy(true);
    setErr("");
    try {
      const [a, b] = await Promise.all([bio.pubmed(q, 10), bio.trials(q, 12)]);
      setPm(a);
      setCt(b);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <h3>Evidence lookup</h3>
      <p className="hint">
        PubMed and ClinicalTrials.gov, queried directly. Use it to spot-check any citation an agent
        produced.
      </p>
      <div className="row">
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && run()} />
        <button onClick={run} disabled={busy}>
          {busy ? "Searching…" : "Search"}
        </button>
      </div>
      {err && <p className="error">{err}</p>}
      <div className="split">
        {pm && (
          <div>
            <h4>PubMed · {pm.count.toLocaleString()} hits</h4>
            <ul className="list">
              {pm.articles.map((a) => (
                <li key={a.pmid}>
                  <a href={a.url} target="_blank" rel="noreferrer">
                    {a.title}
                  </a>
                  <div className="muted">
                    {a.journal} {a.year} · PMID {a.pmid}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
        {ct && (
          <div>
            <h4>ClinicalTrials.gov · {ct.studies.length} shown</h4>
            <ul className="list">
              {ct.studies.map((s) => (
                <li key={s.nctId}>
                  <a href={s.url} target="_blank" rel="noreferrer">
                    {s.title}
                  </a>
                  <div className="muted">
                    {s.nctId} · {s.phases.join("/") || "N/A"} · {s.status}
                    {s.sponsor ? ` · ${s.sponsor}` : ""}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

export function Bench() {
  return (
    <div className="stack-lg">
      <TargetPanel />
      <SequencePanel />
      <EvidencePanel />
    </div>
  );
}
