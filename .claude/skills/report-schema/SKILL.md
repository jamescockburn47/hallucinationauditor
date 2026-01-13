---
name: report-schema
description: Define audit report structure and JSON schema for hallucination auditor outputs
version: 0.1
---

## Report Output Files

Each audit job produces TWO files:
1. `reports/<job_id>.json` - Machine-readable structured data
2. `reports/<job_id>.md` - Human-readable report

## JSON Schema

### reports/<job_id>.json

```json
{
  "audit_metadata": {
    "job_id": "string",
    "title": "string",
    "audited_at": "ISO 8601 timestamp",
    "auditor_version": "0.1.0",
    "settings": {
      "public_sources_only": true,
      "rate_limit_ms": 1000
    }
  },
  "documents": [
    {
      "doc_id": "string",
      "path": "string",
      "type": "pdf|html|txt",
      "extraction_status": "success|error",
      "char_count": 12345
    }
  ],
  "claims": [
    {
      "claim_id": "string",
      "text": "string",
      "source_doc_id": "string",
      "citations": [
        {
          "citation_id": "string",
          "citation_text": "string",
          "resolution_status": "resolved|ambiguous|unresolvable",
          "candidate_urls": ["url1", "url2"],
          "fetch_status": "success|error|cached",
          "fetched_url": "string",
          "parse_status": "success|error",
          "verification_outcome": "supported|contradicted|unclear",
          "public_gate_outcome": "VERIFIED_CORRECT|VERIFIED_ERROR|UNVERIFIABLE_PUBLIC",
          "hallucination_category": "CITATION_MISMATCH|PARAGRAPH_HALLUCINATION|QUOTATION_FABRICATION|PARAPHRASE_DISTORTION|AUTHORITY_NONEXISTENT|CITATION_MALFORMED|null",
          "confidence": "HIGH|MEDIUM|LOW",
          "evidence": {
            "retrieval_urls": ["url"],
            "retrieval_timestamp": "ISO 8601",
            "cached_path": "sources/job_id/hash",
            "matching_paragraphs": [
              {
                "para_num": "42",
                "text": "excerpt...",
                "similarity": 0.95
              }
            ],
            "notes": "explanation"
          }
        }
      ],
      "claim_outcome": "VERIFIED_CORRECT|VERIFIED_ERROR|UNVERIFIABLE_PUBLIC|MIXED"
    }
  ],
  "summary": {
    "total_claims": 10,
    "total_citations": 25,
    "verified_correct": 18,
    "verified_error": 5,
    "unverifiable": 2,
    "hallucination_breakdown": {
      "CITATION_MISMATCH": 2,
      "PARAGRAPH_HALLUCINATION": 2,
      "QUOTATION_FABRICATION": 1,
      "PARAPHRASE_DISTORTION": 0,
      "AUTHORITY_NONEXISTENT": 0,
      "CITATION_MALFORMED": 0
    }
  }
}
```

## Markdown Report Structure

### reports/<job_id>.md

```markdown
# Hallucination Audit Report: <Title>

**Job ID**: <job_id>
**Audited**: <timestamp>
**Version**: 0.1.0

---

## Executive Summary

- **Total Claims Audited**: N
- **Total Citations Checked**: M
- **Verified Correct**: X (Y%)
- **Verified Errors**: A (B%)
- **Unverifiable**: C (D%)

### Hallucination Breakdown

| Category | Count | % of Errors |
|----------|-------|-------------|
| Citation Mismatch | 2 | 40% |
| Paragraph Hallucination | 2 | 40% |
| Quotation Fabrication | 1 | 20% |
| Paraphrase Distortion | 0 | 0% |
| Authority Nonexistent | 0 | 0% |
| Citation Malformed | 0 | 0% |

---

## Detailed Findings

### Claim 1: <claim_text>

**Source Document**: <doc_id>
**Overall Outcome**: VERIFIED_ERROR

#### Citation 1.1: <citation_text>

- **Resolution**: Resolved to <url>
- **Retrieval**: SUCCESS (cached)
- **Verification**: CONTRADICTED
- **Public Gate**: VERIFIED_ERROR
- **Hallucination**: CITATION_MISMATCH (HIGH confidence)
- **Evidence**:
  - Retrieved from: <url>
  - Retrieved at: <timestamp>
  - Cached at: <path>
  - Matching paragraph [23]: "actual text..."
  - Analysis: Claim states X but authority states Y

#### Citation 1.2: <citation_text>

- **Resolution**: Unresolvable
- **Retrieval**: FAILED
- **Verification**: N/A
- **Public Gate**: UNVERIFIABLE_PUBLIC
- **Hallucination**: N/A
- **Evidence**:
  - URLs attempted: [list]
  - Reason: No pattern match, 404 errors

---

## Appendices

### Appendix A: Retrieval Log

| Citation | Resolution | URL | Fetch Status | Timestamp |
|----------|------------|-----|--------------|-----------|
| Smith v Jones [2023] UKSC 1 | Resolved | https://bailii.org/... | Success | 2026-01-13T12:00:00Z |
| Brown [2022] EWCA Civ 5 | Resolved | https://bailii.org/... | Cached | 2026-01-13T12:00:05Z |
| ... | Unresolvable | N/A | Failed | 2026-01-13T12:00:10Z |

### Appendix B: Cache Inventory

- `cache/<job_id>/doc_1.text.json` - 45KB
- `cache/<job_id>/claims.json` - 12KB
- `sources/<job_id>/abc123...` - 120KB (BAILII judgment)
- `sources/<job_id>/def456...` - 85KB (BAILII judgment)
- Total cached: 262KB

### Appendix C: Methodology

This audit used hallucination-auditor v0.1.0 with public sources only.

**Verification Process**:
1. Text extracted from documents using PyMuPDF
2. Citations resolved to BAILII URLs using pattern matching
3. Authorities fetched and cached with SHA256 content-addressing
4. Claims verified using keyword matching and fuzzy text comparison
5. Errors classified per hallucination-taxonomy

**Public Sources Used**:
- BAILII (British and Irish Legal Information Institute)
- legislation.gov.uk

All evidence is cached locally for reproducibility.

**Audit Statistics**:
- Processing time: <duration>
- Errors encountered: <count>
- Warnings: <count>

Audit completed on <timestamp>.
```

## Report Generation Rules

1. **Reproducibility**: Include all URLs, timestamps, cache paths
2. **Evidence trails**: Every conclusion links to cached artifact
3. **Conservative language**: Use "appears to", "suggests" for MEDIUM/LOW confidence
4. **No speculation**: If UNVERIFIABLE_PUBLIC, say so explicitly
5. **Summary first**: Executive summary gives high-level view
6. **Details follow**: Claim-by-claim breakdown with full evidence
7. **Appendices**: Raw data for full reproducibility
8. **Claim outcome aggregation**:
   - VERIFIED_CORRECT: All citations for claim are correct
   - VERIFIED_ERROR: At least one citation has error
   - UNVERIFIABLE_PUBLIC: All citations unverifiable
   - MIXED: Some correct, some unverifiable, none errors

## Field Requirements

### Required for ALL citations:
- citation_id
- citation_text
- resolution_status
- public_gate_outcome
- evidence.retrieval_urls (even if empty list)
- evidence.retrieval_timestamp

### Required for VERIFIED_ERROR:
- hallucination_category (must be one of 6 categories)
- confidence (must be HIGH|MEDIUM|LOW)
- evidence.cached_path (if authority retrieved)
- evidence.notes (explanation of error)

### Optional fields:
- matching_paragraphs (only if authority parsed successfully)
- verification_outcome (only if verification attempted)
- candidate_urls (only if resolution attempted)

## Validation Rules

Before writing reports, validate:
1. All VERIFIED_ERROR have hallucination_category
2. All VERIFIED_ERROR have evidence.cached_path OR evidence.notes explaining why not
3. All outcomes are one of three: VERIFIED_CORRECT, VERIFIED_ERROR, UNVERIFIABLE_PUBLIC
4. Summary counts match actual claim/citation tallies
5. All timestamps are valid ISO 8601
6. All file paths exist in cache/sources
