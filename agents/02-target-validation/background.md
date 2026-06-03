# Agent 02 — Target Validation

## Background

Target validation confirms that modulating a target produces the desired therapeutic effect with acceptable safety. For oncology targets, validation involves:

1. **Genetic evidence** — human genetics linking target variants to disease risk or protection
2. **Functional evidence** — animal models, knockdown/knockout, in vivo pharmacology
3. **Pharmacological evidence** — approved drugs or clinical-stage molecules against the target
4. **Safety evidence** — toxicity from target modulation, normal tissue expression
5. **Epidemiological evidence** — population-level data on target-associated outcomes

Key tools:
- gnomAD — loss-of-function tolerance (pLI, LOEUF scores). Low LOEUF means the target can't tolerate LoF, so it may be essential.
- ClinVar — clinically significant variants. Pathogenic variants in target indicate disease link.
- ClinGen — expert-panel gene-disease validity assessments
- Open Targets validation track — combines multiple orthogonal validation data types

## Target Validation Assessment Framework

For each target in the pair, evaluate:

### Genetic Evidence
- Check gnomAD for pLI and LOEUF scores. Immuno oncology targets often show tolerance to heterozygous LoF since their regulatory function is dominant rather than dose-dependent.
- Search ClinVar for clinically significant variants linked to disease phenotypes.
- Cross-reference GWAS associations through Open Targets Genetics.
- Review ClinGen gene-disease validity curations for expert-panel assessments.

### Functional Evidence
- Examine knockout and transgenic animal model data. Key questions:
  - Does loss of the target produce a disease-relevant phenotype?
  - Is the KO viable or lethal? Embryonic lethality suggests essential function and narrow therapeutic window.
  - Does the phenotype match the intended therapeutic direction?
  - Does dual KO of both targets show cooperative biology without compounding toxicity?

### Pharmacological Evidence
- Catalog FDA-approved drugs and clinical-stage programs against each target.
- Assess the highest clinical phase achieved and breadth of validated indications.
- Determine whether each target has been de-risked by clinical exposure (number of patients treated, years on market).

### Safety Evidence
- Characterize class-effect toxicities from approved modulators.
- Review reversibility of adverse events and management strategies.
- Assess combined safety profile when both targets are modulated together vs sequential or monotherapy approaches.

### Validation Gaps
- Flag any targets where human loss-of-function phenotypes are absent or unknown.
- Note where functional evidence relies entirely on animal models or in vitro pharmacology.
- Identify resistance mechanisms and patient populations likely to respond vs relapse.