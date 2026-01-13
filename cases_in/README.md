# Cases Input Directory

This directory contains input job definitions for the hallucination auditor.

## File Format

Each job is defined as a JSON file: `<job_id>.json`

### Schema

```json
{
  "job_id": "string (must match filename)",
  "title": "string (descriptive title)",
  "documents": [
    {
      "doc_id": "string (unique identifier)",
      "path": "string (relative or absolute path to document)",
      "type": "pdf|html|txt",
      "notes": "optional string"
    }
  ],
  "claims": [
    {
      "claim_id": "string (unique identifier)",
      "text": "string (proposition to verify)",
      "source_doc_id": "string (references documents array)",
      "source_locator": "optional (e.g., 'paragraph 42', 'page 7')",
      "citations": [
        {
          "raw": "string (citation as written)",
          "normalized": "optional string",
          "kind": "neutral|report|unknown"
        }
      ]
    }
  ],
  "settings": {
    "public_sources_only": true,
    "max_fetch_per_job": 50,
    "fetch_timeout_seconds": 20,
    "rate_limit_seconds": 1.0,
    "prefer_sources": ["bailii", "user_url"],
    "allow_find_case_law_url_fetch_only": true
  }
}
```

## Optional Claims

If the `claims` array is empty or omitted, the system will:
1. Extract text from all documents
2. Identify candidate citations using regex patterns
3. Generate claims heuristically
4. Output extracted claims to `cache/<job_id>/claims_extracted.json`

## Example

```json
{
  "job_id": "sample_001",
  "title": "Sample Legal Brief Audit",
  "documents": [
    {
      "doc_id": "brief_1",
      "path": "cases_in/sample_brief.pdf",
      "type": "pdf",
      "notes": "Client brief submitted 2025-01-01"
    }
  ],
  "claims": [
    {
      "claim_id": "claim_1",
      "text": "The Supreme Court held that informed consent requires full disclosure",
      "source_doc_id": "brief_1",
      "source_locator": "paragraph 12",
      "citations": [
        {
          "raw": "Montgomery v Lanarkshire [2015] UKSC 11",
          "kind": "neutral"
        }
      ]
    }
  ],
  "settings": {
    "public_sources_only": true,
    "rate_limit_seconds": 1.5
  }
}
```

## Running an Audit

Once you've created a job file:

```bash
/audit_public sample_001
```

The system will:
1. Extract text from documents
2. Resolve and fetch cited authorities
3. Verify claims against authorities
4. Generate reports in `reports/` directory
