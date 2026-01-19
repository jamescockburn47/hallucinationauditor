#!/usr/bin/env python3
"""
Parse fetched authority (FCL XML or BAILII HTML) to extract structured content.

Usage:
    python scripts/parse_authority.py --job-id JOB_ID --cache-path PATH --url URL [--source-type TYPE]

Output:
    cache/<job_id>/authorities/<url_hash>.parsed.json

Supported Sources:
    - Find Case Law (Akoma Ntoso XML)
    - BAILII (HTML)
"""

import argparse
import sys
import re
import hashlib
import xml.etree.ElementTree as ET
from pathlib import Path
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional

try:
    from bs4 import BeautifulSoup
except ImportError:
    BeautifulSoup = None

from utils.cache_helpers import ensure_cache_dir
from utils.file_helpers import safe_read_text, safe_write_json


def parse_bailii_html(html_content: str) -> Dict[str, Any]:
    """
    Parse BAILII judgment HTML.

    Args:
        html_content: HTML content

    Returns:
        Parsed authority data

    Raises:
        ImportError: If BeautifulSoup not installed
    """
    if BeautifulSoup is None:
        raise ImportError("BeautifulSoup not installed")

    soup = BeautifulSoup(html_content, "lxml")

    # Extract title
    title_tag = soup.find("title")
    title = title_tag.text.strip() if title_tag else "Unknown"

    # Try to extract neutral citation from title
    neutral_citation = None
    citation_match = re.search(r"\[(\d{4})\]\s+(\w+)\s+(\d+)", title)
    if citation_match:
        neutral_citation = citation_match.group(0)

    # Extract case name (usually before the neutral citation)
    case_name = None
    if neutral_citation:
        parts = title.split(neutral_citation)
        if parts:
            case_name = parts[0].strip()

    # Extract court and date from title or content
    court = None
    if neutral_citation:
        court_match = re.search(r"\[(\d{4})\]\s+(\w+)", neutral_citation)
        if court_match:
            court = court_match.group(2)

    # Extract paragraphs - try numbered [N] format first
    paragraphs = []
    for p in soup.find_all("p"):
        text = p.get_text().strip()
        if not text:
            continue

        # Check if paragraph has number [N]
        para_match = re.match(r"^\[(\d+)\]\s+(.*)", text, re.DOTALL)
        if para_match:
            para_num = para_match.group(1)
            para_text = para_match.group(2).strip()

            # Try to identify speaker (usually in bold at start)
            speaker = None
            bold_tags = p.find_all("b")
            if bold_tags and bold_tags[0].text.strip():
                speaker = bold_tags[0].text.strip().rstrip(":")

            paragraphs.append({"para_num": para_num, "text": para_text, "speaker": speaker})

    # Get full text
    full_text = soup.get_text(separator="\n")
    # Clean up whitespace
    full_text = "\n".join(line.strip() for line in full_text.splitlines() if line.strip())

    # Fallback for older cases without [N] numbering:
    # Extract substantial paragraphs from full text
    if not paragraphs:
        # Skip navigation/header content - look for judgment content
        lines = full_text.split("\n")

        # Find start of actual judgment (after case details)
        start_idx = 0
        for i, line in enumerate(lines):
            # Look for common judgment start indicators
            if any(marker in line.lower() for marker in ['judgment', 'lord ', 'the court', 'opinion']):
                start_idx = i
                break

        # Group lines into paragraphs (blank lines separate paragraphs)
        current_para = []
        para_num = 1

        for line in lines[start_idx:]:
            if not line.strip():
                # End of paragraph
                if current_para:
                    para_text = " ".join(current_para).strip()
                    # Only include substantial paragraphs (likely judgment content)
                    if len(para_text) > 100:
                        paragraphs.append({
                            "para_num": str(para_num),
                            "text": para_text,
                            "speaker": None
                        })
                        para_num += 1
                    current_para = []
            else:
                current_para.append(line.strip())

        # Don't forget last paragraph
        if current_para:
            para_text = " ".join(current_para).strip()
            if len(para_text) > 100:
                paragraphs.append({
                    "para_num": str(para_num),
                    "text": para_text,
                    "speaker": None
                })

    return {
        "title": title,
        "case_name": case_name,
        "neutral_citation": neutral_citation,
        "court": court,
        "date": None,  # Would need more sophisticated extraction
        "paragraphs": paragraphs,
        "full_text": full_text,
        "metadata": {
            "parser_version": "0.2.0",
            "parse_method": "bailii_html",
            "warnings": [],
        },
    }


def extract_text_recursive(element: ET.Element) -> str:
    """
    Recursively extract text from XML element and all children.

    Args:
        element: XML element

    Returns:
        Concatenated text content
    """
    text_parts = []
    if element.text:
        text_parts.append(element.text.strip())
    for child in element:
        text_parts.append(extract_text_recursive(child))
        if child.tail:
            text_parts.append(child.tail.strip())
    return " ".join(filter(None, text_parts))


def parse_fcl_xml(xml_content: str) -> Dict[str, Any]:
    """
    Parse Find Case Law Akoma Ntoso XML.

    Args:
        xml_content: Raw XML string

    Returns:
        Parsed authority dict
    """
    # Akoma Ntoso namespaces
    namespaces = {
        "akn": "http://docs.oasis-open.org/legaldocml/ns/akn/3.0",
        "uk": "https://caselaw.nationalarchives.gov.uk/akn",
    }

    try:
        root = ET.fromstring(xml_content.encode("utf-8"))
    except ET.ParseError as e:
        return {
            "title": "Unknown",
            "paragraphs": [],
            "full_text": "",
            "metadata": {
                "parser_version": "0.2.0",
                "parse_method": "fcl_xml",
                "warnings": [f"XML parse error: {e}"],
            },
        }

    result = {
        "title": None,
        "case_name": None,
        "neutral_citation": None,
        "court": None,
        "date": None,
        "paragraphs": [],
        "full_text": None,
    }

    # Extract metadata from <meta>
    meta = root.find(".//akn:meta", namespaces)
    if meta is not None:
        # Title
        doc_title = meta.find(".//akn:FRBRname", namespaces)
        if doc_title is not None and doc_title.get("value"):
            result["title"] = doc_title.get("value")

        # Neutral citation
        citation_elem = meta.find(".//akn:FRBRnumber", namespaces)
        if citation_elem is not None and citation_elem.get("value"):
            result["neutral_citation"] = citation_elem.get("value")

        # Date
        date_elem = meta.find(".//akn:FRBRdate", namespaces)
        if date_elem is not None and date_elem.get("date"):
            result["date"] = date_elem.get("date")

        # Court (from FRBRauthor)
        court_elem = meta.find(".//akn:FRBRauthor", namespaces)
        if court_elem is not None and court_elem.get("as"):
            result["court"] = court_elem.get("as")

    # Extract case name from title (fallback)
    if not result["title"]:
        name_elem = root.find(".//akn:docTitle", namespaces)
        if name_elem is not None:
            result["title"] = extract_text_recursive(name_elem)

    # Set case_name to title (FCL uses FRBRname for case name)
    result["case_name"] = result["title"]

    # Extract judgment body
    judgment = root.find(".//akn:judgment", namespaces)
    if judgment is None:
        judgment = root.find(".//akn:body", namespaces)

    if judgment is not None:
        # Extract paragraphs
        paragraphs = []
        para_counter = 1
        for para in judgment.findall(".//akn:paragraph", namespaces):
            para_id = para.get("eId", None)
            para_text = extract_text_recursive(para)
            if para_text:
                # Clean up paragraph number - extract just the number
                # eId is usually like "para_1" or "paragraph_12"
                para_num = None
                if para_id:
                    num_match = re.search(r'(\d+)', para_id)
                    if num_match:
                        para_num = num_match.group(1)
                    else:
                        para_num = para_id
                
                # Fallback to counter if no number found
                if not para_num:
                    para_num = str(para_counter)
                
                paragraphs.append(
                    {
                        "para_num": para_num,
                        "para_id": para_id,  # Keep original ID for anchoring
                        "text": para_text,
                        "speaker": None,
                    }
                )
                para_counter += 1

        result["paragraphs"] = paragraphs
        result["full_text"] = extract_text_recursive(judgment)

    # If no paragraphs found, extract full document text
    if not result["full_text"]:
        result["full_text"] = extract_text_recursive(root)

    result["metadata"] = {
        "parser_version": "0.2.0",
        "parse_method": "fcl_xml",
        "warnings": [],
    }

    return result


def detect_source_type(content: str, url: str, cache_path: Path) -> str:
    """
    Detect source type from content, URL, or file extension.

    Args:
        content: File content (first 500 chars)
        url: Original URL
        cache_path: Path to cached file

    Returns:
        Source type: "fcl_xml", "bailii", or "unknown"
    """
    # Check file extension
    if cache_path.suffix == ".xml":
        return "fcl_xml"

    # Check URL hostname
    if "caselaw.nationalarchives.gov.uk" in url.lower():
        return "fcl_xml"
    elif "bailii.org" in url.lower():
        return "bailii"

    # Check content (first 500 chars)
    content_sample = content[:500].strip()

    # Look for XML declaration or Akoma Ntoso namespace
    if content_sample.startswith("<?xml") or "akn:akomaNtoso" in content_sample:
        return "fcl_xml"

    # Look for HTML doctype or tags
    if content_sample.startswith("<!DOCTYPE") or content_sample.startswith("<html"):
        return "bailii"

    # Default to bailii for backwards compatibility
    return "bailii"


def parse_authority_document(
    job_id: str, cache_path: Path, url: str, source_type: Optional[str] = None
) -> Dict[str, Any]:
    """
    Parse authority document to structured format with auto-detection.

    Args:
        job_id: Job identifier
        cache_path: Path to cached content
        url: Original URL
        source_type: Source type for parser selection (None = auto-detect)

    Returns:
        Parsed authority data

    Raises:
        FileNotFoundError: If cache file doesn't exist
        Exception: If parsing fails
    """
    if not cache_path.exists():
        raise FileNotFoundError(f"Cache file not found: {cache_path}")

    # Read content with encoding fallback
    try:
        content = safe_read_text(cache_path, encoding="utf-8")
    except UnicodeDecodeError:
        # Fallback to latin-1 which can handle any byte sequence
        content = safe_read_text(cache_path, encoding="latin-1")

    # Auto-detect source type if not provided
    if source_type is None:
        source_type = detect_source_type(content, url, cache_path)
        print(f"[OK] Detected source type: {source_type}")

    # Parse based on source type
    if source_type == "fcl_xml":
        parsed_data = parse_fcl_xml(content)
    elif source_type == "bailii":
        parsed_data = parse_bailii_html(content)
    else:
        # Fallback: basic text extraction
        if BeautifulSoup:
            soup = BeautifulSoup(content, "lxml")
            full_text = soup.get_text(separator="\n")
        else:
            full_text = content

        parsed_data = {
            "title": "Unknown",
            "case_name": None,
            "neutral_citation": None,
            "court": None,
            "date": None,
            "paragraphs": [],
            "full_text": full_text,
            "metadata": {
                "parser_version": "0.2.0",
                "parse_method": "fallback_text",
                "warnings": ["Used fallback parser - limited structure extracted"],
            },
        }

    # Add URL and timestamp
    parsed_data["url"] = url
    parsed_data["parsed_at"] = datetime.now(timezone.utc).isoformat()

    # Write to cache
    url_hash = hashlib.sha256(url.encode("utf-8")).hexdigest()[:16]
    authorities_dir = ensure_cache_dir(job_id, "authorities")
    output_path = authorities_dir / f"{url_hash}.parsed.json"
    safe_write_json(output_path, parsed_data)

    # Print summary
    para_count = len(parsed_data.get("paragraphs", []))
    print(f"[OK] Parsed authority: {parsed_data.get('title', 'Unknown')}")
    if para_count > 0:
        print(f"  Paragraphs: {para_count}")
    print(f"  Output: {output_path}")

    if parsed_data["metadata"].get("warnings"):
        for warning in parsed_data["metadata"]["warnings"]:
            print(f"  [WARN] {warning}")

    return parsed_data


def main() -> int:
    """
    CLI entry point.

    Returns:
        Exit code (0=success, 1=validation error, 2=parse error)
    """
    parser = argparse.ArgumentParser(
        description="Parse authority (FCL XML or BAILII HTML) to structured format"
    )
    parser.add_argument("--job-id", required=True, help="Job identifier")
    parser.add_argument("--cache-path", required=True, help="Path to cached file")
    parser.add_argument("--url", required=True, help="Original URL")
    parser.add_argument(
        "--source-type",
        choices=["fcl_xml", "bailii", "auto"],
        help='Source type (auto = auto-detect, default: auto)',
    )

    args = parser.parse_args()

    try:
        # Convert "auto" to None for auto-detection
        source_type = None if args.source_type == "auto" or args.source_type is None else args.source_type

        parse_authority_document(
            job_id=args.job_id,
            cache_path=Path(args.cache_path),
            url=args.url,
            source_type=source_type,
        )
        return 0

    except FileNotFoundError as e:
        print(f"[ERROR] File error: {e}", file=sys.stderr)
        return 1

    except Exception as e:
        print(f"[ERROR] Parse error: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
