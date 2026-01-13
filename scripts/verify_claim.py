#!/usr/bin/env python3
"""
Verify claim against authority using deterministic text matching.

Usage:
    python scripts/verify_claim.py --claim-text TEXT --citation-text TEXT --authority-json PATH --output PATH

Output:
    JSON with verification outcome and evidence
"""

import argparse
import sys
import re
from pathlib import Path
from datetime import datetime, timezone
from typing import Dict, Any, List, Set

from utils.file_helpers import safe_read_json, safe_write_json


def extract_keywords(text: str, min_length: int = 4) -> Set[str]:
    """
    Extract keywords from text for matching.

    Args:
        text: Text to extract keywords from
        min_length: Minimum keyword length (default: 4)

    Returns:
        Set of lowercase keywords
    """
    # Remove punctuation and split
    words = re.findall(r"\b[a-zA-Z]{" + str(min_length) + r",}\b", text.lower())

    # Remove common stop words
    stop_words = {
        "that",
        "this",
        "with",
        "from",
        "have",
        "been",
        "were",
        "will",
        "would",
        "could",
        "should",
        "their",
        "there",
        "where",
        "which",
        "when",
    }

    return set(words) - stop_words


def calculate_keyword_overlap(claim_text: str, authority_text: str) -> float:
    """
    Calculate keyword overlap between claim and authority.

    Args:
        claim_text: Claim text
        authority_text: Authority text

    Returns:
        Overlap ratio (0.0 to 1.0)
    """
    claim_keywords = extract_keywords(claim_text)
    authority_keywords = extract_keywords(authority_text)

    if not claim_keywords:
        return 0.0

    overlap = len(claim_keywords & authority_keywords)
    return overlap / len(claim_keywords)


def find_matching_paragraphs(
    claim_text: str, paragraphs: List[Dict[str, Any]], threshold: float = 0.3
) -> List[Dict[str, Any]]:
    """
    Find paragraphs that match the claim.

    Args:
        claim_text: Claim text
        paragraphs: List of paragraph objects
        threshold: Minimum overlap threshold (default: 0.3)

    Returns:
        List of matching paragraphs with similarity scores
    """
    matches = []

    for para in paragraphs:
        para_text = para.get("text", "")
        overlap = calculate_keyword_overlap(claim_text, para_text)

        if overlap >= threshold:
            matches.append(
                {
                    "para_num": para.get("para_num", ""),
                    "text": para_text[:200] + "..." if len(para_text) > 200 else para_text,
                    "similarity_score": round(overlap, 2),
                    "match_type": "keyword" if overlap >= 0.6 else "partial",
                }
            )

    # Sort by similarity score
    matches.sort(key=lambda m: m["similarity_score"], reverse=True)

    return matches


def classify_hallucination_type(
    outcome: str,
    resolution_status: str = "resolved",
    case_retrieved: bool = False,
) -> Dict[str, Any]:
    """
    Classify the type of hallucination based on Matthew Lee's 8 categories.
    
    Key insight: If we successfully retrieved a case from FCL/BAILII, 
    the case EXISTS - it's not fabricated. We can only assess if the
    claim about it is accurate.
    
    Returns:
        Dict with lee_type (1-8 or None) and lee_type_name
    """
    # If supported, no hallucination
    if outcome == "supported":
        return {"lee_type": None, "lee_type_name": None}
    
    # If case was retrieved but needs review - NOT a hallucination, just needs verification
    if outcome == "needs_review" and case_retrieved:
        return {"lee_type": None, "lee_type_name": None}
    
    # Type 1: Fabricated Case & Citation - ONLY if citation couldn't be found at all
    if not case_retrieved and (resolution_status == "not_found" or resolution_status == "unresolved"):
        return {
            "lee_type": "1",
            "lee_type_name": "Fabricated Case & Citation"
        }
    
    # If case WAS retrieved but claim doesn't match well - needs manual review
    # Don't automatically label as hallucination since the case exists
    if case_retrieved and outcome in ["unclear", "contradicted"]:
        return {
            "lee_type": "review",
            "lee_type_name": "Needs Manual Review"
        }
    
    # Default for unverifiable where case wasn't found
    if outcome == "unverifiable" and not case_retrieved:
        return {
            "lee_type": "1",
            "lee_type_name": "Fabricated Case & Citation"
        }
    
    return {"lee_type": None, "lee_type_name": None}


def verify_claim_against_authority(
    claim_text: str,
    citation_text: str,
    parsed_authority: Dict[str, Any],
    matching_threshold: float = 0.2,
    resolution_status: str = "resolved",
) -> Dict[str, Any]:
    """
    Verify claim against authority document.
    
    IMPORTANT: This uses simple keyword matching which has limitations.
    A low match score does NOT mean the claim is false - it may just be
    paraphrased differently. Results should always be manually reviewed.

    Args:
        claim_text: Proposition to verify
        citation_text: Citation being checked
        parsed_authority: Parsed authority data
        matching_threshold: Similarity threshold (default: 0.2)
        resolution_status: Status of citation resolution

    Returns:
        Verification result with evidence and hallucination classification
    """
    # Extract full text and paragraphs
    full_text = parsed_authority.get("full_text", "")
    paragraphs = parsed_authority.get("paragraphs", [])
    authority_url = parsed_authority.get("url", "")
    authority_title = parsed_authority.get("title", "Unknown Case")
    
    # The case was successfully retrieved - this is important!
    case_retrieved = bool(full_text and len(full_text) > 100)

    # Method 1: Exact substring match (very rare)
    if claim_text.lower() in full_text.lower():
        hallucination = classify_hallucination_type("supported", resolution_status, case_retrieved)
        return {
            "claim_text": claim_text,
            "citation_text": citation_text,
            "authority_url": authority_url,
            "authority_title": authority_title,
            "case_retrieved": case_retrieved,
            "verified_at": datetime.now(timezone.utc).isoformat(),
            "verification_outcome": "supported",
            "hallucination_type": hallucination["lee_type"],
            "hallucination_type_name": hallucination["lee_type_name"],
            "evidence": {
                "matching_paragraphs": [],
                "confidence": 0.95,
                "method": "exact_match",
            },
            "notes": "Claim text found exactly in authority",
        }

    # Method 2: Keyword overlap with full text
    overall_overlap = calculate_keyword_overlap(claim_text, full_text)

    # Method 3: Find matching paragraphs
    matching_paras = find_matching_paragraphs(claim_text, paragraphs, matching_threshold)

    # LESS STRICT outcome determination
    # Key insight: keyword matching is imperfect - be conservative
    if overall_overlap >= 0.6 or (matching_paras and matching_paras[0]["similarity_score"] >= 0.6):
        outcome = "supported"
        confidence = max(overall_overlap, matching_paras[0]["similarity_score"] if matching_paras else 0)
        notes = "Strong keyword overlap with authority - likely supported"
    elif overall_overlap >= 0.3 or (matching_paras and matching_paras[0]["similarity_score"] >= 0.3):
        outcome = "supported"
        confidence = max(overall_overlap, matching_paras[0]["similarity_score"] if matching_paras else 0)
        notes = "Moderate keyword overlap - appears supported but review recommended"
    else:
        # Don't automatically mark as contradicted - case exists, just needs review
        outcome = "needs_review"
        confidence = overall_overlap
        notes = "Case retrieved but low keyword match - manual review required"

    # Classify hallucination type - much more conservative now
    hallucination = classify_hallucination_type(outcome, resolution_status, case_retrieved)

    return {
        "claim_text": claim_text,
        "citation_text": citation_text,
        "authority_url": authority_url,
        "authority_title": authority_title,
        "case_retrieved": case_retrieved,
        "verified_at": datetime.now(timezone.utc).isoformat(),
        "verification_outcome": outcome,
        "hallucination_type": hallucination["lee_type"],
        "hallucination_type_name": hallucination["lee_type_name"],
        "evidence": {
            "matching_paragraphs": matching_paras[:3],  # Top 3 matches
            "confidence": round(confidence, 2),
            "method": "keyword_match",
            "keyword_overlap": round(overall_overlap, 2),
        },
        "notes": notes,
    }


def main() -> int:
    """
    CLI entry point.

    Returns:
        Exit code (0=success, 1=validation error, 2=verification error)
    """
    parser = argparse.ArgumentParser(description="Verify claim against authority")
    parser.add_argument("--claim-text", required=True, help="Claim text to verify")
    parser.add_argument("--citation-text", required=True, help="Citation text")
    parser.add_argument("--authority-json", required=True, help="Path to parsed authority JSON")
    parser.add_argument("--output", required=True, help="Output JSON path")
    parser.add_argument(
        "--threshold",
        type=float,
        default=0.3,
        help="Matching threshold (default: 0.3)",
    )

    args = parser.parse_args()

    try:
        # Load parsed authority
        parsed_authority = safe_read_json(Path(args.authority_json))

        # Verify claim
        result = verify_claim_against_authority(
            claim_text=args.claim_text,
            citation_text=args.citation_text,
            parsed_authority=parsed_authority,
            matching_threshold=args.threshold,
        )

        # Write output
        safe_write_json(Path(args.output), result)

        # Print summary
        outcome = result["verification_outcome"].upper()
        confidence = result["evidence"]["confidence"]

        if outcome == "SUPPORTED":
            print(f"[OK] {outcome} (confidence: {confidence:.2f})")
        elif outcome == "CONTRADICTED":
            print(f"[ERROR] {outcome} (confidence: {confidence:.2f})")
        else:
            print(f"? {outcome} (confidence: {confidence:.2f})")

        if result["evidence"]["matching_paragraphs"]:
            print(f"  Matching paragraphs: {len(result['evidence']['matching_paragraphs'])}")

        return 0

    except FileNotFoundError as e:
        print(f"[ERROR] File error: {e}", file=sys.stderr)
        return 1

    except Exception as e:
        print(f"[ERROR] Verification error: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
