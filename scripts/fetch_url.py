#!/usr/bin/env python3
"""
Fetch URL with caching, source-specific rate limiting, and metadata recording.

Usage:
    python scripts/fetch_url.py --job-id JOB_ID --url URL [--rate-limit MS] [--timeout SEC]

Output:
    sources/<job_id>/<sha256>.html (content)
    sources/<job_id>/<sha256>.meta.json (metadata)

Rate Limiting:
    - Find Case Law: 1 req/sec (1000ms default)
    - BAILII: 1 req/sec (1000ms default)
    - Other sources: 1 req/sec (1000ms default)
"""

import argparse
import sys
import time
from pathlib import Path
from datetime import datetime, timezone
from typing import Dict, Any, Optional
from urllib.parse import urlparse

try:
    import requests
except ImportError:
    requests = None

from utils.cache_helpers import ensure_sources_dir, get_sources_path
from utils.file_helpers import safe_write_bytes, safe_write_json
from utils.hash_helpers import sha256_bytes
from utils.validation import validate_url


# Source-specific rate limiter state
_last_fetch_by_source: Dict[str, float] = {}

# Source-specific rate limits (ms)
SOURCE_RATE_LIMITS = {
    "find_case_law": 1000,  # 1 req/sec
    "bailii": 1000,  # 1 req/sec
    "default": 1000,  # 1 req/sec for unknown sources
}


def detect_source(url: str) -> str:
    """
    Detect source type from URL.

    Args:
        url: URL to check

    Returns:
        Source identifier (find_case_law, bailii, or default)
    """
    hostname = urlparse(url).hostname or ""
    hostname = hostname.lower()

    if "caselaw.nationalarchives.gov.uk" in hostname:
        return "find_case_law"
    elif "bailii.org" in hostname:
        return "bailii"
    else:
        return "default"


def rate_limit_wait(url: str, rate_limit_ms: Optional[int] = None) -> None:
    """
    Sleep if needed to enforce source-specific rate limit.

    Args:
        url: URL being fetched (for source detection)
        rate_limit_ms: Override rate limit in milliseconds (None = use source default)
    """
    global _last_fetch_by_source

    # Detect source
    source = detect_source(url)

    # Get rate limit (override or source-specific default)
    if rate_limit_ms is None:
        rate_limit_ms = SOURCE_RATE_LIMITS.get(source, SOURCE_RATE_LIMITS["default"])

    # Check if we need to wait
    last_fetch = _last_fetch_by_source.get(source)
    if last_fetch is not None:
        elapsed_ms = (time.time() - last_fetch) * 1000
        if elapsed_ms < rate_limit_ms:
            sleep_ms = rate_limit_ms - elapsed_ms
            print(f"[WAIT] Rate limiting ({source}): sleeping {sleep_ms:.0f}ms")
            time.sleep(sleep_ms / 1000)

    # Update last fetch time for this source
    _last_fetch_by_source[source] = time.time()


def fetch_and_cache_url(
    job_id: str,
    url: str,
    rate_limit_ms: Optional[int] = None,
    timeout_sec: int = 30,
    force_refetch: bool = False,
    user_agent: str = "HallucinationAuditor/0.2.0",
) -> Dict[str, Any]:
    """
    Fetch URL and cache with metadata using source-specific rate limiting.

    Args:
        job_id: Job identifier
        url: URL to fetch
        rate_limit_ms: Override rate limit in milliseconds (None = use source default)
        timeout_sec: Request timeout in seconds (default: 30)
        force_refetch: Bypass cache (default: False)
        user_agent: User-Agent header (default: HallucinationAuditor/0.2.0)

    Returns:
        dict with fetch result and metadata

    Raises:
        ImportError: If requests library not installed
        ValueError: If URL is invalid
        Exception: If fetch fails
    """
    if requests is None:
        raise ImportError("requests library not installed. Install with: pip install requests")

    # Validate URL
    if not validate_url(url):
        raise ValueError(f"Invalid URL: {url}")

    # Ensure sources directory exists
    ensure_sources_dir(job_id)

    # Detect source for metadata
    source = detect_source(url)

    # Try to fetch (will compute hash to check cache)
    rate_limit_wait(url, rate_limit_ms)

    try:
        # Make request with retry logic
        max_retries = 3
        retry_delay = 1.0

        for attempt in range(max_retries):
            try:
                response = requests.get(
                    url,
                    timeout=timeout_sec,
                    headers={"User-Agent": user_agent},
                    allow_redirects=True,
                )

                # Check if successful
                if response.status_code == 200:
                    break

                # Handle specific status codes
                if response.status_code == 404:
                    return {
                        "url": url,
                        "fetched_at": datetime.now(timezone.utc).isoformat(),
                        "status_code": 404,
                        "fetch_status": "not_found",
                        "error": "404 Not Found",
                    }

                if response.status_code == 429:  # Rate limit
                    if attempt < max_retries - 1:
                        sleep_time = retry_delay * (2**attempt)
                        print(f"[WAIT] Rate limited (429), waiting {sleep_time:.1f}s...")
                        time.sleep(sleep_time)
                        continue

                # Other error status
                return {
                    "url": url,
                    "fetched_at": datetime.now(timezone.utc).isoformat(),
                    "status_code": response.status_code,
                    "fetch_status": "error",
                    "error": f"HTTP {response.status_code}",
                }

            except requests.Timeout:
                if attempt < max_retries - 1:
                    print(f"[WAIT] Timeout, retrying ({attempt + 1}/{max_retries})...")
                    time.sleep(retry_delay)
                    continue
                else:
                    return {
                        "url": url,
                        "fetched_at": datetime.now(timezone.utc).isoformat(),
                        "status_code": 0,
                        "fetch_status": "timeout",
                        "error": "Request timeout",
                    }

            except requests.RequestException as e:
                if attempt < max_retries - 1:
                    print(f"[WAIT] Network error, retrying ({attempt + 1}/{max_retries})...")
                    time.sleep(retry_delay)
                    continue
                else:
                    return {
                        "url": url,
                        "fetched_at": datetime.now(timezone.utc).isoformat(),
                        "status_code": 0,
                        "fetch_status": "error",
                        "error": str(e),
                    }

        # Get content and compute hash
        content = response.content
        content_hash = sha256_bytes(content)

        # Determine file extension from Content-Type
        content_type = response.headers.get("Content-Type", "text/html")
        if "html" in content_type:
            ext = ".html"
        elif "json" in content_type:
            ext = ".json"
        elif "xml" in content_type:
            ext = ".xml"
        else:
            ext = ".html"  # Default to HTML

        # Check if already cached
        cache_filename = f"{content_hash}{ext}"
        cache_path = get_sources_path(job_id, cache_filename)

        if cache_path.exists() and not force_refetch:
            print(f"[OK] Cached (deduped - already exists)")
            return {
                "url": url,
                "fetched_at": datetime.now(timezone.utc).isoformat(),
                "status_code": response.status_code,
                "content_hash": content_hash,
                "cache_path": str(cache_path),
                "fetch_status": "cached",
                "metadata": {
                    "content_type": content_type,
                    "content_length": len(content),
                },
            }

        # Write content to cache
        safe_write_bytes(cache_path, content)

        # Write metadata
        metadata = {
            "url": url,
            "source": source,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            "status_code": response.status_code,
            "content_hash": content_hash,
            "cache_path": str(cache_path),
            "metadata": {
                "content_type": content_type,
                "content_length": len(content),
                "headers": dict(response.headers),
                "redirects": [r.url for r in response.history] if response.history else [],
            },
            "fetch_status": "success",
        }

        # Write metadata file
        meta_path = cache_path.with_suffix(cache_path.suffix + ".meta.json")
        safe_write_json(meta_path, metadata)

        print(f"[OK] Fetched ({len(content)} bytes)")
        print(f"  Cached: {cache_path}")

        return metadata

    except Exception as e:
        raise Exception(f"Fetch failed: {e}") from e


def main() -> int:
    """
    CLI entry point.

    Returns:
        Exit code (0=success, 1=validation error, 2=fetch error)
    """
    parser = argparse.ArgumentParser(description="Fetch URL with caching and rate limiting")
    parser.add_argument("--job-id", required=True, help="Job identifier")
    parser.add_argument("--url", required=True, help="URL to fetch")
    parser.add_argument(
        "--rate-limit", type=int, default=1000, help="Rate limit in milliseconds (default: 1000)"
    )
    parser.add_argument(
        "--timeout", type=int, default=30, help="Timeout in seconds (default: 30)"
    )
    parser.add_argument("--force", action="store_true", help="Force refetch (bypass cache)")

    args = parser.parse_args()

    try:
        result = fetch_and_cache_url(
            job_id=args.job_id,
            url=args.url,
            rate_limit_ms=args.rate_limit,
            timeout_sec=args.timeout,
            force_refetch=args.force,
        )

        # Print result for scripting
        if result["fetch_status"] in ["error", "not_found", "timeout"]:
            print(f"[ERROR] Fetch failed: {result.get('error', 'Unknown error')}", file=sys.stderr)
            return 2

        return 0

    except ValueError as e:
        print(f"[ERROR] Validation error: {e}", file=sys.stderr)
        return 1

    except Exception as e:
        print(f"[ERROR] Fetch error: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
