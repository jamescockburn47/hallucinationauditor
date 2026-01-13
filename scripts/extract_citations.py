#!/usr/bin/env python3
"""
Extract candidate citations from document text using regex patterns.

Usage:
    python scripts/extract_citations.py --job-id JOB_ID --doc-id DOC_ID --text-json PATH

Output:
    cache/<job_id>/<doc_id>.citations.json
"""

import argparse
import sys
import re
from pathlib import Path
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional

from utils.cache_helpers import write_cache_json, read_cache_json


# Citation patterns for UK legal citations
CITATION_PATTERNS = {
    "uk_neutral_citation": r"\[(\d{4})\]\s+(UKSC|UKPC|UKHL|UKEAT)\s+(\d+)",
    "ew_neutral_citation": r"\[(\d{4})\]\s+(EWCA|EWHC|EW\s+Misc)\s+(Civ|Crim|Admin|Ch|QB|Fam|TCC|Comm|Pat|IPEC)?\s*(\d+)",
    "case_name": r"\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+v\.?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b",
    "law_report": r"\[(\d{4})\]\s+(\d+)\s+(WLR|AC|QB|Ch|Fam|All ER|EWLR)\s+(\d+)",
    "year_volume_report": r"\((\d{4})\)\s+(\d+)\s+(WLR|AC|QB|Ch|Fam|All ER)\s+(\d+)",
}


def extract_citations_from_text(
    text: str, patterns: Optional[Dict[str, str]] = None
) -> List[Dict[str, Any]]:
    """
    Extract citations using regex patterns.

    Args:
        text: Document text to parse
        patterns: Optional custom regex patterns (default: CITATION_PATTERNS)

    Returns:
        List of citation objects with metadata
    """
    if patterns is None:
        patterns = CITATION_PATTERNS

    citations = []
    citation_id_counter = 1

    for pattern_name, pattern_regex in patterns.items():
        for match in re.finditer(pattern_regex, text):
            citation = {
                "citation_id": f"cit_{citation_id_counter}",
                "text": match.group(0),
                "start_pos": match.start(),
                "end_pos": match.end(),
                "pattern_matched": pattern_name,
                "confidence": calculate_confidence(pattern_name, match.group(0)),
            }

            citations.append(citation)
            citation_id_counter += 1

    # Sort by position in document
    citations.sort(key=lambda c: c["start_pos"])

    # Reassign sequential IDs after sorting
    for i, citation in enumerate(citations, 1):
        citation["citation_id"] = f"cit_{i}"

    return citations


def calculate_confidence(pattern_name: str, citation_text: str) -> float:
    """
    Calculate confidence score for citation match.

    Args:
        pattern_name: Name of matched pattern
        citation_text: Citation text

    Returns:
        Confidence score (0.0 to 1.0)
    """
    # Neutral citations are most reliable
    if "neutral_citation" in pattern_name:
        return 0.95

    # Law reports are reliable
    if "law_report" in pattern_name or "year_volume_report" in pattern_name:
        return 0.90

    # Case names are less reliable (can be false positives)
    if pattern_name == "case_name":
        # Check if it looks like a real case name
        if " v " in citation_text.lower() or " v. " in citation_text.lower():
            return 0.70
        return 0.50

    return 0.60


def extract_citations_from_document(
    job_id: str, doc_id: str, text_json_path: Path, patterns: Optional[Dict[str, str]] = None
) -> Dict[str, Any]:
    """
    Extract citations from document text JSON.

    Args:
        job_id: Job identifier
        doc_id: Document identifier
        text_json_path: Path to extracted text JSON
        patterns: Optional custom patterns

    Returns:
        Citations data structure

    Raises:
        FileNotFoundError: If text JSON not found
        Exception: If extraction fails
    """
    # Load extracted text
    text_data = read_cache_json(job_id, f"{doc_id}.text.json")

    if "text" not in text_data:
        raise ValueError(f"No 'text' field in {text_json_path}")

    text = text_data["text"]

    # Extract citations
    citations = extract_citations_from_text(text, patterns)

    # Build statistics
    stats = {"total_found": len(citations), "by_pattern": {}}

    for citation in citations:
        pattern = citation["pattern_matched"]
        stats["by_pattern"][pattern] = stats["by_pattern"].get(pattern, 0) + 1

    # Build result
    result = {
        "doc_id": doc_id,
        "extracted_at": datetime.now(timezone.utc).isoformat(),
        "citations": citations,
        "stats": stats,
    }

    # Write to cache
    output_path = write_cache_json(job_id, f"{doc_id}.citations.json", result)

    print(f"[OK] Extracted {len(citations)} citations from {doc_id}")
    if stats["by_pattern"]:
        for pattern, count in stats["by_pattern"].items():
            print(f"  {pattern}: {count}")
    print(f"  Output: {output_path}")

    return result


def main() -> int:
    """
    CLI entry point.

    Returns:
        Exit code (0=success, 1=validation error, 2=extraction error)
    """
    parser = argparse.ArgumentParser(description="Extract citations from document text")
    parser.add_argument("--job-id", required=True, help="Job identifier")
    parser.add_argument("--doc-id", required=True, help="Document identifier")
    parser.add_argument("--text-json", required=True, help="Path to extracted text JSON")

    args = parser.parse_args()

    try:
        extract_citations_from_document(
            job_id=args.job_id, doc_id=args.doc_id, text_json_path=Path(args.text_json)
        )
        return 0

    except (ValueError, FileNotFoundError) as e:
        print(f"[ERROR] Validation error: {e}", file=sys.stderr)
        return 1

    except Exception as e:
        print(f"[ERROR] Extraction error: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
