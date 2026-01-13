"""
Input validation and schema checking.
"""

from typing import Any, Dict, List
from dataclasses import dataclass
import re


@dataclass
class ValidationResult:
    """Result of validation check."""

    valid: bool
    errors: List[str]

    def __bool__(self) -> bool:
        """Allow using as boolean."""
        return self.valid


def validate_input_job(data: Dict[str, Any]) -> ValidationResult:
    """
    Validate input JSON schema.

    Args:
        data: Input job data

    Returns:
        ValidationResult with errors if invalid
    """
    errors = []

    # Check required fields
    if "job_id" not in data:
        errors.append("Missing required field: job_id")
    elif not isinstance(data["job_id"], str):
        errors.append("job_id must be a string")
    elif not re.match(r"^[a-zA-Z0-9_-]+$", data["job_id"]):
        errors.append("job_id must contain only alphanumeric, underscore, or hyphen")

    if "documents" not in data:
        errors.append("Missing required field: documents")
    elif not isinstance(data["documents"], list):
        errors.append("documents must be an array")
    elif len(data["documents"]) == 0:
        errors.append("documents array cannot be empty")
    else:
        # Validate each document
        for i, doc in enumerate(data["documents"]):
            if not isinstance(doc, dict):
                errors.append(f"documents[{i}] must be an object")
                continue

            if "doc_id" not in doc:
                errors.append(f"documents[{i}] missing required field: doc_id")
            if "path" not in doc:
                errors.append(f"documents[{i}] missing required field: path")
            if "type" not in doc:
                errors.append(f"documents[{i}] missing required field: type")
            elif doc["type"] not in ["pdf", "html", "txt"]:
                errors.append(
                    f"documents[{i}] type must be pdf, html, or txt, got: {doc['type']}"
                )

    # Validate claims if present
    if "claims" in data and data["claims"]:
        if not isinstance(data["claims"], list):
            errors.append("claims must be an array")
        else:
            for i, claim in enumerate(data["claims"]):
                if not isinstance(claim, dict):
                    errors.append(f"claims[{i}] must be an object")
                    continue

                if "claim_id" not in claim:
                    errors.append(f"claims[{i}] missing required field: claim_id")
                if "text" not in claim:
                    errors.append(f"claims[{i}] missing required field: text")

                # Validate citations if present
                if "citations" in claim and claim["citations"]:
                    if not isinstance(claim["citations"], list):
                        errors.append(f"claims[{i}] citations must be an array")
                    else:
                        for j, citation in enumerate(claim["citations"]):
                            cite_result = validate_citation(citation)
                            if not cite_result:
                                for error in cite_result.errors:
                                    errors.append(f"claims[{i}] citations[{j}] {error}")

    return ValidationResult(valid=len(errors) == 0, errors=errors)


def validate_citation(citation: Dict[str, Any]) -> ValidationResult:
    """
    Validate single citation structure.

    Args:
        citation: Citation object

    Returns:
        ValidationResult with errors if invalid
    """
    errors = []

    if not isinstance(citation, dict):
        errors.append("citation must be an object")
        return ValidationResult(valid=False, errors=errors)

    # Check for either 'raw' or 'citation_text' field
    if "raw" not in citation and "citation_text" not in citation:
        errors.append("citation must have 'raw' or 'citation_text' field")

    # Validate 'kind' if present
    if "kind" in citation:
        valid_kinds = ["neutral", "report", "unknown"]
        if citation["kind"] not in valid_kinds:
            errors.append(f"citation kind must be one of {valid_kinds}")

    return ValidationResult(valid=len(errors) == 0, errors=errors)


def validate_url(url: str) -> bool:
    """
    Basic URL validation.

    Args:
        url: URL string to validate

    Returns:
        True if URL is valid
    """
    if not isinstance(url, str):
        return False

    # Basic URL pattern
    url_pattern = re.compile(
        r"^https?://"  # http:// or https://
        r"(?:(?:[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?\.)+[A-Z]{2,6}\.?|"  # domain
        r"localhost|"  # localhost
        r"\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})"  # IP
        r"(?::\d+)?"  # optional port
        r"(?:/?|[/?]\S+)$",
        re.IGNORECASE,
    )

    return bool(url_pattern.match(url))


def validate_job_id(job_id: str) -> ValidationResult:
    """
    Validate job ID format.

    Args:
        job_id: Job identifier

    Returns:
        ValidationResult with errors if invalid
    """
    errors = []

    if not isinstance(job_id, str):
        errors.append("job_id must be a string")
    elif not job_id:
        errors.append("job_id cannot be empty")
    elif not re.match(r"^[a-zA-Z0-9_-]+$", job_id):
        errors.append("job_id must contain only alphanumeric, underscore, or hyphen")

    return ValidationResult(valid=len(errors) == 0, errors=errors)


def validate_document_type(doc_type: str) -> ValidationResult:
    """
    Validate document type.

    Args:
        doc_type: Document type string

    Returns:
        ValidationResult with errors if invalid
    """
    errors = []

    valid_types = ["pdf", "html", "txt"]
    if doc_type not in valid_types:
        errors.append(f"Document type must be one of {valid_types}, got: {doc_type}")

    return ValidationResult(valid=len(errors) == 0, errors=errors)
