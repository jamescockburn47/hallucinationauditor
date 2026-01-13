#!/usr/bin/env python3
"""
Search Find Case Law Atom feed for authorities.

Usage:
    python scripts/fcl_search_atom.py --query TEXT [--court COURT] [--party PARTY] [--output PATH]

Output:
    JSON with list of matching entries
"""

import argparse
import sys
from pathlib import Path
from typing import Dict, Any, List, Optional
from datetime import datetime, timezone
import xml.etree.ElementTree as ET

try:
    import requests
except ImportError:
    requests = None

from utils.file_helpers import safe_write_json
from utils.validation import validate_url


# Atom feed endpoint
FCL_ATOM_URL = "https://caselaw.nationalarchives.gov.uk/atom.xml"

# XML namespaces
NAMESPACES = {
    "atom": "http://www.w3.org/2005/Atom",
    "tna": "https://caselaw.nationalarchives.gov.uk/akn",
}


def parse_atom_entry(entry: ET.Element) -> Dict[str, Any]:
    """
    Parse single Atom entry into structured data.

    Args:
        entry: XML Element for <entry>

    Returns:
        Parsed entry dict
    """
    result = {
        "title": None,
        "uri": None,
        "identifiers": [],
        "links": {},
        "updated": None,
        "contenthash": None,
    }

    # Title
    title_elem = entry.find("atom:title", NAMESPACES)
    if title_elem is not None:
        result["title"] = title_elem.text

    # URI (Document URI - stable identifier)
    uri_elem = entry.find("tna:uri", NAMESPACES)
    if uri_elem is not None:
        result["uri"] = uri_elem.text

    # Identifiers
    for identifier in entry.findall("tna:identifier", NAMESPACES):
        id_type = identifier.get("type", "unknown")
        id_value = identifier.text
        if id_value:
            result["identifiers"].append({"type": id_type, "value": id_value})

    # Links
    for link in entry.findall("atom:link", NAMESPACES):
        rel = link.get("rel", "alternate")
        content_type = link.get("type", "text/html")
        href = link.get("href", "")

        if "akn+xml" in content_type:
            result["links"]["xml"] = href
        elif "pdf" in content_type:
            result["links"]["pdf"] = href
        elif rel == "alternate":
            result["links"]["html"] = href

    # Updated timestamp
    updated_elem = entry.find("atom:updated", NAMESPACES)
    if updated_elem is not None:
        result["updated"] = updated_elem.text

    # Content hash
    hash_elem = entry.find("tna:contenthash", NAMESPACES)
    if hash_elem is not None:
        result["contenthash"] = hash_elem.text

    return result


def search_fcl_atom(
    query: Optional[str] = None,
    party: Optional[str] = None,
    judge: Optional[str] = None,
    court: Optional[List[str]] = None,
    order: str = "-date",
    page: int = 1,
    per_page: int = 10,
    timeout: int = 30,
) -> Dict[str, Any]:
    """
    Search Find Case Law Atom feed.

    Args:
        query: Full-text search query
        party: Word in party name
        judge: Word in judge name
        court: List of court codes (e.g., ["uksc", "ewhc/fam"])
        order: Sort order (default: "-date")
        page: Page number (default: 1)
        per_page: Results per page (default: 10, max 50)
        timeout: Request timeout in seconds

    Returns:
        dict with entries and metadata

    Raises:
        ImportError: If requests library not installed
        Exception: If search fails
    """
    if requests is None:
        raise ImportError("requests library not installed")

    # Build query parameters
    params = {
        "order": order,
        "page": page,
        "per_page": min(per_page, 50),  # Cap at 50
    }

    if query:
        params["query"] = query
    if party:
        params["party"] = party
    if judge:
        params["judge"] = judge
    if court:
        for c in court:
            params.setdefault("court", []).append(c) if isinstance(params.get("court"), list) else params.update({"court": c})

    # Make request
    try:
        response = requests.get(
            FCL_ATOM_URL,
            params=params,
            timeout=timeout,
            headers={"User-Agent": "HallucinationAuditor/0.2.0"},
        )

        if response.status_code != 200:
            return {
                "searched_at": datetime.now(timezone.utc).isoformat(),
                "query_params": params,
                "entries": [],
                "error": f"HTTP {response.status_code}",
            }

        # Parse XML
        root = ET.fromstring(response.content)

        # Extract entries
        entries = []
        for entry_elem in root.findall("atom:entry", NAMESPACES):
            entry = parse_atom_entry(entry_elem)
            entries.append(entry)

        return {
            "searched_at": datetime.now(timezone.utc).isoformat(),
            "query_params": params,
            "entries": entries,
            "count": len(entries),
        }

    except Exception as e:
        return {
            "searched_at": datetime.now(timezone.utc).isoformat(),
            "query_params": params,
            "entries": [],
            "error": str(e),
        }


def main() -> int:
    """
    CLI entry point.

    Returns:
        Exit code (0=success, 1=error)
    """
    parser = argparse.ArgumentParser(description="Search Find Case Law Atom feed")
    parser.add_argument("--query", help="Full-text search query")
    parser.add_argument("--party", help="Word in party name")
    parser.add_argument("--judge", help="Word in judge name")
    parser.add_argument("--court", action="append", help="Court code (can repeat)")
    parser.add_argument("--order", default="-date", help="Sort order (default: -date)")
    parser.add_argument("--page", type=int, default=1, help="Page number (default: 1)")
    parser.add_argument("--per-page", type=int, default=10, help="Results per page (default: 10)")
    parser.add_argument("--output", required=True, help="Output JSON path")

    args = parser.parse_args()

    try:
        result = search_fcl_atom(
            query=args.query,
            party=args.party,
            judge=args.judge,
            court=args.court,
            order=args.order,
            page=args.page,
            per_page=args.per_page,
        )

        # Write output
        safe_write_json(Path(args.output), result)

        # Print summary
        count = result.get("count", 0)
        if count > 0:
            print(f"[OK] Found {count} results")
            for i, entry in enumerate(result["entries"][:3], 1):
                print(f"  {i}. {entry.get('title', 'Unknown')} - {entry.get('uri', 'N/A')}")
            if count > 3:
                print(f"  ... and {count - 3} more")
        else:
            error = result.get("error")
            if error:
                print(f"[ERROR] Search failed: {error}", file=sys.stderr)
            else:
                print("[WARN] No results found")

        return 0

    except Exception as e:
        print(f"[ERROR] Search error: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
