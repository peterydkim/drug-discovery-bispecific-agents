"""Single-pass runner for the bispecific antibody discovery pipeline.

    python run_pipeline.py PDCD1 LAG3 "metastatic melanoma"

WHAT THIS DOES
    Resolves both targets against UniProt, Open Targets, AlphaFold DB and the
    RCSB PDB, injects those records into the prompts as grounding, then runs
    agents 01 through 06 in sequence. Each agent's markdown report and its
    parsed JSON block are written to output/iterations/i0/.

WHAT THIS DOES NOT DO
    - No refinement loop. Agents 03/04/05 run once. The design-build-test cycle
      lives in the web app and the orchestrator prompt, not here.
    - No module 07. Wet-lab ingestion is not wired into this script.
    - No web search. Grounding covers targets, structures and associations.
      Affinity and functional values still come from the model's own knowledge,
      so treat every number as a claim to verify, not a measurement.

    For the full loop, use the web app (app/) or the MCP server (mcp/server.mjs).

REQUIREMENTS
    Python 3.9+. No third-party packages.
    Set ANTHROPIC_API_KEY or OPENAI_API_KEY. Whichever is present is used;
    Anthropic wins if both are set. Override with --provider / --model.
"""

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path

REPO_ROOT = Path(__file__).parent
AGENTS_DIR = REPO_ROOT / "agents"
KNOWLEDGE_DIR = REPO_ROOT / "knowledge"
OUTPUT_DIR = REPO_ROOT / "output"
ITERATIONS_DIR = OUTPUT_DIR / "iterations"

AGENT_SEQUENCE = [
    {"id": "01", "name": "target-id", "dir": "agents/01-target-id", "ground": True},
    {"id": "02", "name": "target-validation", "dir": "agents/02-target-validation", "ground": False},
    {"id": "03", "name": "bispecific-design", "dir": "agents/03-bispecific-design", "ground": True},
    {"id": "04", "name": "spr-binding", "dir": "agents/04-spr-binding", "ground": False},
    {"id": "05", "name": "cell-functional", "dir": "agents/05-cell-functional", "ground": False},
    {"id": "06", "name": "in-vivo", "dir": "agents/06-in-vivo", "ground": False},
]

KNOWLEDGE_FILES = ["knowledge/glossary.md", "knowledge/public-databases.md"]

SYSTEM_PROMPT = (
    "You are a drug discovery AI agent operating inside a staged, auditable pipeline. "
    "Every quantitative claim must carry a traceable identifier on the same line or in the "
    "adjacent row: a PMID, PMC ID, DOI, NCT number, PDB ID, UniProt accession, or database URL. "
    "If a number is not in a source you can name, do not state it. Write 'not established in "
    "public data' and add it to the gaps list instead. A named gap is a correct answer; an "
    "invented value is a defect. "
    "A 'Retrieved reference data' block, when present, was fetched live from the named database "
    "immediately before this call. Treat it as ground truth and prefer it over recall. "
    "Close every report with a numbered reference list, then the fenced JSON block in the schema "
    "the prompt specifies. The JSON must parse."
)

USER_AGENT = "drug-discovery-bispecific-agents/1.0 (run_pipeline.py)"


# ── HTTP helpers ─────────────────────────────────────────────────────────────


def _request(url, data=None, headers=None, timeout=60):
    req = urllib.request.Request(url, data=data, headers={"user-agent": USER_AGENT, **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return res.read().decode("utf-8")


def get_json(url, timeout=60):
    return json.loads(_request(url, timeout=timeout))


def post_json(url, payload, headers=None, timeout=300):
    body = json.dumps(payload).encode("utf-8")
    merged = {"content-type": "application/json", **(headers or {})}
    return json.loads(_request(url, data=body, headers=merged, timeout=timeout))


# ── Retrieval ────────────────────────────────────────────────────────────────
#
# Mirrors mcp/server.mjs. Grounding is a flat retrieval function, so it can live
# in both places without the two drifting; the pipeline DAG deliberately does not.


def fetch_uniprot(gene):
    q = urllib.parse.urlencode(
        {
            "query": f"gene_exact:{gene} AND organism_id:9606 AND reviewed:true",
            "fields": "accession,id,protein_name,length,ft_domain,ft_topo_dom",
            "format": "json",
            "size": "1",
        }
    )
    data = get_json(f"https://rest.uniprot.org/uniprotkb/search?{q}")
    results = data.get("results") or []
    if not results:
        return None
    hit = results[0]
    domains = [
        {
            "description": f.get("description"),
            "start": (f.get("location") or {}).get("start", {}).get("value"),
            "end": (f.get("location") or {}).get("end", {}).get("value"),
        }
        for f in hit.get("features", [])
        if f.get("type") in ("Domain", "Topological domain")
    ]
    return {
        "accession": hit.get("primaryAccession"),
        "entry_name": hit.get("uniProtkbId"),
        "protein_name": (((hit.get("proteinDescription") or {}).get("recommendedName") or {}).get("fullName") or {}).get("value"),
        "length": (hit.get("sequence") or {}).get("length"),
        "domains": domains[:6],
        "url": f"https://www.uniprot.org/uniprotkb/{hit.get('primaryAccession')}",
    }


OPEN_TARGETS_QUERY = """
query T($q:String!){
  search(queryString:$q, entityNames:["target"], page:{index:0,size:1}){
    hits{ object{ ... on Target {
      id approvedSymbol approvedName
      proteinIds { id source }
      geneticConstraint { constraintType score exp obs }
      safetyLiabilities { event datasource }
      mousePhenotypes { modelPhenotypeLabel }
      associatedDiseases(page:{index:0,size:8}){ count rows{ score disease{ id name } } }
      drugAndClinicalCandidates {
        count
        rows { drug { id name drugType maximumClinicalStage
                      mechanismsOfAction { rows { mechanismOfAction } } } }
      }
    } } }
  }
}
"""


def fetch_open_targets(gene):
    data = post_json(
        "https://api.platform.opentargets.org/api/v4/graphql",
        {"query": OPEN_TARGETS_QUERY, "variables": {"q": gene}},
        timeout=60,
    )
    if data.get("errors"):
        raise RuntimeError(data["errors"][0]["message"].split("\n")[0])
    hits = ((data.get("data") or {}).get("search") or {}).get("hits") or []
    if not hits or not hits[0].get("object"):
        return None
    t = hits[0]["object"]
    lof = next((c for c in (t.get("geneticConstraint") or []) if c.get("constraintType") == "lof"), None)
    return {
        "ensembl_id": t.get("id"),
        "symbol": t.get("approvedSymbol"),
        "name": t.get("approvedName"),
        "uniprot": [p["id"] for p in (t.get("proteinIds") or []) if p.get("source") == "uniprot_swissprot"],
        "gnomad_lof": {"pLI": lof.get("score"), "observed": lof.get("obs"), "expected": lof.get("exp")} if lof else None,
        "safety_liabilities": [s.get("event") for s in (t.get("safetyLiabilities") or [])][:10],
        "mouse_phenotypes": sorted({m.get("modelPhenotypeLabel") for m in (t.get("mousePhenotypes") or []) if m.get("modelPhenotypeLabel")})[:12],
        "disease_count": ((t.get("associatedDiseases") or {}).get("count")) or 0,
        "top_diseases": [
            {"name": r["disease"]["name"], "score": round(r["score"], 3)}
            for r in ((t.get("associatedDiseases") or {}).get("rows") or [])
        ],
        "known_drug_count": ((t.get("drugAndClinicalCandidates") or {}).get("count")) or 0,
        "known_drugs": [
            {
                "name": (r.get("drug") or {}).get("name"),
                "type": (r.get("drug") or {}).get("drugType"),
                "max_stage": (r.get("drug") or {}).get("maximumClinicalStage"),
                "moa": "; ".join(
                    m["mechanismOfAction"]
                    for m in (((r.get("drug") or {}).get("mechanismsOfAction") or {}).get("rows") or [])
                    if m.get("mechanismOfAction")
                ),
            }
            for r in ((t.get("drugAndClinicalCandidates") or {}).get("rows") or [])
        ][:10],
        "url": f"https://platform.opentargets.org/target/{t.get('id')}",
    }


def fetch_alphafold(accession):
    data = get_json(f"https://alphafold.ebi.ac.uk/api/prediction/{accession}")
    m = data[0] if isinstance(data, list) else data
    if not m:
        return None
    return {
        "model_id": m.get("modelEntityId"),
        "version": m.get("latestVersion"),
        "mean_plddt": m.get("globalMetricValue"),
        "fraction_very_high": m.get("fractionPlddtVeryHigh"),
        "fraction_very_low": m.get("fractionPlddtVeryLow"),
        "url": f"https://alphafold.ebi.ac.uk/entry/{accession}",
    }


def fetch_pdb(query, rows=5):
    body = {
        "query": {"type": "terminal", "service": "full_text", "parameters": {"value": query}},
        "return_type": "entry",
        "request_options": {"paginate": {"start": 0, "rows": rows}},
    }
    url = "https://search.rcsb.org/rcsbsearch/v2/query?json=" + urllib.parse.quote(json.dumps(body))
    ids = [r["identifier"] for r in (get_json(url).get("result_set") or [])]
    entries = []
    for pdb_id in ids:
        try:
            d = get_json(f"https://data.rcsb.org/rest/v1/core/entry/{pdb_id}")
        except Exception:
            continue
        resolution = (d.get("rcsb_entry_info") or {}).get("resolution_combined") or [None]
        entries.append(
            {
                "id": pdb_id,
                "title": (d.get("struct") or {}).get("title"),
                "method": (d.get("exptl") or [{}])[0].get("method"),
                "resolution": resolution[0],
                "url": f"https://www.rcsb.org/structure/{pdb_id}",
            }
        )
    return entries


def ground_target(gene):
    """Resolve one gene against the public record. Failures are recorded, not raised."""
    brief = {"gene": gene, "errors": []}

    def attempt(label, fn, *args):
        try:
            return fn(*args)
        except Exception as exc:  # network, schema drift, missing entry
            brief["errors"].append(f"{label}: {exc}")
            return None

    brief["uniprot"] = attempt("UniProt", fetch_uniprot, gene)
    brief["open_targets"] = attempt("Open Targets", fetch_open_targets, gene)

    accession = None
    if brief["uniprot"]:
        accession = brief["uniprot"]["accession"]
    elif brief["open_targets"] and brief["open_targets"]["uniprot"]:
        accession = brief["open_targets"]["uniprot"][0]
    brief["alphafold"] = attempt("AlphaFold", fetch_alphafold, accession) if accession else None

    brief["structures"] = attempt("PDB", fetch_pdb, f"{gene} antibody Fab complex") or []
    return brief


def brief_to_block(b):
    lines = [f"### Retrieved reference data — {b['gene']}"]
    u = b.get("uniprot")
    if u:
        lines.append(f"- UniProt {u['accession']} ({u['entry_name']}) — {u['protein_name']}, {u['length']} aa. {u['url']}")
        if u["domains"]:
            doms = "; ".join(f"{d['description']} ({d['start']}-{d['end']})" for d in u["domains"])
            lines.append(f"- Domain architecture: {doms}")
    a = b.get("alphafold")
    if a:
        lines.append(
            f"- AlphaFold DB {a['model_id']} v{a['version']} — mean pLDDT {a['mean_plddt']}, "
            f"{round((a['fraction_very_high'] or 0) * 100)}% very high / "
            f"{round((a['fraction_very_low'] or 0) * 100)}% very low. {a['url']}"
        )
    o = b.get("open_targets")
    if o:
        lines.append(f"- Open Targets {o['ensembl_id']}: {o['disease_count']} associated diseases. {o['url']}")
        if o["top_diseases"]:
            lines.append("- Top associations: " + ", ".join(f"{d['name']} ({d['score']})" for d in o["top_diseases"]))
        if o["gnomad_lof"]:
            g = o["gnomad_lof"]
            lines.append(f"- gnomAD LoF constraint: pLI {g['pLI']}, observed {g['observed']} vs expected {g['expected']}")
        if o["safety_liabilities"]:
            lines.append("- Curated safety liabilities: " + "; ".join(o["safety_liabilities"]))
        if o["mouse_phenotypes"]:
            lines.append("- Mouse knockout phenotypes: " + "; ".join(o["mouse_phenotypes"]))
        if o["known_drugs"]:
            drugs = "; ".join(f"{d['name']} ({d['type']}, {d['max_stage']}, {d['moa']})" for d in o["known_drugs"])
            lines.append(f"- Clinical candidates ({o['known_drug_count']} records): {drugs}")
    if b.get("structures"):
        lines.append("- PDB entries retrieved live:")
        for s in b["structures"]:
            res = f", {s['resolution']} Å" if s["resolution"] else ""
            lines.append(f"  - {s['id']}: {s['title']} — {s['method']}{res}. {s['url']}")
    if b["errors"]:
        lines.append("- Retrieval gaps: " + "; ".join(b["errors"]))
    return "\n".join(lines)


# ── Model calls ──────────────────────────────────────────────────────────────

DEFAULT_MODELS = {"anthropic": "claude-opus-5", "openai": "gpt-4o"}


def resolve_provider(requested):
    if requested:
        key = os.environ.get("ANTHROPIC_API_KEY" if requested == "anthropic" else "OPENAI_API_KEY")
        if not key:
            raise SystemExit(
                f"--provider {requested} needs "
                f"{'ANTHROPIC_API_KEY' if requested == 'anthropic' else 'OPENAI_API_KEY'} to be set."
            )
        return requested, key
    if os.environ.get("ANTHROPIC_API_KEY"):
        return "anthropic", os.environ["ANTHROPIC_API_KEY"]
    if os.environ.get("OPENAI_API_KEY"):
        return "openai", os.environ["OPENAI_API_KEY"]
    raise SystemExit("Set ANTHROPIC_API_KEY or OPENAI_API_KEY before running.")


def call_llm(prompt_text, provider, api_key, model, max_tokens=8192, temperature=0.3):
    if provider == "anthropic":
        data = post_json(
            "https://api.anthropic.com/v1/messages",
            {
                "model": model,
                "max_tokens": max_tokens,
                "temperature": temperature,
                "system": SYSTEM_PROMPT,
                "messages": [{"role": "user", "content": prompt_text}],
            },
            headers={"x-api-key": api_key, "anthropic-version": "2023-06-01"},
        )
        return "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text")

    data = post_json(
        "https://api.openai.com/v1/chat/completions",
        {
            "model": model,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": prompt_text},
            ],
        },
        headers={"authorization": f"Bearer {api_key}"},
    )
    return data["choices"][0]["message"]["content"]


# ── Prompt assembly ──────────────────────────────────────────────────────────


def load(path):
    p = REPO_ROOT / path
    return p.read_text() if p.exists() else None


def substitute(text, target1, target2, disease):
    # The indication used to be accepted and then dropped, so every run was
    # silently analysed as solid tumour immunotherapy. It is substituted here,
    # including over the phrase hardcoded in several prompt files.
    for token, value in (
        ("{target_1}", target1),
        ("{target_2}", target2),
        ("{gene_1}", target1),
        ("{gene_2}", target2),
        ("{GENE1}", target1),
        ("{GENE2}", target2),
        ("{target_pair}", f"{target1}/{target2}"),
        ("{disease}", disease),
        ("{disease_indication}", disease),
        ("solid tumor immunotherapy", disease),
    ):
        text = text.replace(token, value)
    return text


def extract_json(markdown):
    """Return the last fenced JSON block that parses, or None."""
    blocks = re.findall(r"```json\s*\n(.*?)```", markdown, re.S)
    if not blocks:
        blocks = re.findall(r"```\s*\n(.*?)```", markdown, re.S)
    for block in reversed(blocks):
        try:
            parsed = json.loads(block)
            if isinstance(parsed, (dict, list)):
                return parsed
        except json.JSONDecodeError:
            continue
    return None


def build_prompt(agent, target1, target2, disease, grounding, prior_json):
    sections = []
    for kf in KNOWLEDGE_FILES:
        text = load(kf)
        if text:
            sections.append(f"## Knowledge: {Path(kf).name}\n{text}")

    background = load(f"{agent['dir']}/background.md")
    if background:
        sections.append(background)

    prompt = load(f"{agent['dir']}/prompt.md")
    if not prompt:
        raise FileNotFoundError(f"Prompt not found: {agent['dir']}/prompt.md")
    sections.append(prompt)

    sections.append(
        f"## Run parameters\n- Target 1: {target1}\n- Target 2: {target2}\n"
        f"- Disease indication: {disease}\n- Iteration: 0"
    )

    if agent["ground"] and grounding:
        sections.append(
            "## Retrieved reference data (live, this run)\n"
            "Fetched from UniProt, Open Targets, AlphaFold DB and the RCSB PDB moments ago. "
            "Use these values and accessions directly.\n\n" + grounding
        )

    # Every prior agent's JSON, not just the immediate predecessor. Agent 06 is
    # told to synthesise all prior output; previously it only ever saw agent 05.
    if prior_json:
        handoff = "\n\n".join(
            f"#### Structured output — agent {aid}\n```json\n{json.dumps(payload, indent=2)}\n```"
            for aid, payload in prior_json
        )
        sections.append(f"## Upstream structured output\n{handoff}")

    return substitute("\n\n---\n\n".join(sections), target1, target2, disease)


# ── Runner ───────────────────────────────────────────────────────────────────


def run_pipeline(target1, target2, disease, provider=None, model=None, grounding=True):
    provider, api_key = resolve_provider(provider)
    model = model or DEFAULT_MODELS[provider]
    slug = f"{target1}-{target2}".lower().replace(" ", "-").replace("/", "-")
    out_dir = ITERATIONS_DIR / "i0"
    out_dir.mkdir(parents=True, exist_ok=True)

    print("#" * 68)
    print("DRUG DISCOVERY PIPELINE — single pass, no refinement loop")
    print(f"Target:     {target1} x {target2}")
    print(f"Indication: {disease}")
    print(f"Model:      {provider}/{model}")
    print(f"Grounding:  {'on' if grounding else 'OFF'}")
    print(f"Started:    {datetime.now():%Y-%m-%d %H:%M:%S}")
    print("#" * 68)
    print(
        "\nScope: agents 01-06 run once. No refinement loop, no module 07, no web\n"
        "search. Structures and target associations are grounded; affinity and\n"
        "functional values are not. Verify every number before relying on it.\n"
        "Full loop: see app/ or mcp/server.mjs."
    )

    grounding_block = ""
    if grounding:
        print("\n" + "=" * 68)
        print("RETRIEVAL")
        print("=" * 68)
        briefs = []
        for gene in (target1, target2):
            brief = ground_target(gene)
            briefs.append(brief)
            u, a, o = brief.get("uniprot"), brief.get("alphafold"), brief.get("open_targets")
            print(
                f"  {gene}: "
                f"{u['accession'] if u else 'no UniProt'} · "
                f"{'AlphaFold pLDDT ' + str(a['mean_plddt']) if a else 'no AlphaFold model'} · "
                f"{len(brief['structures'])} PDB entries · "
                f"{o['disease_count'] if o else 0} disease associations"
            )
            for err in brief["errors"]:
                print(f"    gap — {err}")
        grounding_block = "\n\n".join(brief_to_block(b) for b in briefs)
        (out_dir / "00-grounding.json").write_text(json.dumps(briefs, indent=2))

    prior_json = []
    reports = []
    failures = []

    for agent in AGENT_SEQUENCE:
        print("\n" + "=" * 68)
        print(f"AGENT {agent['id']}: {agent['name'].upper()}")
        print("=" * 68)

        prompt_text = build_prompt(agent, target1, target2, disease, grounding_block, prior_json)
        print(f"  prompt: {len(prompt_text):,} chars")

        try:
            response = call_llm(prompt_text, provider, api_key, model)
        except (urllib.error.URLError, urllib.error.HTTPError, KeyError, ValueError) as exc:
            detail = exc.read().decode("utf-8", "replace")[:300] if hasattr(exc, "read") else str(exc)
            print(f"  FAILED: {detail}")
            (out_dir / f"{agent['id']}-prompt.txt").write_text(prompt_text)
            print(f"  prompt saved for manual execution: {out_dir}/{agent['id']}-prompt.txt")
            failures.append(agent["id"])
            continue

        md_path = out_dir / f"{agent['id']}-{agent['name']}.md"
        md_path.write_text(response)

        payload = extract_json(response)
        if payload is None:
            print(f"  saved {md_path.name} ({len(response):,} chars) — WARNING: no parseable JSON block")
        else:
            json_path = out_dir / f"{agent['id']}-{agent['name']}.json"
            json_path.write_text(json.dumps(payload, indent=2))
            prior_json.append((agent["id"], payload))
            print(f"  saved {md_path.name} ({len(response):,} chars) + {json_path.name}")

        reports.append((agent, response))

    final_path = OUTPUT_DIR / f"{slug}-workflow-results.md"
    header = [
        f"# {target1} × {target2} Bispecific — Pipeline Results",
        "",
        f"**Indication:** {disease}  ",
        f"**Run:** {datetime.now().isoformat(timespec='seconds')}  ",
        f"**Model:** {provider}/{model}  ",
        f"**Retrieval grounding:** {'on' if grounding else 'off'}  ",
        "**Scope:** single pass — no refinement loop, no module 07, no web search.",
        "",
        "---",
        "",
    ]
    body = [f"## Agent {a['id']} — {a['name']}\n\n{text}\n\n---\n" for a, text in reports]
    final_path.write_text("\n".join(header) + "\n".join(body))

    print("\n" + "#" * 68)
    print(f"COMPLETE — {datetime.now():%H:%M:%S}")
    print("#" * 68)
    print(f"  per-agent output: {out_dir}")
    print(f"  synthesis:        {final_path}")
    if failures:
        print(f"  FAILED agents:    {', '.join(failures)}")
    return {"slug": slug, "final": str(final_path), "failures": failures}


def main():
    parser = argparse.ArgumentParser(
        description="Single-pass bispecific antibody discovery pipeline (agents 01-06).",
        epilog="Example: python run_pipeline.py PDCD1 LAG3 'metastatic melanoma'",
    )
    parser.add_argument("target1", help="HGNC symbol for the first target, e.g. PDCD1")
    parser.add_argument("target2", help="HGNC symbol for the second target, e.g. LAG3")
    parser.add_argument("disease", help="Disease indication, e.g. 'metastatic melanoma'")
    parser.add_argument("--provider", choices=("anthropic", "openai"), help="Default: whichever API key is set.")
    parser.add_argument("--model", help="Model id. Default: claude-opus-5 or gpt-4o.")
    parser.add_argument(
        "--no-grounding",
        action="store_true",
        help="Skip the UniProt/Open Targets/AlphaFold/PDB retrieval pass.",
    )
    args = parser.parse_args()

    run_pipeline(
        args.target1.strip().upper(),
        args.target2.strip().upper(),
        args.disease.strip(),
        provider=args.provider,
        model=args.model,
        grounding=not args.no_grounding,
    )


if __name__ == "__main__":
    sys.exit(main())
