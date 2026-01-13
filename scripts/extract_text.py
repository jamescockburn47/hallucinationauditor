#!/usr/bin/env python3
"""
Extract plain text from documents (PDF/HTML/TXT) into structured JSON.

Usage:
    python scripts/extract_text.py --job-id JOB_ID --doc-id DOC_ID --doc-path PATH --doc-type TYPE

Output:
    cache/<job_id>/<doc_id>.text.json
"""

import argparse
import sys
from pathlib import Path
from datetime import datetime, timezone
from typing import Dict, Any

# PyMuPDF for PDF extraction
try:
    import fitz  # PyMuPDF
except ImportError:
    fitz = None

# BeautifulSoup for HTML extraction
try:
    from bs4 import BeautifulSoup
except ImportError:
    BeautifulSoup = None

from utils.cache_helpers import write_cache_json
from utils.file_helpers import safe_read_text
from utils.validation import validate_document_type
from utils.hash_helpers import sha256_file


def extract_text_from_pdf(doc_path: Path) -> Dict[str, Any]:
    """
    Extract text from PDF using PyMuPDF.

    Args:
        doc_path: Path to PDF file

    Returns:
        dict with text and metadata

    Raises:
        ImportError: If PyMuPDF not installed
        Exception: If PDF extraction fails
    """
    if fitz is None:
        raise ImportError("PyMuPDF (fitz) not installed. Install with: pip install PyMuPDF")

    try:
        doc = fitz.open(doc_path)

        # Extract text from all pages
        text_parts = []
        for page_num, page in enumerate(doc, 1):
            page_text = page.get_text()
            if page_text.strip():
                text_parts.append(page_text)

        full_text = "\n\n".join(text_parts)
        page_count = len(doc)

        doc.close()

        return {
            "text": full_text,
            "page_count": page_count,
            "char_count": len(full_text),
            "extraction_method": "pymupdf",
        }

    except Exception as e:
        raise Exception(f"PDF extraction failed: {e}") from e


def extract_text_from_html(doc_path: Path) -> Dict[str, Any]:
    """
    Extract text from HTML using BeautifulSoup.

    Args:
        doc_path: Path to HTML file

    Returns:
        dict with text and metadata

    Raises:
        ImportError: If BeautifulSoup not installed
        Exception: If HTML extraction fails
    """
    if BeautifulSoup is None:
        raise ImportError(
            "BeautifulSoup not installed. Install with: pip install beautifulsoup4 lxml"
        )

    try:
        html_content = safe_read_text(doc_path)
        soup = BeautifulSoup(html_content, "lxml")

        # Remove script and style elements
        for script in soup(["script", "style"]):
            script.decompose()

        # Get text
        text = soup.get_text(separator="\n")

        # Clean up whitespace
        lines = [line.strip() for line in text.splitlines()]
        text = "\n".join(line for line in lines if line)

        return {
            "text": text,
            "char_count": len(text),
            "extraction_method": "beautifulsoup",
        }

    except Exception as e:
        raise Exception(f"HTML extraction failed: {e}") from e


def extract_text_from_txt(doc_path: Path) -> Dict[str, Any]:
    """
    Extract text from plain text file.

    Args:
        doc_path: Path to TXT file

    Returns:
        dict with text and metadata

    Raises:
        Exception: If text extraction fails
    """
    try:
        # Try UTF-8 first
        try:
            text = safe_read_text(doc_path, encoding="utf-8")
        except UnicodeDecodeError:
            # Fallback to latin-1
            text = safe_read_text(doc_path, encoding="latin-1")

        return {
            "text": text,
            "char_count": len(text),
            "extraction_method": "plain_text",
        }

    except Exception as e:
        raise Exception(f"Text extraction failed: {e}") from e


def extract_text_from_document(
    job_id: str, doc_id: str, doc_path: Path, doc_type: str
) -> Dict[str, Any]:
    """
    Extract text from document.

    Args:
        job_id: Job identifier
        doc_id: Document identifier
        doc_path: Path to document file
        doc_type: Document type (pdf, html, txt)

    Returns:
        Extraction result with text and metadata

    Raises:
        FileNotFoundError: If document not found
        ValueError: If document type unsupported
        Exception: If extraction fails
    """
    # Validate inputs
    validation = validate_document_type(doc_type)
    if not validation:
        raise ValueError(f"Invalid document type: {', '.join(validation.errors)}")

    if not doc_path.exists():
        raise FileNotFoundError(f"Document not found: {doc_path}")

    # Extract based on type
    if doc_type == "pdf":
        metadata = extract_text_from_pdf(doc_path)
    elif doc_type == "html":
        metadata = extract_text_from_html(doc_path)
    elif doc_type == "txt":
        metadata = extract_text_from_txt(doc_path)
    else:
        raise ValueError(f"Unsupported document type: {doc_type}")

    # Build result
    result = {
        "doc_id": doc_id,
        "doc_type": doc_type,
        "extracted_at": datetime.now(timezone.utc).isoformat(),
        "text": metadata["text"],
        "metadata": {
            "char_count": metadata["char_count"],
            "extraction_method": metadata["extraction_method"],
            "source_hash": sha256_file(doc_path),
        },
    }

    # Add PDF-specific metadata
    if "page_count" in metadata:
        result["metadata"]["page_count"] = metadata["page_count"]

    # Write to cache
    output_path = write_cache_json(job_id, f"{doc_id}.text.json", result)

    print(f"[OK] Extracted {doc_id} ({metadata['char_count']} chars)")
    print(f"  Output: {output_path}")

    return result


def main() -> int:
    """
    CLI entry point.

    Returns:
        Exit code (0=success, 1=validation error, 2=extraction error)
    """
    parser = argparse.ArgumentParser(
        description="Extract text from documents (PDF/HTML/TXT)"
    )
    parser.add_argument("--job-id", required=True, help="Job identifier")
    parser.add_argument("--doc-id", required=True, help="Document identifier")
    parser.add_argument("--doc-path", required=True, help="Path to document")
    parser.add_argument(
        "--doc-type", required=True, choices=["pdf", "html", "txt"], help="Document type"
    )

    args = parser.parse_args()

    try:
        extract_text_from_document(
            job_id=args.job_id,
            doc_id=args.doc_id,
            doc_path=Path(args.doc_path),
            doc_type=args.doc_type,
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
