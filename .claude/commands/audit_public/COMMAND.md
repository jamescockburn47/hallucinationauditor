---
name: audit_public
description: Run full hallucination audit pipeline on a job
usage: /audit_public <job_id>
---

# Audit Public Command

Orchestrates the full hallucination audit pipeline: extraction → retrieval → verification.

## Usage

```
/audit_public <job_id>
```

Where `<job_id>` corresponds to `cases_in/<job_id>.json`

## Command Flow

### Pre-Flight Checks

Before starting, validate:

1. **Input file exists**: `cases_in/<job_id>.json` must exist
2. **Valid JSON**: Input file must parse successfully
3. **Required fields present**: job_id, documents array
4. **Documents exist**: All document paths in input must be valid files

If any check fails, abort with clear error message.

### Phase 1: Extraction (Extractor Agent)

**Goal**: Extract text, citations, and build canonical claims

**Action**: Invoke extractor agent to process input documents

**Agent Responsibilities**:
1. Load input job from `cases_in/<job_id>.json`
2. Extract text from all documents (PDF/HTML/TXT)
3. Extract citations if no claims provided in input
4. Build canonical claims list

**Expected Output**: `cache/<job_id>/claims.json`

**Progress Reporting**:
```
Phase 1/3: Extraction
  → Reading input job: cases_in/job_001.json
  → Processing 3 documents...
  ✓ Extracted doc_1 (sample.pdf) - 15000 chars
  ✓ Extracted doc_2 (brief.html) - 8000 chars
  ⚠ Failed doc_3 (memo.txt) - FileNotFoundError
  → Extracting citations from documents...
  ✓ Found 15 citations in doc_1
  ✓ Found 3 citations in doc_2
  → Building canonical claims...
  ✓ Built 5 claims with 8 citations

Extraction Summary:
  - Documents: 3 total, 2 success, 1 error
  - Claims: 5
  - Citations: 8

Output: cache/job_001/claims.json
```

**Error Handling**:
- If extraction fails entirely → abort, report error
- If some documents fail → continue, note in report
- If no claims built → abort with error

**Proceed to Phase 2 if**: At least one claim exists

### Phase 2: Retrieval (Retriever Agent)

**Goal**: Resolve citations, fetch authorities, parse content

**Action**: Invoke retriever agent to obtain public sources

**Agent Responsibilities**:
1. Resolve all citations to candidate URLs
2. Fetch authorities from public sources (BAILII, etc.)
3. Parse authorities into structured format
4. Cache all sources with content-addressing

**Expected Outputs**:
- `cache/<job_id>/resolutions/` - Resolution results
- `cache/<job_id>/authorities/` - Parsed authorities
- `sources/<job_id>/` - Cached source documents

**Progress Reporting**:
```
Phase 2/3: Retrieval
  → Resolving 8 citations...
  ✓ Resolved cit_1: Smith v Jones [2023] UKSC 1
  ✓ Resolved cit_2: Brown [2022] EWCA Civ 5
  ⚠ Unresolvable cit_3: Invalid citation format
  → Progress: 3/8 citations resolved

  → Fetching authorities...
  ⏳ Rate limit: waiting 1.0s
  ✓ Fetched https://bailii.org/... (45KB)
  ✓ Cached (deduped - already exists)
  ⚠ Failed: 404 Not Found
  → Progress: 2/3 fetched

  → Parsing authorities...
  ✓ Parsed BAILII judgment (42 paragraphs)
  ✓ Parsed legislation (15 sections)
  → Progress: 2/2 parsed

Retrieval Summary:
  - Citations: 8 total
  - Resolved: 6 (75%)
  - Unresolvable: 2 (25%)
  - Fetched: 5 (83% of resolved)
  - Parsed: 5 (100% of fetched)
  - Cache: 215KB

Output: cache/job_001/authorities/, sources/job_001/
```

**Error Handling**:
- If resolution fails → mark unresolvable, continue
- If fetch fails → try next candidate, mark failed if all exhausted
- If parse fails → save raw content, mark parse_failed

**Proceed to Phase 3 if**: Retrieval attempted for all citations (even if some failed)

### Phase 3: Verification (Verifier Agent)

**Goal**: Verify claims, classify errors, generate reports

**Action**: Invoke verifier agent to assess and report

**Agent Responsibilities**:
1. Verify each claim against retrieved authorities
2. Apply hallucination-taxonomy to classify errors
3. Enforce public-source-gating tri-state outcomes
4. Generate JSON and Markdown reports

**Expected Outputs**:
- `reports/<job_id>.json` - Structured report
- `reports/<job_id>.md` - Human-readable report

**Progress Reporting**:
```
Phase 3/3: Verification
  → Verifying 5 claims (8 citations)...
  ✓ Claim 1: Verified CORRECT (1/1 citations)
  ✓ Claim 2: Verified CORRECT (2/2 citations)
  ⚠ Claim 3: VERIFIED ERROR - PARAGRAPH_HALLUCINATION
  ✓ Claim 4: Verified CORRECT (1/1 citations)
  ⚠ Claim 5: UNVERIFIABLE (authority not retrieved)
  → Progress: 5/5 claims verified

  → Applying hallucination taxonomy...
  ✓ Classified 1 PARAGRAPH_HALLUCINATION
  ✓ Classified 1 CITATION_MISMATCH

  → Generating reports...
  ✓ JSON report: reports/job_001.json
  ✓ Markdown report: reports/job_001.md

Verification Summary:
  - Claims: 5
  - Citations: 8
  - Verified Correct: 5 (62.5%)
  - Verified Errors: 2 (25%)
  - Unverifiable: 1 (12.5%)

Hallucination Errors:
  - Paragraph Hallucination: 1
  - Citation Mismatch: 1

Output: reports/job_001.json, reports/job_001.md
```

**Error Handling**:
- If verification script fails → log error, mark verification_failed
- If classification ambiguous → use most general category
- If report generation fails → retry, then abort

**Validation**: Verify report-schema compliance before finalizing

### Phase 4: Final Summary

After all phases complete, display comprehensive summary:

```
═══════════════════════════════════════════════════════════
✓ Audit Complete: job_001
═══════════════════════════════════════════════════════════

Title: Sample Legal Document Audit
Audited: 2026-01-13T12:05:30Z

PHASE 1: EXTRACTION
  Documents: 3 (2 success, 1 error)
  Claims: 5
  Citations: 8

PHASE 2: RETRIEVAL
  Resolved: 6/8 (75%)
  Fetched: 5/6 (83%)
  Parsed: 5/5 (100%)
  Cache: 215KB

PHASE 3: VERIFICATION
  Verified Correct: 5 (62.5%)
  Verified Errors: 2 (25%)
  Unverifiable: 1 (12.5%)

HALLUCINATION ERRORS FOUND:
  ⚠ Paragraph Hallucination: 1
  ⚠ Citation Mismatch: 1

REPORTS GENERATED:
  📄 reports/job_001.json (structured data)
  📋 reports/job_001.md (human-readable)

EVIDENCE CACHED:
  📁 cache/job_001/ (processing results)
  📁 sources/job_001/ (source documents)

═══════════════════════════════════════════════════════════

Review the markdown report for detailed findings:
  reports/job_001.md

All evidence is cached locally for reproducibility.
```

## Error Handling

### Input Validation Errors
```
✗ Error: Input file not found
  File: cases_in/job_001.json

  Please create an input job file at this location.
  See cases_in/README.md for format details.
```

### Phase Errors

**Extraction Phase Failure**:
```
✗ Phase 1 Failed: Extraction
  Reason: No documents could be extracted

  Check:
  - Document file paths are correct
  - Files are not corrupted
  - Supported types: pdf, html, txt

  See: cache/job_001/extraction.log
```

**Retrieval Phase Failure**:
```
⚠ Phase 2 Warning: Retrieval issues
  2/8 citations could not be resolved
  1/6 fetches failed (404)

  Continuing to verification with available data...
```

**Verification Phase Failure**:
```
✗ Phase 3 Failed: Verification
  Reason: Report generation error

  See: cache/job_001/verification.log
```

### Recovery Options

If a phase fails:
1. Check logs in `cache/<job_id>/<phase>.log`
2. Fix issues (file paths, network, etc.)
3. Re-run command (uses cache for completed steps)

## Caching Strategy

The command uses caching to enable incremental processing:

- **Extraction**: If `cache/<job_id>/claims.json` exists → skip Phase 1
- **Retrieval**: If `sources/<job_id>/<hash>` exists → skip fetch
- **Verification**: Always run (quick, depends on current taxonomy rules)

**Force full re-run**: Delete `cache/<job_id>/` and `sources/<job_id>/` before running

## Skills Applied

This command enforces:
- **public-source-gating**: Tri-state outcomes, evidence trails, no fabrication
- **hallucination-taxonomy**: 6 error categories, classification priority
- **report-schema**: JSON and Markdown output structure

## Success Criteria

Command succeeds if:
- [ ] All three phases complete
- [ ] Both reports generated (JSON + MD)
- [ ] All outcomes are tri-state (VERIFIED_CORRECT | VERIFIED_ERROR | UNVERIFIABLE_PUBLIC)
- [ ] All VERIFIED_ERROR have hallucination category
- [ ] All conclusions have evidence trails

## Progress Tracking

Show real-time progress for long-running operations:
- Document extraction (per document)
- Citation resolution (per citation)
- Authority fetching (with rate limit delays)
- Verification (per claim)

Use visual indicators:
- ✓ Success
- ⚠ Warning (non-fatal)
- ✗ Error (fatal)
- → In progress
- ⏳ Waiting (rate limit)

## Performance Notes

Typical timing (per job):
- Extraction: 1-5 seconds per document
- Retrieval: 1-2 seconds per citation (with rate limiting)
- Verification: <1 second per claim
- Report generation: <1 second

**Bottleneck**: Rate-limited HTTP fetches (1000ms default between requests)

For 10 citations: ~10-20 seconds for retrieval phase

## Future Enhancements (v0.2+)

Not in v0.1:
- Concurrency (parallel fetching within rate limits)
- Resume capability (restart failed jobs)
- Incremental updates (re-verify subset of claims)
- API server mode
- Real-time streaming output
