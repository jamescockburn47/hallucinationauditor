# Getting Started with Hallucination Auditor

A practical guide to auditing legal claims and citations in your documents.

---

## Quick Start (3 Steps)

### 1. Install Dependencies

```bash
cd hallucination-auditor
pip install -r requirements.txt
```

**What you need:**
- Python 3.11+
- Internet connection (to fetch case law)

---

### 2. Create Your Input File

Create a JSON file in `cases_in/` folder:

**Example: `cases_in/my_audit.json`**

```json
{
  "job_id": "my_audit",
  "title": "My Legal Document Audit",
  "documents": [
    {
      "doc_id": "doc1",
      "path": "path/to/your/document.txt",
      "type": "txt"
    }
  ],
  "claims": [
    {
      "claim_id": "claim_1",
      "text": "The court held that informed consent is required",
      "citations": [
        {
          "raw": "Montgomery v Lanarkshire [2015] UKSC 11"
        }
      ]
    }
  ]
}
```

**File types supported:**
- `txt` - Plain text
- `pdf` - PDF documents (requires PyMuPDF)
- `html` - HTML documents

---

### 3. Run the Audit

```bash
python scripts/orchestrate.py --input cases_in/my_audit.json
```

**That's it!** The system will:
1. ✅ Extract text and citations from your documents
2. ✅ Resolve citations to Find Case Law or BAILII
3. ✅ Fetch the actual judgments
4. ✅ Verify your claims against the real authorities
5. ✅ Generate reports in `reports/`

---

## Understanding the Input Format

### Minimal Example (Let the system find citations)

If you don't want to list claims manually, just provide documents:

```json
{
  "job_id": "auto_extract",
  "title": "Automatic Citation Extraction",
  "documents": [
    {
      "doc_id": "brief",
      "path": "my_legal_brief.txt",
      "type": "txt"
    }
  ],
  "claims": []
}
```

The system will **automatically extract citations** from your document!

---

### Full Example (Specify exact claims to verify)

```json
{
  "job_id": "detailed_audit",
  "title": "Medical Negligence Analysis",
  "documents": [
    {
      "doc_id": "analysis",
      "path": "medical_negligence.pdf",
      "type": "pdf"
    }
  ],
  "claims": [
    {
      "claim_id": "claim_1",
      "text": "Doctors must disclose material risks to patients",
      "citations": [
        {
          "raw": "Montgomery v Lanarkshire [2015] UKSC 11"
        }
      ]
    },
    {
      "claim_id": "claim_2",
      "text": "The Bolam test was rejected for informed consent",
      "citations": [
        {
          "raw": "[2015] UKSC 11"
        }
      ]
    }
  ],
  "settings": {
    "public_sources_only": true,
    "rate_limit_ms": 1000
  }
}
```

---

## Understanding the Output

### Reports Location

After running an audit, you'll find reports in the `reports/` folder:

```
reports/
├── my_audit.json          # Machine-readable results
└── my_audit.md            # Human-readable report
```

### Markdown Report Format

```markdown
# Hallucination Audit Report: My Legal Document Audit

**Job ID**: my_audit
**Audited**: 2026-01-13T19:35:03+00:00

## Summary

- **Total Claims**: 2
- **Total Citations**: 2

## Claims

### Claim: Doctors must disclose material risks to patients

- **Montgomery v Lanarkshire [2015] UKSC 11**: supported

### Claim: The Bolam test was rejected for informed consent

- **[2015] UKSC 11**: supported
```

### What "supported" means:

- **supported** - ✅ The claim matches what the authority actually says
- **contradicted** - ❌ The claim contradicts the authority
- **unclear** - ⚠️ Not enough evidence to determine

---

## Common Use Cases

### Use Case 1: Check if citations exist

**Problem:** ChatGPT gave me these citations. Are they real?

**Solution:**

```json
{
  "job_id": "citation_check",
  "title": "Verify ChatGPT Citations",
  "documents": [],
  "claims": [
    {
      "claim_id": "claim_1",
      "text": "This is what ChatGPT claimed",
      "citations": [
        {
          "raw": "Smith v Jones [2023] UKSC 999"
        }
      ]
    }
  ]
}
```

Run the audit. If the citation is fake, the report will show resolution failed.

---

### Use Case 2: Audit a legal document

**Problem:** I wrote a legal memo. Are my citations accurate?

**Solution:**

```json
{
  "job_id": "memo_audit",
  "title": "Legal Memo Citation Check",
  "documents": [
    {
      "doc_id": "memo",
      "path": "my_memo.pdf",
      "type": "pdf"
    }
  ],
  "claims": []
}
```

The system will:
1. Extract all citations from your memo
2. Fetch the real judgments
3. Tell you if your paraphrases are accurate

---

### Use Case 3: Verify specific claims

**Problem:** I want to check if these 3 specific statements are supported by case law.

**Solution:**

```json
{
  "job_id": "fact_check",
  "title": "Fact Check Legal Claims",
  "documents": [],
  "claims": [
    {
      "claim_id": "claim_1",
      "text": "First statement to check",
      "citations": [{"raw": "[2015] UKSC 11"}]
    },
    {
      "claim_id": "claim_2",
      "text": "Second statement to check",
      "citations": [{"raw": "Montgomery v Lanarkshire [2015] UKSC 11"}]
    }
  ]
}
```

---

## Citation Formats Supported

### UK Neutral Citations (Primary - uses Find Case Law)

✅ `[2015] UKSC 11` - UK Supreme Court
✅ `[2015] UKPC 11` - UK Privy Council
✅ `[2015] UKHL 11` - UK House of Lords
✅ `[2015] EWCA Civ 11` - England & Wales Court of Appeal (Civil)
✅ `[2015] EWCA Crim 11` - England & Wales Court of Appeal (Criminal)
✅ `[2015] EWHC 11 (Admin)` - England & Wales High Court (Administrative)
✅ `[2015] EWHC 11 (Ch)` - England & Wales High Court (Chancery)
✅ `[2015] EWHC 11 (QB)` - England & Wales High Court (Queen's Bench)
✅ `[2015] EWHC 11 (Fam)` - England & Wales High Court (Family)

### Case Names

✅ `Montgomery v Lanarkshire` - Will try to find using Atom search
✅ `R v Smith` - Criminal cases
✅ `Smith v Jones` - Civil cases

---

## Cached Data

The system caches everything to avoid re-downloading:

```
cache/my_audit/               # Intermediate processing results
sources/my_audit/             # Downloaded judgments (XML/HTML)
reports/my_audit.json         # Final results
reports/my_audit.md           # Final results (readable)
```

**To re-run an audit:** Just delete the cache folder and run again.

---

## Advanced Options

### Settings in Input JSON

```json
{
  "job_id": "advanced",
  "title": "Advanced Audit",
  "documents": [...],
  "claims": [...],
  "settings": {
    "public_sources_only": true,        # Only use public sources (always true)
    "rate_limit_ms": 1000,              # Wait 1 second between requests
    "prefer_sources": ["find_case_law", "bailii"]  # Try FCL first
  }
}
```

---

## Troubleshooting

### Problem: "Citation not found"

**Possible reasons:**
1. The citation is fabricated (doesn't exist)
2. The citation format is wrong
3. The case isn't in Find Case Law or BAILII

**Solution:** Check the report - it will show all URLs attempted.

---

### Problem: "Rate limited"

**Reason:** You're making too many requests to Find Case Law or BAILII.

**Solution:**
- Wait a minute and try again
- The system already waits 1 second between requests
- For large audits, run in batches

---

### Problem: "Verification unclear"

**Reason:** The system can't determine if the claim matches the authority.

**Possible causes:**
1. The claim is too vague
2. The authority is very long
3. The claim uses different terminology

**Solution:**
- Make claims more specific
- Check the cached authority in `sources/` to see what it actually says

---

## Example: Real Workflow

Let's audit a ChatGPT-generated legal memo:

### Step 1: Save ChatGPT's output

Save the memo as `my_memo.txt`

### Step 2: Create input JSON

```bash
cd hallucination-auditor
```

Create `cases_in/chatgpt_audit.json`:

```json
{
  "job_id": "chatgpt_audit",
  "title": "ChatGPT Legal Memo Audit",
  "documents": [
    {
      "doc_id": "memo",
      "path": "my_memo.txt",
      "type": "txt"
    }
  ],
  "claims": []
}
```

### Step 3: Run audit

```bash
python scripts/orchestrate.py --input cases_in/chatgpt_audit.json
```

### Step 4: Check report

```bash
# View the report
cat reports/chatgpt_audit.md

# Or open in your editor
code reports/chatgpt_audit.md
```

### Step 5: Interpret results

- ✅ **supported** = ChatGPT got it right
- ❌ **contradicted** = ChatGPT made an error
- ⚠️ **unclear** = Need manual review

---

## Performance

**Typical audit:**
- 10 citations = ~15 seconds
- 50 citations = ~60 seconds
- 100 citations = ~2 minutes

**Rate limiting:**
- Find Case Law: 1 request/second
- BAILII: 1 request/second
- Caching: Second run is instant (uses cached data)

---

## What the System Does (Under the Hood)

### Phase 1: Extraction
1. Reads your documents
2. Extracts text content
3. Finds UK neutral citations using regex
4. Builds canonical claims list

### Phase 2: Retrieval (FCL-first)
1. **Tries Find Case Law first:**
   - Constructs deterministic URI (e.g., `uksc/2015/11`)
   - Fetches Akoma Ntoso XML from National Archives

2. **Falls back to BAILII if needed:**
   - Uses pattern matching to construct BAILII URL
   - Fetches HTML judgment

3. **Parses the judgment:**
   - Extracts case name, date, court
   - Extracts numbered paragraphs
   - Extracts full text

### Phase 3: Verification
1. Compares your claim text to the actual judgment
2. Uses keyword matching and similarity scoring
3. Determines: supported / contradicted / unclear
4. Generates JSON and Markdown reports

---

## Need More Help?

### Check the documentation:

- `README.md` - Project overview
- `PROJECT_CONSTITUTION.md` - System policies and rules
- `FCL_INTEGRATION_COMPLETE.md` - Technical details
- `SUCCESS_SUMMARY.md` - Feature list and test results

### Common commands:

```bash
# Run an audit
python scripts/orchestrate.py --input cases_in/my_job.json

# Test individual scripts
python scripts/public_resolve.py --citation-text "[2015] UKSC 11" --output test.json

# Extract citations from a document
python scripts/extract_citations.py --job-id test --doc-id doc1 --text-json cache/test/doc1.text.json
```

---

## Privacy & Data

### What gets cached:
- ✅ Downloaded judgments from Find Case Law / BAILII
- ✅ Extracted text from your documents
- ✅ Intermediate processing results

### What gets sent over the internet:
- ✅ Requests to Find Case Law API (National Archives)
- ✅ Requests to BAILII website
- ❌ **Your document content is NEVER uploaded**

All processing is **100% local** on your machine.

---

## License & Compliance

### Data Sources:

1. **Find Case Law (National Archives)**
   - License: Open Justice Licence
   - Usage: Individual case retrieval only
   - Rate limit: 1,000 requests per 5 minutes

2. **BAILII**
   - Usage: Individual case retrieval only
   - Rate limit: 1 request per second (polite limit)
   - No bulk downloading

**The system is configured to be compliant with both sources.**

---

## Ready to Start?

Try the included example:

```bash
python scripts/orchestrate.py --input cases_in/montgomery_fcl_test.json
```

This will audit 3 claims about the Montgomery case and show you how the system works!

---

**Questions?** Check the documentation files or open an issue on GitHub.
