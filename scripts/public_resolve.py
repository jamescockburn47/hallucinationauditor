#!/usr/bin/env python3
"""
Resolve citation strings to candidate URLs (FCL-first, BAILII fallback, conservative).

Usage:
    python scripts/public_resolve.py --citation-text TEXT --output OUTPUT_JSON [--job-id JOB]

Output:
    JSON with candidate URLs and resolution status

Resolution Strategy (FCL-first):
    1. Try deterministic FCL URL construction
    2. Fall back to Atom feed search (restricted mode)
    3. Fall back to BAILII pattern matching
"""

import argparse
import sys
import re
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional, Tuple
from pathlib import Path

from utils.file_helpers import safe_write_json


# Find Case Law URL patterns (deterministic URI construction)
FCL_PATTERNS = {
    "uksc": {
        "pattern": r"\[(\d{4})\]\s+UKSC\s+(\d+)",
        "uri_template": "uksc/{year}/{num}",
        "url_template": "https://caselaw.nationalarchives.gov.uk/uksc/{year}/{num}/data.xml",
    },
    "ukpc": {
        "pattern": r"\[(\d{4})\]\s+UKPC\s+(\d+)",
        "uri_template": "ukpc/{year}/{num}",
        "url_template": "https://caselaw.nationalarchives.gov.uk/ukpc/{year}/{num}/data.xml",
    },
    "ukhl": {
        "pattern": r"\[(\d{4})\]\s+UKHL\s+(\d+)",
        "uri_template": "ukhl/{year}/{num}",
        "url_template": "https://caselaw.nationalarchives.gov.uk/ukhl/{year}/{num}/data.xml",
    },
    "ewca_civ": {
        "pattern": r"\[(\d{4})\]\s+EWCA\s+Civ\s+(\d+)",
        "uri_template": "ewca/civ/{year}/{num}",
        "url_template": "https://caselaw.nationalarchives.gov.uk/ewca/civ/{year}/{num}/data.xml",
    },
    "ewca_crim": {
        "pattern": r"\[(\d{4})\]\s+EWCA\s+Crim\s+(\d+)",
        "uri_template": "ewca/crim/{year}/{num}",
        "url_template": "https://caselaw.nationalarchives.gov.uk/ewca/crim/{year}/{num}/data.xml",
    },
    "ewhc_admin": {
        "pattern": r"\[(\d{4})\]\s+EWHC\s+(\d+)\s+\(Admin\)",
        "uri_template": "ewhc/admin/{year}/{num}",
        "url_template": "https://caselaw.nationalarchives.gov.uk/ewhc/admin/{year}/{num}/data.xml",
    },
    "ewhc_ch": {
        "pattern": r"\[(\d{4})\]\s+EWHC\s+(\d+)\s+\(Ch\)",
        "uri_template": "ewhc/ch/{year}/{num}",
        "url_template": "https://caselaw.nationalarchives.gov.uk/ewhc/ch/{year}/{num}/data.xml",
    },
    "ewhc_qb": {
        "pattern": r"\[(\d{4})\]\s+EWHC\s+(\d+)\s+\(QB\)",
        "uri_template": "ewhc/qb/{year}/{num}",
        "url_template": "https://caselaw.nationalarchives.gov.uk/ewhc/qb/{year}/{num}/data.xml",
    },
    "ewhc_fam": {
        "pattern": r"\[(\d{4})\]\s+EWHC\s+(\d+)\s+\(Fam\)",
        "uri_template": "ewhc/fam/{year}/{num}",
        "url_template": "https://caselaw.nationalarchives.gov.uk/ewhc/fam/{year}/{num}/data.xml",
    },
}

# BAILII URL patterns (conservative, deterministic)
BAILII_PATTERNS = {
    "uksc": {
        "pattern": r"\[(\d{4})\]\s+UKSC\s+(\d+)",
        "url_template": "https://www.bailii.org/uk/cases/UKSC/{year}/{num}.html",
    },
    "ukpc": {
        "pattern": r"\[(\d{4})\]\s+UKPC\s+(\d+)",
        "url_template": "https://www.bailii.org/uk/cases/UKPC/{year}/{num}.html",
    },
    "ukhl": {
        "pattern": r"\[(\d{4})\]\s+UKHL\s+(\d+)",
        "url_template": "https://www.bailii.org/uk/cases/UKHL/{year}/{num}.html",
    },
    "ewca_civ": {
        "pattern": r"\[(\d{4})\]\s+EWCA\s+Civ\s+(\d+)",
        "url_template": "https://www.bailii.org/ew/cases/EWCA/Civ/{year}/{num}.html",
    },
    "ewca_crim": {
        "pattern": r"\[(\d{4})\]\s+EWCA\s+Crim\s+(\d+)",
        "url_template": "https://www.bailii.org/ew/cases/EWCA/Crim/{year}/{num}.html",
    },
    "ewhc_admin": {
        "pattern": r"\[(\d{4})\]\s+EWHC\s+(\d+)\s+\(Admin\)",
        "url_template": "https://www.bailii.org/ew/cases/EWHC/Admin/{year}/{num}.html",
    },
    "ewhc_ch": {
        "pattern": r"\[(\d{4})\]\s+EWHC\s+(\d+)\s+\(Ch\)",
        "url_template": "https://www.bailii.org/ew/cases/EWHC/Ch/{year}/{num}.html",
    },
    "ewhc_qb": {
        "pattern": r"\[(\d{4})\]\s+EWHC\s+(\d+)\s+\(QB\)",
        "url_template": "https://www.bailii.org/ew/cases/EWHC/QB/{year}/{num}.html",
    },
    "ewhc_fam": {
        "pattern": r"\[(\d{4})\]\s+EWHC\s+(\d+)\s+\(Fam\)",
        "url_template": "https://www.bailii.org/ew/cases/EWHC/Fam/{year}/{num}.html",
    },
}


def try_fcl_patterns(citation_text: str) -> Optional[Tuple[str, str, str]]:
    """
    Try to match citation against FCL patterns.

    Args:
        citation_text: Citation string to match

    Returns:
        Tuple of (uri, url, pattern_name) if matched, None otherwise
    """
    for pattern_name, pattern_config in FCL_PATTERNS.items():
        match = re.search(pattern_config["pattern"], citation_text, re.IGNORECASE)
        if match:
            year = match.group(1)
            num = match.group(2)
            uri = pattern_config["uri_template"].format(year=year, num=num)
            url = pattern_config["url_template"].format(year=year, num=num)
            return (uri, url, pattern_name)
    return None


def try_bailii_patterns(citation_text: str) -> List[Dict[str, Any]]:
    """
    Try to match citation against BAILII patterns.

    Args:
        citation_text: Citation string to match

    Returns:
        List of candidate URL dicts
    """
    candidates = []
    for pattern_name, pattern_config in BAILII_PATTERNS.items():
        match = re.search(pattern_config["pattern"], citation_text, re.IGNORECASE)
        if match:
            year = match.group(1)
            num = match.group(2)
            url = pattern_config["url_template"].format(year=year, num=num)
            candidates.append(
                {
                    "url": url,
                    "source": "bailii",
                    "confidence": 0.90,
                    "resolution_method": "pattern_match",
                    "pattern_name": pattern_name,
                }
            )
    return candidates


def resolve_citation_to_urls(
    citation_text: str,
    citation_context: Optional[str] = None,
    prefer_sources: List[str] = None,
    job_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Resolve citation to candidate URLs using FCL-first strategy.

    Resolution Order:
        1. Try FCL deterministic URL construction
        2. Fall back to BAILII pattern matching
        3. Mark unresolvable if no patterns match

    Args:
        citation_text: Citation string to resolve
        citation_context: Optional surrounding text (for future use)
        prefer_sources: Source preference order (default: ["find_case_law", "bailii"])
        job_id: Job identifier for tracking (optional)

    Returns:
        Resolution result with candidate URLs and metadata
    """
    if prefer_sources is None:
        prefer_sources = ["find_case_law", "bailii"]

    candidate_urls = []
    resolution_attempts = []

    # Step 1: Try FCL deterministic URL construction
    if "find_case_law" in prefer_sources:
        fcl_result = try_fcl_patterns(citation_text)
        if fcl_result:
            uri, url, pattern_name = fcl_result
            candidate_urls.append(
                {
                    "url": url,
                    "source": "find_case_law",
                    "document_uri": uri,
                    "confidence": 0.95,
                    "resolution_method": "deterministic_uri_construction",
                    "pattern_name": pattern_name,
                }
            )
            resolution_attempts.append(
                f"FCL deterministic match: {pattern_name} -> {uri}"
            )

    # Step 2: Fall back to BAILII if FCL didn't match or if preferred
    if "bailii" in prefer_sources and (
        not candidate_urls or "bailii" == prefer_sources[0]
    ):
        bailii_candidates = try_bailii_patterns(citation_text)
        if bailii_candidates:
            candidate_urls.extend(bailii_candidates)
            resolution_attempts.append(
                f"BAILII pattern match: {len(bailii_candidates)} candidate(s)"
            )

    # Determine resolution status
    if len(candidate_urls) == 0:
        resolution_status = "unresolvable"
        notes = "No pattern match found for citation in FCL or BAILII"
    elif len(candidate_urls) == 1:
        resolution_status = "resolved"
        source = candidate_urls[0]["source"]
        notes = f"Resolved to {source} using deterministic pattern"
    else:
        resolution_status = "ambiguous"
        notes = f"Multiple candidates found ({len(candidate_urls)})"

    result = {
        "citation_text": citation_text,
        "resolved_at": datetime.now(timezone.utc).isoformat(),
        "candidate_urls": candidate_urls,
        "resolution_status": resolution_status,
        "resolution_attempts": resolution_attempts,
        "notes": notes,
    }

    if job_id:
        result["job_id"] = job_id

    return result


def main() -> int:
    """
    CLI entry point.

    Returns:
        Exit code (0=success, 1=validation error, 2=resolution error)
    """
    parser = argparse.ArgumentParser(
        description="Resolve citations to URLs (FCL-first, BAILII fallback)"
    )
    parser.add_argument("--citation-text", required=True, help="Citation text to resolve")
    parser.add_argument("--output", required=True, help="Output JSON path")
    parser.add_argument("--job-id", help="Job identifier (optional)")
    parser.add_argument("--context", help="Optional citation context")
    parser.add_argument(
        "--prefer-sources",
        help='Comma-separated source preference (default: "find_case_law,bailii")',
        default="find_case_law,bailii",
    )

    args = parser.parse_args()

    try:
        prefer_sources = [s.strip() for s in args.prefer_sources.split(",")]

        result = resolve_citation_to_urls(
            citation_text=args.citation_text,
            citation_context=args.context,
            prefer_sources=prefer_sources,
            job_id=args.job_id,
        )

        # Write output
        safe_write_json(Path(args.output), result)

        # Print summary
        if result["resolution_status"] == "resolved":
            candidate = result["candidate_urls"][0]
            source = candidate["source"]
            url = candidate["url"]
            print(f"[OK] Resolved ({source}): {url}")
        elif result["resolution_status"] == "ambiguous":
            print(f"[WARN] Ambiguous: {len(result['candidate_urls'])} candidates")
            for candidate in result["candidate_urls"]:
                print(f"  - {candidate['source']}: {candidate['url']}")
        else:
            print(f"[ERROR] Unresolvable: {result['notes']}")

        return 0

    except Exception as e:
        print(f"[ERROR] Resolution error: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
