/**
 * API client for the hallucination auditor backend
 * 
 * For client-side privacy mode:
 * - Document parsing happens in the browser
 * - Only extracted citation strings are sent to the server
 * - Server resolves citations and fetches judgment text
 * - Verification/matching happens back in the browser
 */

// In production (when served from same origin), use empty string for relative URLs
// In development, use localhost:8000
const API_BASE = import.meta.env.VITE_API_URL ?? (import.meta.env.PROD ? '' : 'http://localhost:8000');

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

/**
 * Resolve citations to URLs and fetch judgment paragraphs
 * 
 * Privacy: Only citation strings are sent to the server.
 * No document content leaves the browser.
 */
export async function resolveCitations(
  citations: string[],
  webSearchEnabled: boolean = false
): Promise<CitationResolveResponse> {
  const response = await fetch(`${API_BASE}/api/resolve-citations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      citations,
      web_search_enabled: webSearchEnabled,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to resolve citations: ${error}`);
  }

  return response.json();
}

/**
 * Legacy: Run full audit on server (document sent to server)
 * Use resolveCitations() instead for client-side privacy mode
 */
export async function runServerAudit(
  claims: Array<{ claim_id: string; text: string; citations: Array<{ raw: string }> }>,
  title: string = 'Citation Audit',
  webSearchEnabled: boolean = false
): Promise<any> {
  const response = await fetch(`${API_BASE}/api/audit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title,
      claims,
      web_search_enabled: webSearchEnabled,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to run audit: ${error}`);
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
