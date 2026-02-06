/**
 * Client-side processing library
 *
 * PRIVACY ARCHITECTURE:
 * All document processing happens in the browser. Only citation strings
 * and public URLs are sent to the server for CORS-proxied fetching.
 *
 * - documentParser: Parse PDF/DOCX/HTML/TXT in browser
 * - citationExtractor: Extract legal citations using regex
 * - citationResolver: Construct BAILII/FCL URLs client-side
 * - judgmentParser: Parse BAILII HTML and FCL XML in browser
 * - verifier: Keyword matching for proposition verification
 * - api: Minimal server communication (CORS proxy + citation search)
 */

export * from './documentParser';
export * from './citationExtractor';
export * from './citationResolver';
export * from './verifier';

export {
  resolveCitations,
  proxyFetch,
  checkUrlsExist,
  checkHealth,
  type ResolvedCitation,
  type CitationResolveResponse
} from './api';
