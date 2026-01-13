"""
Safe file I/O with validation and atomic writes.
"""

import json
from pathlib import Path
from typing import Any, Dict


def ensure_dir(path: Path) -> None:
    """
    Create directory if it doesn't exist.

    Args:
        path: Directory path to create
    """
    path.mkdir(parents=True, exist_ok=True)


def safe_read_text(path: Path, encoding: str = "utf-8") -> str:
    """
    Read text file with error handling.

    Args:
        path: File path to read
        encoding: Text encoding (default: utf-8)

    Returns:
        File contents as string

    Raises:
        FileNotFoundError: If file doesn't exist
        UnicodeDecodeError: If encoding is incorrect
    """
    if not path.exists():
        raise FileNotFoundError(f"File not found: {path}")

    with open(path, "r", encoding=encoding) as f:
        return f.read()


def safe_write_text(path: Path, content: str, encoding: str = "utf-8") -> None:
    """
    Atomic write of text file.

    Uses temp file + rename for atomicity.

    Args:
        path: File path to write
        content: Text content to write
        encoding: Text encoding (default: utf-8)
    """
    # Ensure parent directory exists
    ensure_dir(path.parent)

    # Write to temp file first
    temp_path = path.with_suffix(path.suffix + ".tmp")
    with open(temp_path, "w", encoding=encoding) as f:
        f.write(content)

    # Atomic rename (on most systems)
    temp_path.replace(path)


def safe_read_json(path: Path) -> Dict[str, Any]:
    """
    Read and parse JSON file.

    Args:
        path: JSON file path

    Returns:
        Parsed JSON as dictionary

    Raises:
        FileNotFoundError: If file doesn't exist
        json.JSONDecodeError: If JSON is invalid
    """
    if not path.exists():
        raise FileNotFoundError(f"File not found: {path}")

    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def safe_write_json(path: Path, data: Dict[str, Any], indent: int = 2) -> None:
    """
    Atomic write of JSON file.

    Uses temp file + rename for atomicity.

    Args:
        path: File path to write
        data: Data to serialize as JSON
        indent: JSON indentation (default: 2)
    """
    # Ensure parent directory exists
    ensure_dir(path.parent)

    # Write to temp file first
    temp_path = path.with_suffix(path.suffix + ".tmp")
    with open(temp_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=indent, ensure_ascii=False)

    # Atomic rename
    temp_path.replace(path)


def safe_write_bytes(path: Path, content: bytes) -> None:
    """
    Atomic write of binary file.

    Uses temp file + rename for atomicity.

    Args:
        path: File path to write
        content: Binary content to write
    """
    # Ensure parent directory exists
    ensure_dir(path.parent)

    # Write to temp file first
    temp_path = path.with_suffix(path.suffix + ".tmp")
    with open(temp_path, "wb") as f:
        f.write(content)

    # Atomic rename
    temp_path.replace(path)
