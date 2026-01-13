"""
Cache management for deterministic artifact storage.
"""

from pathlib import Path
from typing import Any, Dict

from .file_helpers import safe_read_json, safe_write_json, ensure_dir


def get_cache_path(job_id: str, filename: str) -> Path:
    """
    Get standardized cache path for a job.

    Args:
        job_id: Job identifier
        filename: Cache filename

    Returns:
        Path to cache file
    """
    cache_dir = Path("cache") / job_id
    return cache_dir / filename


def get_cache_dir(job_id: str, subdir: str = "") -> Path:
    """
    Get cache directory for a job.

    Args:
        job_id: Job identifier
        subdir: Optional subdirectory (e.g., "resolutions", "authorities")

    Returns:
        Path to cache directory
    """
    cache_dir = Path("cache") / job_id
    if subdir:
        cache_dir = cache_dir / subdir
    return cache_dir


def write_cache_json(job_id: str, filename: str, data: Dict[str, Any]) -> Path:
    """
    Write JSON to cache with atomic write + validation.

    Args:
        job_id: Job identifier
        filename: Cache filename
        data: Data to write

    Returns:
        Path to written file
    """
    cache_path = get_cache_path(job_id, filename)
    safe_write_json(cache_path, data)
    return cache_path


def read_cache_json(job_id: str, filename: str) -> Dict[str, Any]:
    """
    Read JSON from cache with validation.

    Args:
        job_id: Job identifier
        filename: Cache filename

    Returns:
        Parsed JSON data

    Raises:
        FileNotFoundError: If cache file doesn't exist
        json.JSONDecodeError: If JSON is invalid
    """
    cache_path = get_cache_path(job_id, filename)
    return safe_read_json(cache_path)


def cache_exists(job_id: str, filename: str) -> bool:
    """
    Check if cache file exists.

    Args:
        job_id: Job identifier
        filename: Cache filename

    Returns:
        True if cache file exists
    """
    cache_path = get_cache_path(job_id, filename)
    return cache_path.exists()


def ensure_cache_dir(job_id: str, subdir: str = "") -> Path:
    """
    Ensure cache directory exists.

    Args:
        job_id: Job identifier
        subdir: Optional subdirectory

    Returns:
        Path to cache directory
    """
    cache_dir = get_cache_dir(job_id, subdir)
    ensure_dir(cache_dir)
    return cache_dir


def get_sources_path(job_id: str, filename: str) -> Path:
    """
    Get path for cached source document.

    Args:
        job_id: Job identifier
        filename: Source filename (typically SHA256 hash)

    Returns:
        Path to source file
    """
    sources_dir = Path("sources") / job_id
    return sources_dir / filename


def ensure_sources_dir(job_id: str) -> Path:
    """
    Ensure sources directory exists.

    Args:
        job_id: Job identifier

    Returns:
        Path to sources directory
    """
    sources_dir = Path("sources") / job_id
    ensure_dir(sources_dir)
    return sources_dir
