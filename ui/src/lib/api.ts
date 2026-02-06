/**
 * API client for the Citation Auditor
 *
 * ARCHITECTURE:
 * - Document parsing, citation extraction, URL construction: all in browser
 * - BAILII/FCL existence checking: via server (CORS prevents direct browser fetch)
 * - Judgment viewing: via iframe loading BAILII directly from user's browser
 * - Server is a thin proxy - only receives citation strings or public URLs
 * - NO document content ever leaves the browser
 */

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

export interface UrlCheckResult {
  url: string;
  exists: boolean;
  status_code: number;
  title?: string | null;
}

/**
 * Batch check if BAILII URLs exist via the server proxy.
 * 
 * BAILII blocks CORS, so we can't check from the browser directly.
 * The server does lightweight GET requests and validates the response
 * is a real judgment (not BAILII's 1654-byte stub page).
 *
 * No document content is sent - only public BAILII/FCL URLs.
 */
export async function checkUrlsExist(urls: string[]): Promise<UrlCheckResult[]> {
  if (urls.length === 0) return [];

  const response = await fetch(`${API_BASE}/api/check-urls`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ urls }),
  });

  if (!response.ok) {
    console.error('check-urls failed:', response.status);
    return urls.map(url => ({ url, exists: false, status_code: 0 }));
  }

  const data = await response.json();
  return data.results;
}

/**
 * Proxy-fetch a URL through the server (CORS bypass).
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
    throw new Error(`Proxy fetch failed: ${await response.text()}`);
  }

  return response.json();
}

/**
 * Resolve citations via server search (BAILII citation finder + search + FCL).
 * Used for traditional citations and as fallback for unfound neutral citations.
 *
 * Only citation strings are sent - no document content.
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
    throw new Error(`Failed to resolve citations: ${await response.text()}`);
  }

  return response.json();
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
