"""
Deterministic hashing for content-addressed storage.
"""

import hashlib
from pathlib import Path
from typing import Union


def sha256_string(content: str) -> str:
    """
    Generate SHA256 hash of UTF-8 string.

    Args:
        content: String to hash

    Returns:
        Hexadecimal SHA256 hash
    """
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def sha256_bytes(content: bytes) -> str:
    """
    Generate SHA256 hash of bytes.

    Args:
        content: Bytes to hash

    Returns:
        Hexadecimal SHA256 hash
    """
    return hashlib.sha256(content).hexdigest()


def sha256_file(filepath: Path) -> str:
    """
    Generate SHA256 hash of file (streaming for large files).

    Args:
        filepath: Path to file

    Returns:
        Hexadecimal SHA256 hash

    Raises:
        FileNotFoundError: If file doesn't exist
    """
    if not filepath.exists():
        raise FileNotFoundError(f"File not found: {filepath}")

    sha256_hash = hashlib.sha256()

    # Read in chunks for memory efficiency
    with open(filepath, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):  # 64KB chunks
            sha256_hash.update(chunk)

    return sha256_hash.hexdigest()
