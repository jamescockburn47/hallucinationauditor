---
name: hallucination-taxonomy
description: Define hallucination categories and evidence thresholds for legal citation errors
version: 0.1
---

## Hallucination Categories

### 1. CITATION_MISMATCH
**Definition**: Citation exists but refers to different content than claimed.

**Evidence Requirements**:
- Authority successfully retrieved from public source
- Citation text matches expected format
- Content contradicts or is unrelated to claim

**Example**: Citing "Smith v Jones [2023] UKSC 1" but the case is actually about contract law, not tort law as claimed.

### 2. PARAGRAPH_HALLUCINATION
**Definition**: Specific paragraph number cited does not exist or contains different content.

**Evidence Requirements**:
- Authority retrieved and parsed
- Paragraph numbering extracted
- Cited paragraph number not found OR content differs significantly

**Example**: Claim cites "at [45]" but judgment only has 40 paragraphs, or [45] discusses different issue.

### 3. QUOTATION_FABRICATION
**Definition**: Direct quote does not appear in cited authority.

**Evidence Requirements**:
- Authority retrieved
- Exact quote not found in full text
- No near-match found (>85% similarity)

**Example**: Claim includes "quote text" attributed to judgment, but string does not appear.

### 4. PARAPHRASE_DISTORTION
**Definition**: Paraphrased content misrepresents authority's actual meaning.

**Evidence Requirements**:
- Authority retrieved
- Relevant section identified
- Content comparison shows material misrepresentation
- Not merely a summary or simplification

**Example**: Claim says "court held X" but judgment actually held "not X" or qualified differently.

### 5. AUTHORITY_NONEXISTENT
**Definition**: Cited authority cannot be found in public sources.

**Evidence Requirements**:
- Exhaustive resolution attempts (BAILII, legislation.gov.uk, nationalarchives)
- All candidate URLs attempted
- All return 404 or no relevant results
- Citation format appears valid (not obviously malformed)

**Important**: Only conclude this after retrieval attempts. Do not infer from citation pattern alone.

### 6. CITATION_MALFORMED
**Definition**: Citation string is structurally invalid or unparseable.

**Evidence Requirements**:
- Citation does not match any known citation format
- Cannot extract case name, year, court identifier
- Appears to be typo or garbled text

**Example**: "[202] UKSC" (missing digit), "Smith v [2023]" (missing opponent)

## Classification Rules

1. **Single category per claim-citation pair**: Assign most specific applicable category
2. **Priority order** (check in this order):
   - CITATION_MALFORMED (structural issues first)
   - AUTHORITY_NONEXISTENT (retrieval failures)
   - PARAGRAPH_HALLUCINATION (specific locator errors)
   - QUOTATION_FABRICATION (exact quote errors)
   - PARAPHRASE_DISTORTION (semantic errors)
   - CITATION_MISMATCH (general content mismatch)

3. **Evidence thresholds**:
   - HIGH confidence: Direct evidence from retrieved source
   - MEDIUM confidence: Indirect evidence or partial retrieval
   - LOW confidence: Inference only, no retrieved source

4. **UNVERIFIABLE_PUBLIC override**: If cannot retrieve authority and not obviously malformed, use UNVERIFIABLE_PUBLIC instead of AUTHORITY_NONEXISTENT

## Integration with public-source-gating

All hallucination classifications MUST respect public-source-gating tri-state outcomes:
- VERIFIED_ERROR → one of the 6 hallucination categories applies
- VERIFIED_CORRECT → no hallucination category
- UNVERIFIABLE_PUBLIC → cannot classify hallucination type

## Output Format

For each claim-citation pair:
```json
{
  "claim_id": "claim_1",
  "citation_id": "cit_1_1",
  "outcome": "VERIFIED_ERROR",
  "hallucination_category": "PARAGRAPH_HALLUCINATION",
  "confidence": "HIGH",
  "evidence_summary": "Judgment retrieved from BAILII; only contains paragraphs [1]-[35]; claim cites [42]",
  "evidence_details": {
    "retrieval_url": "https://www.bailii.org/...",
    "retrieval_timestamp": "2026-01-13T12:00:00Z",
    "cached_path": "sources/job_001/abc123...",
    "paragraph_count": 35,
    "cited_paragraph": 42
  }
}
```
