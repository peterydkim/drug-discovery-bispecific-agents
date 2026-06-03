# Agent 03 — Bispecific Antibody Design

## Background

Bispecific antibody design involves selecting a molecular format, engineering the binding domains, and assessing manufacturability and developability.

## Key Formats

| Format | Valency (target_1:target_2) | Fc | Size | Characteristics |
|---|---|---|---|---|
| IgG1 CrossMab (KiH) | 1:1 (bivalent) | IgG1 | ~150 kDa | Best PK, lowest aggregation. Used by tobemstomig (Roche). |
| DART | 2:2 (tetravalent) | IgG4 | ~167 kDa | Dual-affinity re-targeting. Hingeless. MW: 166.7 kDa (PMC10667103). |
| FIT-Ig | 2:2 (tetravalent) | IgG1 | ~200 kDa | Fabs-in-tandem. No mutations needed. Used by EMB-02 (EpimAb). |
| DVD-Ig | 2:2 (tetravalent) | IgG | ~200 kDa | Dual variable domain; tandem VH/VL. Steric hindrance risk. |
| Ab-ScFv | 2:2 (tetravalent) | IgG | ~175 kDa | scFv fused to HC C-terminus. scFv stability risk. |

## Format Selection Criteria

1. **Valency** — tetravalent (2+2) gives avidity advantage on dual-positive cells; bivalent (1+1) better PK
2. **Fc engineering** — IgG1 for ADCC/effector function; IgG4 for pure blocking; Fc-null if minimizing effector function
3. **Chain pairing** — KiH (knobs-into-holes) or CrossMab prevents HC and LC mispairing
4. **Developability** — aggregation tendency, thermal stability, expression yield
5. **PK** — FcRn binding determines half-life; DART (hingeless) may have shorter half-life
6. **Immunogenicity** — non-native junctions and linker sequences can trigger anti-drug antibodies

## Key PDB Structures for Design

Search PDB for each target individually. Look for:
- Apo structures of the extracellular domain
- Co-crystal structures with known blocking antibodies (from SAbDab/Thera-SAbDab)
- Ligand-bound structures showing the native binding interface to block
- AlphaFold models where experimental structures are absent

## Antibody Domain Sourcing

For each target, survey clinically validated antibodies as Fv domain sources:
- Identify FDA-approved or clinical-stage mAbs against the target
- Map their epitopes from published structures or competition data
- Assess binding affinity (KD), epitope location, and whether they block the relevant ligand interaction
- Evaluate geometric compatibility for co-engagement on dual-positive cells

## Developability Considerations

- Aggregation risk: DART format is usually lower; DVD-Ig and FIT-Ig higher due to size
- Thermal stability (Tm): >60°C preferred for manufacturing
- Expression yield: >1 g/L in CHO cells preferred
- Solubility: >50 mg/mL for subcutaneous formulation
- SAbPred TAP score: computational developability prediction