"""
Shared pytest fixtures for hallucination auditor tests.
"""

import pytest
from pathlib import Path
import json
import shutil
from typing import Dict, Any
import tempfile


@pytest.fixture
def temp_workspace(tmp_path):
    """
    Create temporary workspace with all required directories.

    Returns:
        dict: Workspace paths
            - root: Root temp directory
            - cases_in: Input cases directory
            - cache: Cache directory
            - sources: Sources directory
            - reports: Reports directory
    """
    workspace = {
        "root": tmp_path,
        "cases_in": tmp_path / "cases_in",
        "cache": tmp_path / "cache",
        "sources": tmp_path / "sources",
        "reports": tmp_path / "reports",
        "scripts": tmp_path / "scripts",
    }

    # Create all directories
    for dir_path in workspace.values():
        if isinstance(dir_path, Path):
            dir_path.mkdir(exist_ok=True, parents=True)

    return workspace


@pytest.fixture
def sample_input_job() -> Dict[str, Any]:
    """
    Sample valid input job JSON.

    Returns:
        dict: Valid job definition
    """
    return {
        "job_id": "test_job_001",
        "title": "Test Audit",
        "documents": [
            {
                "doc_id": "doc_1",
                "path": "test.pdf",
                "type": "pdf",
            }
        ],
        "claims": [
            {
                "claim_id": "claim_1",
                "text": "The court held that X.",
                "source_doc_id": "doc_1",
                "source_locator": "paragraph 42",
                "citations": [{"raw": "Smith v Jones [2023] UKSC 1", "kind": "neutral"}],
            }
        ],
        "settings": {
            "public_sources_only": True,
            "rate_limit_seconds": 0.1,  # Fast for testing
        },
    }


@pytest.fixture
def sample_extracted_text() -> Dict[str, Any]:
    """
    Sample extracted text output.

    Returns:
        dict: Extracted text data structure
    """
    return {
        "doc_id": "doc_1",
        "doc_type": "pdf",
        "extracted_at": "2026-01-13T12:00:00Z",
        "text": "This is a sample judgment. Smith v Jones [2023] UKSC 1 established the principle that X.",
        "metadata": {"page_count": 1, "char_count": 95, "extraction_method": "test"},
    }


@pytest.fixture
def sample_citations() -> Dict[str, Any]:
    """
    Sample extracted citations output.

    Returns:
        dict: Citations data structure
    """
    return {
        "doc_id": "doc_1",
        "extracted_at": "2026-01-13T12:00:05Z",
        "citations": [
            {
                "citation_id": "cit_1",
                "text": "Smith v Jones [2023] UKSC 1",
                "start_pos": 34,
                "end_pos": 61,
                "pattern_matched": "uk_neutral_citation",
                "confidence": 0.95,
            }
        ],
        "stats": {"total_found": 1, "by_pattern": {"uk_neutral_citation": 1}},
    }


@pytest.fixture
def sample_claims() -> Dict[str, Any]:
    """
    Sample canonical claims output.

    Returns:
        dict: Claims data structure
    """
    return {
        "job_id": "test_job_001",
        "built_at": "2026-01-13T12:00:10Z",
        "claims": [
            {
                "claim_id": "claim_1",
                "text": "The court held that X.",
                "source_doc_id": "doc_1",
                "source_locator": "paragraph 42",
                "citations": [
                    {
                        "citation_id": "cit_1_1",
                        "citation_text": "Smith v Jones [2023] UKSC 1",
                        "context": "established the principle that X.",
                        "extracted_from": "user_input",
                    }
                ],
            }
        ],
        "stats": {
            "total_claims": 1,
            "total_citations": 1,
            "from_input": 1,
            "from_extraction": 0,
        },
    }


@pytest.fixture
def sample_resolution() -> Dict[str, Any]:
    """
    Sample citation resolution output.

    Returns:
        dict: Resolution data structure
    """
    return {
        "citation_text": "Smith v Jones [2023] UKSC 1",
        "resolved_at": "2026-01-13T12:01:00Z",
        "candidate_urls": [
            {
                "url": "https://www.bailii.org/uk/cases/UKSC/2023/1.html",
                "source": "bailii",
                "confidence": 0.95,
                "resolution_method": "pattern_match",
            }
        ],
        "resolution_status": "resolved",
        "notes": "Matched UK neutral citation pattern",
    }


@pytest.fixture
def sample_bailii_html() -> str:
    """
    Sample BAILII HTML judgment.

    Returns:
        str: HTML content
    """
    return """
    <html>
    <head><title>Smith v Jones [2023] UKSC 1</title></head>
    <body>
    <h1>Smith v Jones</h1>
    <p><b>[2023] UKSC 1</b></p>
    <p><b>Before: Lord Smith</b></p>
    <p>[1] This is the first paragraph of the judgment.</p>
    <p>[2] This is the second paragraph discussing principle X.</p>
    <p>[3] We therefore hold that X is correct.</p>
    </body>
    </html>
    """


@pytest.fixture
def sample_parsed_authority() -> Dict[str, Any]:
    """
    Sample parsed authority output.

    Returns:
        dict: Parsed authority data structure
    """
    return {
        "url": "https://www.bailii.org/uk/cases/UKSC/2023/1.html",
        "parsed_at": "2026-01-13T12:01:10Z",
        "title": "Smith v Jones [2023] UKSC 1",
        "case_name": "Smith v Jones",
        "neutral_citation": "[2023] UKSC 1",
        "court": "UKSC",
        "date": "2023-01-15",
        "paragraphs": [
            {"para_num": "1", "text": "This is the first paragraph of the judgment."},
            {
                "para_num": "2",
                "text": "This is the second paragraph discussing principle X.",
            },
            {"para_num": "3", "text": "We therefore hold that X is correct."},
        ],
        "full_text": "Smith v Jones [2023] UKSC 1 [1] This is the first paragraph of the judgment. [2] This is the second paragraph discussing principle X. [3] We therefore hold that X is correct.",
        "metadata": {
            "parser_version": "0.1.0",
            "parse_method": "bailii_html",
            "warnings": [],
        },
    }


@pytest.fixture
def sample_verification() -> Dict[str, Any]:
    """
    Sample verification output.

    Returns:
        dict: Verification data structure
    """
    return {
        "claim_text": "The court held that X.",
        "citation_text": "Smith v Jones [2023] UKSC 1",
        "authority_url": "https://www.bailii.org/uk/cases/UKSC/2023/1.html",
        "verified_at": "2026-01-13T12:02:00Z",
        "verification_outcome": "supported",
        "evidence": {
            "matching_paragraphs": [
                {
                    "para_num": "3",
                    "text": "We therefore hold that X is correct.",
                    "similarity_score": 0.92,
                    "match_type": "paraphrase",
                }
            ],
            "confidence": 0.90,
            "method": "keyword_match",
        },
        "notes": "Claim is well-supported by paragraph [3]",
    }


@pytest.fixture
def mock_fetch_response():
    """
    Mock HTTP fetch response.

    Returns:
        dict: Mock response data
    """

    class MockResponse:
        def __init__(self, content, status_code=200):
            self.content = content
            self.status_code = status_code
            self.headers = {"Content-Type": "text/html; charset=utf-8"}
            self.url = "https://www.bailii.org/uk/cases/UKSC/2023/1.html"

    return MockResponse


@pytest.fixture(autouse=True)
def change_test_dir(request, monkeypatch):
    """
    Change to temp directory for all tests.
    Prevents tests from modifying actual project directories.
    """
    if "no_change_dir" in request.keywords:
        # Skip for tests that need actual project directory
        return

    # Use tmp_path if available in test
    if "tmp_path" in request.fixturenames:
        monkeypatch.chdir(request.getfixturevalue("tmp_path"))


# Markers for test organization
def pytest_configure(config):
    """Configure custom pytest markers."""
    config.addinivalue_line("markers", "unit: Unit tests for individual functions")
    config.addinivalue_line(
        "markers", "integration: Integration tests for multiple components"
    )
    config.addinivalue_line("markers", "slow: Slow tests (network, large files)")
    config.addinivalue_line("markers", "no_change_dir: Don't change to temp directory")
