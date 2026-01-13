# Hallucination Auditor - Project Constitution

This document defines the immutable policies and requirements for the hallucination auditor system.

---

## A. Source Acquisition Policy (Public-Only; Case-Scoped)

### A1. Permitted Sources

The system must acquire authority texts **only** from:

1. **User-provided documents and links**
2. **Public sources:**
   - **Primary:** Find Case Law (National Archives) - preferred for all UK case law
   - **Secondary:** BAILII - case-scoped, low-volume, targeted retrieval only

### A2. Prohibited Activities

The system **must not**:
- Crawl, mirror, or bulk-download from BAILII or Find Case Law
- Build a general corpus from any public source
- Walk indices, pagination, or "related cases" links
- Perform systematic computational analysis without appropriate licensing

### A3. BAILII Usage Restrictions

BAILII use is permitted **only** for:
- Targeted retrieval of **specific authorities in the current job**
- Individual case-by-case fetching (not batch processing)

**Hard Limits:**
- **Per-job cap:** 25-50 fetches maximum (configurable)
- **Rate limit:** 1 request per second minimum
- **Caching:** Strict - no refetching within job if cached
- **No bulk operations:** No index walking, pagination, or link following

---

## B. Find Case Law License-Aware Operation

### B1. Open Justice Licence Compliance

**Default Mode:** URL fetch + API retrieval only for documents directly identified from the job's citations.

**Important:** The Open Justice Licence permits reuse but **does not permit computational analysis** without permission.

### B2. Configuration Modes

**FCL_SEARCH_MODE:**
- `RESTRICTED` (default) - Limited resolution attempts per citation; no bulk operations
- `LICENSED_BULK_OK` (future) - Requires explicit computational analysis permission

### B3. Operational Rules

1. **URL fetch + API retrieval** only for specific identified authorities
2. If workflow requires programmatic searching in bulk:
   - Switch to `FCL_SEARCH_MODE=RESTRICTED`
   - Output warning in report noting license constraints
   - Advise user to apply for computational analysis permission before scaling

### B4. Rate Limiting

**Find Case Law API:**
- **Global limit:** 1,000 requests per rolling 5 minutes per IP (API specification)
- **Polite limit:** 1 request per second (system default)
- **429 handling:** Backoff + retry (3 attempts max), then mark remaining `UNVERIFIABLE_PUBLIC`

---

## C. Canonical Evidence Gating (Immutable)

### C1. Tri-State Outcomes (Mandatory)

Every citation/proposition outcome **MUST** be one of:
- `VERIFIED_CORRECT` - Public source retrieved and supports claim
- `VERIFIED_ERROR` - Public source retrieved and contradicts claim
- `UNVERIFIABLE_PUBLIC` - Cannot retrieve, ambiguous, or no coverage

### C2. Evidence Requirements

**No "fabricated" labels without evidence:**
- Cannot label item "fabricated" or "non-existent" unless system has:
  - Retrieved public source evidence
  - Cached that evidence
  - Evidence proves mismatch or non-existence
- Otherwise: Must use `UNVERIFIABLE_PUBLIC` with rationale

### C3. Mandatory Evidence Trail

Every `VERIFIED_*` conclusion **must** include:
1. **Source URL(s)** - All URLs attempted and successful
2. **Retrieval timestamp** - When fetched (ISO 8601)
3. **Cached artefact path + SHA256** - Local evidence file with integrity hash
4. **Quoted snippets** - Extracted from retrieved artefact only (no fabrication)

### C4. Rationale for Failures

Every `UNVERIFIABLE_PUBLIC` must include:
- URLs attempted (all of them)
- HTTP status codes or resolution failures
- Reason (no pattern match / 404 / ambiguous / rate limited)
- Timestamp

---

## D. Deterministic Engineering Requirements

### D1. Script Architecture

**All logic must live in deterministic Python scripts:**
- Location: `scripts/` directory
- No LLM calls within scripts
- No "reasoning" or inference logic
- Pure deterministic computation only

**Agents orchestrate; Scripts execute.**

### D2. Unit Testing

All scripts must have:
- Unit tests in `tests/` directory
- Test fixtures for edge cases
- Deterministic input → output validation
- No network calls in unit tests (mock external APIs)

### D3. HTTP Requirements

All HTTP calls must:
1. **Respect rate limits** - Both API-specified and polite limits
2. **Implement retries** - Exponential backoff (3 attempts max)
3. **Cache by URL + content hash** - SHA256 content-addressed storage
4. **Capture metadata:**
   - HTTP status code
   - Content-Type header
   - Content hash (SHA256)
   - Retrieval timestamp
5. **Handle 429s gracefully:**
   - Backoff and retry
   - Stop on repeated failures
   - Mark remaining citations `UNVERIFIABLE_PUBLIC`
   - Include clear limitation note in report

---

## E. Find Case Law API Integration

### E1. Key Concepts

**Document URI (Machine Identifier):**
- Stable internal identifier
- Formats:
  - Older: `court/year/sequence` (looks like NCN but is not)
  - Newer: `d-<uuid>` style
- Use for API retrieval: `/{document_uri}/data.xml`

**Structured Identifiers (Human-Facing):**
- Multiple per document:
  - Find Case Law identifier (`fclid`)
  - Neutral citation (`ukncn`) where applicable
- **Not guaranteed unique** - do not use as primary keys
- Each document has one "preferred identifier"

### E2. Citation Resolution Algorithm (Conservative)

For each extracted citation:

#### Step 1: Deterministic URL Construction (Preferred)
```
If neutral citation can be safely mapped to FCL slug (e.g., uksc/2024/123):
  Try: GET /{slug}/data.xml
  If 200: RESOLVED
  If 404: Proceed to Step 2
```

#### Step 2: Atom Feed Search (Restricted Mode)
```
Build 2-3 targeted queries:
  - court filter (if court known)
  - query using neutral citation string
  - optionally party using one surname token

Fetch per_page=10, page=1 only (max 2 pages)

Score entries deterministically:
  - Exact match on tna:identifier[type="ukncn"]: BEST
  - Match on party tokens + year + court: GOOD
  - Otherwise: AMBIGUOUS
```

#### Step 3: Outcome
```
If exactly one high-confidence match:
  - Set document_uri
  - Fetch /{document_uri}/data.xml
  - Cache with metadata
  - Status: RESOLVED

If multiple plausible matches:
  - Status: UNVERIFIABLE_PUBLIC (ambiguous)
  - List candidates in notes

If none:
  - Status: UNVERIFIABLE_PUBLIC (not found)
  - Log exact search parameters attempted
```

#### Step 4: BAILII Fallback (Optional, if within limits)
```
If FCL failed AND within per-job BAILII limit:
  Try BAILII pattern match
  Respect rate limit
  Cache result
```

### E3. Caching Requirements

Store per retrieved authority:
1. **Raw XML artefact file**
2. **SHA256 of artefact** - Computed locally
3. **Content hash from Atom** - `<tna:contenthash>` if available
4. **Atom updated timestamp** - `<updated>` field
5. **Metadata JSON:**
   ```json
   {
     "source": "find_case_law",
     "document_uri": "uksc/2015/11",
     "retrieved_at": "2026-01-13T...",
     "content_hash_local": "abc123...",
     "content_hash_fcl": "def456...",
     "updated_at_fcl": "2015-03-12T...",
     "url": "https://caselaw.nationalarchives.gov.uk/uksc/2015/11/data.xml",
     "http_status": 200
   }
   ```

**Purpose:**
- Prove what was relied upon at time of audit
- Detect if authoritative text changed later
- Enable reproducibility

### E4. Atom Feed Search Parameters

**Endpoint:** `GET https://caselaw.nationalarchives.gov.uk/atom.xml`

**Key Parameters:**
- `query` - Full-text search
- `party` - Word in party name (full-match for a word)
- `judge` - Word in judge name
- `court` - Can be repeated; accepts URL-style (`ewhc/fam`) or XML codes
- `order` - Default `-date`; can use `-transformation` or `-updated`
- `page`, `per_page` - Pagination

**Parse from each `<entry>`:**
- `<link rel="alternate">` - HTML page
- `<link type="application/akn+xml">` - XML link (data.xml)
- `<link type="application/pdf">` - PDF link
- `<tna:uri>` - Document URI (use for retrieval)
- `<tna:identifier ...>` - Identifiers including neutral citation
- `<tna:contenthash>` - Hash of text content

---

## F. Compliance and Reporting

### F1. License Warnings

If `FCL_SEARCH_MODE=RESTRICTED` is active, reports must include:

```
## License Notice

This audit used the Find Case Law API in RESTRICTED mode, complying with
the Open Justice Licence terms for individual case retrieval.

**Computational analysis permission not obtained.**

If you require bulk processing or systematic computational analysis across
Find Case Law records, you must apply for permission from The National
Archives before scaling this workflow.
```

### F2. Rate Limit Transparency

Reports must include retrieval statistics:
- Total FCL requests made
- Total BAILII requests made
- Any rate limit encounters (429 responses)
- Citations marked unverifiable due to limits

### F3. Source Attribution

All verified claims must attribute source:
- "Retrieved from Find Case Law: [document_uri]"
- "Retrieved from BAILII: [url]"
- Never mix sources without explicit delineation

---

## G. Configuration Schema

### G1. Job-Level Settings

```json
{
  "settings": {
    "public_sources_only": true,
    "fcl_search_mode": "RESTRICTED",
    "max_fcl_requests_per_job": 100,
    "max_bailii_requests_per_job": 25,
    "rate_limit_fcl_seconds": 1.0,
    "rate_limit_bailii_seconds": 1.0,
    "prefer_sources": ["find_case_law", "bailii"]
  }
}
```

### G2. Limits Enforcement

System must:
- Track request counts per job
- Abort gracefully when limits reached
- Mark remaining citations `UNVERIFIABLE_PUBLIC`
- Report: "Per-job limit reached (N/M sources attempted)"

---

## H. Implementation Checklist

### Required Scripts

- [x] `scripts/fcl_search_atom.py` - Search Atom feed
- [x] `scripts/fcl_get_xml.py` - Retrieve document XML
- [x] `scripts/public_resolve.py` - Updated with FCL-first approach
- [x] `scripts/fetch_url.py` - Updated with source-specific rate limiting
- [x] `scripts/parse_authority.py` - Updated with Akoma Ntoso XML parsing

### Required Updates

- [x] `.claude/skills/public-source-gating/SKILL.md` - Add FCL policies
- [x] Agents - Updated with new resolution workflow
- [x] Reports - Add license warnings and source attribution
- [x] Tests - Add FCL API mocking and integration tests

---

## I. Acceptance Criteria

A valid implementation must:

1. ✅ **Prefer Find Case Law** over BAILII for UK case law
2. ✅ **Use deterministic URL construction** before searching
3. ✅ **Respect all rate limits** (FCL: 1 req/sec, BAILII: 1 req/sec)
4. ✅ **Cache all retrievals** with SHA256 + metadata
5. ✅ **Enforce per-job caps** (FCL: 100, BAILII: 25 by default)
6. ✅ **Never bulk-process** or computationally analyze without permission
7. ✅ **Maintain tri-state outcomes** (CORRECT / ERROR / UNVERIFIABLE)
8. ✅ **Include evidence trails** (URLs, timestamps, cache paths, hashes)
9. ✅ **Generate license warnings** in RESTRICTED mode
10. ✅ **Handle 429s gracefully** with backoff and clear reporting

---

## J. Version History

- **v0.1.0** - Initial implementation with BAILII-only
- **v0.2.0** - Added Find Case Law API integration (current)

---

**This constitution is immutable for the current version. Any changes require explicit version increment and user approval.**
