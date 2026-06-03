# Run Pipeline — Drug Discovery AI Workflow
#
# Usage:
#   python run_pipeline.py PDCD1 VEGFA "solid tumor immunotherapy"
#
# This script orchestrates the full 7-module pipeline.
# It reads each agent's prompt, substitutes the target pair,
# calls the LLM API, and saves output to the output/ folder.
#
# Requires: pip install openai
# Set: export OPENAI_API_KEY=sk-...

import os
import sys
import json
from pathlib import Path
from datetime import datetime

try:
    from openai import OpenAI
    HAS_OPENAI = True
except ImportError:
    HAS_OPENAI = False

REPO_ROOT = Path(__file__).parent
AGENTS_DIR = REPO_ROOT / "agents"
KNOWLEDGE_DIR = REPO_ROOT / "knowledge"
OUTPUT_DIR = REPO_ROOT / "output"
ITERATIONS_DIR = OUTPUT_DIR / "iterations"

AGENT_SEQUENCE = [
    {"id": "01", "name": "target-id", "prompt": "01-target-id/prompt.md", "background": "01-target-id/background.md"},
    {"id": "02", "name": "target-validation", "prompt": "02-target-validation/prompt.md", "background": "02-target-validation/background.md"},
    {"id": "03", "name": "bispecific-design", "prompt": "03-bispecific-design/prompt.md", "background": "03-bispecific-design/background.md"},
    {"id": "04", "name": "spr-binding", "prompt": "04-spr-binding/prompt.md", "background": "04-spr-binding/background.md"},
    {"id": "05", "name": "cell-functional", "prompt": "05-cell-functional/prompt.md", "background": "05-cell-functional/background.md"},
    {"id": "06", "name": "in-vivo", "prompt": "06-in-vivo/prompt.md", "background": "06-in-vivo/background.md"},
]

REFINEMENT_PROMPT = AGENTS_DIR / "03-bispecific-design" / "refinement-prompt.md"
EXPERIMENTAL_PROMPT = AGENTS_DIR / "07-experimental-data" / "prompt.md"

KNOWLEDGE_FILES = [
    KNOWLEDGE_DIR / "glossary.md",
    KNOWLEDGE_DIR / "public-databases.md",
]


def slug(text):
    return text.lower().replace(" ", "-").replace("/", "-")


def load_file(path):
    p = Path(path)
    if not p.is_absolute():
        p = REPO_ROOT / p
    if not p.exists():
        return None
    return p.read_text()


def build_prompt(agent, target_pair, disease, prev_output=None):
    prompt_text = load_file(agent["prompt"])
    bg_text = load_file(agent["background"])

    if not prompt_text:
        raise FileNotFoundError(f"Prompt not found: {agent['prompt']}")

    parts = []
    if bg_text:
        parts.append(bg_text)
    parts.append(prompt_text)

    if prev_output:
        parts.append(f"\n\n---\n## CONTEXT FROM PREVIOUS AGENT\n---\n{prev_output}")

    knowledge = ""
    for kf in KNOWLEDGE_FILES:
        kt = load_file(kf)
        if kt:
            knowledge += f"\n\n---\n## Knowledge: {kf.name}\n---\n{kt}"
    if knowledge:
        parts.append(knowledge)

    full = "\n\n".join(parts)

    substitutions = {
        "{target_1}": target_pair[0], "{target_2}": target_pair[1],
        "{gene_1}": target_pair[0], "{gene_2}": target_pair[1],
        "{target_pair}": f"{target_pair[0]}/{target_pair[1]}",
        "{GENE1}": target_pair[0], "{GENE2}": target_pair[1],
    }
    for k, v in substitutions.items():
        full = full.replace(k, v)

    return full


def call_llm(prompt_text, model="gpt-4o"):
    """Call OpenAI API and return the response text."""
    if not HAS_OPENAI:
        raise RuntimeError("openai package not installed. Run: pip install openai")

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY environment variable not set")

    client = OpenAI(api_key=api_key)

    response = client.chat.completions.create(
        model=model,
        messages=[
            {
                "role": "system",
                "content": (
                    "You are a drug discovery AI agent. You produce thorough, well-cited scientific reports. "
                    "Every data point must be traceable to a PMID, DOI, database accession, or URL. "
                    "Include a numbered references list at the end of every report. "
                    "Flag gaps honestly. Do not invent data."
                ),
            },
            {"role": "user", "content": prompt_text},
        ],
        temperature=0.3,
        max_tokens=8192,
    )

    return response.choices[0].message.content


def run_agent(agent, target_pair, disease, prev_output=None):
    print(f"\n{'='*60}")
    print(f"AGENT {agent['id']}: {agent['name'].upper()}")
    print(f"{'='*60}")

    output_dir = ITERATIONS_DIR / "i0"
    output_dir.mkdir(parents=True, exist_ok=True)

    prompt_text = build_prompt(agent, target_pair, disease, prev_output)
    print(f"Prompt: {len(prompt_text)} chars")

    try:
        response = call_llm(prompt_text)
    except RuntimeError as e:
        print(f"API error: {e}")
        print("Saving prompt for manual execution instead.")
        prompt_file = output_dir / f"{agent['id']}-prompt.txt"
        prompt_file.write_text(prompt_text)
        return {"id": agent["id"], "name": agent["name"], "response": None, "prompt_file": str(prompt_file)}

    md_file = output_dir / f"{agent['id']}-{agent['name']}.md"
    md_file.write_text(response)
    print(f"Saved: {md_file} ({len(response)} chars)")

    return {"id": agent["id"], "name": agent["name"], "response": response, "md_file": str(md_file)}


def run_pipeline(target1, target2, disease, experimental_data_path=None):
    target_pair = [target1, target2]
    target_slug = slug(f"{target1}-{target2}")

    print(f"\n{'#'*60}")
    print(f"DRUG DISCOVERY PIPELINE")
    print(f"Target: {target1} x {target2}  |  Disease: {disease}")
    print(f"Output: {OUTPUT_DIR / f'{target_slug}-workflow-results.md'}")
    print(f"Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{'#'*60}")

    if HAS_OPENAI and os.environ.get("OPENAI_API_KEY"):
        print("\nAPI mode: calling OpenAI for each agent.")
    else:
        print("\nManual mode: prompts will be saved. No API key found.")
        print("Set OPENAI_API_KEY to use automatic LLM calls.")

    results = {}
    prev_output = None

    for agent in AGENT_SEQUENCE:
        result = run_agent(agent, target_pair, disease, prev_output)
        results[agent["id"]] = result
        prev_output = result.get("response", "")

    # Final synthesis
    final_file = OUTPUT_DIR / f"{target_slug}-workflow-results.md"

    if prev_output:
        final_file.write_text(prev_output)
        print(f"\nFinal synthesis saved: {final_file}")
    else:
        # Compile from individual agent outputs
        sections = [f"# {target1} x {target2} Bispecific Antibody — Pipeline Results\n\n"]
        for agent in AGENT_SEQUENCE:
            r = results.get(agent["id"], {})
            resp = r.get("response", "")
            if resp:
                sections.append(resp)
                sections.append("\n\n---\n")
        final_file.write_text("\n".join(sections))
        print(f"\nCompiled synthesis saved: {final_file}")

    print(f"\n{'#'*60}")
    print(f"PIPELINE COMPLETE — {datetime.now().strftime('%H:%M:%S')}")
    print(f"{'#'*60}")
    print(f"\nOutputs:")
    for agent in AGENT_SEQUENCE:
        r = results.get(agent["id"], {})
        md = r.get("md_file", "not run")
        resp = r.get("response", "")
        status = f"{len(resp)} chars" if resp else "no response"
        print(f"  Agent {agent['id']}: {md} ({status})")
    print(f"  Final: {final_file}")

    return {"slug": target_slug, "results": results, "final": str(final_file)}


if __name__ == "__main__":
    if len(sys.argv) >= 4:
        run_pipeline(sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4] if len(sys.argv) > 4 else None)
    else:
        print("Usage: python run_pipeline.py <GENE1> <GENE2> <DISEASE>")
        print("Example: python run_pipeline.py PDCD1 VEGFA 'solid tumor immunotherapy'")
        print()
        print("Requirements: pip install openai")
        print("Set: export OPENAI_API_KEY=sk-...")