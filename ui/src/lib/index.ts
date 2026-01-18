/**
 * Client-side processing library
 *
 * This library provides client-side document parsing, citation extraction,
 * and verification - ensuring user documents never leave the browser.
 */

export * from './documentParser';
export * from './citationExtractor';
export * from './verifier';

// Re-export from api, but exclude JudgmentParagraph to avoid conflict with verifier
export {
  resolveCitations,
  runServerAudit,
  checkHealth,
  type ResolvedCitation,
  type CitationResolveResponse
} from './api';
