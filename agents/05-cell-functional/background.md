# Agent 05 — Cell-Based Functional Data

## Background

Biochemical binding data (SPR/BLI) tells you how well a molecule binds. Cell-based functional data tells you whether that binding actually produces a biological effect. This is the bridge between affinity and pharmacology.

## Key Cell-Based Assays for Immuno Oncology Target Bispecifics

### 1. Reporter Gene Assays
- **{target_1} blockade bioassay** (Promega): Jurkat T cells expressing {target_1} and NFAT-luciferase + {target_1}-ligand aAPC cells. Blockade of {target_1}/ligand interaction → TCR/CD3 activation → luciferase signal. Measures functional IC50.
- **{target_2} blockade bioassay**: Raji B cells (MHC-II+) + Jurkat-{target_2} reporter cells. {target_2} engagement suppresses IL-2 promoter-driven luciferase. Blockade restores signal.
- **Combination reporter bioassay**: Jurkat cells co-expressing {target_1} and {target_2} with dual luciferase reporters. Measures dual blockade in a single well.
- **Triple reporter bioassay**: Jurkat cells co-expressing {target_1}, {target_2}, and a third relevant immune receptor with triple luciferase reporters.

### 2. Primary T-Cell Functional Assays
- **Mixed Lymphocyte Reaction (MLR):** Allogeneic moDCs + CD4+ T cells. Measure IFN-γ, IL-2, TNF-α, proliferation.
- **Staphylococcal enterotoxin B (SEB) stimulation:** PBMCs + SEB superantigen. {target_2} expression peaks at 24–72h. Bispecific blockade → cytokine rescue.
- **CMV/Tetanus recall assay:** Antigen-specific memory T-cell reactivation.
- **Tumor-infiltrating lymphocyte (TIL) exhaustion reversal:** Patient-derived TILs from tumor digests. Measure cytokine restoration, proliferation, cytotoxicity.

### 3. Bridging / Avidity Assays
- **Dual-positive cell bridging:** Engineer cell lines co-expressing {target_1} and {target_2}. Measure bispecific binding vs parental mAb mix. Higher binding at lower concentration = avidity effect.
- **FRET-based proximity:** If bispecific brings {target_1} and {target_2} into proximity on the same cell surface.

### 4. Effector Function Assays
- **ADCC reporter bioassay:** Engineered Jurkat cells expressing FcγRIIIa + NFAT-luciferase. Measures Fc-mediated killing.
- **CDC assay:** Complement-dependent cytotoxicity. Relevant for IgG1 Fc formats.
- **ADCP assay:** Antibody-dependent cellular phagocytosis. Macrophage-mediated clearance.
- **ADCC/CDC bridging assay:** Combined assessment of Fc-mediated effector functions in a single readout.

### 5. Cytokine Release / Safety
- **Whole blood cytokine release assay:** Incubate bispecific with human whole blood. Measure IL-6, IL-2, IFN-γ, TNF-α. High cytokine release → CRS risk (cytokine release syndrome).
- **PBMC activation panel:** Multiplex cytokine + activation marker flow.

## Published Functional Data for {target_pair} Bispecifics

**DART bispecific:**
- Simultaneously binds {target_1}+ and {target_2}+ cells
- Blocks {target_1}/PD-L1, {target_1}/PD-L2, {target_2}/MHC-II
- Potency comparable to benchmark mAb combination
- Enhanced cytokine production from exhausted T cells vs single immune pathway blockade
- Nature Medicine (2023), PMC10667103. Monotherapy ORR 7% solid tumors, DLBCL ORR 50%, combo + margetuximab ORR 19%

**YG-003D3 (KiH format):**
- Dual binding confirmed by BLI
- Blocks all 3 ligand interactions ({target_1}/PD-L1, {target_1}/PD-L2, {target_2}/MHC-II)
- Bridges {target_1}+ and {target_2}+ cells
- Source: PMC9742559

**IBI323 (PD-L1/{target_2}):**
- Bridges PD-L1+ and {target_2}+ cells
- Blocks {target_1}/{target_1}_ligand, CD80/{target_1}_ligand, {target_2}/MHC-II
- Source: PMC8237984
- Additional functional data pending for {target_2}-mediated Treg suppression

**EMB-02 (FIT-Ig format):**
- Preclinical data published in Br J Cancer (2025) — PMID 40234667
- T-cell activation and cytokine data available

## Key Questions for Functional Analysis

1. Does the bispecific format produce better T-cell activation than the mAb combination? (avidity advantage)
2. Is there a cytokine release risk at therapeutic concentrations?
3. Does the Fc format (silent vs active) matter for functional activity?
4. Can the bispecific reverse exhaustion in TILs from actual cancer patients?
5. How does functional potency compare across formats (DART vs KiH vs FIT-Ig)?
