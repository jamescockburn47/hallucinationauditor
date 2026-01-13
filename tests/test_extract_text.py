"""
Tests for scripts/extract_text.py
"""

import pytest
from pathlib import Path
import sys

# Add scripts to path
sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))

from extract_text import extract_text_from_txt, extract_text_from_document


@pytest.mark.unit
def test_extract_text_from_txt_success(temp_workspace, tmp_path):
    """Test successful text extraction from TXT file."""
    # Create sample text file
    test_file = tmp_path / "sample.txt"
    test_content = "This is a test document.\nWith multiple lines."
    test_file.write_text(test_content, encoding="utf-8")

    result = extract_text_from_txt(test_file)

    assert "text" in result
    assert result["text"] == test_content
    assert result["char_count"] == len(test_content)
    assert result["extraction_method"] == "plain_text"


@pytest.mark.unit
def test_extract_text_from_document_txt(temp_workspace, tmp_path):
    """Test full extraction workflow for TXT document."""
    # Create test file
    test_file = tmp_path / "test.txt"
    test_content = "Test content for extraction"
    test_file.write_text(test_content)

    # Extract
    result = extract_text_from_document(
        job_id="test_job", doc_id="doc_1", doc_path=test_file, doc_type="txt"
    )

    assert result["doc_id"] == "doc_1"
    assert result["doc_type"] == "txt"
    assert "extracted_at" in result
    assert result["text"] == test_content
    assert result["metadata"]["char_count"] == len(test_content)
    assert result["metadata"]["extraction_method"] == "plain_text"

    # Check cache file created
    cache_file = temp_workspace["cache"] / "test_job" / "doc_1.text.json"
    assert cache_file.exists()


@pytest.mark.unit
def test_extract_text_file_not_found(temp_workspace, tmp_path):
    """Test error handling for missing file."""
    with pytest.raises(FileNotFoundError):
        extract_text_from_document(
            job_id="test_job",
            doc_id="doc_1",
            doc_path=Path("/nonexistent.txt"),
            doc_type="txt",
        )


@pytest.mark.unit
def test_extract_text_invalid_type(temp_workspace, tmp_path):
    """Test error handling for unsupported file type."""
    test_file = tmp_path / "test.txt"
    test_file.write_text("content")

    with pytest.raises(ValueError, match="Invalid document type"):
        extract_text_from_document(
            job_id="test_job", doc_id="doc_1", doc_path=test_file, doc_type="invalid"
        )


@pytest.mark.unit
def test_extract_text_deterministic(temp_workspace, tmp_path):
    """Test that extraction is deterministic (same input = same output)."""
    test_file = tmp_path / "test.txt"
    test_content = "Deterministic content"
    test_file.write_text(test_content)

    result1 = extract_text_from_document(
        job_id="test_job_1", doc_id="doc_1", doc_path=test_file, doc_type="txt"
    )

    result2 = extract_text_from_document(
        job_id="test_job_2", doc_id="doc_1", doc_path=test_file, doc_type="txt"
    )

    # Text should be identical
    assert result1["text"] == result2["text"]
    assert result1["metadata"]["char_count"] == result2["metadata"]["char_count"]
    assert result1["metadata"]["source_hash"] == result2["metadata"]["source_hash"]
