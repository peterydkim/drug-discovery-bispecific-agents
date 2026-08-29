# Design Decisions

## Why I Built This

I spent 20 years in pharma and biotech leading oncology programs. I saw how much time scientists lose to manual literature review, data synthesis, and competitive analysis. A single target landscape assessment can take a PhD scientist 2 or 3 weeks.

This project asks: what if an AI workflow could compress that to hours, with a repeatable pipeline that anyone on the team can run?

## What I Built vs What the AI Generated

The AI did the science content: literature search, data extraction, synthesis, analysis. I designed and built six things.

1. The architecture. I chose a 7 module pipeline that follows a real drug discovery workflow: target ID, validation, design, binding, functional, clinical. Module 07 (Experimental Data Ingestion) sits off to the side. It takes wet lab results from binding and functional assays and feeds that real data into modules 04 and 05. When experimental data comes in, those modules compare the predicted values against what was actually observed. If the gap is bigger than 3x, that kicks off the refinement loop: redesign the molecule, recheck binding, recheck function. This is the sequence drug developers actually use, not how an LLM would structure it.

2. The JSON handoff protocol. I designed the JSON schemas so each module's output is machine readable. That lets you compare numbers across iterations. The AI filled in the data. I built the containers.

3. The refinement loop. Design, binding, functional, redesign. This is how real science works. I wrote the protocol that pipes binding weaknesses and functional gaps back to the design module. The AI suggests the fixes. I defined when to iterate and when to stop.

4. The knowledge base. I put together the domain context: glossary, public database catalog, background on bispecific antibody formats and immuno oncology targets. The AI did not know which databases to search or which comparators mattered. I provided that judgment.

5. The orchestrator. I wrote the master prompt that coordinates all 7 modules, defines the handoff order, and sets the stop rules for the refinement loop.

6. Module boundaries. Deciding what goes in each module (data sources, outputs, format) took domain expertise. The AI can write content inside a module. It cannot decide that binding data belongs in module 04 and functional data belongs in module 05.

## Key Design Decisions

### Why 7 modules?

Drug discovery has natural stage gates. Keeping each stage separate means each module's prompt can be tuned on its own. Outputs stay small and easy to verify. If one module hallucinates, it does not poison the rest of the pipeline. Scientists can run individual modules (just binding analysis, or just target validation) without firing up the full pipeline.

Module 07 is separate because experimental data is optional. When a lab runs an SPR assay, you feed those results into module 04. When they run a cell based functional assay, you feed into module 05. The module does not sit in the main sequence. It sits alongside, waiting for real data to arrive.

### Why structured JSON output?

Markdown is readable by humans. JSON is readable by machines. Both formats together mean the scientist gets a report they can read, and the downstream module gets numbers it can process. Iterations become directly comparable: KD went from 1.0 nM to 0.8 nM, not "the affinity improved somewhat."

### Why a refinement loop?

In actual drug discovery, you design a molecule, test it, get data, then redesign. The refinement prompt receives specific weaknesses from binding data and functional data, then proposes targeted fixes: affinity maturation, format switching, Fc engineering. It is not "run it again." It is "run it again with instructions based on what we just learned from the last experiment."

### Why immuno oncology bispecifics as the example?

I picked this because I have deep domain knowledge from years working on bispecific antibody programs. There is a lot of public data available. And it is a case study in why strong preclinical data does not guarantee clinical success. That lesson matters for any platform selling to pharma companies.

All data is from published, public sources. Nothing proprietary was used.

### Why "modules" not "agents"?

Throughout the architecture I call these modules because they are deterministic prompt templates with structured output schemas. They do not make autonomous decisions. They do not learn from experience. They have no memory. Calling them agents suggests capabilities they do not have. The `agents/` folder name is a convention for the AI agent pattern, but in design docs I use "modules" to be precise about what they actually do.

## Lessons Learned

**Domain knowledge is still the bottleneck.** The AI writes good scientific prose and pulls data from papers. But deciding which targets to compare, which assays matter, which papers are credible: that takes a human who has done the work.

**Prompt engineering is the new scripting.** Writing good prompts for scientific analysis needs the same discipline as writing analysis code: clear inputs, defined outputs, error handling, test cases.

**Modularity beats full automation.** A pipeline where you can inspect intermediate output is more useful than a black box that spits out a final report. Scientists need to verify before they trust.

**Public data is richer than most people realize.** Open Targets, ClinVar, gnomAD, PDB, PubMed, ClinicalTrials.gov. The infrastructure for drug discovery analysis already exists in public. The bottleneck was never data availability. It was the time and expertise to synthesize it.

**The biggest gap was wet lab integration.** In real drug discovery, computational predictions get validated by experiments. My first version of this workflow was missing that loop: design, test, compare predicted versus observed, redesign. Insilico Medicine does this. Their Pharma.AI platform (used to discover Rentosertib, now in Phase IIa with positive FVC data published in Nature Medicine, June 2025) runs experiments every week and feeds results back into the AI. I added Module 07 to close this gap. It takes raw SPR data, cell based assay results, and in vivo study outputs. It checks for N, SD, and controls. It compares every experimental data point against the computational prediction from the design module. When the gap exceeds 3x, the refinement loop triggers. This is how real platforms operate: design, build, test, learn, then redesign.

## Why Module 07

Most AI drug discovery workflows only read public databases. Real drug programs run experiments every week. Module 07 bridges that gap.

It accepts almost any format. A markdown table, a JSON payload from a Biacore, a CSV from an ELISA reader, a plain English summary from a scientist. It validates before trusting. Every data point gets checked for sample size, standard deviation, and whether the controls ran in range. It compares predicted versus observed. Every experimental result is held up against what the design module said should happen. Deltas bigger than 3x trigger a redesign alert. It tracks provenance. Experiment ID, date, technician, instrument, protocol version. This is a GxP requirement for regulated work. It feeds four downstream modules. SPR binding (04), cell functional (05), and in vivo (06) all accept experimental data alongside public data. When Module 07 data is present, those modules add a predicted versus observed comparison table to their output.

Without Module 07, this workflow is a literature review tool. With it, the workflow mirrors how a real drug discovery team runs: design, test, learn, redesign.

## What Was Built After This Was Written

Three things, in response to a review of the workflow (see `REVIEW.md`):

A web app that runs the pipeline with retrieval before generation. Targets resolve
against UniProt, Open Targets, AlphaFold DB and the RCSB PDB before any agent
writes, and every output is audited for whether its numbers carry an identifier.
The refinement loop I describe above now runs in code, with the stop criteria
enforced rather than described.

An MCP server, so an agent runtime can call those same databases as tools instead
of being told a URL and recalling what is behind it.

Computed developability. pI, molecular weight, extinction coefficient, GRAVY,
charge and the PTM liability motifs are arithmetic on a sequence, so they are
computed now rather than asserted. The rest of the developability section —
predicted Tm, expression yield, aggregation — is still asserted, and still needs
a model behind it.

## What I Would Build Next

A multi target comparison module that runs the same pipeline against several target pairs at once and produces a ranked report.

A resource estimation module that estimates costs and timelines for each development path: CMC, tox, clinical.

A regulatory readiness module that maps GxP and 21 CFR Part 11 requirements onto each stage of the pipeline.

Antibody numbering, so sequence liabilities can be localised to CDRs instead of
reported position by position across the whole chain.

---

Built by Peter Kim. All AI generated content was verified against published sources. All scientific conclusions are my own.