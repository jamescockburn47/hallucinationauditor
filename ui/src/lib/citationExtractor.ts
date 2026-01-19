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

// Pattern to extract case name - look for "Party v Party" patterns
const CASE_NAME_PATTERNS = [
  // Standard "Party v Party" or "Party v. Party" - most common pattern
  /([A-Z][A-Za-z''\-\.]+(?:\s+(?:Industries|Holdings|plc|Ltd|Co|Corporation|Corp|Inc|Limited|LLP|LLC))?)\s+v\.?\s+([A-Z][A-Za-z''\-\.]+(?:\s+(?:and\s+(?:Others?|Another|Ors))?)?)/i,
  // "R v Defendant" pattern (criminal cases)
  /\b(R)\s+(v\.?)\s+([A-Z][A-Za-z''\-\.]+)/i,
  // "Re Something" pattern (in the matter of)
  /\b((?:In\s+)?[Rr]e)\s+([A-Z][A-Za-z''\-\.]+)/i,
];

/**
 * Extract case name from text - looks for "v" patterns anywhere in text
 */
export function extractCaseNameFromText(text: string): string | undefined {
  // Try each pattern
  for (const pattern of CASE_NAME_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      // For "R v X" pattern
      if (match[1] === 'R' && match[2] && match[3]) {
        return `R v ${match[3]}`;
      }
      // For "Re X" pattern
      if (match[1] && match[1].toLowerCase().includes('re') && match[2]) {
        return `${match[1]} ${match[2]}`;
      }
      // For standard "Party v Party" pattern
      if (match[1] && match[2]) {
        return `${match[1]} v ${match[2]}`;
      }
    }
  }

  return undefined;
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
