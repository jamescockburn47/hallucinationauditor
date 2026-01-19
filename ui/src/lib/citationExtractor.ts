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
 * Extract case name from text using a comprehensive approach.
 *
 * UK case name patterns (per OSCOLA guidelines):
 * 1. Party v Party - most common (Caparo Industries plc v Dickman)
 * 2. R v X - criminal cases (R v Smith)
 * 3. Re X / In re X / In the matter of X - bankruptcy, probate, etc.
 * 4. Ex p X / Ex parte X - judicial review (often as "R v X, ex p Y")
 * 5. The [Name] - admiralty/ship cases (The Wagon Mound)
 *
 * The approach:
 * 1. Look for text immediately before a citation bracket [year]
 * 2. Parse backwards to find the case name using known patterns
 * 3. Clean up common introductory phrases
 */
export function extractCaseNameFromText(text: string): string | undefined {
  // Find where the citation starts (look for [year] pattern)
  const citationStart = text.search(/\[\d{4}\]/);

  // Get the text before the citation (or all text if no citation found)
  const beforeCitation = citationStart > 0 ? text.slice(0, citationStart).trim() : text.trim();

  if (!beforeCitation) {
    return undefined;
  }

  // Try to extract case name using different patterns
  // Order matters - try more specific patterns first

  // Pattern 1: "R v X, ex p Y" or "R v X, Ex parte Y" (judicial review with ex parte)
  const exParteMatch = beforeCitation.match(
    /\b(R)\s+v\.?\s+([^,\[\]]+),?\s+(?:ex\s*p\.?|Ex\s+parte)\s+([A-Z][^\[\]]+?)$/i
  );
  if (exParteMatch) {
    const court = exParteMatch[2].trim();
    const applicant = cleanPartyName(exParteMatch[3]);
    if (court && applicant) {
      return `R v ${court}, ex p ${applicant}`;
    }
  }

  // Pattern 2: Standard "X v Y" pattern
  const vMatch = beforeCitation.match(/\s+(v\.?)\s+/i);
  if (vMatch && vMatch.index !== undefined) {
    const beforeV = beforeCitation.slice(0, vMatch.index);
    const afterV = beforeCitation.slice(vMatch.index + vMatch[0].length);

    const plaintiff = extractPlaintiffName(beforeV);
    const defendant = cleanPartyName(afterV);

    if (plaintiff && defendant) {
      return `${plaintiff} v ${defendant}`;
    }
  }

  // Pattern 3: "Re X" / "In re X" / "In the matter of X"
  const reMatch = beforeCitation.match(
    /\b((?:In\s+the\s+matter\s+of|In\s+re|Re))\s+([A-Z][^\[\]]+?)$/i
  );
  if (reMatch) {
    const prefix = reMatch[1].toLowerCase().includes('matter') ? 'Re' :
                   reMatch[1].toLowerCase() === 'in re' ? 'Re' : 'Re';
    const subject = cleanPartyName(reMatch[2]);
    if (subject) {
      return `${prefix} ${subject}`;
    }
  }

  // Pattern 4: "Ex p X" / "Ex parte X" (standalone)
  const standaloneExParte = beforeCitation.match(
    /\b(?:ex\s*p\.?|Ex\s+parte)\s+([A-Z][^\[\]]+?)$/i
  );
  if (standaloneExParte) {
    const applicant = cleanPartyName(standaloneExParte[1]);
    if (applicant) {
      return `Ex p ${applicant}`;
    }
  }

  // Pattern 5: "The X" or "The X (No 1)" - ship/admiralty cases
  const shipMatch = beforeCitation.match(/\b(The\s+[A-Z][A-Za-z0-9\s'']+(?:\s*\([^)]+\))?)$/);
  if (shipMatch) {
    const shipName = cleanPartyName(shipMatch[1]);
    if (shipName) {
      return shipName;
    }
  }

  return undefined;
}

/**
 * Extract plaintiff/claimant name from text before "v".
 * STRICT: Only extract when we have a clear party name pattern.
 * Avoids grabbing surrounding context text.
 */
function extractPlaintiffName(text: string): string | undefined {
  if (!text || text.trim().length === 0) {
    return undefined;
  }

  let cleaned = text.trim();

  // Only look at the last 80 characters - case names should be close to "v"
  if (cleaned.length > 80) {
    cleaned = cleaned.slice(-80);
  }

  // Look for the LAST capital-letter word/phrase before the end
  // This should be the plaintiff/claimant name
  // Pattern: Capitalized word(s) possibly including plc, Ltd, Inc, etc.
  const partyNamePattern = /([A-Z][A-Za-z'']+(?:\s+(?:[A-Z][A-Za-z'']+|plc|Ltd|Inc|LLP|Co|Corporation|Council|Authority|Secretary|State|Minister|Commissioner|Trust|Board|NHS|BBC|CPS))*)\s*$/;

  const match = cleaned.match(partyNamePattern);
  if (match) {
    const name = match[1].trim();
    // Validate: reasonable length, not just single letter, not common words
    if (name.length >= 2 && name.length <= 80) {
      // Exclude common words that aren't party names
      const excludeWords = ['The', 'In', 'And', 'For', 'With', 'From', 'That', 'This', 'Which', 'Where', 'When', 'What', 'How', 'Why'];
      if (!excludeWords.includes(name)) {
        return name;
      }
    }
  }

  // Also check for "R" (Crown prosecution)
  if (cleaned.trim().endsWith('R') || cleaned.match(/\bR\s*$/)) {
    return 'R';
  }

  return undefined;
}

/**
 * Clean up a party name by removing trailing artifacts and normalizing.
 */
function cleanPartyName(text: string): string | undefined {
  if (!text || text.trim().length === 0) {
    return undefined;
  }

  let cleaned = text.trim();

  // Normalize whitespace
  cleaned = cleaned.replace(/\s+/g, ' ');

  // Remove trailing punctuation and artifacts
  cleaned = cleaned.replace(/[,;:\.\s]+$/, '').trim();

  // Remove trailing "and others", "& Ors", etc.
  cleaned = cleaned.replace(/\s*(?:and\s+(?:others?|another)|&\s*(?:Ors?|Others?))\s*$/i, '');

  // Validate: must have reasonable length
  if (cleaned.length < 1 || cleaned.length > 150) {
    return undefined;
  }

  // Must contain at least one capital letter (party names are capitalized)
  if (!/[A-Z]/.test(cleaned)) {
    return undefined;
  }

  // Shouldn't start with lowercase (unless it's a known prefix like "ex")
  if (/^[a-z]/.test(cleaned) && !/^(?:ex\s|de\s)/i.test(cleaned)) {
    return undefined;
  }

  return cleaned;
}

/**
 * Extract case name from the text preceding a citation (legacy)
 */
function extractCaseName(textBefore: string): string | undefined {
  // Look at the last 200 characters before the citation
  let context = textBefore.slice(-200);

  // Important: Only look at text on the same "line" as the citation
  // Split by numbered list markers (common in legal docs) and newlines
  // This prevents grabbing case names from previous citations in a list
  const lineBreakers = /(?:\n|\r|(?:\d{1,3})\.\s+|\[\d+\]\s*)/g;
  const parts = context.split(lineBreakers);
  if (parts.length > 1) {
    // Take only the last segment (same line as citation)
    context = parts[parts.length - 1];
  }

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

export interface SourceParagraph {
  paragraphNumber: number;
  text: string;           // The full paragraph text
  citationPosition: number; // Character position of citation in paragraph
}

export interface CitationWithContext extends ExtractedCitation {
  sourceParagraph?: SourceParagraph;
}

/**
 * Extract all citations from text with their source paragraphs
 * Each citation is returned separately with the paragraph where it was found
 */
export function extractCitationsWithContext(text: string): CitationWithContext[] {
  const results: CitationWithContext[] = [];
  const seen = new Set<string>();

  // Split into paragraphs
  const paragraphs = splitIntoParagraphs(text);

  for (const para of paragraphs) {
    // Find all citations in this paragraph
    const citations = extractCitations(para.text);

    for (const cit of citations) {
      const key = cit.raw.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      // Find the position of this citation in the paragraph
      const citationMatch = para.text.indexOf(cit.raw);
      const citationPosition = citationMatch >= 0 ? citationMatch : 0;

      results.push({
        ...cit,
        sourceParagraph: {
          paragraphNumber: para.number,
          text: para.text.trim(),
          citationPosition
        }
      });
    }
  }

  return results;
}

/**
 * Split document text into numbered paragraphs
 */
function splitIntoParagraphs(text: string): Array<{ number: number; text: string }> {
  const paragraphs: Array<{ number: number; text: string }> = [];

  // Try to detect numbered paragraphs first (common in legal docs)
  // Pattern: "1." or "(1)" or "[1]" at start of line
  const numberedPattern = /(?:^|\n\n?)(\d{1,3})\.\s+/g;
  const bracketPattern = /(?:^|\n\n?)\[(\d{1,3})\]\s*/g;
  const parenPattern = /(?:^|\n\n?)\((\d{1,3})\)\s+/g;

  // Check which pattern is most common
  const numberedMatches = [...text.matchAll(numberedPattern)];
  const bracketMatches = [...text.matchAll(bracketPattern)];
  const parenMatches = [...text.matchAll(parenPattern)];

  let matches: RegExpMatchArray[] = [];

  if (bracketMatches.length >= numberedMatches.length && bracketMatches.length >= parenMatches.length && bracketMatches.length > 2) {
    matches = bracketMatches;
  } else if (numberedMatches.length >= parenMatches.length && numberedMatches.length > 2) {
    matches = numberedMatches;
  } else if (parenMatches.length > 2) {
    matches = parenMatches;
  }

  if (matches.length > 2) {
    // Extract paragraphs using detected pattern
    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
      const startPos = match.index! + match[0].length;
      const endPos = i < matches.length - 1 ? matches[i + 1].index! : text.length;
      const paraNum = parseInt(match[1], 10);
      const paraText = text.slice(startPos, endPos).trim();

      if (paraText.length > 10) {
        paragraphs.push({ number: paraNum, text: paraText });
      }
    }
  }

  // Fallback: split by double newlines
  if (paragraphs.length === 0) {
    const chunks = text.split(/\n\n+/);
    chunks.forEach((chunk, idx) => {
      const trimmed = chunk.trim();
      if (trimmed.length > 20) {
        paragraphs.push({ number: idx + 1, text: trimmed });
      }
    });
  }

  return paragraphs;
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
