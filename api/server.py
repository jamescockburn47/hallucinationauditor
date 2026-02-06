#!/usr/bin/env python3
"""
Minimal CORS Proxy for Citation Auditor.

PRIVACY ARCHITECTURE:
    - All document parsing happens in the user's browser (client-side)
    - All citation extraction happens in the user's browser (client-side)
    - All citation URL construction happens in the user's browser (client-side)
    - This server is ONLY a CORS proxy for fetching public legal databases
      (BAILII, Find Case Law) which do not support browser cross-origin requests
    - NO document content ever reaches this server
    - The server only sees: public URLs to fetch, or citation strings for search

Endpoints:
    POST /api/resolve-citation-urls  - Search BAILII/FCL for citation URLs
    POST /api/proxy-fetch            - CORS proxy to fetch a public legal URL
    GET  /health                     - Health check

Usage:
    cd hallucination-auditor
    python -m api.server
"""

import sys
import os
import re
import logging
from pathlib import Path
from datetime import datetime, timezone
from typing import List, Optional, Dict, Any

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Add the scripts directory to path for proper imports
SCRIPT_DIR = Path(__file__).parent.parent / "scripts"
sys.path.insert(0, str(SCRIPT_DIR))
sys.path.insert(0, str(Path(__file__).parent.parent))

# Change working directory for consistent paths
os.chdir(Path(__file__).parent.parent)

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel

# Import citation resolution from scripts
from public_resolve import resolve_citation_to_urls

# Optional: for proxy fetching
try:
    import requests as http_requests
    HAS_REQUESTS = True
except ImportError:
    HAS_REQUESTS = False


# ===== Pydantic Models =====

class CitationSearchItem(BaseModel):
    """A citation string to search for."""
    citation: str
    case_name: Optional[str] = None


class CitationSearchRequest(BaseModel):
    """Request to search for citation URLs. No document content."""
    citations: List[CitationSearchItem]


class ResolvedUrl(BaseModel):
    """A resolved citation with its URL(s)."""
    citation: str
    case_name: Optional[str] = None
    urls: List[Dict[str, Any]] = []
    status: str  # 'resolved', 'not_found'
    error: Optional[str] = None


class CitationSearchResponse(BaseModel):
    """Response with resolved URLs for citations."""
    resolved: List[ResolvedUrl]
    summary: Dict[str, int]


class ProxyFetchRequest(BaseModel):
    """Request to proxy-fetch a public URL."""
    url: str


class ProxyFetchResponse(BaseModel):
    """Response from proxy-fetching a URL."""
    url: str
    status_code: int
    content_type: str
    content: str
    ok: bool


# Legacy models for backward compatibility with existing UI
class CitationWithContext(BaseModel):
    """A citation with optional context like case name"""
    citation: str
    case_name: Optional[str] = None
    claim_text: Optional[str] = None


class CitationResolveRequest(BaseModel):
    """Request to resolve citations - backward compatible"""
    citations: List[str] = []
    citations_with_context: Optional[List[CitationWithContext]] = None
    web_search_enabled: bool = False


class ResolvedCitation(BaseModel):
    """Citation with resolved judgment data - backward compatible"""
    citation: str
    case_name: Optional[str] = None
    source_type: str
    url: Optional[str] = None
    title: Optional[str] = None
    paragraphs: List[Dict[str, Any]] = []
    error: Optional[str] = None


class CitationResolveResponse(BaseModel):
    """Response with resolved citations - backward compatible"""
    resolved: List[ResolvedCitation]
    summary: Dict[str, int]


# ===== App Setup =====

app = FastAPI(
    title="Citation Auditor Proxy",
    description="Minimal CORS proxy for legal citation resolution. No document content is processed.",
    version="0.3.0"
)

# CORS - allow all origins (this is a public proxy for public data)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# NO AUTH - removed password protection. This is a public tool.

# Static directory path for frontend files
STATIC_DIR = Path(__file__).parent.parent / "static"

# Mount assets directory if it exists
if STATIC_DIR.exists() and (STATIC_DIR / "assets").exists():
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")


# ===== Allowed URL domains for proxy =====
ALLOWED_PROXY_DOMAINS = [
    "www.bailii.org",
    "bailii.org",
    "caselaw.nationalarchives.gov.uk",
]


def is_allowed_proxy_url(url: str) -> bool:
    """Check if a URL is allowed for proxying (only legal databases)."""
    try:
        from urllib.parse import urlparse
        parsed = urlparse(url)
        return parsed.hostname in ALLOWED_PROXY_DOMAINS
    except Exception:
        return False


def extract_case_name_from_citation(citation_text: str) -> Optional[str]:
    """Extract case name from a citation string like 'Montgomery v Lanarkshire [2015] UKSC 11'."""
    match = re.match(r'^(.*?)\s*\[\d{4}\]', citation_text.strip())
    if match:
        name = match.group(1).strip()
        if name and len(name) > 2:
            return name
    return None


def verify_case_name_match(claimed_name: str, actual_name: str) -> bool:
    """
    Verify that the claimed case name matches the actual case name.
    Detects Type 1 hallucinations (fabricated cases).
    """
    if not claimed_name or not actual_name:
        return True

    def normalize(name: str) -> str:
        name = name.lower().strip()
        name = re.sub(r'\s*\(rev\s*\d*\)\s*$', '', name)
        name = re.sub(r'\s*\[.*?\]\s*', ' ', name)
        name = re.sub(r'\s+v\.?\s+', ' v ', name)
        name = re.sub(r'\s+(plc|ltd|limited|inc|llc|llp)\b', '', name)
        name = re.sub(r'\s+', ' ', name).strip()
        return name

    norm_claimed = normalize(claimed_name)
    norm_actual = normalize(actual_name)

    if norm_claimed == norm_actual:
        return True
    if norm_claimed in norm_actual or norm_actual in norm_claimed:
        return True

    def extract_parties(name: str) -> set:
        stop_words = {'r', 'v', 'the', 'and', 'of', 'for', 'in', 'on', 'a', 'an',
                      'secretary', 'state', 'home', 'department', 'commissioner',
                      'council', 'borough', 'county', 'city', 'district'}
        words = set(re.findall(r'\b[a-z]{3,}\b', name.lower()))
        return words - stop_words

    claimed_parties = extract_parties(norm_claimed)
    actual_parties = extract_parties(norm_actual)

    if not claimed_parties or not actual_parties:
        return True

    intersection = claimed_parties & actual_parties
    union = claimed_parties | actual_parties

    if not union:
        return True
    if len(intersection) / len(union) >= 0.3:
        return True
    if len(intersection) >= 1:
        return True

    return False


# ===== API Routes =====

class BatchCheckRequest(BaseModel):
    """Request to check if multiple URLs exist (HEAD requests only)."""
    urls: List[str]


class UrlCheckResult(BaseModel):
    """Result of a single URL existence check."""
    url: str
    exists: bool
    status_code: int
    title: Optional[str] = None


class BatchCheckResponse(BaseModel):
    """Response with URL existence results."""
    results: List[UrlCheckResult]


@app.post("/api/check-urls", response_model=BatchCheckResponse)
async def check_urls_exist(request: BatchCheckRequest):
    """
    Lightweight existence check for BAILII/FCL URLs using HEAD requests.

    The browser constructs URLs client-side and sends them here
    just to check if they return 200 (case exists) or 404 (not found).
    Minimal traffic - HEAD requests only, no content fetched.
    """
    import asyncio
    from concurrent.futures import ThreadPoolExecutor

    def check_single_url(url: str) -> UrlCheckResult:
        if not is_allowed_proxy_url(url):
            return UrlCheckResult(url=url, exists=False, status_code=403)

        if not HAS_REQUESTS:
            return UrlCheckResult(url=url, exists=False, status_code=500)

        try:
            # Full GET to validate content (BAILII returns 200 even for non-existent cases)
            resp = http_requests.get(
                url, timeout=12,
                headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"},
                allow_redirects=True,
            )

            if resp.status_code != 200:
                return UrlCheckResult(url=url, exists=False, status_code=resp.status_code)

            content = resp.text
            lower = content.lower()

            # Check for error/not-found/redirect pages
            if "page not found" in lower[:1000] or "error 404" in lower[:1000]:
                return UrlCheckResult(url=url, exists=False, status_code=404)

            # BAILII: check for actual case content (BAILII returns 200 for empty/stub pages)
            if "bailii.org" in url:
                # Real BAILII case pages have judgment text - check for legal indicators
                legal_indicators = ["judgment", "court", "justice", "appeal", "claimant",
                                    "defendant", "respondent", "appellant", "held", "ordered",
                                    "lordship", "honour", "tribunal", "act"]
                matches = sum(1 for ind in legal_indicators if ind in lower)
                # Also check content length - real judgments are substantial
                if matches < 3 or len(content) < 3000:
                    return UrlCheckResult(url=url, exists=False, status_code=404)

            # FCL XML: check for Akoma Ntoso structure
            if url.endswith(".xml"):
                if "<akomantoso" not in lower and "<frbrwork" not in lower:
                    return UrlCheckResult(url=url, exists=False, status_code=404)

            # FCL HTML: check for real case content (not "Page not found")
            if "caselaw.nationalarchives.gov.uk" in url and not url.endswith(".xml"):
                if "page not found" in lower[:2000]:
                    return UrlCheckResult(url=url, exists=False, status_code=404)
                if len(content) < 5000:
                    return UrlCheckResult(url=url, exists=False, status_code=404)

            # Extract title
            title = None
            import re as re_mod
            title_match = re_mod.search(r"<title[^>]*>(.*?)</title>", content[:5000], re_mod.IGNORECASE | re_mod.DOTALL)
            if title_match:
                title = title_match.group(1).strip()[:200]
            # FCL: try FRBRname
            if not title and "<FRBRname" in content:
                name_match = re_mod.search(r'<FRBRname\s+value="([^"]+)"', content)
                if name_match:
                    title = name_match.group(1).strip()[:200]

            return UrlCheckResult(url=url, exists=True, status_code=200, title=title)

        except Exception as e:
            logger.debug(f"URL check failed for {url}: {e}")
            return UrlCheckResult(url=url, exists=False, status_code=0)

    # Run checks in parallel (max 10 concurrent)
    loop = asyncio.get_event_loop()
    max_workers = min(len(request.urls), 10)

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = [
            loop.run_in_executor(executor, check_single_url, url)
            for url in request.urls
        ]
        results = await asyncio.gather(*futures)

    return BatchCheckResponse(results=list(results))


@app.post("/api/proxy-fetch", response_model=ProxyFetchResponse)
async def proxy_fetch(request: ProxyFetchRequest):
    """
    CORS proxy for fetching public legal database URLs.

    PRIVACY: This endpoint only fetches public URLs from BAILII and
    Find Case Law. It does not receive or process any document content.

    Only URLs from allowed domains (bailii.org, caselaw.nationalarchives.gov.uk)
    are permitted.
    """
    if not HAS_REQUESTS:
        raise HTTPException(status_code=500, detail="HTTP client not available")

    url = request.url.strip()

    if not is_allowed_proxy_url(url):
        raise HTTPException(
            status_code=403,
            detail=f"URL domain not allowed. Only BAILII and Find Case Law URLs are permitted."
        )

    try:
        response = http_requests.get(
            url,
            timeout=15,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            },
            allow_redirects=True
        )

        content_type = response.headers.get("content-type", "text/html")

        return ProxyFetchResponse(
            url=url,
            status_code=response.status_code,
            content_type=content_type,
            content=response.text,
            ok=response.status_code == 200
        )

    except http_requests.exceptions.Timeout:
        raise HTTPException(status_code=504, detail="Upstream request timed out")
    except http_requests.exceptions.ConnectionError:
        raise HTTPException(status_code=502, detail="Could not connect to upstream server")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Proxy fetch failed: {str(e)}")


@app.post("/api/resolve-citation-urls", response_model=CitationSearchResponse)
async def resolve_citation_urls(request: CitationSearchRequest):
    """
    Search BAILII and Find Case Law for citation URLs.

    PRIVACY: This endpoint only receives citation strings (e.g., "[2019] UKSC 12")
    and optional case names. No document content is sent or processed.

    Returns only URLs - the browser fetches and parses judgment content itself.
    """
    results = []

    for item in request.citations:
        citation_text = item.citation.strip()
        if not citation_text:
            continue

        case_name = item.case_name or extract_case_name_from_citation(citation_text)

        try:
            resolution = resolve_citation_to_urls(
                citation_text=citation_text,
                case_name=case_name,
            )

            if resolution.get("resolution_status") == "resolved" and resolution.get("candidate_urls"):
                urls = []
                for candidate in resolution["candidate_urls"]:
                    urls.append({
                        "url": candidate.get("url"),
                        "source": candidate.get("source", "unknown"),
                        "confidence": candidate.get("confidence", 0),
                        "title": candidate.get("title"),
                    })

                results.append(ResolvedUrl(
                    citation=citation_text,
                    case_name=resolution.get("case_name") or case_name,
                    urls=urls,
                    status="resolved",
                ))
            else:
                results.append(ResolvedUrl(
                    citation=citation_text,
                    case_name=case_name,
                    urls=[],
                    status="not_found",
                    error="Citation could not be resolved to a URL"
                ))

        except Exception as e:
            logger.error(f"Error resolving {citation_text}: {e}")
            results.append(ResolvedUrl(
                citation=citation_text,
                case_name=case_name,
                urls=[],
                status="not_found",
                error=str(e)
            ))

    found = sum(1 for r in results if r.status == "resolved")
    not_found = len(results) - found

    return CitationSearchResponse(
        resolved=results,
        summary={"total": len(results), "found": found, "not_found": not_found}
    )


# ===== BACKWARD-COMPATIBLE ENDPOINT =====
# Kept for existing UI compatibility. Combines resolution + fetch + parse.

@app.post("/api/resolve-citations", response_model=CitationResolveResponse)
async def resolve_citations_legacy(request: CitationResolveRequest):
    """
    Resolve citations to URLs and fetch judgment paragraphs.
    Backward-compatible endpoint.

    PRIVACY: Only citation strings and case names are processed.
    No document content is sent to this endpoint.
    """
    import asyncio
    from concurrent.futures import ThreadPoolExecutor

    # Build unified list of citations with context
    citations_to_process = []

    if request.citations_with_context:
        for ctx in request.citations_with_context:
            citations_to_process.append({
                "citation": ctx.citation.strip(),
                "case_name": ctx.case_name,
            })

    for citation_text in request.citations:
        citation_text = citation_text.strip()
        if citation_text:
            existing = [c["citation"] for c in citations_to_process]
            if citation_text not in existing:
                citations_to_process.append({
                    "citation": citation_text,
                    "case_name": extract_case_name_from_citation(citation_text),
                })

    num_citations = len(citations_to_process)
    logger.info(f"Resolving {num_citations} citations (privacy mode - no document content)")

    if num_citations == 0:
        return CitationResolveResponse(
            resolved=[],
            summary={"total": 0, "found": 0, "not_found": 0}
        )

    max_workers = min(num_citations, 10)

    loop = asyncio.get_event_loop()
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = [
            loop.run_in_executor(
                executor,
                _resolve_single_citation,
                ctx,
                request.web_search_enabled
            )
            for ctx in citations_to_process
        ]
        resolved_citations = await asyncio.gather(*futures)

    found = sum(1 for r in resolved_citations if r.source_type != "not_found")
    not_found = len(resolved_citations) - found

    return CitationResolveResponse(
        resolved=list(resolved_citations),
        summary={"total": num_citations, "found": found, "not_found": not_found}
    )


def _resolve_single_citation(ctx: dict, web_search_enabled: bool) -> ResolvedCitation:
    """Resolve a single citation. Used for parallel processing."""
    from utils.cache_helpers import ensure_cache_dir
    from fetch_url import fetch_and_cache_url
    from parse_authority import parse_authority_document
    import uuid

    citation_text = ctx["citation"]
    if not citation_text:
        return ResolvedCitation(citation="", source_type="not_found", error="Empty citation")

    case_name = ctx.get("case_name") or extract_case_name_from_citation(citation_text)

    try:
        resolution = resolve_citation_to_urls(
            citation_text=citation_text,
            case_name=case_name,
            enable_web_search=web_search_enabled
        )

        if resolution and resolution.get("resolution_status") == "resolved" and resolution.get("candidate_urls"):
            candidate = resolution["candidate_urls"][0]
            url = candidate["url"]
            source_type = candidate.get("source", "unknown")
            title = resolution.get("case_name") or case_name

            paragraphs = []
            try:
                job_id = f"resolve_{uuid.uuid4().hex[:8]}"
                ensure_cache_dir(job_id)

                fetch_result = fetch_and_cache_url(job_id=job_id, url=url)

                if fetch_result and fetch_result.get("cache_path"):
                    parsed = parse_authority_document(
                        job_id,
                        Path(fetch_result["cache_path"]),
                        url
                    )

                    if parsed:
                        actual_title = parsed.get("title", "")

                        if case_name and actual_title:
                            name_match = verify_case_name_match(case_name, actual_title)
                            if not name_match:
                                return ResolvedCitation(
                                    citation=citation_text,
                                    case_name=case_name,
                                    source_type="not_found",
                                    error=f"Case name mismatch: document is '{actual_title}', not '{case_name}'"
                                )
                            title = actual_title

                        if parsed.get("paragraphs"):
                            paragraphs = [
                                {
                                    "para_num": p.get("para_num", str(i+1)),
                                    "text": p.get("text", ""),
                                    "speaker": p.get("speaker")
                                }
                                for i, p in enumerate(parsed["paragraphs"])
                                if p.get("text") and len(p.get("text", "")) > 20
                            ]

            except Exception as e:
                logger.error(f"Error fetching/parsing {url}: {e}")

            return ResolvedCitation(
                citation=citation_text,
                case_name=case_name or title,
                source_type=source_type,
                url=url,
                title=title,
                paragraphs=paragraphs
            )

        else:
            return ResolvedCitation(
                citation=citation_text,
                case_name=case_name,
                source_type="not_found",
                error="Citation could not be resolved to a URL"
            )

    except Exception as e:
        logger.error(f"Error resolving {citation_text}: {e}")
        return ResolvedCitation(
            citation=citation_text,
            case_name=case_name,
            source_type="not_found",
            error=str(e)
        )


# ===== Health & Static Serving =====

@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "name": "Citation Auditor Proxy",
        "version": "0.3.0",
        "privacy": "No document content is processed. Only citation strings and public URLs."
    }


if STATIC_DIR.exists():
    @app.get("/")
    async def serve_frontend():
        """Serve the frontend index.html."""
        index_path = STATIC_DIR / "index.html"
        if index_path.exists():
            return FileResponse(index_path, headers={"Cache-Control": "no-cache, no-store, must-revalidate"})
        return {"name": "Citation Auditor Proxy", "status": "online", "version": "0.3.0"}

    @app.get("/{path:path}")
    async def serve_static(path: str):
        """Serve static files or fall back to index.html for SPA routing."""
        if path.startswith("api/") or path == "health":
            raise HTTPException(status_code=404, detail="Not found")

        file_path = STATIC_DIR / path
        if file_path.exists() and file_path.is_file():
            if "/assets/" in path and any(c.isdigit() for c in path):
                headers = {"Cache-Control": "public, max-age=31536000, immutable"}
            else:
                headers = {"Cache-Control": "no-cache, no-store, must-revalidate"}
            return FileResponse(file_path, headers=headers)

        index_path = STATIC_DIR / "index.html"
        if index_path.exists():
            return FileResponse(index_path, headers={"Cache-Control": "no-cache, no-store, must-revalidate"})

        raise HTTPException(status_code=404, detail="Not found")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
