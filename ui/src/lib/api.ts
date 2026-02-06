/**
 * API client for the Citation Auditor
 *
 * BROWSER-FIRST ARCHITECTURE:
 * All requests to BAILII/FCL are attempted directly from the user's browser.
 * This distributes rate limits across users (each user = their own IP).
 * Only if CORS blocks the request does the server proxy get used as fallback.
 *
 * NO document content ever leaves the browser.
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

// ===== BROWSER-DIRECT FUNCTIONS =====

// Legal content indicators for validating real judgment pages
const LEGAL_INDICATORS = [
  'judgment', 'court', 'justice', 'appeal', 'claimant',
  'defendant', 'respondent', 'appellant', 'held', 'ordered',
  'lordship', 'honour', 'tribunal', 'act',
];

/**
 * Check if fetched HTML/XML content is a real judgment (not a stub/404 page).
 */
function isRealJudgmentContent(content: string, url: string): boolean {
  if (!content || content.length < 2000) return false;

  const lower = content.toLowerCase();

  // Check for error pages
  if (lower.slice(0, 1000).includes('page not found')) return false;
  if (lower.slice(0, 1000).includes('error 404')) return false;

  // BAILII stub pages are ~1654 bytes
  if (url.includes('bailii.org') && content.length < 3000) return false;

  // FCL XML: must have Akoma Ntoso structure
  if (url.endsWith('.xml')) {
    return lower.includes('<akomantoso') || lower.includes('<frbrwork');
  }

  // FCL HTML: check for real content
  if (url.includes('caselaw.nationalarchives.gov.uk')) {
    if (content.length < 5000) return false;
    if (lower.slice(0, 2000).includes('page not found')) return false;
    return true;
  }

  // BAILII HTML: check for legal content indicators
  const matches = LEGAL_INDICATORS.filter(ind => lower.includes(ind));
  return matches.length >= 3;
}

/**
 * Extract title from HTML/XML content.
 */
function extractTitleFromContent(content: string): string | null {
  // Try HTML <title> tag
  const titleMatch = content.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) {
    let title = titleMatch[1].trim().slice(0, 200);
    if (title.startsWith('BAILII - ')) title = title.slice(9);
    return title || null;
  }

  // Try FCL FRBRname
  const nameMatch = content.match(/<FRBRname\s+value="([^"]+)"/);
  if (nameMatch) return nameMatch[1].trim().slice(0, 200);

  return null;
}

/**
 * Try to fetch and validate a single URL directly from the browser.
 * Returns result if successful, null if CORS blocked.
 */
async function tryDirectCheck(url: string): Promise<UrlCheckResult | null> {
  try {
    const response = await fetch(url, {
      mode: 'cors',
      headers: { 'Accept': 'text/html, application/xml, text/xml, */*' },
    });

    if (!response.ok) {
      return { url, exists: false, status_code: response.status };
    }

    const content = await response.text();
    const exists = isRealJudgmentContent(content, url);
    const title = exists ? extractTitleFromContent(content) : null;

    return { url, exists, status_code: exists ? 200 : 404, title };
  } catch {
    // CORS blocked or network error - return null to signal fallback needed
    return null;
  }
}

/**
 * Check if URLs exist - tries direct browser fetch first, falls back to server.
 *
 * BROWSER-FIRST: Each URL is first fetched directly from the user's browser.
 * This means BAILII/FCL see the user's IP, not the server's IP, distributing
 * rate limits naturally across all users.
 *
 * Only URLs that fail due to CORS get sent to the server proxy as fallback.
 */
export async function checkUrlsExist(urls: string[]): Promise<UrlCheckResult[]> {
  // Step 1: Try all URLs directly from the browser (parallel)
  const directResults = await Promise.all(
    urls.map(url => tryDirectCheck(url))
  );

  const results: UrlCheckResult[] = [];
  const needProxy: string[] = [];

  for (let i = 0; i < urls.length; i++) {
    if (directResults[i] !== null) {
      // Direct fetch worked (CORS allowed) - use browser result
      results.push(directResults[i]!);
    } else {
      // CORS blocked - need server proxy fallback
      needProxy.push(urls[i]);
    }
  }

  // Step 2: For CORS-blocked URLs, fall back to server proxy
  if (needProxy.length > 0) {
    try {
      const response = await fetch(`${API_BASE}/api/check-urls`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: needProxy }),
      });

      if (response.ok) {
        const data = await response.json();
        results.push(...data.results);
      } else {
        // Server proxy also failed - mark all as unknown
        for (const url of needProxy) {
          results.push({ url, exists: false, status_code: 0 });
        }
      }
    } catch {
      for (const url of needProxy) {
        results.push({ url, exists: false, status_code: 0 });
      }
    }
  }

  return results;
}

// ===== SERVER PROXY FUNCTIONS (fallback only) =====

/**
 * Proxy-fetch a URL through the server (CORS fallback).
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
 * Try BAILII citation finder directly from the browser.
 * POST to /cgi-bin/find_by_citation.cgi - if case exists, BAILII redirects
 * to the case page. We can read the response if CORS allows it.
 *
 * Returns the case URL and title if found, null if CORS blocked or not found.
 */
export async function tryBailiiCitationFinder(citation: string): Promise<{url: string; title: string | null} | null> {
  try {
    const response = await fetch('https://www.bailii.org/cgi-bin/find_by_citation.cgi', {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `citation=${encodeURIComponent(citation)}`,
      redirect: 'follow',
    });

    if (!response.ok) return null;

    const content = await response.text();

    // Check if we got redirected to a real case page (not the search form)
    if (response.url.includes('/cgi-bin/')) return null;
    if (!isRealJudgmentContent(content, response.url)) return null;

    const title = extractTitleFromContent(content);
    return { url: response.url, title };
  } catch {
    // CORS blocked - expected
    return null;
  }
}

/**
 * Resolve citations - tries browser-direct BAILII lookup first,
 * falls back to server search.
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
