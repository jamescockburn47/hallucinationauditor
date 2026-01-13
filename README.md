# Hallucination Auditor

**Version 0.2.0** - A local tool for auditing hallucinations in legal authority citations with audit-grade reports.

## 🚀 Quick Start

**New to the project?** → See **[GETTING_STARTED.md](GETTING_STARTED.md)** for step-by-step instructions!

**TL;DR:**
```bash
pip install -r requirements.txt
python scripts/orchestrate.py --input cases_in/montgomery_fcl_test.json
```

---

## Overview

Detects and classifies citation/proposition errors in legal documents by:
1. Extracting claims and citations from documents
2. Retrieving authorities from public sources (**Find Case Law** + BAILII)
3. Verifying claims against authorities using keyword matching
4. Classifying errors into hallucination categories
5. Generating reproducible audit reports with evidence trails

## Core Principles

- **Public sources only** - User documents + publicly accessible authorities
- **FCL-first** - Prefers National Archives Find Case Law over BAILII
- **Tri-state outcomes** - Every claim is VERIFIED_CORRECT, VERIFIED_ERROR, or UNVERIFIABLE_PUBLIC
- **Evidence-based** - No conclusions without retrieved evidence proving mismatch
- **Reproducible** - All sources cached locally with SHA256 hashes and timestamps

## Installation

### Prerequisites

- Python 3.11 or higher
- Git

### Setup

```bash
# Clone repository
cd hallucination-auditor

# Create virtual environment
python3.11 -m venv venv

# Activate virtual environment
# On Windows:
venv\Scripts\activate
# On macOS/Linux:
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Install dev dependencies (for testing)
pip install -r requirements-dev.txt
```

## Usage

**→ See [GETTING_STARTED.md](GETTING_STARTED.md) for detailed usage guide**

### Basic workflow:

1. **Create input JSON** in `cases_in/your_job.json`
2. **Run audit:** `python scripts/orchestrate.py --input cases_in/your_job.json`
3. **View reports** in `reports/your_job.md` and `reports/your_job.json`

### Example input (minimal):

```json
{
  "job_id": "my_audit",
  "title": "My Document Audit",
  "documents": [
    {
      "doc_id": "doc1",
      "path": "my_document.txt",
      "type": "txt"
    }
  ],
  "claims": [
    {
      "claim_id": "claim_1",
      "text": "The court held that informed consent is required",
      "citations": [
        {"raw": "Montgomery v Lanarkshire [2015] UKSC 11"}
      ]
    }
  ]
}
```

### Try the included example:

```bash
python scripts/orchestrate.py --input cases_in/montgomery_fcl_test.json
```

## Architecture

### Three-Phase Pipeline

1. **Phase 1: Extraction**
   - extract_text.py - Extract text from PDF/HTML/TXT
   - extract_citations.py - Find UK neutral citations (regex patterns)
   - build_claims.py - Build canonical claims from user input + extraction

2. **Phase 2: Retrieval (FCL-first)**
   - public_resolve.py - Resolve citations (Find Case Law → BAILII)
   - fetch_url.py - Download with source-specific rate limiting
   - parse_authority.py - Parse XML (Akoma Ntoso) or HTML (BAILII)

3. **Phase 3: Verification**
   - verify_claim.py - Verify claims using keyword matching
   - generate_reports.py - Create JSON and Markdown reports

### Data Sources

**Primary:** Find Case Law (National Archives)
- 9 UK court patterns supported
- Akoma Ntoso XML format
- Rate limit: 1,000 requests / 5 minutes
- License: Open Justice Licence

**Secondary:** BAILII (fallback)
- HTML judgments
- Rate limit: 1 request / second (polite)
- Per-job cap: 25-50 fetches (configurable)

### Directory Structure

```
hallucination-auditor/
├── cases_in/              # Input job JSONs
├── cache/<job_id>/        # Processing results
├── sources/<job_id>/      # Cached sources
├── reports/               # Final reports
├── scripts/               # Python scripts
├── tests/                 # Test suite
└── .claude/
    ├── skills/            # Domain rules
    ├── agents/            # Coordination
    └── commands/          # Orchestration
```

## Hallucination Categories

1. **CITATION_MISMATCH** - Citation exists but refers to different content
2. **PARAGRAPH_HALLUCINATION** - Paragraph number doesn't exist or differs
3. **QUOTATION_FABRICATION** - Direct quote doesn't appear in authority
4. **PARAPHRASE_DISTORTION** - Paraphrased content misrepresents meaning
5. **AUTHORITY_NONEXISTENT** - Authority cannot be found in public sources
6. **CITATION_MALFORMED** - Citation string is structurally invalid

## Testing

```bash
# Run all tests
pytest tests/ -v

# Run with coverage
pytest tests/ --cov=scripts --cov-report=html

# Run specific test
pytest tests/test_extract_text.py -v
```

## Development

### Project Status

**Current**: v0.2.0 - Production-ready with Find Case Law integration

**Completed**:
- ✅ All core scripts implemented and tested
- ✅ Find Case Law API integration (Akoma Ntoso XML)
- ✅ BAILII HTML parsing
- ✅ FCL-first resolution algorithm
- ✅ Source-specific rate limiting
- ✅ End-to-end pipeline validated
- ✅ Test fixtures and examples
- ✅ Comprehensive documentation

**See:** [SUCCESS_SUMMARY.md](SUCCESS_SUMMARY.md) for full implementation details

### Contributing

1. Install dev dependencies: `pip install -r requirements-dev.txt`
2. Run tests: `pytest tests/ -v`
3. Format code: `black scripts/ tests/`
4. Type check: `mypy scripts/`
5. Lint: `ruff scripts/ tests/`

## Technical Stack

- Python 3.11+
- PyMuPDF (PDF extraction)
- BeautifulSoup + lxml (HTML parsing)
- requests (HTTP fetching)
- pytest (testing)

## Configuration

### Rate Limiting

Default: 1000ms between requests. Configure in job settings:

```json
{
  "settings": {
    "rate_limit_seconds": 1.5
  }
}
```

### Supported Citation Formats

**UK Neutral Citations (9 court types):**
- `[YYYY] UKSC N` - UK Supreme Court
- `[YYYY] UKPC N` - UK Privy Council
- `[YYYY] UKHL N` - UK House of Lords
- `[YYYY] EWCA Civ N` - England & Wales CA (Civil)
- `[YYYY] EWCA Crim N` - England & Wales CA (Criminal)
- `[YYYY] EWHC N (Admin)` - England & Wales HC (Administrative)
- `[YYYY] EWHC N (Ch)` - England & Wales HC (Chancery)
- `[YYYY] EWHC N (QB)` - England & Wales HC (Queen's Bench)
- `[YYYY] EWHC N (Fam)` - England & Wales HC (Family)

**Case Names:** `Montgomery v Lanarkshire`, `R v Smith`, etc.

## Features & Limitations (v0.2.0)

### ✅ What it does:
- Resolves UK neutral citations to Find Case Law or BAILII
- Fetches and parses judgments (XML and HTML)
- Verifies claims using keyword matching
- Generates audit-grade reports with evidence trails
- Caches all sources with SHA256 integrity verification
- Respects rate limits and licensing terms

### ⚠️ Current limitations:
- UK legal authorities only (no US, EU, etc.)
- Public sources only (no subscription databases)
- Sequential processing (no parallel fetching)
- Keyword-based verification (no semantic understanding)
- No API server mode
- No LLM-assisted verification

## License

MIT

## Documentation

- **[GETTING_STARTED.md](GETTING_STARTED.md)** - Step-by-step usage guide (start here!)
- **[SUCCESS_SUMMARY.md](SUCCESS_SUMMARY.md)** - Complete feature list and test results
- **[PROJECT_CONSTITUTION.md](PROJECT_CONSTITUTION.md)** - System policies and rules
- **[FCL_INTEGRATION_COMPLETE.md](FCL_INTEGRATION_COMPLETE.md)** - Find Case Law integration details
- **[HALLUCINATION_TYPES_MAPPING.md](HALLUCINATION_TYPES_MAPPING.md)** - Detection coverage for 8 hallucination types

## Support

### Debugging:
- Check `cache/<job_id>/` for intermediate processing results
- Check `sources/<job_id>/` for cached judgments
- Check `reports/<job_id>.json` for detailed verification results

### Common issues:
- **Citation not found:** May be fabricated or wrong format
- **Rate limited:** Wait and retry (system already waits 1 sec/request)
- **Verification unclear:** Claim may be too vague or use different terminology

## Validation Status ✅

All acceptance criteria met:

1. ✅ Pipeline runs end-to-end successfully
2. ✅ Produces both JSON and Markdown reports
3. ✅ No VERIFIED_ERROR without evidence from retrieved sources
4. ✅ Unverifiable citations marked UNVERIFIABLE_PUBLIC with URLs attempted
5. ✅ Complete evidence trails (URL, timestamp, cache path, SHA256)
6. ✅ Reproducible (same input → same output except timestamps)
7. ✅ Cache integrity (SHA256 hashes, metadata JSON)
8. ✅ FCL-first resolution working
9. ✅ Source-specific rate limiting
10. ✅ Akoma Ntoso XML parsing

**Tested with:** Montgomery v Lanarkshire [2015] UKSC 11 (real case from National Archives)
