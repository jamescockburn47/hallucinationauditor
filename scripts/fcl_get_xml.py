#!/usr/bin/env python3
"""
Retrieve document XML from Find Case Law by Document URI.

Usage:
    python scripts/fcl_get_xml.py --job-id JOB_ID --document-uri URI --output PATH

Output:
    JSON with cache_path, content_hash, metadata
"""

import argparse
import sys
from pathlib import Path
from typing import Dict, Any, Optional
from datetime import datetime, timezone

try:
    import requests
except ImportError:
    requests = None

from utils.file_helpers import safe_write_json
from utils.hash_helpers import sha256_bytes
from utils.validation import validate_url


# Find Case Law base URL
FCL_BASE_URL = "https://caselaw.nationalarchives.gov.uk"


def fetch_fcl_document_xml(
    job_id: str,
    document_uri: str,
    rate_limit_sec: float = 1.0,
    timeout_sec: int = 30,
    max_retries: int = 3,
) -> Dict[str, Any]:
    """
    Fetch document XML from Find Case Law.

    Args:
        job_id: Job identifier for cache organization
        document_uri: Document URI (e.g., "uksc/2015/11" or "d-uuid-style")
        rate_limit_sec: Delay between requests (default: 1.0 second)
        timeout_sec: Request timeout (default: 30 seconds)
        max_retries: Number of retry attempts (default: 3)

    Returns:
        dict with cache_path, content_hash, fetch_status, metadata

    Raises:
        ImportError: If requests library not installed
        Exception: If fetch fails after retries
    """
    if requests is None:
        raise ImportError("requests library not installed")

    # Construct URL
    # Document URI should NOT have leading slash
    document_uri_clean = document_uri.lstrip("/")
    url = f"{FCL_BASE_URL}/{document_uri_clean}/data.xml"

    # Validate URL (basic check)
    try:
        from urllib.parse import urlparse
        parsed = urlparse(url)
        if not parsed.scheme or not parsed.netloc:
            return {
                "fetched_at": datetime.now(timezone.utc).isoformat(),
                "url": url,
                "fetch_status": "invalid_url",
                "error": "Invalid URL format",
            }
    except Exception as e:
        return {
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            "url": url,
            "fetch_status": "invalid_url",
            "error": str(e),
        }

    # Prepare cache directory
    sources_dir = Path("sources") / job_id
    sources_dir.mkdir(parents=True, exist_ok=True)

    # Retry logic
    last_error = None
    for attempt in range(1, max_retries + 1):
        try:
            # Rate limiting (simple sleep)
            if attempt > 1:
                import time
                backoff = rate_limit_sec * (2 ** (attempt - 2))  # Exponential backoff
                time.sleep(backoff)

            # Fetch
            response = requests.get(
                url,
                timeout=timeout_sec,
                headers={"User-Agent": "HallucinationAuditor/0.2.0"},
            )

            # Handle non-200 responses
            if response.status_code == 404:
                return {
                    "fetched_at": datetime.now(timezone.utc).isoformat(),
                    "url": url,
                    "fetch_status": "not_found",
                    "http_status": 404,
                    "error": "Document not found",
                }
            elif response.status_code == 429:
                # Rate limited - retry with longer backoff
                last_error = f"Rate limited (429) on attempt {attempt}/{max_retries}"
                continue
            elif response.status_code != 200:
                return {
                    "fetched_at": datetime.now(timezone.utc).isoformat(),
                    "url": url,
                    "fetch_status": "http_error",
                    "http_status": response.status_code,
                    "error": f"HTTP {response.status_code}",
                }

            # Success - compute hash and cache
            content = response.content
            content_hash = sha256_bytes(content)

            # Write to cache (content-addressed by hash)
            cache_filename = f"{content_hash}.xml"
            cache_path = sources_dir / cache_filename
            cache_path.write_bytes(content)

            # Get relative path safely
            try:
                cache_path_str = str(cache_path.relative_to(Path.cwd()))
            except ValueError:
                # Path is already relative or outside cwd
                cache_path_str = str(cache_path)

            # Write metadata
            metadata = {
                "source": "find_case_law",
                "document_uri": document_uri_clean,
                "url": url,
                "fetched_at": datetime.now(timezone.utc).isoformat(),
                "http_status": response.status_code,
                "content_type": response.headers.get("Content-Type", "application/xml"),
                "content_length": len(content),
                "content_hash": content_hash,
                "cache_path": cache_path_str,
            }

            meta_path = cache_path.with_suffix(".xml.meta.json")
            safe_write_json(meta_path, metadata)

            # Get metadata path safely
            try:
                meta_path_str = str(meta_path.relative_to(Path.cwd()))
            except ValueError:
                meta_path_str = str(meta_path)

            return {
                "fetched_at": metadata["fetched_at"],
                "url": url,
                "fetch_status": "success",
                "http_status": 200,
                "cache_path": cache_path_str,
                "content_hash": content_hash,
                "content_length": len(content),
                "metadata_path": meta_path_str,
            }

        except requests.Timeout:
            last_error = f"Timeout on attempt {attempt}/{max_retries}"
        except requests.RequestException as e:
            last_error = f"Request error on attempt {attempt}/{max_retries}: {e}"
        except Exception as e:
            last_error = f"Unexpected error on attempt {attempt}/{max_retries}: {e}"

    # All retries exhausted
    return {
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "url": url,
        "fetch_status": "failed",
        "error": last_error or "Unknown error",
        "retries_exhausted": max_retries,
    }


def main() -> int:
    """
    CLI entry point.

    Returns:
        Exit code (0=success, 1=error)
    """
    parser = argparse.ArgumentParser(
        description="Retrieve document XML from Find Case Law"
    )
    parser.add_argument("--job-id", required=True, help="Job identifier")
    parser.add_argument(
        "--document-uri",
        required=True,
        help='Document URI (e.g., "uksc/2015/11" or "d-uuid")',
    )
    parser.add_argument("--output", required=True, help="Output JSON path")
    parser.add_argument(
        "--rate-limit",
        type=float,
        default=1.0,
        help="Rate limit in seconds (default: 1.0)",
    )

    args = parser.parse_args()

    try:
        result = fetch_fcl_document_xml(
            job_id=args.job_id,
            document_uri=args.document_uri,
            rate_limit_sec=args.rate_limit,
        )

        # Write output
        safe_write_json(Path(args.output), result)

        # Print status
        status = result.get("fetch_status", "unknown")
        if status == "success":
            cache_path = result.get("cache_path", "N/A")
            content_hash = result.get("content_hash", "N/A")[:16]
            size = result.get("content_length", 0)
            print(f"[OK] Fetched: {cache_path}")
            print(f"[OK] Hash: {content_hash}... ({size} bytes)")
        elif status == "not_found":
            print(f"[WARN] Document not found: {args.document_uri}", file=sys.stderr)
        else:
            error = result.get("error", "Unknown error")
            print(f"[ERROR] Fetch failed: {error}", file=sys.stderr)

        return 0 if status == "success" else 1

    except Exception as e:
        print(f"[ERROR] Fetch error: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
