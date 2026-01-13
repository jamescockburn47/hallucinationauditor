#!/usr/bin/env python3
"""
Build canonical claims list from input job or extracted citations.

Usage:
    python scripts/build_claims.py --job-id JOB_ID --input INPUT_JSON [--citations-dir DIR]

Output:
    cache/<job_id>/claims.json
"""

import argparse
import sys
from pathlib import Path
from datetime import datetime, timezone
from typing import Dict, Any, List

from utils.cache_helpers import write_cache_json
from utils.file_helpers import safe_read_json
from utils.validation import validate_input_job


def build_claims_from_job(
    job_id: str, input_data: Dict[str, Any], citations_dir: Path
) -> Dict[str, Any]:
    """
    Build canonical claims list.

    Args:
        job_id: Job identifier
        input_data: Full input job JSON
        citations_dir: Directory containing extracted citations

    Returns:
        Canonical claims structure

    Raises:
        ValueError: If no claims can be built
    """
    claims = []
    from_input = 0
    from_extraction = 0

    # Check if user provided claims
    if "claims" in input_data and input_data["claims"]:
        # Use user-provided claims
        for claim in input_data["claims"]:
            canonical_claim = {
                "claim_id": claim["claim_id"],
                "text": claim["text"],
                "source_doc_id": claim.get("source_doc_id", ""),
                "source_locator": claim.get("source_locator", ""),
                "citations": [],
            }

            # Process citations
            if "citations" in claim:
                for i, citation in enumerate(claim["citations"], 1):
                    canonical_citation = {
                        "citation_id": f"{claim['claim_id']}_cit_{i}",
                        "citation_text": citation.get("raw", citation.get("citation_text", "")),
                        "context": "",
                        "extracted_from": "user_input",
                    }
                    canonical_claim["citations"].append(canonical_citation)
                    from_input += 1

            claims.append(canonical_claim)

    else:
        # No user claims - extract from documents
        print("No user claims provided, extracting from documents...")

        for doc in input_data.get("documents", []):
            doc_id = doc["doc_id"]
            citations_file = citations_dir / job_id / f"{doc_id}.citations.json"

            if not citations_file.exists():
                print(f"[WARN] No citations found for {doc_id}, skipping")
                continue

            # Load extracted citations
            citations_data = safe_read_json(citations_file)

            # Create claims from citations (heuristic approach)
            for citation in citations_data.get("citations", []):
                claim = {
                    "claim_id": f"claim_{doc_id}_{citation['citation_id']}",
                    "text": f"Document references: {citation['text']}",
                    "source_doc_id": doc_id,
                    "source_locator": f"position {citation['start_pos']}",
                    "citations": [
                        {
                            "citation_id": citation["citation_id"],
                            "citation_text": citation["text"],
                            "context": "",
                            "extracted_from": "extracted",
                        }
                    ],
                }
                claims.append(claim)
                from_extraction += 1

    if not claims:
        raise ValueError("No claims could be built from input or extracted citations")

    # Build statistics
    stats = {
        "total_claims": len(claims),
        "total_citations": sum(len(c["citations"]) for c in claims),
        "from_input": from_input,
        "from_extraction": from_extraction,
    }

    # Build result
    result = {
        "job_id": job_id,
        "built_at": datetime.now(timezone.utc).isoformat(),
        "claims": claims,
        "stats": stats,
    }

    # Write to cache
    output_path = write_cache_json(job_id, "claims.json", result)

    print(f"[OK] Built {stats['total_claims']} claims with {stats['total_citations']} citations")
    print(f"  From input: {stats['from_input']}")
    print(f"  From extraction: {stats['from_extraction']}")
    print(f"  Output: {output_path}")

    return result


def main() -> int:
    """
    CLI entry point.

    Returns:
        Exit code (0=success, 1=validation error, 2=build error)
    """
    parser = argparse.ArgumentParser(description="Build canonical claims from input or extracted")
    parser.add_argument("--job-id", required=True, help="Job identifier")
    parser.add_argument("--input", required=True, help="Path to input job JSON")
    parser.add_argument(
        "--citations-dir", default="cache", help="Directory containing citations (default: cache)"
    )

    args = parser.parse_args()

    try:
        # Load input job
        input_data = safe_read_json(Path(args.input))

        # Validate
        validation = validate_input_job(input_data)
        if not validation:
            for error in validation.errors:
                print(f"[ERROR] {error}", file=sys.stderr)
            return 1

        # Build claims
        build_claims_from_job(
            job_id=args.job_id, input_data=input_data, citations_dir=Path(args.citations_dir)
        )
        return 0

    except (ValueError, FileNotFoundError) as e:
        print(f"[ERROR] Validation error: {e}", file=sys.stderr)
        return 1

    except Exception as e:
        print(f"[ERROR] Build error: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
