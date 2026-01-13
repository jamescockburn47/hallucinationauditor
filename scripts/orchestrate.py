#!/usr/bin/env python3
"""
Orchestrate full hallucination audit pipeline (v0.2.0 with FCL support).

This script demonstrates the integration of all components:
- Phase 1: Extraction (extract text, citations, build claims)
- Phase 2: Retrieval (FCL-first resolution, fetch, parse authorities)
- Phase 3: Verification (verify claims, generate reports)

Sources:
- Primary: Find Case Law (National Archives)
- Secondary: BAILII (fallback)

Usage:
    python scripts/orchestrate.py --input cases_in/<job_id>.json
"""

import argparse
import sys
import subprocess
import json
from pathlib import Path
from datetime import datetime, timezone
from typing import Dict, Any, List

from utils.file_helpers import safe_read_json, safe_write_json
from utils.cache_helpers import get_cache_path, ensure_cache_dir
from utils.validation import validate_input_job


def run_command(cmd: List[str], description: str) -> int:
    """
    Run shell command and handle errors.

    Args:
        cmd: Command and arguments
        description: Human-readable description

    Returns:
        Exit code
    """
    print(f"  -> {description}...")
    result = subprocess.run(cmd, capture_output=True, text=True)

    if result.returncode != 0:
        print(f"  X Failed: {result.stderr}")
        return result.returncode

    # Print stdout if present
    if result.stdout:
        for line in result.stdout.strip().split('\n'):
            if line.strip():
                print(f"     {line}")

    return 0


def phase1_extraction(job_id: str, input_data: Dict[str, Any]) -> bool:
    """
    Phase 1: Extract text, citations, and build claims.

    Args:
        job_id: Job identifier
        input_data: Input job JSON

    Returns:
        True if successful
    """
    print("\n=== Phase 1: Extraction ===")

    # Extract text from each document
    for doc in input_data.get("documents", []):
        doc_id = doc["doc_id"]
        doc_path = doc["path"]
        doc_type = doc["type"]

        cmd = [
            "python", "scripts/extract_text.py",
            "--job-id", job_id,
            "--doc-id", doc_id,
            "--doc-path", doc_path,
            "--doc-type", doc_type,
        ]

        if run_command(cmd, f"Extract text from {doc_id}") != 0:
            return False

    # Extract citations from each document
    for doc in input_data.get("documents", []):
        doc_id = doc["doc_id"]
        text_json = f"cache/{job_id}/{doc_id}.text.json"

        cmd = [
            "python", "scripts/extract_citations.py",
            "--job-id", job_id,
            "--doc-id", doc_id,
            "--text-json", text_json,
        ]

        if run_command(cmd, f"Extract citations from {doc_id}") != 0:
            return False

    # Build canonical claims
    cmd = [
        "python", "scripts/build_claims.py",
        "--job-id", job_id,
        "--input", f"cases_in/{job_id}.json",
    ]

    if run_command(cmd, "Build canonical claims") != 0:
        return False

    print("  [OK] Extraction phase complete")
    return True


def phase2_retrieval(job_id: str) -> bool:
    """
    Phase 2: Resolve citations, fetch authorities, parse content.

    Args:
        job_id: Job identifier

    Returns:
        True if successful
    """
    print("\n=== Phase 2: Retrieval ===")

    # Load claims
    claims_path = get_cache_path(job_id, "claims.json")
    claims_data = safe_read_json(claims_path)

    # Ensure resolution directory exists
    ensure_cache_dir(job_id, "resolutions")
    ensure_cache_dir(job_id, "authorities")

    # Resolve each citation
    for claim in claims_data.get("claims", []):
        for citation in claim.get("citations", []):
            citation_id = citation["citation_id"]
            citation_text = citation["citation_text"]

            output_path = get_cache_path(job_id, f"resolutions/{citation_id}.json")

            cmd = [
                "python", "scripts/public_resolve.py",
                "--citation-text", citation_text,
                "--output", str(output_path),
                "--job-id", job_id,
            ]

            if run_command(cmd, f"Resolve {citation_id}") != 0:
                continue  # Non-fatal, continue with other citations

    # Fetch and parse resolved URLs
    resolutions_dir = Path("cache") / job_id / "resolutions"
    if resolutions_dir.exists():
        for resolution_file in resolutions_dir.glob("*.json"):
            resolution = safe_read_json(resolution_file)

            if resolution.get("resolution_status") != "resolved":
                print(f"  ! Skipping unresolved citation: {resolution.get('citation_text')}")
                continue

            # Get first candidate URL
            candidates = resolution.get("candidate_urls", [])
            if not candidates:
                continue

            url = candidates[0]["url"]

            # Fetch URL
            cmd = [
                "python", "scripts/fetch_url.py",
                "--job-id", job_id,
                "--url", url,
            ]

            if run_command(cmd, f"Fetch {url}") != 0:
                continue  # Non-fatal

            # Parse authority (find cached file - HTML or XML)
            sources_dir = Path("sources") / job_id
            if sources_dir.exists():
                # Find most recent HTML or XML file
                html_files = list(sources_dir.glob("*.html"))
                xml_files = list(sources_dir.glob("*.xml"))
                all_files = html_files + xml_files

                if all_files:
                    latest_file = max(all_files, key=lambda p: p.stat().st_mtime)

                    cmd = [
                        "python", "scripts/parse_authority.py",
                        "--job-id", job_id,
                        "--cache-path", str(latest_file),
                        "--url", url,
                        # Auto-detect source type from file extension/content
                    ]

                    run_command(cmd, f"Parse authority")

    print("  [OK] Retrieval phase complete")
    return True


def phase3_verification(job_id: str, input_data: Dict[str, Any]) -> bool:
    """
    Phase 3: Verify claims and generate reports.

    Args:
        job_id: Job identifier
        input_data: Input job JSON

    Returns:
        True if successful
    """
    print("\n=== Phase 3: Verification ===")

    # Load claims
    claims_path = get_cache_path(job_id, "claims.json")
    claims_data = safe_read_json(claims_path)

    # Verify each claim-citation pair
    ensure_cache_dir(job_id, "verifications")

    for claim in claims_data.get("claims", []):
        claim_id = claim["claim_id"]
        claim_text = claim["text"]

        for citation in claim.get("citations", []):
            citation_id = citation["citation_id"]
            citation_text = citation["citation_text"]

            # Find parsed authority for this citation
            authorities_dir = Path("cache") / job_id / "authorities"
            if authorities_dir.exists():
                authority_files = list(authorities_dir.glob("*.parsed.json"))
                if authority_files:
                    # Use first authority (in real system, match by URL)
                    authority_file = authority_files[0]

                    output_path = get_cache_path(job_id, f"verifications/{claim_id}_{citation_id}.json")

                    cmd = [
                        "python", "scripts/verify_claim.py",
                        "--claim-text", claim_text,
                        "--citation-text", citation_text,
                        "--authority-json", str(authority_file),
                        "--output", str(output_path),
                    ]

                    run_command(cmd, f"Verify {claim_id} against authority")

    # Generate simple reports
    generate_reports(job_id, input_data)

    print("  [OK] Verification phase complete")
    return True


def generate_reports(job_id: str, input_data: Dict[str, Any]) -> None:
    """
    Generate JSON and Markdown reports.

    Args:
        job_id: Job identifier
        input_data: Input job JSON
    """
    print("\n  -> Generating reports...")

    # Load all data
    claims_data = safe_read_json(get_cache_path(job_id, "claims.json"))

    # Build report structure
    report = {
        "audit_metadata": {
            "job_id": job_id,
            "title": input_data.get("title", "Untitled"),
            "audited_at": datetime.now(timezone.utc).isoformat(),
            "auditor_version": "0.1.0",
        },
        "claims": [],
        "summary": {
            "total_claims": len(claims_data.get("claims", [])),
            "total_citations": sum(len(c.get("citations", [])) for c in claims_data.get("claims", [])),
        },
    }

    # Process each claim
    for claim in claims_data.get("claims", []):
        claim_result = {
            "claim_id": claim["claim_id"],
            "text": claim["text"],
            "citations": [],
        }

        for citation in claim.get("citations", []):
            citation_id = citation["citation_id"]

            # Load verification if exists
            verification_path = get_cache_path(job_id, f"verifications/{claim['claim_id']}_{citation_id}.json")
            if verification_path.exists():
                verification = safe_read_json(verification_path)
                outcome = verification.get("verification_outcome", "unclear")
            else:
                outcome = "unverifiable"

            citation_result = {
                "citation_id": citation_id,
                "citation_text": citation["citation_text"],
                "outcome": outcome,
            }

            claim_result["citations"].append(citation_result)

        report["claims"].append(claim_result)

    # Write JSON report
    reports_dir = Path("reports")
    reports_dir.mkdir(exist_ok=True)

    json_path = reports_dir / f"{job_id}.json"
    safe_write_json(json_path, report)
    print(f"     [OK] JSON report: {json_path}")

    # Write Markdown report
    md_path = reports_dir / f"{job_id}.md"
    md_content = f"""# Hallucination Audit Report: {report['audit_metadata']['title']}

**Job ID**: {job_id}
**Audited**: {report['audit_metadata']['audited_at']}
**Version**: {report['audit_metadata']['auditor_version']}

## Summary

- **Total Claims**: {report['summary']['total_claims']}
- **Total Citations**: {report['summary']['total_citations']}

## Claims

"""

    for claim in report["claims"]:
        md_content += f"\n### Claim: {claim['text']}\n\n"
        for citation in claim["citations"]:
            md_content += f"- **{citation['citation_text']}**: {citation['outcome']}\n"

    md_path.write_text(md_content, encoding='utf-8')
    print(f"     [OK] Markdown report: {md_path}")


def main() -> int:
    """
    CLI entry point.

    Returns:
        Exit code (0=success, 1=error)
    """
    parser = argparse.ArgumentParser(description="Orchestrate full audit pipeline")
    parser.add_argument("--input", required=True, help="Path to input job JSON")

    args = parser.parse_args()

    try:
        # Load and validate input
        input_path = Path(args.input)
        if not input_path.exists():
            print(f"[ERROR] Input file not found: {input_path}")
            return 1

        input_data = safe_read_json(input_path)

        validation = validate_input_job(input_data)
        if not validation:
            print("[ERROR] Input validation failed:")
            for error in validation.errors:
                print(f"  - {error}")
            return 1

        job_id = input_data["job_id"]

        print(f"\n{'='*60}")
        print(f"  Hallucination Audit Pipeline")
        print(f"  Job: {job_id}")
        print(f"{'='*60}")

        # Run phases
        if not phase1_extraction(job_id, input_data):
            print("\n[ERROR] Pipeline failed in Phase 1")
            return 1

        if not phase2_retrieval(job_id):
            print("\n[ERROR] Pipeline failed in Phase 2")
            return 1

        if not phase3_verification(job_id, input_data):
            print("\n[ERROR] Pipeline failed in Phase 3")
            return 1

        print(f"\n{'='*60}")
        print("  [OK] Audit Complete")
        print(f"{'='*60}")
        print(f"\nReports generated:")
        print(f"  - reports/{job_id}.json")
        print(f"  - reports/{job_id}.md")
        print(f"\nCache location: cache/{job_id}/")
        print(f"Sources cached: sources/{job_id}/")

        return 0

    except Exception as e:
        print(f"\n[ERROR] Pipeline error: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    sys.exit(main())
