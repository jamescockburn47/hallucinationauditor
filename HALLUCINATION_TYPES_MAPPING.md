# Matthew Lee's 8 AI Hallucination Types - Detection Mapping

This document maps Matthew Lee's taxonomy to our hallucination auditor's detection capabilities.

---

## Detection Capability Matrix

| Lee Type | Our Category | Detection Method | Status |
|----------|--------------|------------------|--------|
| 1. Fabricated Case & Citation | AUTHORITY_NONEXISTENT | FCL/BAILII resolution fails after exhaustive attempts | ✅ FULL |
| 2. Wrong Case Name, Right Citation | CITATION_MISMATCH | Title mismatch after fetching real case | ✅ FULL |
| 3. Right Case Name, Wrong Citation | CITATION_MALFORMED + AUTHORITY_NONEXISTENT | Citation fails to resolve despite valid-looking format | ✅ FULL |
| 4. Conflated Authorities | PARAPHRASE_DISTORTION + CITATION_MISMATCH | Claim verification detects mixed content from multiple cases | ⚠️ PARTIAL |
| 5. Correct Law, Invented Authority | AUTHORITY_NONEXISTENT | Authority doesn't exist but principle may be valid | ✅ FULL |
| 6. Real Case, Misstated Facts/Ratio | PARAPHRASE_DISTORTION + CITATION_MISMATCH | Verification shows contradiction/distortion | ✅ FULL |
| 7. Misleading Secondary Paraphrase | PARAPHRASE_DISTORTION | Requires detecting secondary vs primary source | ⚠️ PARTIAL |
| 8. False Citations Citing False | AUTHORITY_NONEXISTENT (cascading) | Detect each citation in chain independently | ✅ FULL |

---

## Detailed Detection Mechanisms

### Type 1: Fabricated Case and Citation
**Example:** "In *Smith v Widget Corp* [2023] UKSC 999..."

**Our Detection:**
1. `public_resolve.py` attempts FCL deterministic URL construction → 404
2. `fcl_search_atom.py` searches Atom feed → no results
3. `public_resolve.py` tries BAILII pattern match → 404
4. **Result:** `AUTHORITY_NONEXISTENT` (HIGH confidence)

**Evidence Trail:**
```json
{
  "outcome": "VERIFIED_ERROR",
  "hallucination_category": "AUTHORITY_NONEXISTENT",
  "evidence": {
    "retrieval_urls": [
      "https://caselaw.nationalarchives.gov.uk/uksc/2023/999/data.xml",
      "https://caselaw.nationalarchives.gov.uk/atom.xml?query=Smith+Widget&court=uksc",
      "https://www.bailii.org/uk/cases/UKSC/2023/999.html"
    ],
    "all_returned_404": true,
    "notes": "Exhaustive search completed; no such case exists in public records"
  }
}
```

---

### Type 2: Wrong Case Name, Right Citation
**Example:** "*Brown v Board of Education* [2015] UKSC 11" (actually Montgomery v Lanarkshire)

**Our Detection:**
1. Resolve citation `[2015] UKSC 11` → finds Montgomery case
2. Fetch and parse authority
3. Compare claimed case name "Brown v Board" with actual "Montgomery v Lanarkshire"
4. **Result:** `CITATION_MISMATCH` (HIGH confidence)

**Evidence Trail:**
```json
{
  "outcome": "VERIFIED_ERROR",
  "hallucination_category": "CITATION_MISMATCH",
  "evidence": {
    "claimed_case_name": "Brown v Board of Education",
    "actual_case_name": "Montgomery v Lanarkshire Health Board",
    "citation": "[2015] UKSC 11",
    "cached_authority": "sources/job_001/abc123.xml",
    "notes": "Citation resolves to different case than claimed"
  }
}
```

---

### Type 3: Right Case Name, Wrong Citation
**Example:** "Montgomery v Lanarkshire [2023] UKSC 99" (correct case, wrong citation)

**Our Detection:**
1. Resolve citation `[2023] UKSC 99` → 404 (doesn't exist)
2. Search Atom feed with "Montgomery Lanarkshire" → finds [2015] UKSC 11
3. Detect: Case name matches real case, but citation is wrong
4. **Result:** `CITATION_MALFORMED` or `AUTHORITY_NONEXISTENT` depending on confidence

**Evidence Trail:**
```json
{
  "outcome": "VERIFIED_ERROR",
  "hallucination_category": "AUTHORITY_NONEXISTENT",
  "evidence": {
    "claimed_citation": "[2023] UKSC 99",
    "resolution_failed": true,
    "possible_intended_case": "Montgomery v Lanarkshire [2015] UKSC 11",
    "notes": "Citation appears fabricated; similar case exists with different citation"
  }
}
```

---

### Type 4: Conflated Authorities
**Example:** Combining principles from Cases A, B, and C into a single fictitious authority

**Our Detection:**
1. Resolve citation → may find one real case
2. Verify claim against actual authority
3. Keyword matching shows partial overlap but significant contradictions
4. **Result:** `PARAPHRASE_DISTORTION` or `CITATION_MISMATCH` (MEDIUM confidence)

**Current Limitation:**
- Detecting conflation requires:
  - Identifying that claim draws from multiple sources
  - Recognizing the hybridization
- Our keyword matching can detect mismatch but not necessarily identify conflation source

**Enhancement Needed:**
- Cross-reference verification across multiple authorities
- Detect when claim elements come from different cases

---

### Type 5: Correct Law, Invented Authority
**Example:** "Doctors must obtain informed consent (see *Medical Ethics v Common Law* [2020] EWHC 555)"

**Our Detection:**
1. Principle may be correct (informed consent required)
2. Citation resolution fails → authority doesn't exist
3. **Result:** `AUTHORITY_NONEXISTENT` (HIGH confidence)
4. **Note in report:** "Principle may be valid but authority is fabricated"

**Evidence Trail:**
```json
{
  "outcome": "VERIFIED_ERROR",
  "hallucination_category": "AUTHORITY_NONEXISTENT",
  "confidence": "HIGH",
  "evidence": {
    "claim_text": "Doctors must obtain informed consent",
    "citation": "Medical Ethics v Common Law [2020] EWHC 555",
    "retrieval_failed": true,
    "notes": "Legal principle may be accurate but supporting authority is fabricated"
  }
}
```

---

### Type 6: Real Case, Misstated Facts or Ratio
**Example:** Montgomery case cited correctly, but facts or holding misrepresented

**Our Detection:**
1. Resolve citation → finds real case ✓
2. Parse authority → extract paragraphs, full text ✓
3. Verify claim against authority:
   - Keyword matching
   - Paragraph-level comparison
   - Semantic checking
4. Detect contradiction or significant distortion
5. **Result:** `PARAPHRASE_DISTORTION` or `CITATION_MISMATCH` (depends on severity)

**Evidence Trail:**
```json
{
  "outcome": "VERIFIED_ERROR",
  "hallucination_category": "PARAPHRASE_DISTORTION",
  "evidence": {
    "claim": "Court held doctors need not disclose rare risks",
    "authority_paragraph": "[87] A doctor is under a duty to take reasonable care to ensure that the patient is aware of any material risks...",
    "contradiction_detected": true,
    "similarity_score": 0.15,
    "notes": "Claim directly contradicts authority's actual holding"
  }
}
```

**Strength:**
- Our verification logic explicitly checks for contradictions
- We extract actual text from authority for comparison
- We compute keyword overlap and similarity scores

---

### Type 7: Misleading Paraphrase of Secondary Authority
**Example:** Citing a textbook or headnote incorrectly, making it sound like primary authority

**Our Detection:**
1. If cited as primary authority (case citation), we fetch and verify
2. If source is actually secondary, we may not detect unless:
   - We fetch the case and find claim isn't supported
   - The "citation" doesn't resolve to a real case

**Current Limitation:**
- Harder to detect if the paraphrase is from a real secondary source
- System focuses on primary case law

**Enhancement Needed:**
- Distinguish primary vs secondary sources
- Flag when claim appears to be from commentary rather than judgment
- Verify secondary source citations separately

**Partial Detection:**
- If paraphrase contradicts real case law: `PARAPHRASE_DISTORTION`
- If the "case" is actually a textbook: `AUTHORITY_NONEXISTENT` (if it doesn't resolve)

---

### Type 8: False Citations Citing False Citations
**Example:** Chain of fabricated authorities building on each other

**Our Detection:**
1. System checks **each citation independently**
2. If Citation A is fabricated → `AUTHORITY_NONEXISTENT`
3. If Citation B (which relies on A) is also fabricated → `AUTHORITY_NONEXISTENT`
4. **Result:** Both marked as errors independently

**Evidence Trail:**
```json
{
  "claims": [
    {
      "claim_id": "claim_1",
      "text": "Established in Case A [2020] UKSC 100",
      "citations": [{"outcome": "VERIFIED_ERROR", "category": "AUTHORITY_NONEXISTENT"}]
    },
    {
      "claim_id": "claim_2",
      "text": "Following Case A, Case B [2021] UKSC 200 held...",
      "citations": [{"outcome": "VERIFIED_ERROR", "category": "AUTHORITY_NONEXISTENT"}]
    }
  ],
  "notes": "Chain of false citations detected: both authorities non-existent"
}
```

**Strength:**
- Independent verification breaks the chain
- Each false citation gets caught separately
- Report shows cascading failures

**Enhancement Needed:**
- Explicitly detect citation chains (when claims reference earlier claims)
- Flag cascading hallucinations in summary

---

## Summary: Detection Coverage

### ✅ Full Detection (6/8 types)
1. Fabricated Case & Citation
2. Wrong Case Name, Right Citation
3. Right Case Name, Wrong Citation
5. Correct Law, Invented Authority
6. Real Case, Misstated Facts/Ratio
8. False Citations Citing False

### ⚠️ Partial Detection (2/8 types)
4. Conflated Authorities - Can detect mismatch, but not always identify conflation
7. Misleading Secondary Paraphrase - Only if it contradicts primary sources

---

## Enhancement Roadmap

To achieve **100% coverage**:

### Short Term
- [x] Extract case names from fetched authorities
- [x] Compare claimed vs actual case names
- [ ] Improve conflation detection (cross-authority comparison)

### Medium Term
- [ ] Distinguish primary vs secondary sources
- [ ] Add secondary source verification module
- [ ] Implement citation chain analysis (detect cascading errors)

### Long Term
- [ ] Semantic similarity beyond keyword matching
- [ ] LLM-assisted verification (hybrid approach)
- [ ] Automated conflation source identification

---

## Current System Strengths

1. **Exhaustive Resolution** - Tries FCL, then BAILII, then marks unverifiable
2. **Actual Text Comparison** - Fetches real authority and verifies against it
3. **Evidence-Based** - Never claims hallucination without retrieved proof
4. **Conservative** - When uncertain, marks `UNVERIFIABLE_PUBLIC` (no false positives)
5. **Transparent** - Full evidence trails with URLs, timestamps, cache paths

---

**The system currently detects 6 out of 8 types fully, with partial coverage on the remaining 2. This provides strong protection against the most common and dangerous hallucination types.**
