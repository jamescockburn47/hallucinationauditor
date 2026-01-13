#!/usr/bin/env python3
"""
Parse Akoma Ntoso XML from Find Case Law into structured format.

Usage:
    python scripts/parse_fcl_xml.py --job-id JOB --xml-path PATH --output JSON

Output:
    Parsed authority JSON with title, case name, court, paragraphs, full text
"""

import argparse
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Dict, Any, List, Optional
from datetime import datetime, timezone

from utils.file_helpers import safe_write_json, safe_read_text
from utils.hash_helpers import sha256_file


# Akoma Ntoso namespaces
NAMESPACES = {
    "akn": "http://docs.oasis-open.org/legaldocml/ns/akn/3.0",
    "uk": "https://caselaw.nationalarchives.gov.uk/akn",
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


def parse_fcl_xml(xml_content: str, source_url: Optional[str] = None) -> Dict[str, Any]:
    """
    Parse Find Case Law Akoma Ntoso XML.

    Args:
        xml_content: Raw XML string
        source_url: Source URL (optional, for metadata)

    Returns:
        Parsed authority dict

    Raises:
        ET.ParseError: If XML is malformed
    """
    try:
        root = ET.fromstring(xml_content.encode("utf-8"))
    except ET.ParseError as e:
        return {
            "parse_status": "error",
            "error": f"XML parse error: {e}",
            "source_url": source_url,
        }

    result = {
        "parse_status": "success",
        "parsed_at": datetime.now(timezone.utc).isoformat(),
        "source": "find_case_law",
        "source_url": source_url,
        "title": None,
        "case_name": None,
        "neutral_citation": None,
        "court": None,
        "date": None,
        "paragraphs": [],
        "full_text": None,
    }

    # Extract metadata from <meta>
    meta = root.find(".//akn:meta", NAMESPACES)
    if meta is not None:
        # Title
        doc_title = meta.find(".//akn:FRBRname", NAMESPACES)
        if doc_title is not None and doc_title.get("value"):
            result["title"] = doc_title.get("value")

        # Neutral citation
        citation_elem = meta.find(".//akn:FRBRnumber", NAMESPACES)
        if citation_elem is not None and citation_elem.get("value"):
            result["neutral_citation"] = citation_elem.get("value")

        # Date
        date_elem = meta.find(".//akn:FRBRdate", NAMESPACES)
        if date_elem is not None and date_elem.get("date"):
            result["date"] = date_elem.get("date")

        # Court (from FRBRauthor)
        court_elem = meta.find(".//akn:FRBRauthor", NAMESPACES)
        if court_elem is not None and court_elem.get("as"):
            result["court"] = court_elem.get("as")

    # Extract case name from title (fallback)
    if not result["title"]:
        name_elem = root.find(".//akn:docTitle", NAMESPACES)
        if name_elem is not None:
            result["title"] = extract_text_recursive(name_elem)

    # Set case_name to title (FCL uses FRBRname for case name)
    result["case_name"] = result["title"]

    # Extract judgment body
    judgment = root.find(".//akn:judgment", NAMESPACES)
    if judgment is None:
        # Some documents may use different structure
        judgment = root.find(".//akn:body", NAMESPACES)

    if judgment is not None:
        # Extract paragraphs
        paragraphs = []
        for para in judgment.findall(".//akn:paragraph", NAMESPACES):
            para_num = para.get("eId", None)
            para_text = extract_text_recursive(para)
            if para_text:
                paragraphs.append(
                    {
                        "num": para_num,
                        "text": para_text,
                    }
                )

        # Also try numbered paragraphs (num elements)
        for num_para in judgment.findall(".//akn:num", NAMESPACES):
            parent = num_para.getparent() if hasattr(num_para, 'getparent') else None
            if parent is not None:
                para_num = extract_text_recursive(num_para)
                para_text = extract_text_recursive(parent)
                if para_text and para_text not in [p["text"] for p in paragraphs]:
                    paragraphs.append(
                        {
                            "num": para_num,
                            "text": para_text,
                        }
                    )

        result["paragraphs"] = paragraphs
        result["full_text"] = extract_text_recursive(judgment)

    # If no paragraphs found, try extracting full document text
    if not result["full_text"]:
        result["full_text"] = extract_text_recursive(root)

    return result


def main() -> int:
    """
    CLI entry point.

    Returns:
        Exit code (0=success, 1=error)
    """
    parser = argparse.ArgumentParser(
        description="Parse Find Case Law Akoma Ntoso XML"
    )
    parser.add_argument("--job-id", required=True, help="Job identifier")
    parser.add_argument("--xml-path", required=True, help="Path to XML file")
    parser.add_argument("--output", required=True, help="Output JSON path")
    parser.add_argument("--url", help="Source URL (for metadata)")

    args = parser.parse_args()

    try:
        xml_path = Path(args.xml_path)
        if not xml_path.exists():
            print(f"[ERROR] XML file not found: {xml_path}", file=sys.stderr)
            return 1

        # Read XML
        xml_content = safe_read_text(xml_path, encoding="utf-8")

        # Parse
        result = parse_fcl_xml(xml_content, source_url=args.url)

        # Add file metadata (handle relative paths safely)
        try:
            source_file_str = str(xml_path.relative_to(Path.cwd()))
        except ValueError:
            source_file_str = str(xml_path)

        result["source_file"] = source_file_str
        result["source_hash"] = sha256_file(xml_path)

        # Write output
        safe_write_json(Path(args.output), result)

        # Print summary
        if result["parse_status"] == "success":
            title = result.get("title", "Unknown")
            para_count = len(result.get("paragraphs", []))
            text_len = len(result.get("full_text", ""))
            print(f"[OK] Parsed: {title}")
            print(f"[OK] Paragraphs: {para_count}, Full text: {text_len} chars")
        else:
            error = result.get("error", "Unknown error")
            print(f"[ERROR] Parse failed: {error}", file=sys.stderr)

        return 0 if result["parse_status"] == "success" else 1

    except Exception as e:
        print(f"[ERROR] Parse error: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
