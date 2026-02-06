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

// Neutral citation patterns - comprehensive UK courts coverage
const NEUTRAL_CITATION_PATTERNS = [
  // Supreme Court & Privy Council
  /\[(\d{4})\]\s+(UKSC|UKPC)\s+(\d+)/gi,
  // House of Lords (pre-2009)
  /\[(\d{4})\]\s+(UKHL)\s+(\d+)/gi,
  // Court of Appeal (Civil & Criminal)
  /\[(\d{4})\]\s+(EWCA)\s+(Civ|Crim)\s+(\d+)/gi,
  // High Court - all divisions with bracket suffix
  /\[(\d{4})\]\s+(EWHC)\s+(\d+)\s*\((Admin|Ch|QB|KB|Fam|Comm|TCC|Pat|IPEC|Mercantile|Costs|SCCO|Admlty)\)/gi,
  // High Court - bare (no division specified)
  /\[(\d{4})\]\s+(EWHC)\s+(\d+)(?!\s*\()/gi,
  // Upper Tribunal - all chambers
  /\[(\d{4})\]\s+(UKUT)\s+(\d+)\s*\((AAC|IAC|LC|TCC|GRC)\)/gi,
  // First-tier Tribunal - all chambers
  /\[(\d{4})\]\s+(UKFTT)\s+(\d+)\s*\((TC|GRC|HESC|SEC|IAC|PC|ASNSC|WP)\)/gi,
  // Employment Appeal Tribunal (both formats)
  /\[(\d{4})\]\s+(UKEAT)\s+(\d+)/gi,
  /\[(\d{4})\]\s+(EAT)\s+(\d+)/gi,
  // Scottish courts - Court of Session & High Court of Justiciary
  /\[(\d{4})\]\s+(CSIH|CSOH|ScotCS|ScotHC|HCJAC|HCJ)\s+(\d+)/gi,
  // Northern Ireland courts
  /\[(\d{4})\]\s+(NICA|NIQB|NIKB|NICH|NIFAM|NIFam|NICC|NICh|NICT|NIMaster)\s+(\d+)/gi,
  // Court of Protection
  /\[(\d{4})\]\s+(EWCOP)\s+(\d+)/gi,
  // Family Court
  /\[(\d{4})\]\s+(EWFC)\s+(\d+)/gi,
  // Court Martial Appeal Court
  /\[(\d{4})\]\s+(EWCA)\s+(Crim)\s+(\d+)/gi,
  // Immigration and Asylum Chamber
  /\[(\d{4})\]\s+(UKAITUR)\s+(\d+)/gi,
  // Admiralty Court (often under EWHC Admlty, but catch standalone)
  /\[(\d{4})\]\s+(EWHC)\s+(\d+)\s*\(Admiralty\)/gi,
];

// Traditional law report patterns - comprehensive UK law reports
const TRADITIONAL_CITATION_PATTERNS = [
  // Appeal Cases, Queen's/King's Bench, Chancery, Family
  /\[(\d{4})\]\s+(\d+)?\s*(AC|QB|KB|Ch|Fam)\s+(\d+)/gi,
  // Weekly Law Reports
  /\[(\d{4})\]\s+(\d+)\s+WLR\s+(\d+)/gi,
  // All England Law Reports (incl. Commercial)
  /\[(\d{4})\]\s+(\d+)\s+All\s+ER\s+(\d+)/gi,
  /\[(\d{4})\]\s+(\d+)\s+All\s+ER\s+\(Comm\)\s+(\d+)/gi,
  // Lloyd's Law Reports (maritime/shipping/insurance)
  /\[(\d{4})\]\s+(\d+)\s+Lloyd's\s+Rep\s+(\d+)/gi,
  /\[(\d{4})\]\s+(\d+)\s+Lloyd's\s+Law\s+Rep\s+(\d+)/gi,
  // Family Law Reports
  /\[(\d{4})\]\s+(\d+)\s+FLR\s+(\d+)/gi,
  // Criminal Appeal Reports
  /\[(\d{4})\]\s+(\d+)\s+Cr\s+App\s+R\s+(\d+)/gi,
  /\[(\d{4})\]\s+(\d+)\s+Cr\s+App\s+R\s*\(S\)\s+(\d+)/gi,
  // Industrial Cases Reports / Industrial Relations LR
  /\[(\d{4})\]\s*(\d*)\s*ICR\s+(\d+)/gi,
  /\[(\d{4})\]\s*(\d*)\s*IRLR\s+(\d+)/gi,
  // Business/Company Law
  /\[(\d{4})\]\s*(\d*)\s*BCLC\s+(\d+)/gi,
  /\[(\d{4})\]\s*(\d*)\s*BCC\s+(\d+)/gi,
  // Property & Compensation Reports
  /\[(\d{4})\]\s*(\d*)\s*P\s*&?\s*CR\s+(\d+)/gi,
  // Estates Gazette Law Reports
  /\[(\d{4})\]\s*(\d*)\s*(?:EG|EGLR)\s+(\d+)/gi,
  // Personal Injury & Quantum Reports
  /\[(\d{4})\]\s*(\d*)\s*(?:PIQR)\s+[A-Z]?\s*(\d+)/gi,
  // Medical Law Reports
  /\[(\d{4})\]\s*(\d*)\s*(?:Med\s*LR|BMLR)\s+(\d+)/gi,
  // Construction Law Reports
  /\[(\d{4})\]\s*(\d*)\s*(?:Con\s*LR|BLR)\s+(\d+)/gi,
  // Housing Law Reports
  /\[(\d{4})\]\s*(\d*)\s*HLR\s+(\d+)/gi,
  // Immigration & Asylum Reports
  /\[(\d{4})\]\s*(\d*)\s*(?:Imm\s*AR|INLR)\s+(\d+)/gi,
  // Road Traffic Reports
  /\[(\d{4})\]\s*(\d*)\s*RTR\s+(\d+)/gi,
  // Tax Cases / Simon's Tax Cases
  /\[(\d{4})\]\s*(\d*)\s*(?:TC|STC)\s+(\d+)/gi,
  // European Human Rights Reports
  /\(\d{4}\)\s+(\d+)\s+EHRR\s+(\d+)/gi,
  // Session Cases (Scottish)
  /(\d{4})\s+SC\s+(\d+)/gi,
  /(\d{4})\s+SLT\s+(\d+)/gi,
  // Northern Ireland Reports
  /\[(\d{4})\]\s*(\d*)\s*(?:NI|NIJB)\s+(\d+)/gi,
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
 * Handles common introductory phrases and extracts the actual party name.
 * Uses a limited context window to avoid grabbing surrounding text.
 */
function extractPlaintiffName(text: string): string | undefined {
  if (!text || text.trim().length === 0) {
    return undefined;
  }

  let cleaned = text.trim();

  // Only look at the last 100 characters - case names should be close to "v"
  // This prevents grabbing unrelated text from earlier in the paragraph
  if (cleaned.length > 100) {
    cleaned = cleaned.slice(-100);
  }

  // Split by common delimiters (semicolons, colons, sentence boundaries)
  // and take the last segment which should contain the case name
  const segments = cleaned.split(/[;:]|\.\s+(?=[A-Z])/);
  cleaned = segments[segments.length - 1].trim();

  // Remove common introductory phrases
  // These appear frequently before case citations in legal writing
  const introPatterns = [
    /^.*?\b(?:as\s+(?:stated|held|noted|decided|established|confirmed|affirmed)\s+(?:in|by))\s+/i,
    /^.*?\b(?:following|per|see\s+also|see|cf\.?|compare)\s+/i,
    /^.*?\b(?:in|the\s+case\s+of|the\s+decision\s+in)\s+/i,
    /^.*?\b(?:citing|quoted\s+in|applied\s+in|approved\s+in|overruled\s+in)\s+/i,
  ];

  for (const pattern of introPatterns) {
    const match = cleaned.match(pattern);
    if (match) {
      cleaned = cleaned.slice(match[0].length).trim();
      break;
    }
  }

  // Remove any remaining leading lowercase text before a capital letter
  cleaned = cleaned.replace(/^[a-z][a-z\s,]*(?=[A-Z])/g, '');

  return cleanPartyName(cleaned);
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

  // Validate: must have reasonable length (party names rarely exceed 80 chars)
  if (cleaned.length < 1 || cleaned.length > 80) {
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
 * Extract all citations from text with their source paragraphs.
 * 
 * IMPORTANT: Runs extraction on the FULL text first (no truncation),
 * then maps each citation back to its surrounding paragraph for context.
 * This ensures no citations are missed due to paragraph splitting.
 */
export function extractCitationsWithContext(text: string): CitationWithContext[] {
  // Step 1: Extract ALL citations from the full text (no paragraph splitting)
  const allCitations = extractCitations(text);

  if (allCitations.length === 0) return [];

  // Step 2: Build paragraph map for context (best-effort, doesn't affect extraction)
  const paragraphs = splitIntoParagraphs(text);

  // Step 3: For each extracted citation, find its position in the full text
  //         and map it to the nearest paragraph for context display
  const results: CitationWithContext[] = [];
  const seen = new Set<string>();

  for (const cit of allCitations) {
    const key = cit.raw.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    // Find the citation's position in the full text
    const citPos = text.indexOf(cit.raw);

    // Find which paragraph contains this position
    let bestPara: { number: number; text: string } | null = null;

    if (paragraphs.length > 0 && citPos >= 0) {
      // Track cumulative position through paragraphs to find the right one
      let searchPos = 0;
      for (const para of paragraphs) {
        const paraStart = text.indexOf(para.text, searchPos);
        if (paraStart < 0) continue;
        const paraEnd = paraStart + para.text.length;

        if (citPos >= paraStart && citPos < paraEnd) {
          bestPara = para;
          break;
        }
        searchPos = paraStart + 1;
      }
    }

    // Fallback: extract surrounding context directly from the full text
    if (!bestPara && citPos >= 0) {
      // Get ~500 chars around the citation as context
      const contextStart = text.lastIndexOf('\n', Math.max(0, citPos - 300));
      const contextEnd = text.indexOf('\n', Math.min(text.length, citPos + cit.raw.length + 300));
      const contextText = text.slice(
        contextStart >= 0 ? contextStart : Math.max(0, citPos - 300),
        contextEnd >= 0 ? contextEnd : Math.min(text.length, citPos + cit.raw.length + 300)
      ).trim();

      bestPara = { number: 0, text: contextText };
    }

    const citationPosition = bestPara ? bestPara.text.indexOf(cit.raw) : 0;

    results.push({
      ...cit,
      sourceParagraph: bestPara ? {
        paragraphNumber: bestPara.number,
        text: bestPara.text,
        citationPosition: citationPosition >= 0 ? citationPosition : 0,
      } : undefined,
    });
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
  // Allow up to 5 digits for long documents (e.g. para 10000+)
  const numberedPattern = /(?:^|\n\n?)(\d{1,5})\.\s+/g;
  const bracketPattern = /(?:^|\n\n?)\[(\d{1,5})\]\s*/g;
  const parenPattern = /(?:^|\n\n?)\((\d{1,5})\)\s+/g;

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
