---
name: public-source-gating
description: Enforce public-sources-only verification for legal authority checking and hallucination classification.
version: 0.2
---

## Hard rules (public sources only)

1. Every authority/proposition outcome MUST be one of:
   - VERIFIED_CORRECT (public source retrieved and supports)
   - VERIFIED_ERROR (public source retrieved and contradicts OR shows mismatch)
   - UNVERIFIABLE_PUBLIC (not found / ambiguous / blocked / missing coverage)

2. NEVER state "does not exist" unless you have retrieved material proving mismatch.
   If you cannot retrieve the authority text from public sources, label UNVERIFIABLE_PUBLIC.

3. Every conclusion MUST include:
   - retrieval URL(s) attempted,
   - timestamp,
   - cached artefact path + SHA256,
   - short reason for any failure.

## Source Acquisition Policy (v0.2)

### Permitted Sources (Priority Order)

1. **Find Case Law (National Archives)** - Primary for UK case law
   - Preferred for all UK neutral citations
   - Deterministic URL construction before searching
   - Atom feed search in restricted mode (max 10 results per query)
   - Document retrieval via `/{document_uri}/data.xml`

2. **BAILII** - Secondary fallback for UK case law
   - Used only when FCL fails or not applicable
   - Case-scoped, targeted retrieval only
   - Per-job cap: 25-50 fetches maximum (configurable)

3. **User-provided documents and links** - Always permitted

### Prohibited Activities

**NEVER:**
- Crawl, mirror, or bulk-download from BAILII or Find Case Law
- Build a general corpus from any public source
- Walk indices, pagination, or "related cases" links
- Perform systematic computational analysis without licensing

### Find Case Law Specific Rules

1. **Open Justice Licence Compliance**:
   - Default mode: URL fetch + API retrieval for specific documents only
   - No computational analysis without explicit permission
   - If bulk searching required: mark as `FCL_SEARCH_MODE=RESTRICTED`

2. **Rate Limiting** (mandatory):
   - Global limit: 1,000 requests per 5 minutes per IP (API spec)
   - Polite limit: 1 request per second (system default)
   - Handle 429 responses: backoff + retry (3 attempts max)
   - After retries exhausted: mark remaining `UNVERIFIABLE_PUBLIC`

3. **Resolution Algorithm** (conservative):
   ```
   Step 1: Deterministic URL Construction
     Try: GET /{court}/{year}/{num}/data.xml
     If 200: RESOLVED
     If 404: Proceed to Step 2

   Step 2: Atom Feed Search (Restricted)
     Build 2-3 targeted queries (court filter, neutral citation, party)
     Fetch: per_page=10, page=1 only (max 2 pages)
     Score: exact identifier match > party+year+court match
     If exactly one high-confidence: RESOLVED
     If multiple: UNVERIFIABLE_PUBLIC (ambiguous)
     If none: Proceed to Step 3

   Step 3: BAILII Fallback (Optional)
     Only if within per-job BAILII limit
     Try pattern match
     Respect rate limit
   ```

4. **Caching Requirements**:
   - Store raw XML/HTML artefact
   - Compute SHA256 hash locally
   - Store FCL contenthash from Atom (if available)
   - Store updated timestamp from Atom
   - Create metadata JSON with all retrieval details

### BAILII Specific Rules

1. **Hard Limits** (enforced per job):
   - Per-job cap: 25-50 fetches (configurable)
   - Rate limit: 1 request per second minimum
   - Strict caching: no refetching within job if cached

2. **Pattern Matching Only**:
   - Support 9 UK court types with deterministic URL templates
   - No web search or creative guessing
   - If pattern doesn't match: mark unresolvable

## Evidence Requirements

Every `VERIFIED_*` conclusion MUST include:

1. **Source URL(s)** - All URLs attempted and which succeeded
2. **Retrieval timestamp** - ISO 8601 format
3. **Cached artefact** - Path relative to project root
4. **Content hash** - SHA256 of cached content
5. **Metadata** - HTTP status, content type, content length
6. **Quoted snippets** - From retrieved artefact only (no fabrication)

Every `UNVERIFIABLE_PUBLIC` MUST include:

1. **URLs attempted** - All resolution attempts
2. **HTTP status codes** - Or resolution failure reasons
3. **Reason** - No pattern match / 404 / ambiguous / rate limited
4. **Timestamp** - When attempts were made

## Rate Limit Handling

When rate limits encountered (429 responses):

1. **Immediate action**:
   - Backoff with exponential delay (1s, 2s, 4s)
   - Retry up to 3 times total
   - Log each retry attempt

2. **After exhaustion**:
   - Stop making requests to that source for this job
   - Mark remaining citations as `UNVERIFIABLE_PUBLIC`
   - Include clear note in report:
     ```
     "Rate limit reached for [source]. Remaining N citations could not be verified.
     Consider running audit again after delay or increasing per-job limits."
     ```

3. **Never**:
   - Continue hammering the API
   - Skip rate limiting to "get results faster"
   - Hide rate limit failures from user
