/**
 * Client-side citation extraction
 * Extracts legal citations from text entirely in the browser
 */

export interface ExtractedCitation {
  raw: string;           // The full citation text
  type: 'neutral' | 'traditional' | 'unknown';
  year?: string;
  court?: string;
  caseNumber?: string;
  caseName?: string;     // Extracted case name if present
}

// Neutral citation patterns (e.g., [2015] UKSC 11)
const NEUTRAL_CITATION_PATTERNS = [
  // Supreme Court & Privy Council
  /\[(\d{4})\]\s+(UKSC|UKPC)\s+(\d+)/gi,
  // House of Lords (pre-2009)
  /\[(\d{4})\]\s+(UKHL)\s+(\d+)/gi,
  // Court of Appeal
  /\[(\d{4})\]\s+(EWCA)\s+(Civ|Crim)\s+(\d+)/gi,
  // High Court
  /\[(\d{4})\]\s+(EWHC)\s+(\d+)\s*\((Admin|Ch|QB|Fam|Comm|TCC|Pat|IPEC)\)/gi,
  /\[(\d{4})\]\s+(EWHC)\s+(\d+)/gi,
  // Upper Tribunal
  /\[(\d{4})\]\s+(UKUT)\s+(\d+)\s*\((AAC|IAC|LC|TCC)\)/gi,
  // Employment Appeal Tribunal
  /\[(\d{4})\]\s+(UKEAT)\s+(\d+)/gi,
  // Scottish courts
  /\[(\d{4})\]\s+(CSIH|CSOH|ScotCS|HCJAC)\s+(\d+)/gi,
];

// Traditional law report patterns (e.g., [1990] 2 AC 605)
const TRADITIONAL_CITATION_PATTERNS = [
  // Appeal Cases, Queen's Bench, etc.
  /\[(\d{4})\]\s+(\d+)?\s*(AC|QB|Ch|Fam)\s+(\d+)/gi,
  // Weekly Law Reports
  /\[(\d{4})\]\s+(\d+)\s+WLR\s+(\d+)/gi,
  // All England Law Reports
  /\[(\d{4})\]\s+(\d+)\s+All\s+ER\s+(\d+)/gi,
  // Lloyd's Law Reports
  /\[(\d{4})\]\s+(\d+)\s+Lloyd's\s+Rep\s+(\d+)/gi,
  // Family Law Reports
  /\[(\d{4})\]\s+(\d+)\s+FLR\s+(\d+)/gi,
  // Criminal Appeal Reports
  /\[(\d{4})\]\s+(\d+)\s+Cr\s+App\s+R\s+(\d+)/gi,
];

/**
 * Extract case name from text using a simple, robust approach.
 *
 * Based on SOTA research (eyecite, LexNLP), the most reliable method is:
 * 1. Find the "v" or "v." separator
 * 2. Capture everything before it that looks like a party name
 * 3. Capture everything after it up to the citation bracket
 *
 * This handles cases like:
 * - "Caparo Industries plc v Dickman"
 * - "Hedley Byrne & Co Ltd v Heller & Partners Ltd"
 * - "R v Smith"
 * - "Re Atlantic Computers"
 */
export function extractCaseNameFromText(text: string): string | undefined {
  // First, try to find "v" or "v." pattern in the text
  // The key insight: look for " v " or " v. " as word boundaries

  // Pattern: capture text before "v"/"v." and text after, stopping at citation bracket [
  // Using a simple split-based approach which is more robust than complex regex

  // Find the position of " v " or " v. " (with word boundaries)
  const vPatterns = [
    /\s+v\.\s+/i,    // " v. "
    /\s+v\s+/i,      // " v "
  ];

  let vMatch: RegExpExecArray | null = null;

  for (const pattern of vPatterns) {
    const match = pattern.exec(text);
    if (match) {
      vMatch = match;
      break;
    }
  }

  if (!vMatch || vMatch.index === undefined) {
    // No "v" found, try "Re" or "In re" patterns
    const reMatch = text.match(/\b((?:In\s+)?[Rr]e)\s+([A-Z][A-Za-z0-9''\-\.\s&]+?)(?=\s*[\[\(]|\s*$)/);
    if (reMatch) {
      return `${reMatch[1]} ${reMatch[2].trim()}`;
    }
    return undefined;
  }

  const vIndex = vMatch.index;
  const vLength = vMatch[0].length;

  // Extract text before "v" - this is the plaintiff/appellant
  const beforeV = text.slice(0, vIndex);

  // Extract text after "v" up to citation bracket or end
  const afterV = text.slice(vIndex + vLength);

  // Clean up plaintiff name - get the last "name-like" segment before v
  // This handles cases where there's other text before the case name
  const plaintiff = extractPartyName(beforeV, 'before');

  // Clean up defendant name - get text up to the citation bracket
  const defendant = extractPartyName(afterV, 'after');

  if (plaintiff && defendant) {
    return `${plaintiff} v ${defendant}`;
  }

  return undefined;
}

/**
 * Extract a party name from text, cleaning up common artifacts.
 *
 * @param text - The text to extract from
 * @param position - 'before' means text before "v", 'after' means text after "v"
 */
function extractPartyName(text: string, position: 'before' | 'after'): string | undefined {
  if (!text || text.trim().length === 0) {
    return undefined;
  }

  let cleaned = text.trim();

  if (position === 'before') {
    // For text before "v", we want the last party-name-like segment
    // Remove common prefixes like "In", "See", "per", etc.

    // Split by common delimiters and take the last meaningful segment
    const segments = cleaned.split(/[;:,]|\.\s+(?=[A-Z])/);
    cleaned = segments[segments.length - 1].trim();

    // Remove leading phrases like "As stated in", "See", "In", "per", etc.
    // These are common introductory phrases before case names
    cleaned = cleaned.replace(/^(?:as\s+(?:stated|held|noted|decided|established)\s+in|see\s+also|see|per|in|the|a|an)\s+/i, '');

    // Remove leading lowercase words (likely not part of case name)
    cleaned = cleaned.replace(/^[a-z][a-z\s]*(?=[A-Z])/g, '');

  } else {
    // For text after "v", stop at citation bracket or certain punctuation
    // Find where the defendant name ends

    // Stop at: [year], (year), common legal phrases, or end of meaningful text
    const stopPatterns = [
      /\s*\[\d{4}\]/,           // [1990]
      /\s*\(\d{4}\)/,           // (1990)
      /\s*\[20\d{2}\]/,         // [2015]
      /\s*,\s*(?:at|para|p\.)/i, // ", at para"
      /\s+held\s+/i,            // " held "
      /\s+where\s+/i,           // " where "
      /\s+the\s+court\s+/i,     // " the court "
      /\s+it\s+was\s+/i,        // " it was "
    ];

    let stopIndex = cleaned.length;
    for (const pattern of stopPatterns) {
      const match = pattern.exec(cleaned);
      if (match && match.index !== undefined && match.index < stopIndex) {
        stopIndex = match.index;
      }
    }

    cleaned = cleaned.slice(0, stopIndex).trim();
  }

  // Final cleanup - normalize whitespace
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  // Remove trailing punctuation
  cleaned = cleaned.replace(/[,;:\.]$/, '').trim();

  // Validate: should start with capital letter and be reasonable length
  if (cleaned.length < 1 || cleaned.length > 100) {
    return undefined;
  }

  // Should contain at least one capital letter
  if (!/[A-Z]/.test(cleaned)) {
    return undefined;
  }

  return cleaned;
}

/**
 * Extract case name from the text preceding a citation (legacy)
 */
function extractCaseName(textBefore: string): string | undefined {
  // Look at the last 200 characters before the citation
  const context = textBefore.slice(-200);
  return extractCaseNameFromText(context);
}

/**
 * Extract all citations from text
 * Runs entirely in the browser
 */
export function extractCitations(text: string): ExtractedCitation[] {
  const citations: ExtractedCitation[] = [];
  const seen = new Set<string>();

  // Extract neutral citations
  for (const pattern of NEUTRAL_CITATION_PATTERNS) {
    // Reset lastIndex for global patterns
    pattern.lastIndex = 0;
    
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const raw = match[0];
      const normalized = raw.replace(/\s+/g, ' ').trim();
      
      if (!seen.has(normalized.toLowerCase())) {
        seen.add(normalized.toLowerCase());
        
        // Find position and look for case name
        const position = match.index;
        const textBefore = text.slice(0, position);
        const caseName = extractCaseName(textBefore);
        
        citations.push({
          raw: normalized,
          type: 'neutral',
          year: match[1],
          court: match[2],
          caseNumber: match[3] || match[4],
          caseName,
        });
      }
    }
  }

  // Extract traditional citations
  for (const pattern of TRADITIONAL_CITATION_PATTERNS) {
    pattern.lastIndex = 0;
    
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const raw = match[0];
      const normalized = raw.replace(/\s+/g, ' ').trim();
      
      if (!seen.has(normalized.toLowerCase())) {
        seen.add(normalized.toLowerCase());
        
        const position = match.index;
        const textBefore = text.slice(0, position);
        const caseName = extractCaseName(textBefore);
        
        citations.push({
          raw: normalized,
          type: 'traditional',
          year: match[1],
          caseName,
        });
      }
    }
  }

  return citations;
}

/**
 * Extract propositions/claims from text around citations
 * Uses rule-based extraction (no AI)
 */
export function extractPropositions(text: string): Array<{
  proposition: string;
  citations: ExtractedCitation[];
}> {
  const results: Array<{ proposition: string; citations: ExtractedCitation[] }> = [];
  
  // Split into sentences/paragraphs
  const sentences = text.split(/(?<=[.!?])\s+(?=[A-Z])/);
  
  for (const sentence of sentences) {
    const citations = extractCitations(sentence);
    
    if (citations.length > 0) {
      // Clean up the proposition text
      let proposition = sentence
        .replace(/\[\d{4}\]\s+(?:UKSC|UKPC|UKHL|EWCA|EWHC|UKUT|UKEAT|CSIH|CSOH)[^\]]*\d+/gi, '')
        .replace(/\[\d{4}\]\s+\d*\s*(?:AC|QB|Ch|Fam|WLR|All\s+ER)\s+\d+/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
      
      // Remove citation artifacts
      proposition = proposition
        .replace(/\s*,\s*,/g, ',')
        .replace(/\s+\./g, '.')
        .replace(/^\s*[,;]\s*/, '')
        .replace(/\s*[,;]\s*$/, '')
        .trim();
      
      if (proposition.length > 20) {
        results.push({ proposition, citations });
      }
    }
  }
  
  return results;
}

/**
 * Format a citation for display
 */
export function formatCitation(citation: ExtractedCitation): string {
  if (citation.caseName) {
    return `${citation.caseName} ${citation.raw}`;
  }
  return citation.raw;
}
