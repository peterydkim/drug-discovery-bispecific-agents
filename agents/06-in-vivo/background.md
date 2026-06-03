# Agent 06 — In Vivo & Clinical Data

## Background

In vivo pharmacology and clinical trial data represent the ultimate validation of a drug target and molecule. This agent synthesizes animal model data and the clinical trial landscape.

## Key Sources

**Clinical Trial Registries:**
- ClinicalTrials.gov — 480K+ studies, full API
- EU Clinical Trials Register
- WHO ICTRP

**Published Clinical Data:**
- PubMed / PMC — peer-reviewed results
- ASCO, ESMO, AACR abstracts — early data
- FDA review documents — detailed clinical pharmacology
- Company press releases — interim data, regulatory updates

## Known Clinical Landscape for {target_pair}

### Approved
- **Approved combo** (anti-{target_1} + anti-{target_2}), sponsor — approved indication, year

### Phase 3
- **Lead bispecific** — sponsor — bispecific for {target_pair}
  - Lead indication data summary
  - Phase 3 in major indication

### Phase 2
- **anti-{target_2} + anti-{target_1} mAb combo** (sponsor) — anti-{target_2} + anti-{target_1} mAb combo, not bispecific
  - Promising Phase 1/2 data

### Phase 1 (completed / deprioritized)
- **{format} bispecific (published data)** — DART format
  - ORR in biomarker-high tumors
  - Deprioritized from pipeline
- **EMB-02** — EpimAb FIT-Ig
  - ORR, CBR-24 data
- **{target_ligand} × {target_2} bispecific** — sponsor
  - Phase 1 in solid tumors

### Key Clinical Failures / Setbacks
- **Adjuvant combo** — failed primary endpoint
- **Bispecific deprioritization** — despite Phase 1 data, not advanced to Phase 2
- **Combo failure in major indication** — didn't meet primary endpoint
- **Bintrafusp alfa** — {target_ligand} × TGFβR2 bispecific failed Phase 3; not {target_2} but a relevant bispecific cautionary tale

## In Vivo Preclinical Models

**Standard tumor models:**
- MC38 (colon) — C57BL/6 syngeneic, responsive to anti-{target_1} blockade
- B16-F10 (melanoma) — C57BL/6, poorly immunogenic
- CT26 (colon) — BALB/c, immunogenic
- A20 (B-cell lymphoma) — BALB/c

**Humanized mouse models:**
- Hu-PBMC or Hu-CD34+ engrafted NSG mice
- PDX (patient-derived xenograft) with human immune reconstitution

**Endpoints:**
- Tumor growth inhibition (TGI%)
- Complete response rate
- Survival
- Tumor-infiltrating lymphocyte (TIL) analysis
- Pharmacodynamic markers: Ki67+ CD8+ T cells, IFN-γ gene signature

## Key Questions

1. What is the clinical efficacy benchmark for {target_pair} (vs anti-{target_1} mono, vs the most toxic comparator combination)?
2. Does the bispecific format show clinical advantage over co-administration of the two mAbs?
3. Why did the tetravalent bispecific (avidity advantage) underperform?
4. Is the {target_2} contribution to efficacy limited to specific tumor types?
5. What is the competitive window — are there better immuno-oncology target pairs emerging (TIGIT, TIM-3)?
