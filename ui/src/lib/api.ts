/**
 * API client for the Citation Auditor
 *
 * PRIVACY ARCHITECTURE:
 * - Document parsing happens in the browser (documentParser.ts)
 * - Citation extraction happens in the browser (citationExtractor.ts)
 * - Citation URL construction happens in the browser (citationResolver.ts)
 * - Judgment parsing happens in the browser (judgmentParser.ts)
 *
 * This API client only sends:
 * 1. Public URLs to proxy-fetch (BAILII/FCL URLs for judgment retrieval)
 * 2. Citation strings for search (when neutral citation URL construction fails)
 *
 * NO document content ever leaves the browser.
 */

// In production (when served from same origin), use empty string for relative URLs
// In development, use localhost:8000
const isLocalhost = typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

const API_BASE = import.meta.env.VITE_API_URL ?? (isLocalhost ? 'http://localhost:8000' : '');

export interface JudgmentParagraph {
  para_num: string;
  text: string;
  speaker?: string | null;
}

export interface ResolvedCitation {
  citation: string;
  case_name: string | null;
  source_type: 'fcl' | 'bailii' | 'web_search' | 'not_found';
  url: string | null;
  title: string | null;
  paragraphs: JudgmentParagraph[];
  error?: string | null;
}

export interface CitationResolveResponse {
  resolved: ResolvedCitation[];
  summary: {
    total: number;
    found: number;
    not_found: number;
  };
}

export interface CitationWithContext {
  citation: string;
  case_name?: string | null;
  claim_text?: string | null;
}

/**
 * Proxy-fetch a public URL through the server (CORS proxy).
 *
 * Only BAILII and FCL URLs are allowed. The server does not process
 * the content - it just forwards the HTTP response.
 *
 * @param url - Public BAILII or FCL URL to fetch
 * @returns The fetched content and metadata
 */
export async function proxyFetch(url: string): Promise<{
  content: string;
  status_code: number;
  content_type: string;
  ok: boolean;
}> {
  const response = await fetch(`${API_BASE}/api/proxy-fetch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Proxy fetch failed: ${error}`);
  }

  return response.json();
}

/**
 * Try to fetch a URL directly from the browser (no proxy needed).
 * This will fail for BAILII due to CORS, but may work for FCL.
 *
 * @param url - URL to try fetching directly
 * @returns Content string if successful, null if CORS blocked
 */
export async function tryDirectFetch(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      mode: 'cors',
      headers: { 'Accept': 'text/html, application/xml, text/xml' },
    });

    if (response.ok) {
      return await response.text();
    }
    return null;
  } catch {
    // CORS error or network error - expected for BAILII
    return null;
  }
}

/**
 * Fetch judgment content for a URL, trying direct fetch first,
 * then falling back to the proxy.
 *
 * This maximizes privacy: if the browser can fetch directly from
 * BAILII/FCL, no data goes through our server at all.
 *
 * @param url - BAILII or FCL URL
 * @returns Judgment content string
 */
export async function fetchJudgmentContent(url: string): Promise<string | null> {
  // Try direct fetch first (works for FCL if they support CORS)
  const directContent = await tryDirectFetch(url);
  if (directContent && directContent.length > 500) {
    return directContent;
  }

  // Fall back to proxy
  try {
    const proxyResult = await proxyFetch(url);
    if (proxyResult.ok && proxyResult.content) {
      return proxyResult.content;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Resolve citations to URLs and fetch judgment paragraphs.
 * Uses the legacy endpoint for backward compatibility.
 *
 * PRIVACY: Only citation strings and case names are sent to the server.
 * No document content leaves the browser.
 */
export async function resolveCitations(
  citations: string[] | CitationWithContext[],
  webSearchEnabled: boolean = false
): Promise<CitationResolveResponse> {
  const hasContext = citations.length > 0 && typeof citations[0] === 'object';

  const body = hasContext
    ? {
        citations_with_context: citations as CitationWithContext[],
        web_search_enabled: webSearchEnabled,
      }
    : {
        citations: citations as string[],
        web_search_enabled: webSearchEnabled,
      };

  const response = await fetch(`${API_BASE}/api/resolve-citations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to resolve citations: ${error}`);
  }

  return response.json();
}

/**
 * Batch check if URLs exist (lightweight HEAD requests).
 * 
 * The browser constructs BAILII/FCL URLs client-side, then sends
 * them to this endpoint just to check existence (200 vs 404).
 * Minimal server traffic - no judgment content is fetched.
 */
export async function checkUrlsExist(urls: string[]): Promise<Array<{
  url: string;
  exists: boolean;
  status_code: number;
  title?: string | null;
}>> {
  const response = await fetch(`${API_BASE}/api/check-urls`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ urls }),
  });

  if (!response.ok) {
    throw new Error(`URL check failed: ${await response.text()}`);
  }

  const data = await response.json();
  return data.results;
}

/**
 * Health check
 */
export async function checkHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE}/health`);
    return response.ok;
  } catch {
    return false;
  }
}
