# Agent 04 — SPR / Biochemical Binding Data

## Background

Surface Plasmon Resonance (SPR) and Bio-Layer Interferometry (BLI) are the gold standard methods for measuring antibody-antigen binding kinetics. This agent curates and analyzes published binding data.

## Key Binding Parameters

- **ka (association rate, M⁻¹s⁻¹):** How fast the antibody binds. Typical mAb: 10⁴–10⁶ M⁻¹s⁻¹
- **kd (dissociation rate, s⁻¹):** How fast it falls off. Typical mAb: 10⁻³–10⁻⁵ s⁻¹
- **KD (equilibrium constant, M):** kd/ka. Lower = tighter. Therapeutic mAbs: 10⁻⁹–10⁻¹² M
- **Hill coefficient:** Cooperative binding indicator. >1 = positive cooperativity

## Published {target_pair} Binding Data

| Molecule | Method | Target | KD / Affinity | Source |
|---|---|---|---|---|
| YG-003D3 (KiH) | BLI | {target_1} | 2,689 pM | PMC9742559 |
| YG-003D3 (KiH) | BLI | Parent Fv78 (anti-{target_1}) | 2,556 pM | PMC9742559 |
| DART bispecific (published data) | ELISA/flow | {target_1} + {target_2} | Simultaneous binding; potency ~ benchmark mAb + benchmark mAb | MacroGenics AACR poster |
| IBI323 | ELISA | PD-L1 + {target_2} | Similar to parental Abs | PMC8237984 |

## What's Typically Not Public

- Absolute ka/kd/KD for most clinical molecules (e.g., tobemstomig) remains proprietary
- **Exception:** DART bispecific SPR kinetics were published in Nature Medicine (2023, PMC10667103): {target_1} KD = 1.0 nM, {target_2} KD = 0.1 nM
- Epitope binning data — broadly proprietary for clinical molecules
- Cross-reactivity panels
- pH-dependent binding data

## Databases for Binding Data

- ChEMBL — curated bioactivity data including antibody binding
- BindingDB — protein-ligand affinities
- PDBbind — binding data for PDB structures
- PubChem BioAssay — screening data
