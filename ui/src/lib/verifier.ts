/**
 * Client-side verification logic
 * Matches propositions against judgment paragraphs in the browser
 */

export interface JudgmentParagraph {
  para_num: string;
  text: string;
  speaker?: string;
}

export interface MatchResult {
  para_num: string;
  text: string;
  similarity_score: number;
  match_type: 'keyword' | 'partial';
  matching_keywords: string[];
}

// Legal stopwords to ignore when matching
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
  'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'this',
  'that', 'these', 'those', 'it', 'its', 'their', 'they', 'them',
  'he', 'she', 'his', 'her', 'we', 'our', 'you', 'your', 'i', 'my',
  'not', 'no', 'nor', 'so', 'if', 'then', 'than', 'when', 'where',
  'which', 'who', 'whom', 'what', 'how', 'why', 'all', 'each', 'every',
  'both', 'few', 'more', 'most', 'other', 'some', 'such', 'only',
  'same', 'very', 'just', 'also', 'now', 'here', 'there', 'any',
  // Legal common words
  'case', 'court', 'judge', 'judgment', 'held', 'decision', 'lord',
  'lady', 'mr', 'mrs', 'ms', 'said', 'stated', 'noted', 'observed',
]);

/**
 * Extract significant keywords from text
 */
export function extractKeywords(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2)
    .filter(word => !STOPWORDS.has(word));
  
  // Return unique words
  return [...new Set(words)];
}

/**
 * Calculate Jaccard similarity between two sets of keywords
 */
function jaccardSimilarity(set1: Set<string>, set2: Set<string>): number {
  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  
  if (union.size === 0) return 0;
  return intersection.size / union.size;
}

/**
 * Find paragraphs in a judgment that match a proposition
 * Runs entirely in the browser
 */
export function findMatchingParagraphs(
  proposition: string,
  paragraphs: JudgmentParagraph[],
  threshold: number = 0.15
): MatchResult[] {
  const propositionKeywords = new Set(extractKeywords(proposition));
  
  if (propositionKeywords.size === 0) {
    return [];
  }
  
  const results: MatchResult[] = [];
  
  for (const para of paragraphs) {
    if (!para.text || para.text.length < 20) continue;
    
    const paraKeywords = new Set(extractKeywords(para.text));
    const similarity = jaccardSimilarity(propositionKeywords, paraKeywords);
    
    if (similarity >= threshold) {
      // Find which keywords matched
      const matchingKeywords = [...propositionKeywords].filter(k => paraKeywords.has(k));
      
      results.push({
        para_num: para.para_num,
        text: para.text,
        similarity_score: similarity,
        match_type: similarity >= 0.3 ? 'keyword' : 'partial',
        matching_keywords: matchingKeywords,
      });
    }
  }
  
  // Sort by similarity score
  results.sort((a, b) => b.similarity_score - a.similarity_score);
  
  // Return top 5 matches
  return results.slice(0, 5);
}

/**
 * Calculate overall confidence score for a citation verification
 *
 * For Type 1 hallucination detection (fabricated cases):
 * - If case is FOUND, that's the primary verification - case exists, not fabricated
 * - Keyword matching is secondary - it helps verify the proposition's accuracy
 * - A found case with no keyword matches still means the case exists
 */
export function calculateConfidence(
  matches: MatchResult[],
  caseFound: boolean
): { score: number; level: 'high' | 'medium' | 'low' | 'none' } {
  if (!caseFound) {
    return { score: 0, level: 'none' };
  }

  // Case is found - this is the primary verification for Type 1 hallucinations
  // Base confidence is medium just for finding the case
  if (matches.length === 0) {
    // Case found but no keyword matches - still verified as existing
    return { score: 0.5, level: 'medium' };
  }

  const topMatch = matches[0];

  // Boost scores because finding the case is already significant
  if (topMatch.similarity_score >= 0.3) {
    return { score: Math.min(0.95, topMatch.similarity_score + 0.4), level: 'high' };
  } else if (topMatch.similarity_score >= 0.15) {
    return { score: topMatch.similarity_score + 0.35, level: 'medium' };
  } else {
    // Even low keyword match + case found = reasonable confidence
    return { score: 0.5, level: 'medium' };
  }
}

/**
 * Determine verification outcome based on results
 *
 * For Type 1 hallucination detection:
 * - "supported" = case definitely exists (found on BAILII/FCL)
 * - "needs_review" = case found but proposition details need manual check
 * - "unclear" = couldn't determine (edge cases)
 * - "unverifiable" = case NOT found - possible fabrication
 */
export function determineOutcome(
  caseFound: boolean,
  matches: MatchResult[],
  sourceType: 'fcl' | 'bailii' | 'web_search' | 'not_found'
): 'supported' | 'needs_review' | 'unclear' | 'unverifiable' {
  if (!caseFound || sourceType === 'not_found') {
    return 'unverifiable';
  }

  // Case was found - for Type 1 hallucination detection, this is the key result
  // The case EXISTS, so it's not a fabricated citation

  if (matches.length === 0) {
    // Case found but no strong keyword matches
    // Still "supported" because the case exists - just proposition content unclear
    return 'supported';
  }

  const topMatch = matches[0];

  // Any reasonable keyword match + case found = supported
  if (topMatch.similarity_score >= 0.1) {
    return 'supported';
  }

  // Very low match but case still exists
  return 'supported';
}
