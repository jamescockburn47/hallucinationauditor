#!/usr/bin/env python3
"""
Resolve citation strings to candidate URLs using multiple strategies.

Enhanced resolver that handles:
1. Neutral citations ([2020] UKSC 15) - Direct URL construction
2. Traditional law reports ([1990] 2 AC 605) - FCL/BAILII search
3. Case name + citation searches

Usage:
    python scripts/public_resolve.py --citation-text TEXT --output OUTPUT_JSON [--job-id JOB]

Output:
    JSON with candidate URLs and resolution status
"""

import argparse
import sys
import re
import logging
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional, Tuple
from pathlib import Path

try:
    import requests
except ImportError:
    requests = None

from utils.file_helpers import safe_write_json

logger = logging.getLogger(__name__)


# ===== NEUTRAL CITATION PATTERNS (Direct URL Construction) =====

FCL_NEUTRAL_PATTERNS = {
    "uksc": {
        "pattern": r"\[(\d{4})\]\s+UKSC\s+(\d+)",
        "url_template": "https://caselaw.nationalarchives.gov.uk/uksc/{year}/{num}/data.xml",
    },
    "ukpc": {
        "pattern": r"\[(\d{4})\]\s+UKPC\s+(\d+)",
        "url_template": "https://caselaw.nationalarchives.gov.uk/ukpc/{year}/{num}/data.xml",
    },
    "ukhl": {
        "pattern": r"\[(\d{4})\]\s+UKHL\s+(\d+)",
        "url_template": "https://caselaw.nationalarchives.gov.uk/ukhl/{year}/{num}/data.xml",
    },
    "ewca_civ": {
        "pattern": r"\[(\d{4})\]\s+EWCA\s+Civ\s+(\d+)",
        "url_template": "https://caselaw.nationalarchives.gov.uk/ewca/civ/{year}/{num}/data.xml",
    },
    "ewca_crim": {
        "pattern": r"\[(\d{4})\]\s+EWCA\s+Crim\s+(\d+)",
        "url_template": "https://caselaw.nationalarchives.gov.uk/ewca/crim/{year}/{num}/data.xml",
    },
    "ewhc_admin": {
        "pattern": r"\[(\d{4})\]\s+EWHC\s+(\d+)\s+\(Admin\)",
        "url_template": "https://caselaw.nationalarchives.gov.uk/ewhc/admin/{year}/{num}/data.xml",
    },
    "ewhc_ch": {
        "pattern": r"\[(\d{4})\]\s+EWHC\s+(\d+)\s+\(Ch\)",
        "url_template": "https://caselaw.nationalarchives.gov.uk/ewhc/ch/{year}/{num}/data.xml",
    },
    "ewhc_qb": {
        "pattern": r"\[(\d{4})\]\s+EWHC\s+(\d+)\s+\(QB\)",
        "url_template": "https://caselaw.nationalarchives.gov.uk/ewhc/qb/{year}/{num}/data.xml",
    },
    "ewhc_kb": {
        "pattern": r"\[(\d{4})\]\s+EWHC\s+(\d+)\s+\(KB\)",
        "url_template": "https://caselaw.nationalarchives.gov.uk/ewhc/kb/{year}/{num}/data.xml",
    },
    "ewhc_fam": {
        "pattern": r"\[(\d{4})\]\s+EWHC\s+(\d+)\s+\(Fam\)",
        "url_template": "https://caselaw.nationalarchives.gov.uk/ewhc/fam/{year}/{num}/data.xml",
    },
    "ewhc_tcc": {
        "pattern": r"\[(\d{4})\]\s+EWHC\s+(\d+)\s+\(TCC\)",
        "url_template": "https://caselaw.nationalarchives.gov.uk/ewhc/tcc/{year}/{num}/data.xml",
    },
    "ewhc_comm": {
        "pattern": r"\[(\d{4})\]\s+EWHC\s+(\d+)\s+\(Comm\)",
        "url_template": "https://caselaw.nationalarchives.gov.uk/ewhc/comm/{year}/{num}/data.xml",
    },
    "ewhc_pat": {
        "pattern": r"\[(\d{4})\]\s+EWHC\s+(\d+)\s+\(Pat\)",
        "url_template": "https://caselaw.nationalarchives.gov.uk/ewhc/pat/{year}/{num}/data.xml",
    },
    "ukut_iac": {
        "pattern": r"\[(\d{4})\]\s+UKUT\s+(\d+)\s+\(IAC\)",
        "url_template": "https://caselaw.nationalarchives.gov.uk/ukut/iac/{year}/{num}/data.xml",
    },
    "ukut_lc": {
        "pattern": r"\[(\d{4})\]\s+UKUT\s+(\d+)\s+\(LC\)",
        "url_template": "https://caselaw.nationalarchives.gov.uk/ukut/lc/{year}/{num}/data.xml",
    },
    "ukut_tcc": {
        "pattern": r"\[(\d{4})\]\s+UKUT\s+(\d+)\s+\(TCC\)",
        "url_template": "https://caselaw.nationalarchives.gov.uk/ukut/tcc/{year}/{num}/data.xml",
    },
    "ukftt_tc": {
        "pattern": r"\[(\d{4})\]\s+UKFTT\s+(\d+)\s+\(TC\)",
        "url_template": "https://caselaw.nationalarchives.gov.uk/ukftt/tc/{year}/{num}/data.xml",
    },
    "ukftt_grc": {
        "pattern": r"\[(\d{4})\]\s+UKFTT\s+(\d+)\s+\(GRC\)",
        "url_template": "https://caselaw.nationalarchives.gov.uk/ukftt/grc/{year}/{num}/data.xml",
    },
    "eat": {
        "pattern": r"\[(\d{4})\]\s+EAT\s+(\d+)",
        "url_template": "https://caselaw.nationalarchives.gov.uk/eat/{year}/{num}/data.xml",
    },
}


# ===== TRADITIONAL LAW REPORT PATTERNS =====
# These need search-based resolution, not direct URL

TRADITIONAL_REPORT_PATTERNS = [
    # Appeal Cases: [1990] 2 AC 605
    r"\[(\d{4})\]\s*(\d*)\s*AC\s+(\d+)",
    # Queen's/King's Bench: [1998] QB 254
    r"\[(\d{4})\]\s*(\d*)\s*(?:QB|KB)\s+(\d+)",
    # Chancery: [1999] Ch 100
    r"\[(\d{4})\]\s*(\d*)\s*Ch\s+(\d+)",
    # Weekly Law Reports: [1990] 1 WLR 582
    r"\[(\d{4})\]\s*(\d*)\s*WLR\s+(\d+)",
    # All England Reports: [1990] 2 All ER 580
    r"\[(\d{4})\]\s*(\d*)\s*All\s*ER\s+(\d+)",
    # Family: [2000] Fam 123
    r"\[(\d{4})\]\s*(\d*)\s*Fam\s+(\d+)",
    # ICR: [1999] ICR 123
    r"\[(\d{4})\]\s*(\d*)\s*ICR\s+(\d+)",
    # IRLR: [1999] IRLR 456
    r"\[(\d{4})\]\s*(\d*)\s*IRLR\s+(\d+)",
    # BCLC: [1999] 1 BCLC 123
    r"\[(\d{4})\]\s*(\d*)\s*BCLC\s+(\d+)",
    # Criminal Appeal Reports: [1999] 2 Cr App R 123
    r"\[(\d{4})\]\s*(\d*)\s*Cr\s*App\s*R\s+(\d+)",
    # Lloyd's Rep: [1999] 1 Lloyd's Rep 123
    r"\[(\d{4})\]\s*(\d*)\s*Lloyd's\s*Rep\s+(\d+)",
    # P&CR: [1999] P&CR 123
    r"\[(\d{4})\]\s*(\d*)\s*P\s*&\s*CR\s+(\d+)",
]


# ===== CASE NAME EXTRACTION PATTERNS =====

CASE_NAME_PATTERNS = [
    # Standard v pattern: "Smith v Jones", "R v Smith", "Regina v Smith"
    r"([A-Z][A-Za-z'\-\.]+(?:\s+(?:and|&)\s+[A-Z][A-Za-z'\-\.]+)*)\s+v\.?\s+([A-Z][A-Za-z'\-\.]+(?:\s+(?:plc|Ltd|Co|PLC|LTD|Council|Authority|NHS|Trust|Board|Committee|Commissioners?|Secretary\s+of\s+State))?(?:\s+(?:for|of)\s+[A-Za-z'\-\s]+)?)",
    # In re / Ex parte patterns
    r"(?:In\s+re|Re|Ex\s+parte)\s+([A-Z][A-Za-z'\-\s]+?)(?=\s*\[)",
    # The X case pattern
    r"The\s+([A-Z][A-Za-z'\-]+)(?:\s+\(No\.?\s*\d+\))?(?=\s*\[)",
]


def extract_case_name(text: str) -> Optional[str]:
    """
    Extract case name from text containing a citation.
    
    Args:
        text: Text that may contain "Case Name [citation]"
        
    Returns:
        Case name if found, None otherwise
    """
    for pattern in CASE_NAME_PATTERNS:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            case_name = match.group(0).strip()
            # Clean up
            case_name = re.sub(r'\s+', ' ', case_name)
            return case_name
    return None


def extract_citation_year(citation_text: str) -> Optional[str]:
    """Extract year from any citation format."""
    match = re.search(r'\[(\d{4})\]', citation_text)
    if match:
        return match.group(1)
    return None


def try_neutral_citation_patterns(citation_text: str) -> Optional[Dict[str, Any]]:
    """
    Try to match citation against neutral citation patterns for direct URL construction.
    
    Returns candidate dict if matched, None otherwise.
    """
    for pattern_name, config in FCL_NEUTRAL_PATTERNS.items():
        match = re.search(config["pattern"], citation_text, re.IGNORECASE)
        if match:
            year = match.group(1)
            num = match.group(2)
            url = config["url_template"].format(year=year, num=num)
            return {
                "url": url,
                "source": "find_case_law",
                "confidence": 0.95,
                "resolution_method": "neutral_citation_direct",
                "pattern_name": pattern_name,
                "year": year,
                "number": num,
            }
    return None


def is_traditional_citation(citation_text: str) -> bool:
    """Check if this is a traditional law report citation."""
    for pattern in TRADITIONAL_REPORT_PATTERNS:
        if re.search(pattern, citation_text, re.IGNORECASE):
            return True
    return False


def search_fcl_by_query(query: str, timeout: int = 30) -> List[Dict[str, Any]]:
    """
    Search Find Case Law using Atom feed.
    
    Args:
        query: Search query (case name, keywords, etc.)
        timeout: Request timeout
        
    Returns:
        List of matching entries
    """
    if requests is None:
        logger.warning("requests library not installed, cannot search FCL")
        return []
    
    try:
        # FCL Atom search endpoint
        url = "https://caselaw.nationalarchives.gov.uk/atom.xml"
        
        # Build params - use party search for better results
        params = {
            "party": query,  # Use party parameter instead of query
            "per_page": 10,
            "order": "-date",
        }
        
        logger.debug(f"FCL Atom request: {url} params={params}")
        
        response = requests.get(
            url,
            params=params,
            timeout=timeout,
            headers={"User-Agent": "HallucinationAuditor/0.3.0"}
        )
        
        logger.debug(f"FCL response status: {response.status_code}")
        
        if response.status_code != 200:
            logger.warning(f"FCL search returned {response.status_code}")
            # Try alternative search with query param
            params = {"query": query, "per_page": 10}
            response = requests.get(url, params=params, timeout=timeout,
                                   headers={"User-Agent": "HallucinationAuditor/0.3.0"})
            if response.status_code != 200:
                logger.warning(f"FCL fallback search also returned {response.status_code}")
                return []
        
        # Parse Atom XML
        import xml.etree.ElementTree as ET
        root = ET.fromstring(response.content)
        
        ns = {
            "atom": "http://www.w3.org/2005/Atom",
            "tna": "https://caselaw.nationalarchives.gov.uk/akn",
        }
        
        results = []
        for entry in root.findall("atom:entry", ns):
            title_elem = entry.find("atom:title", ns)
            uri_elem = entry.find("tna:uri", ns)
            
            # Get XML link
            xml_link = None
            for link in entry.findall("atom:link", ns):
                if "xml" in link.get("type", ""):
                    xml_link = link.get("href")
                    break
            
            if title_elem is not None and uri_elem is not None:
                results.append({
                    "title": title_elem.text,
                    "uri": uri_elem.text,
                    "url": xml_link or f"https://caselaw.nationalarchives.gov.uk/{uri_elem.text}/data.xml",
                })
        
        logger.info(f"FCL search found {len(results)} results")
        return results
        
    except Exception as e:
        logger.error(f"FCL search error: {e}")
        return []


def try_bailii_direct_url(case_name: str, year: str, timeout: int = 10) -> Optional[Dict[str, Any]]:
    """
    Try to find a case on BAILII by trying known court URL patterns.
    
    For cases like Caparo [1990] 2 AC 605, AC = Appeal Cases = House of Lords
    """
    if requests is None or not year:
        return None
    
    # Map law report abbreviations to likely courts
    # AC = Appeal Cases (House of Lords / Supreme Court)
    # For House of Lords before 2009, try UKHL
    
    courts_to_try = [
        ("UKHL", "uk"),   # House of Lords (pre-2009)
        ("UKSC", "uk"),   # Supreme Court (2009+)
        ("EWCA/Civ", "ew"),  # Court of Appeal Civil
        ("EWCA/Crim", "ew"), # Court of Appeal Criminal
    ]
    
    year_int = int(year)
    
    # For pre-2009 appeals, prioritize UKHL
    if year_int < 2009:
        courts_to_try = [("UKHL", "uk")] + courts_to_try
    
    # Extract key search terms from case name
    search_terms = []
    if case_name:
        # Get significant words
        words = re.findall(r'\b([A-Z][a-z]+)\b', case_name)
        search_terms = [w.lower() for w in words if w.lower() not in ['the', 'and', 'plc', 'ltd', 'limited']]
    
    for court, jurisdiction in courts_to_try[:2]:  # Only try first 2 courts
        court_path = court.replace("/", "/")
        
        # Try first 10 case numbers for that year
        for case_num in range(1, 15):
            url = f"https://www.bailii.org/{jurisdiction}/cases/{court}/{year}/{case_num}.html"
            
            try:
                response = requests.head(
                    url,
                    timeout=5,
                    headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"},
                    allow_redirects=True
                )
                
                if response.status_code == 200:
                    # Verify it's the right case by fetching and checking content
                    full_response = requests.get(
                        url,
                        timeout=timeout,
                        headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
                    )
                    
                    if full_response.status_code == 200:
                        content_lower = full_response.text.lower()
                        
                        # Check if search terms appear in the content
                        matches = sum(1 for term in search_terms if term in content_lower)
                        if matches >= min(2, len(search_terms)):
                            # Found it!
                            # Try to extract title
                            title = case_name or f"BAILII {court} {year}/{case_num}"
                            
                            try:
                                from bs4 import BeautifulSoup
                                soup = BeautifulSoup(full_response.text, 'lxml')
                                title_tag = soup.find('title')
                                if title_tag:
                                    title = title_tag.get_text().strip()
                            except:
                                pass
                            
                            logger.info(f"Found case on BAILII: {url}")
                            return {
                                "title": title,
                                "url": url,
                                "source": "bailii",
                                "confidence": 0.85,
                            }
                            
            except requests.exceptions.RequestException:
                continue
    
    return None


def search_bailii(query: str, year: Optional[str] = None, case_name: Optional[str] = None, timeout: int = 30) -> List[Dict[str, Any]]:
    """
    Search BAILII for cases using multiple strategies.
    
    Args:
        query: Search query (party names)
        year: Optional year filter
        case_name: Full case name for direct URL matching
        timeout: Request timeout
        
    Returns:
        List of matching entries
    """
    if requests is None:
        return []
    
    results = []
    
    # Strategy 1: Try direct URL construction for known courts
    if case_name and year:
        direct_result = try_bailii_direct_url(case_name, year, timeout)
        if direct_result:
            results.append(direct_result)
            return results  # Found it directly!
    
    # Strategy 2: Use BAILII's search interface
    try:
        # BAILII search URL
        search_url = "https://www.bailii.org/cgi-bin/find.cgi"
        
        # Build search query for BAILII
        search_query = query
        if year:
            search_query = f'"{query}" {year}'
        
        params = {
            "query": search_query,
            "mask_path": "",  # Search all
        }
        
        logger.debug(f"BAILII search: {search_url} query={search_query}")
        
        response = requests.get(
            search_url,
            params=params,
            timeout=timeout,
            headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)"}
        )
        
        if response.status_code != 200:
            logger.warning(f"BAILII search returned {response.status_code}")
        else:
            # Parse results from HTML
            try:
                from bs4 import BeautifulSoup
                soup = BeautifulSoup(response.text, 'lxml')
                
                # Look for links to case pages
                for link in soup.find_all('a', href=True):
                    href = link.get('href', '')
                    text = link.get_text().strip()
                    
                    # BAILII case URLs follow pattern: /uk/cases/COURT/YEAR/NUMBER.html
                    if '/cases/' in href and href.endswith('.html'):
                        # Make URL absolute
                        if href.startswith('/'):
                            full_url = f"https://www.bailii.org{href}"
                        elif href.startswith('http'):
                            full_url = href
                        else:
                            continue
                        
                        # Check if year matches (if provided)
                        if year and year not in href and year not in text:
                            continue
                        
                        # Skip navigation links
                        if len(text) < 5 or text.lower() in ['next', 'previous', 'back', 'home']:
                            continue
                        
                        results.append({
                            "title": text,
                            "url": full_url,
                            "source": "bailii",
                            "confidence": 0.75,
                        })
                        
                        if len(results) >= 5:
                            break
                            
            except ImportError:
                logger.warning("BeautifulSoup not installed, BAILII HTML parsing disabled")
        
        logger.info(f"BAILII search found {len(results)} results")
        return results
        
    except Exception as e:
        logger.error(f"BAILII search error: {e}")
        return results


def resolve_traditional_citation(citation_text: str, case_name: Optional[str] = None) -> List[Dict[str, Any]]:
    """
    Resolve traditional law report citation using search.
    
    Traditional citations like [1990] 2 AC 605 don't have direct URLs,
    so we search using case name and year.
    """
    candidates = []
    year = extract_citation_year(citation_text)
    
    # Build search query - extract meaningful party names
    search_terms = []
    if case_name:
        # Extract party names from case name  
        # "Caparo Industries plc v Dickman" -> search for "Caparo" and "Dickman"
        
        # Split by 'v' or 'v.' to get parties
        if ' v ' in case_name.lower() or ' v. ' in case_name.lower():
            parts = re.split(r'\s+v\.?\s+', case_name, flags=re.IGNORECASE)
            for part in parts:
                # Get first significant word from each party
                words = re.findall(r'\b([A-Z][a-z]+)\b', part)
                # Skip common words like "The", "Re", "In"
                significant_words = [w for w in words if w.lower() not in ['the', 're', 'in', 'ex', 'parte', 'and', 'plc', 'ltd', 'limited']]
                if significant_words:
                    search_terms.append(significant_words[0])
        else:
            # Not a v case - just get significant words
            words = re.findall(r'\b([A-Z][a-z]+)\b', case_name)
            significant_words = [w for w in words if w.lower() not in ['the', 're', 'in', 'ex', 'parte', 'and', 'plc', 'ltd', 'limited']]
            if significant_words:
                search_terms.extend(significant_words[:2])
    
    # If we still don't have search terms, try to extract from citation itself
    if not search_terms:
        # Look for case name pattern in citation_text
        v_match = re.search(r'([A-Z][a-z]+)(?:\s+\w+)*\s+v\.?\s+([A-Z][a-z]+)', citation_text)
        if v_match:
            search_terms = [v_match.group(1), v_match.group(2)]
    
    if not search_terms:
        logger.warning(f"Could not extract search terms from: {citation_text}")
        return candidates
    
    # Build query - just party names (FCL search doesn't need year in query)
    query = " ".join(search_terms)
    
    logger.info(f"Searching FCL for traditional citation: query='{query}' year={year}")
    
    # Search FCL
    fcl_results = search_fcl_by_query(query)
    
    # Filter results by year if we have one
    for result in fcl_results:
        result_title = result.get("title", "")
        result_uri = result.get("uri", "")
        
        # Check if the year matches (in title or URI)
        if year:
            year_match = year in result_title or year in result_uri
            # Also check if the search terms appear in the title
            terms_match = all(term.lower() in result_title.lower() for term in search_terms)
            
            if year_match and terms_match:
                # High confidence - year and terms match
                confidence = 0.85
            elif year_match or terms_match:
                # Medium confidence - partial match
                confidence = 0.70
            else:
                # Skip if neither matches well
                continue
        else:
            confidence = 0.65
        
        candidates.append({
            "url": result.get("url"),
            "source": "find_case_law",
            "confidence": confidence,
            "resolution_method": "fcl_search",
            "title": result.get("title"),
            "uri": result.get("uri"),
        })
    
    # If no FCL results, try BAILII
    if not candidates:
        logger.info(f"No FCL results, trying BAILII search for {case_name or query}")
        bailii_results = search_bailii(query, year, case_name=case_name)
        for result in bailii_results:
            candidates.append({
                "url": result.get("url"),
                "source": "bailii",
                "confidence": 0.70,
                "resolution_method": "bailii_search",
                "title": result.get("title"),
            })
    
    # Sort by confidence
    candidates.sort(key=lambda x: x.get("confidence", 0), reverse=True)
    
    return candidates


def resolve_citation_to_urls(
    citation_text: str,
    case_name: Optional[str] = None,
    prefer_sources: List[str] = None,
    job_id: Optional[str] = None,
    enable_web_search: bool = False,
) -> Dict[str, Any]:
    """
    Resolve citation to candidate URLs using multiple strategies.
    
    Resolution Strategy:
    1. If neutral citation -> Direct URL construction (highest confidence)
    2. If traditional citation -> Search FCL by case name + year
    3. Fallback -> Search BAILII
    
    Args:
        citation_text: Citation string to resolve
        case_name: Optional case name for better search
        prefer_sources: Source preference order
        job_id: Job identifier for tracking
        
    Returns:
        Resolution result with candidate URLs
    """
    if prefer_sources is None:
        prefer_sources = ["find_case_law", "bailii"]
    
    candidate_urls = []
    resolution_attempts = []
    
    # Extract case name if not provided
    if not case_name:
        case_name = extract_case_name(citation_text)
        if case_name:
            logger.info(f"Extracted case name: {case_name}")
    
    # Strategy 1: Try neutral citation direct URL construction
    neutral_result = try_neutral_citation_patterns(citation_text)
    if neutral_result:
        candidate_urls.append(neutral_result)
        resolution_attempts.append(f"Neutral citation matched: {neutral_result['pattern_name']}")
        logger.info(f"Resolved via neutral citation: {neutral_result['url']}")
    
    # Strategy 2: If traditional citation or neutral didn't match, use search
    if not candidate_urls or is_traditional_citation(citation_text):
        if is_traditional_citation(citation_text):
            resolution_attempts.append("Traditional law report citation detected - using search")
        
        traditional_candidates = resolve_traditional_citation(citation_text, case_name)
        
        for candidate in traditional_candidates:
            # Avoid duplicates
            existing_urls = [c.get("url") for c in candidate_urls]
            if candidate.get("url") not in existing_urls:
                candidate_urls.append(candidate)
        
        if traditional_candidates:
            resolution_attempts.append(f"Search found {len(traditional_candidates)} candidate(s)")
    
    # Determine resolution status
    if len(candidate_urls) == 0:
        resolution_status = "unresolvable"
        notes = "No pattern match or search results found"
    elif len(candidate_urls) == 1:
        resolution_status = "resolved"
        notes = f"Resolved via {candidate_urls[0].get('resolution_method', 'unknown')}"
    else:
        resolution_status = "resolved"  # Take best match
        notes = f"Multiple candidates found ({len(candidate_urls)}), using best match"
    
    result = {
        "citation_text": citation_text,
        "case_name": case_name,
        "resolved_at": datetime.now(timezone.utc).isoformat(),
        "candidate_urls": candidate_urls,
        "resolution_status": resolution_status,
        "resolution_attempts": resolution_attempts,
        "notes": notes,
    }
    
    if job_id:
        result["job_id"] = job_id
    
    return result


def main() -> int:
    """CLI entry point."""
    parser = argparse.ArgumentParser(
        description="Resolve citations to URLs (FCL-first, BAILII fallback)"
    )
    parser.add_argument("--citation-text", required=True, help="Citation text to resolve")
    parser.add_argument("--case-name", help="Optional case name for better search")
    parser.add_argument("--output", required=True, help="Output JSON path")
    parser.add_argument("--job-id", help="Job identifier (optional)")
    parser.add_argument(
        "--prefer-sources",
        help='Comma-separated source preference (default: "find_case_law,bailii")',
        default="find_case_law,bailii",
    )

    args = parser.parse_args()

    try:
        prefer_sources = [s.strip() for s in args.prefer_sources.split(",")]

        result = resolve_citation_to_urls(
            citation_text=args.citation_text,
            case_name=args.case_name,
            prefer_sources=prefer_sources,
            job_id=args.job_id,
        )

        # Write output
        safe_write_json(Path(args.output), result)

        # Print summary
        if result["resolution_status"] == "resolved":
            candidate = result["candidate_urls"][0]
            source = candidate["source"]
            url = candidate["url"]
            print(f"[OK] Resolved ({source}): {url}")
            if result.get("case_name"):
                print(f"  Case name: {result['case_name']}")
        else:
            print(f"[ERROR] Unresolvable: {result['notes']}")

        return 0

    except Exception as e:
        print(f"[ERROR] Resolution error: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
