#!/usr/bin/env python3
"""
FastAPI backend for Matthew Lee Bot - Legal Citation Auditor.

Wraps the hallucination auditor pipeline with a REST API.

Usage:
    cd hallucination-auditor
    python -m api.server
"""

import uuid
import sys
import os
import re
import tempfile
import logging
from pathlib import Path
from datetime import datetime, timezone
from typing import List, Optional, Dict, Any, Tuple

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Add the scripts directory to path for proper imports
SCRIPT_DIR = Path(__file__).parent.parent / "scripts"
sys.path.insert(0, str(SCRIPT_DIR))
sys.path.insert(0, str(Path(__file__).parent.parent))

# Change working directory to hallucination-auditor for consistent paths
os.chdir(Path(__file__).parent.parent)

import secrets
import base64
from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from starlette.middleware.base import BaseHTTPMiddleware
from pydantic import BaseModel

from utils.file_helpers import safe_read_json, safe_write_json
from utils.cache_helpers import get_cache_path, ensure_cache_dir
from public_resolve import resolve_citation_to_urls
from verify_claim import verify_claim_against_authority
from fetch_url import fetch_and_cache_url
from parse_authority import parse_authority_document

# Optional imports for document parsing
try:
    import fitz  # PyMuPDF
    HAS_PYMUPDF = True
except ImportError:
    HAS_PYMUPDF = False

# Optional spaCy for advanced NLP
try:
    import spacy
    try:
        NLP = spacy.load("en_core_web_sm")
        HAS_SPACY = True
        logger.info("spaCy loaded successfully - enhanced proposition extraction available")
    except OSError:
        HAS_SPACY = False
        NLP = None
        logger.info("spaCy model not found - using rule-based extraction only")
except ImportError:
    HAS_SPACY = False
    NLP = None
    logger.info("spaCy not installed - using rule-based extraction only")

try:
    import docx  # python-docx
    HAS_DOCX = True
except ImportError:
    HAS_DOCX = False

try:
    from bs4 import BeautifulSoup
    HAS_BS4 = True
except ImportError:
    HAS_BS4 = False


# ===== Models =====

class Citation(BaseModel):
    raw: str


class ClaimInput(BaseModel):
    claim_id: str
    text: str
    citations: List[Citation]


class AuditRequest(BaseModel):
    title: Optional[str] = "Citation Audit"
    claims: List[ClaimInput]
    web_search_enabled: bool = False


class CitationResult(BaseModel):
    citation_id: str
    citation_text: str
    outcome: str
    hallucination_type: Optional[str] = None
    hallucination_type_name: Optional[str] = None
    authority_url: Optional[str] = None
    authority_title: Optional[str] = None
    case_retrieved: bool = False
    confidence: Optional[float] = None
    notes: Optional[str] = None
    source_type: Optional[str] = None  # 'fcl', 'bailii', 'web_search', 'not_found'
    verification_level: Optional[str] = None  # 'primary', 'secondary', 'unverified'


class ClaimResult(BaseModel):
    claim_id: str
    text: str
    citations: List[CitationResult]


class AuditMetadata(BaseModel):
    job_id: str
    title: str
    audited_at: str


class AuditSummary(BaseModel):
    total_claims: int
    total_citations: int


class AuditResponse(BaseModel):
    audit_metadata: AuditMetadata
    claims: List[ClaimResult]
    summary: AuditSummary


# ===== App Setup =====

app = FastAPI(
    title="Matthew Lee Bot API",
    description="Legal Citation Auditor - Verify claims against UK case law",
    version="0.2.0"
)

# CORS for frontend - allow all origins in production
ALLOWED_ORIGINS = os.environ.get("ALLOWED_ORIGINS", "http://localhost:5173,http://localhost:3000,http://127.0.0.1:5173").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ===== Password Protection =====
# Simple HTTP Basic Auth for the entire site using middleware
SITE_PASSWORD = os.environ.get("SITE_PASSWORD", "Citecheck2026")
AUTH_ENABLED = os.environ.get("AUTH_ENABLED", "true").lower() == "true"


class BasicAuthMiddleware(BaseHTTPMiddleware):
    """Middleware to require HTTP Basic Auth for all requests."""

    async def dispatch(self, request: Request, call_next):
        # Skip auth if disabled
        if not AUTH_ENABLED:
            return await call_next(request)

        # Allow health check without auth (needed for Railway/container health checks)
        # Railway checks "/" by default - detect health checks by User-Agent or path
        if request.url.path == "/health":
            return await call_next(request)

        # Allow root path for health checks (no User-Agent or simple health check agents)
        if request.url.path == "/":
            user_agent = request.headers.get("User-Agent", "")
            # Health checks typically have no User-Agent or simple ones like "curl", "Go-http-client", etc.
            # Real browsers have complex User-Agent strings
            if not user_agent or "Mozilla" not in user_agent:
                return await call_next(request)

        # Allow static assets without auth (they're loaded after initial page auth)
        if request.url.path.startswith("/assets/"):
            return await call_next(request)

        # Check for Authorization header
        auth_header = request.headers.get("Authorization")
        if auth_header:
            try:
                scheme, credentials = auth_header.split()
                if scheme.lower() == "basic":
                    decoded = base64.b64decode(credentials).decode("utf-8")
                    username, password = decoded.split(":", 1)
                    if secrets.compare_digest(password, SITE_PASSWORD):
                        return await call_next(request)
            except (ValueError, UnicodeDecodeError):
                pass

        # Return 401 with WWW-Authenticate header to prompt for credentials
        return Response(
            content="Authentication required",
            status_code=401,
            headers={"WWW-Authenticate": 'Basic realm="Citecheck"'},
        )


# Add auth middleware
app.add_middleware(BasicAuthMiddleware)


# Static directory path for frontend files
STATIC_DIR = Path(__file__).parent.parent / "static"

# Mount assets directory if it exists (this doesn't conflict with API routes)
if STATIC_DIR.exists() and (STATIC_DIR / "assets").exists():
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")


# ===== Citation Patterns =====

# Comprehensive citation patterns
CITATION_PATTERNS = [
    # Traditional law report: [1990] 2 AC 605, [1957] 1 WLR 582, [1998] AC 232
    r"\[(\d{4})\]\s*\d*\s*(?:AC|QB|KB|Ch|WLR|All ER|BCLC|Fam|ICR|IRLR|Cr App R|EWLR|Lloyd's Rep|P&CR|EG|EGLR)\s+\d+",
    # Neutral citations: [2020] UKSC 15, [2019] EWCA Civ 123
    r"\[(\d{4})\]\s*(?:UKSC|UKPC|UKHL|EWCA\s*(?:Civ|Crim)|EWHC|UKUT|UKFTT)\s*\d+(?:\s*\([A-Za-z]+\))?",
]

# Legal claim indicator phrases - these signal a proposition about what a case establishes
CLAIM_INDICATORS = [
    # What the case held/established
    r"(?:held|holds|holding)\s+that",
    r"(?:establish(?:es|ed|ing)?|established)\s+(?:that|the)",
    r"(?:confirm(?:s|ed|ing)?)\s+(?:that|the)",
    r"(?:decid(?:es|ed|ing))\s+(?:that|the)",
    r"(?:determin(?:es|ed|ing))\s+(?:that|the)",
    r"(?:rul(?:es|ed|ing))\s+(?:that|the)",
    r"(?:found|finds)\s+(?:that|the)",
    r"(?:stat(?:es|ed|ing))\s+(?:that|the)",
    # Authority language
    r"is\s+(?:the\s+)?(?:leading\s+)?authority\s+(?:for|on|that)",
    r"(?:provides?|provided)\s+(?:that|the)",
    r"(?:set(?:s|ting)?|laid)\s+(?:out|down)\s+(?:that|the)",
    r"(?:articulated?|formulated?)\s+(?:that|the|a)",
    # Principle/test language  
    r"(?:the\s+)?(?:test|principle|rule|standard|duty|requirement)\s+(?:is|that|in|from)",
    r"(?:tripartite|two-stage|three-stage)\s+test",
    # Ratio/obiter
    r"(?:ratio|obiter)\s+(?:decidendi|dicta|dictum)",
    # Em-dash pattern (Case [Citation] — proposition)
    r"[—–-]\s*(?=\w)",
]

# Numbered paragraph patterns for legal documents
PARAGRAPH_PATTERNS = [
    r"^\s*(\d{1,3})\.\s+",           # "9. " or "10. "
    r"^\s*\((\d{1,3})\)\s+",         # "(9) " or "(10) "
    r"^\s*(\d{1,3})\)\s+",           # "9) " or "10) "
    r"^\s*\[(\d{1,3})\]\s+",         # "[9] " or "[10] "
    r"^\s*([a-z])\.\s+",             # "a. " or "b. "
    r"^\s*\(([a-z])\)\s+",           # "(a) " or "(b) "
    r"^\s*([ivx]{1,4})\.\s+",        # "i. " or "iv. " (roman numerals)
    r"^\s*\(([ivx]{1,4})\)\s+",      # "(i) " or "(iv) "
]

# Case name patterns (to extract full case name before citation)
CASE_NAME_PATTERNS = [
    # Standard v pattern: "Smith v Jones" or "R v Smith"
    r"([A-Z][A-Za-z'\-]+(?:\s+(?:and|&)\s+[A-Z][A-Za-z'\-]+)*)\s+v\s+([A-Z][A-Za-z'\-]+(?:\s+(?:plc|Ltd|Co|Council|Authority|NHS|Trust|Board|Committee|Commissioners?))?(?:\s+[A-Za-z'\-]+)*)",
    # In re / Ex parte patterns
    r"(?:In\s+re|Re|Ex\s+parte)\s+([A-Z][A-Za-z'\-\s]+)",
    # The X case pattern
    r"The\s+([A-Z][A-Za-z'\-]+)\s+(?:\(No\.?\s*\d+\)\s*)?(?=\[)",
]


# ===== Document Extraction Functions =====

def extract_text_from_pdf(file_path: Path) -> str:
    """Extract text from PDF using PyMuPDF."""
    if not HAS_PYMUPDF:
        raise ImportError("PyMuPDF not installed. Install with: pip install PyMuPDF")
    
    doc = fitz.open(file_path)
    text_parts = []
    for page in doc:
        text_parts.append(page.get_text())
    doc.close()
    return "\n".join(text_parts)


def extract_text_from_docx(file_path: Path) -> str:
    """Extract text from DOCX using python-docx."""
    if not HAS_DOCX:
        raise ImportError("python-docx not installed. Install with: pip install python-docx")
    
    doc = docx.Document(file_path)
    text_parts = []
    for para in doc.paragraphs:
        text_parts.append(para.text)
    return "\n".join(text_parts)


def extract_text_from_html(file_path: Path) -> str:
    """Extract text from HTML using BeautifulSoup."""
    if not HAS_BS4:
        raise ImportError("BeautifulSoup not installed. Install with: pip install beautifulsoup4")
    
    with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
        content = f.read()
    
    soup = BeautifulSoup(content, 'html.parser')
    # Remove script and style elements
    for script in soup(["script", "style"]):
        script.decompose()
    return soup.get_text(separator="\n")


def extract_text_from_file(file_path: Path, file_type: str) -> str:
    """Extract text from a file based on its type."""
    if file_type == 'pdf':
        return extract_text_from_pdf(file_path)
    elif file_type == 'html':
        return extract_text_from_html(file_path)
    elif file_type == 'docx':
        return extract_text_from_docx(file_path)
    else:  # txt or other
        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
            return f.read()


def extract_case_name_from_citation(citation_text: str) -> Optional[str]:
    """
    Extract case name from a citation string like "Montgomery v Lanarkshire [2015] UKSC 11".
    """
    # Pattern: "Name v Name [YEAR] COURT NUM"
    match = re.match(r'^(.*?)\s*\[\d{4}\]', citation_text.strip())
    if match:
        name = match.group(1).strip()
        if name and len(name) > 2:
            return name
    return None


def extract_case_name_from_text(text: str, citation: str) -> Optional[str]:
    """
    Extract case name from text that contains a citation.
    
    Looks for patterns like:
    - "Caparo Industries plc v Dickman [1990] 2 AC 605"
    - "R v Smith [2020] UKSC 15"
    - "Secretary of State for the Home Department v AF [2009] UKHL 28"
    """
    # First, check if the citation itself contains a case name (common format)
    # Pattern: "Case Name [citation]" or "Case Name citation"
    
    # Look for text immediately before the citation
    citation_pos = text.find(citation)
    if citation_pos > 0:
        # Look at the 150 chars before the citation
        prefix = text[max(0, citation_pos - 150):citation_pos].strip()
        
        # Try to find case name pattern at the end of prefix
        # More comprehensive pattern for case names
        case_patterns = [
            # Full pattern: Party1 v Party2 (most common)
            r"([A-Z][A-Za-z'\-\.]+(?:\s+(?:Industries|Holdings|International|Services|Group|Limited|Ltd|plc|PLC|Inc|Corporation|Corp|Co|&\s*Co\.?|and\s+(?:Others?|Another|Ors)))*)\s+v\.?\s+([A-Z][A-Za-z'\-\.]+(?:\s+(?:Industries|Holdings|International|Services|Group|Limited|Ltd|plc|PLC|Inc|Corporation|Corp|Co|&\s*Co\.?|and\s+(?:Others?|Another|Ors)|for\s+[A-Za-z\s]+|of\s+[A-Za-z\s]+))*)\s*$",
            # R v / Regina v pattern
            r"(R|Regina|Rex)\s+v\.?\s+([A-Z][A-Za-z'\-\.\s]+?)\s*$",
            # Secretary of State pattern
            r"(Secretary\s+of\s+State\s+for\s+[A-Za-z\s]+)\s+v\.?\s+([A-Z][A-Za-z'\-\.]+(?:\s+(?:and\s+(?:Others?|Another|Ors)))?)\s*$",
            # In re / Re pattern
            r"((?:In\s+)?[Rr]e\s+[A-Z][A-Za-z'\-\.\s]+?)\s*$",
        ]
        
        for pattern in case_patterns:
            match = re.search(pattern, prefix)
            if match:
                case_name = match.group(0).strip()
                # Clean up any trailing whitespace
                case_name = re.sub(r'\s+', ' ', case_name).strip()
                if len(case_name) > 5:
                    logger.debug(f"Extracted case name '{case_name}' from prefix")
                    return case_name
    
    # Also check if case name is embedded in the citation text itself
    # e.g., "Caparo Industries plc v Dickman [1990] 2 AC 605"
    v_pattern = r"^([A-Z][A-Za-z'\-\.]+(?:\s+[A-Za-z'\-\.&]+)*)\s+v\.?\s+([A-Z][A-Za-z'\-\.]+(?:\s+[A-Za-z'\-\.&]+)*)\s*\["
    v_match = re.match(v_pattern, citation)
    if v_match:
        case_name = f"{v_match.group(1)} v {v_match.group(2)}"
        logger.debug(f"Extracted case name '{case_name}' from citation text")
        return case_name
    
    return None


def find_citations_in_text(text: str) -> List[Dict[str, Any]]:
    """
    Find all UK legal citations in text with their positions and context.
    
    Enhanced to also extract case names when present before citations.
    
    Returns list of dicts with citation info, position, and case name.
    """
    citations = []
    seen = set()
    
    for pattern in CITATION_PATTERNS:
        for match in re.finditer(pattern, text, re.IGNORECASE):
            full_citation = match.group(0).strip()
            
            # Normalize the citation for deduplication
            normalized = re.sub(r'\s+', ' ', full_citation)
            if normalized in seen:
                continue
            seen.add(normalized)
            
            # Try to extract case name from text before citation
            case_name = None
            prefix_start = max(0, match.start() - 150)
            prefix = text[prefix_start:match.start()]
            
            for name_pattern in CASE_NAME_PATTERNS:
                name_match = re.search(name_pattern, prefix)
                if name_match:
                    case_name = name_match.group(0).strip()
                    break
            
            citations.append({
                "raw": full_citation,
                "case_name": case_name,
                "full_reference": f"{case_name} {full_citation}" if case_name else full_citation,
                "start": match.start(),
                "end": match.end()
            })
    
    # Sort by position
    citations.sort(key=lambda x: x["start"])
    return citations


def find_claim_indicator(text: str) -> Optional[Dict[str, Any]]:
    """
    Find legal claim indicator phrases in text.
    
    Returns info about the claim type and position if found.
    """
    for pattern in CLAIM_INDICATORS:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            return {
                "indicator": match.group(0),
                "start": match.start(),
                "end": match.end(),
                "type": "claim_indicator"
            }
    return None


def split_into_paragraphs(text: str) -> List[Dict[str, Any]]:
    """
    Split text into numbered paragraphs (common in legal documents).
    
    Handles: "9. ", "(9) ", "[9] ", "a. ", "(a) ", etc.
    """
    paragraphs = []
    lines = text.split('\n')
    current_para = {"number": None, "text": "", "start_line": 0}
    
    for i, line in enumerate(lines):
        # Check if this line starts a new numbered paragraph
        is_new_para = False
        para_num = None
        
        for pattern in PARAGRAPH_PATTERNS:
            match = re.match(pattern, line)
            if match:
                is_new_para = True
                para_num = match.group(1)
                line = re.sub(pattern, '', line)  # Remove the number
                break
        
        if is_new_para:
            # Save previous paragraph if it has content
            if current_para["text"].strip():
                paragraphs.append(current_para)
            
            current_para = {
                "number": para_num,
                "text": line.strip(),
                "start_line": i
            }
        else:
            # Continue current paragraph
            current_para["text"] += " " + line.strip()
    
    # Don't forget the last paragraph
    if current_para["text"].strip():
        paragraphs.append(current_para)
    
    return paragraphs


def extract_proposition_from_context(text: str, citation_start: int, citation_end: int) -> Dict[str, Any]:
    """
    Extract the legal proposition from context around a citation.
    
    Uses multiple strategies (in priority order):
    1. Em-dash pattern: "Case [Citation] — proposition" (highest confidence)
    2. Claim indicators: "held that", "establishes", etc.
    3. spaCy dependency parsing (if available)
    4. Sentence boundary detection (fallback)
    """
    result = {
        "proposition": "",
        "extraction_method": "unknown",
        "confidence": 0.0
    }
    
    # Get surrounding context
    context_before = text[max(0, citation_start - 500):citation_start]
    context_after = text[citation_end:min(len(text), citation_end + 500)]
    
    # Strategy 1: Em-dash pattern (highest confidence)
    # Pattern: "Case Name [Citation] — proposition about the case."
    em_dash_match = re.search(r'[—–-]\s*(.+?)(?:\.|$)', context_after)
    if em_dash_match:
        proposition = em_dash_match.group(1).strip()
        if len(proposition) > 10:
            result["proposition"] = proposition
            result["extraction_method"] = "em_dash"
            result["confidence"] = 0.9
            return result
    
    # Strategy 2: Look for claim indicators before the citation
    for pattern in CLAIM_INDICATORS:
        match = re.search(pattern + r'\s*(.+?)(?=' + re.escape(text[citation_start:citation_end]) + r')', 
                         context_before, re.IGNORECASE | re.DOTALL)
        if match:
            # Get everything from the indicator to the citation
            indicator_text = context_before[match.start():]
            proposition = indicator_text.strip()
            if len(proposition) > 15:
                result["proposition"] = proposition
                result["extraction_method"] = "claim_indicator"
                result["confidence"] = 0.85
                return result
    
    # Strategy 3: Look for claim indicators after the citation
    for pattern in CLAIM_INDICATORS:
        match = re.search(pattern + r'\s*(.+?\.)', context_after, re.IGNORECASE)
        if match:
            proposition = match.group(0).strip()
            if len(proposition) > 15:
                result["proposition"] = proposition
                result["extraction_method"] = "claim_indicator_after"
                result["confidence"] = 0.8
                return result
    
    # Strategy 4: Try spaCy dependency parsing (if available)
    spacy_result = extract_with_spacy(text, citation_start, citation_end)
    if spacy_result and spacy_result.get("proposition") and len(spacy_result["proposition"]) > 20:
        return spacy_result
    
    # Strategy 5: Full sentence extraction (final fallback)
    # Find sentence start (look for previous sentence end)
    sentence_ends = ['.', '!', '?', '\n\n', ';\n']
    best_start = 0
    for end_char in sentence_ends:
        pos = context_before.rfind(end_char)
        if pos > best_start:
            best_start = pos + len(end_char)
    
    # Find sentence end (after citation)
    best_end = len(context_after)
    for end_char in ['.', '!', '?']:
        pos = context_after.find(end_char)
        if pos >= 0 and pos < best_end:
            best_end = pos + 1
    
    # Construct the sentence
    sentence = context_before[best_start:].strip() + " " + text[citation_start:citation_end] + " " + context_after[:best_end].strip()
    sentence = re.sub(r'\s+', ' ', sentence).strip()
    
    if len(sentence) > 20:
        result["proposition"] = sentence
        result["extraction_method"] = "sentence_boundary"
        result["confidence"] = 0.5
    
    return result


def extract_with_spacy(text: str, citation_start: int, citation_end: int) -> Optional[Dict[str, Any]]:
    """
    Use spaCy dependency parsing to extract propositions.
    
    Identifies:
    - Main verb and its arguments (subject, object)
    - Clausal complements (what is being claimed)
    - Named entities (case names, courts)
    
    Returns None if spaCy is not available.
    """
    if not HAS_SPACY or NLP is None:
        return None
    
    try:
        # Get context around citation
        context_start = max(0, citation_start - 300)
        context_end = min(len(text), citation_end + 300)
        context = text[context_start:context_end]
        
        doc = NLP(context)
        
        # Find the sentence containing the citation
        citation_relative_start = citation_start - context_start
        citation_relative_end = citation_end - context_start
        
        target_sent = None
        for sent in doc.sents:
            if sent.start_char <= citation_relative_start <= sent.end_char:
                target_sent = sent
                break
            if sent.start_char <= citation_relative_end <= sent.end_char:
                target_sent = sent
                break
        
        if not target_sent:
            return None
        
        # Extract the main proposition using dependency parsing
        proposition_parts = []
        main_verb = None
        
        for token in target_sent:
            # Find the main verb (ROOT)
            if token.dep_ == "ROOT" and token.pos_ == "VERB":
                main_verb = token
                break
        
        if main_verb:
            # Get the subject
            for child in main_verb.children:
                if child.dep_ in ("nsubj", "nsubjpass"):
                    # Get the full subject phrase
                    subject_text = " ".join([t.text for t in child.subtree])
                    proposition_parts.append(("subject", subject_text))
            
            # Get clausal complements (what was held/established)
            for child in main_verb.children:
                if child.dep_ in ("ccomp", "xcomp", "dobj", "attr"):
                    complement_text = " ".join([t.text for t in child.subtree])
                    proposition_parts.append(("complement", complement_text))
        
        # If we found meaningful structure, construct the proposition
        if proposition_parts:
            return {
                "proposition": target_sent.text.strip(),
                "extraction_method": "spacy_dependency",
                "confidence": 0.75,
                "structure": proposition_parts,
                "main_verb": main_verb.text if main_verb else None
            }
        
        # Fallback to just the sentence
        return {
            "proposition": target_sent.text.strip(),
            "extraction_method": "spacy_sentence",
            "confidence": 0.65,
            "structure": [],
            "main_verb": None
        }
        
    except Exception as e:
        logger.warning(f"spaCy extraction failed: {e}")
        return None


def extract_sentence_around_position(text: str, start: int, end: int, context_chars: int = 500) -> str:
    """
    Extract the sentence or context around a citation.
    
    Args:
        text: Full document text
        start: Start position of citation
        end: End position of citation
        context_chars: How many chars of context to include
        
    Returns:
        The extracted proposition/sentence
    """
    # Find sentence boundaries
    # Look backwards for sentence start
    search_start = max(0, start - context_chars)
    prefix = text[search_start:start]
    
    # Find last sentence terminator
    sentence_ends = ['.', '!', '?', '\n\n']
    last_end = -1
    for terminator in sentence_ends:
        pos = prefix.rfind(terminator)
        if pos > last_end:
            last_end = pos
    
    if last_end >= 0:
        sentence_start = search_start + last_end + 1
    else:
        sentence_start = search_start
    
    # Look forward for sentence end (after citation)
    search_end = min(len(text), end + context_chars)
    suffix = text[end:search_end]
    
    first_end = len(suffix)
    for terminator in ['.', '!', '?']:
        pos = suffix.find(terminator)
        if pos >= 0 and pos < first_end:
            first_end = pos + 1
    
    sentence_end = end + first_end
    
    # Extract and clean
    result = text[sentence_start:sentence_end].strip()
    # Remove excessive whitespace
    result = re.sub(r'\s+', ' ', result)
    
    return result


def extract_claims_from_text(text: str) -> List[Dict[str, Any]]:
    """
    Extract legal propositions paired with their citations.
    
    Enhanced extraction using multiple strategies:
    1. Numbered paragraph detection (legal docs often use "9.", "(a)", etc.)
    2. Em-dash patterns (Case [Citation] — proposition)
    3. Claim indicator phrases (held that, establishes, confirms)
    4. Sentence boundary analysis
    
    Returns claims with confidence scores and extraction method info.
    """
    citations = find_citations_in_text(text)
    
    if not citations:
        logger.info("No citations found in text")
        return []
    
    logger.info(f"Found {len(citations)} citations, extracting propositions...")
    
    # First, try paragraph-based extraction for structured documents
    paragraphs = split_into_paragraphs(text)
    para_text_map = {}  # Map paragraph text to paragraph info
    
    for para in paragraphs:
        para_text_map[para["text"]] = para
    
    claims = []
    seen_propositions = set()
    
    for citation in citations:
        # Use the enhanced proposition extractor
        extraction = extract_proposition_from_context(
            text, 
            citation["start"], 
            citation["end"]
        )
        
        proposition = extraction["proposition"]
        extraction_method = extraction["extraction_method"]
        confidence = extraction["confidence"]
        
        # If extraction failed, fall back to simple sentence extraction
        if not proposition or len(proposition) < 15:
            proposition = extract_sentence_around_position(
                text, 
                citation["start"], 
                citation["end"]
            )
            extraction_method = "sentence_fallback"
            confidence = 0.4
        
        # Additional cleanup - remove excessive whitespace
        proposition = re.sub(r'\s+', ' ', proposition).strip()
        
        # Skip very short or very long propositions
        if len(proposition) < 15:
            logger.warning(f"Skipping too-short proposition for citation {citation['raw']}")
            continue
        if len(proposition) > 2000:
            # Truncate very long propositions
            proposition = proposition[:2000] + "..."
        
        # Deduplication - merge citations for same proposition
        prop_normalized = proposition.lower().strip()
        if prop_normalized in seen_propositions:
            for claim in claims:
                if claim["text"].lower().strip() == prop_normalized:
                    existing_raws = [c["raw"] for c in claim["citations"]]
                    if citation["raw"] not in existing_raws:
                        claim["citations"].append({
                            "raw": citation["raw"],
                            "case_name": citation.get("case_name"),
                            "full_reference": citation.get("full_reference")
                        })
                    break
            continue
        
        seen_propositions.add(prop_normalized)
        
        claims.append({
            "text": proposition,
            "citations": [{
                "raw": citation["raw"],
                "case_name": citation.get("case_name"),
                "full_reference": citation.get("full_reference")
            }],
            "extraction_method": extraction_method,
            "confidence": confidence
        })
        
        logger.debug(f"Extracted claim: '{proposition[:100]}...' via {extraction_method} (conf: {confidence})")
    
    logger.info(f"Extracted {len(claims)} unique claims from text")
    return claims


# ===== Web Search Function =====

def web_search_case(citation_text: str) -> Dict[str, Any]:
    """
    Search the web for a legal case citation as a fallback.
    
    Uses DuckDuckGo HTML search (no API key needed).
    
    Args:
        citation_text: The citation to search for
        
    Returns:
        Dict with search results or empty if not found
    """
    import urllib.request
    import urllib.parse
    from html.parser import HTMLParser
    
    class DuckDuckGoParser(HTMLParser):
        def __init__(self):
            super().__init__()
            self.results = []
            self.current_result = {}
            self.in_result = False
            self.in_title = False
            self.in_snippet = False
            
        def handle_starttag(self, tag, attrs):
            attrs_dict = dict(attrs)
            if tag == 'a' and 'result__a' in attrs_dict.get('class', ''):
                self.in_result = True
                self.in_title = True
                self.current_result = {'url': attrs_dict.get('href', '')}
            elif tag == 'a' and 'result__snippet' in attrs_dict.get('class', ''):
                self.in_snippet = True
                
        def handle_endtag(self, tag):
            if tag == 'a' and self.in_title:
                self.in_title = False
            elif tag == 'a' and self.in_snippet:
                self.in_snippet = False
                if self.current_result:
                    self.results.append(self.current_result)
                    self.current_result = {}
                self.in_result = False
                
        def handle_data(self, data):
            if self.in_title:
                self.current_result['title'] = self.current_result.get('title', '') + data.strip()
            elif self.in_snippet:
                self.current_result['snippet'] = self.current_result.get('snippet', '') + data.strip()
    
    try:
        # Build search query - focus on legal case databases
        query = f"{citation_text} UK law case"
        encoded_query = urllib.parse.quote(query)
        url = f"https://html.duckduckgo.com/html/?q={encoded_query}"
        
        # Make request
        req = urllib.request.Request(url, headers={
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        })
        
        with urllib.request.urlopen(req, timeout=10) as response:
            html = response.read().decode('utf-8')
        
        # Parse results
        parser = DuckDuckGoParser()
        parser.feed(html)
        
        # Filter for legal/case related results
        legal_domains = ['bailii.org', 'legislation.gov.uk', 'caselaw.nationalarchives.gov.uk', 
                        'judiciary.uk', 'supremecourt.uk', 'lawreports', 'westlaw', 'lexis',
                        'swarb.co.uk', 'e-lawresources', 'law.cornell.edu']
        
        relevant_results = []
        for result in parser.results[:10]:
            url = result.get('url', '')
            # Check if it's from a legal source
            is_legal = any(domain in url.lower() for domain in legal_domains)
            if is_legal or 'case' in result.get('title', '').lower() or 'judgment' in result.get('snippet', '').lower():
                relevant_results.append(result)
        
        if relevant_results:
            return {
                "search_status": "found",
                "results": relevant_results[:3],  # Top 3 results
                "source_type": "web_search",
                "verification_level": "secondary"
            }
        
        return {
            "search_status": "not_found",
            "results": [],
            "source_type": "not_found",
            "verification_level": "unverified"
        }
        
    except Exception as e:
        logger.error(f"Web search error for {citation_text}: {e}")
        return {
            "search_status": "error",
            "error": str(e),
            "results": [],
            "source_type": "not_found",
            "verification_level": "unverified"
        }


# ===== Helper Functions =====

def run_audit_pipeline(job_id: str, claims: List[ClaimInput], web_search_enabled: bool = False) -> dict:
    """
    Run the full audit pipeline for given claims.
    
    Args:
        job_id: Unique job identifier
        claims: List of claims to audit
        web_search_enabled: Whether to use web search as fallback
        
    Returns:
        Audit results dictionary with hallucination classification
    """
    results = []
    
    # Ensure cache directories exist
    ensure_cache_dir(job_id, "resolutions")
    ensure_cache_dir(job_id, "authorities")
    ensure_cache_dir(job_id, "verifications")
    
    for claim in claims:
        claim_result = {
            "claim_id": claim.claim_id,
            "text": claim.text,
            "citations": []
        }
        
        for i, citation in enumerate(claim.citations):
            citation_id = f"cit_{i + 1}"
            citation_text = citation.raw.strip()
            
            if not citation_text:
                continue
            
            # Extract case name from the citation object or from context
            case_name = getattr(citation, 'case_name', None)
            if not case_name:
                # Try to extract from the claim text
                case_name = extract_case_name_from_text(claim.text, citation_text)
            
            logger.info(f"Processing citation: {citation_text}")
            if case_name:
                logger.info(f"  Case name: {case_name}")
            
            # Step 1: Resolve citation to URL (FCL / BAILII)
            resolution = resolve_citation_to_urls(
                citation_text=citation_text,
                case_name=case_name,
                job_id=job_id
            )
            
            outcome = "unverifiable"
            hallucination_type = "1"  # Default: Fabricated Case & Citation
            hallucination_type_name = "Fabricated Case & Citation"
            resolution_status = resolution.get("resolution_status", "unresolved")
            authority_url = None
            authority_title = None
            case_retrieved = False
            confidence = None
            notes = "Citation could not be resolved"
            source_type = "not_found"
            verification_level = "unverified"
            matching_paragraphs = []  # Will contain matching judgment paragraphs
            
            # Get case name from resolution if we didn't have one
            resolved_case_name = resolution.get("case_name") or case_name
            
            # If resolution found candidates, get title from first candidate
            if resolution.get("candidate_urls"):
                first_candidate = resolution["candidate_urls"][0]
                if first_candidate.get("title"):
                    authority_title = first_candidate["title"]
                    if not resolved_case_name:
                        resolved_case_name = first_candidate["title"]
            
            # Determine source type from URL
            def get_source_type(url: str) -> str:
                if not url:
                    return "not_found"
                url_lower = url.lower()
                if "caselaw.nationalarchives.gov.uk" in url_lower or "nationalarchives" in url_lower:
                    return "fcl"
                elif "bailii.org" in url_lower:
                    return "bailii"
                return "web_search"
            
            if resolution_status == "resolved" and resolution["candidate_urls"]:
                candidate = resolution["candidate_urls"][0]
                url = candidate["url"]
                authority_url = url
                source_type = get_source_type(url)
                verification_level = "primary"
                
                try:
                    # Step 2: Fetch the authority
                    fetch_result = fetch_and_cache_url(
                        job_id=job_id,
                        url=url
                    )
                    
                    if fetch_result.get("fetch_status") == "success" or fetch_result.get("fetch_status") == "cached":
                        cache_path = Path(fetch_result["cache_path"])
                        
                        # Step 3: Parse the authority
                        parsed = parse_authority_document(
                            job_id=job_id,
                            cache_path=cache_path,
                            url=url
                        )
                        
                        authority_title = parsed.get("title", "Unknown Case")
                        
                        if parsed.get("full_text"):
                            case_retrieved = True
                            
                            # Step 4: Verify claim against authority
                            verification = verify_claim_against_authority(
                                claim_text=claim.text,
                                citation_text=citation_text,
                                parsed_authority=parsed,
                                resolution_status=resolution_status
                            )
                            
                            outcome = verification.get("verification_outcome", "needs_review")
                            hallucination_type = verification.get("hallucination_type")
                            hallucination_type_name = verification.get("hallucination_type_name")
                            authority_url = verification.get("authority_url", url)
                            authority_title = verification.get("authority_title", authority_title)
                            case_retrieved = verification.get("case_retrieved", True)
                            confidence = verification.get("evidence", {}).get("confidence")
                            notes = verification.get("notes", "")
                            # Extract matching paragraphs for user review
                            matching_paragraphs = verification.get("evidence", {}).get("matching_paragraphs", [])
                
                except Exception as e:
                    logger.error(f"Error processing citation {citation_text}: {e}")
                    outcome = "unverifiable"
                    hallucination_type = "1"
                    hallucination_type_name = "Fabricated Case & Citation"
                    notes = f"Error during verification: {str(e)}"
            
            # Web search fallback if enabled and case not found
            elif web_search_enabled and not case_retrieved:
                logger.info(f"Trying web search fallback for: {citation_text}")
                web_result = web_search_case(citation_text)
                
                if web_result.get("search_status") == "found" and web_result.get("results"):
                    top_result = web_result["results"][0]
                    authority_url = top_result.get("url", "")
                    authority_title = top_result.get("title", "Web Search Result")
                    source_type = "web_search"
                    verification_level = "secondary"
                    case_retrieved = True  # Found via web search
                    outcome = "needs_review"
                    hallucination_type = None  # Not a hallucination - found online
                    hallucination_type_name = None
                    notes = f"Found via web search (secondary source). Snippet: {top_result.get('snippet', '')[:200]}"
                    confidence = 0.5  # Lower confidence for web results
                    
                    logger.info(f"Web search found: {authority_title} at {authority_url}")
                else:
                    notes = "Not found in FCL/BAILII. Web search also found no results."
                    source_type = "not_found"
            
            citation_result = {
                "citation_id": citation_id,
                "citation_text": citation_text,
                "case_name": resolved_case_name,  # Case name extracted or from search
                "outcome": outcome,
                "hallucination_type": hallucination_type,
                "hallucination_type_name": hallucination_type_name,
                "authority_url": authority_url,
                "authority_title": authority_title or resolved_case_name,  # Use case name if no title
                "case_retrieved": case_retrieved,
                "confidence": confidence,
                "notes": notes,
                "source_type": source_type,
                "verification_level": verification_level,
                "matching_paragraphs": matching_paragraphs  # Paragraphs in judgment that match the claim
            }
            
            claim_result["citations"].append(citation_result)
            
            # Log each citation result
            logger.info(f"Citation: {citation_text}")
            logger.info(f"  - Outcome: {outcome}")
            logger.info(f"  - Case Retrieved: {case_retrieved}")
            logger.info(f"  - URL: {authority_url}")
            logger.info(f"  - Notes: {notes}")
        
        results.append(claim_result)
    
    # Save full results to log file for review
    log_path = Path("reports") / f"{job_id}_audit_log.json"
    log_path.parent.mkdir(parents=True, exist_ok=True)
    safe_write_json(log_path, {
        "job_id": job_id,
        "audited_at": datetime.now(timezone.utc).isoformat(),
        "results": results
    })
    logger.info(f"Audit log saved to: {log_path}")
    
    return results


# ===== API Routes =====

@app.post("/api/audit", response_model=AuditResponse)
async def run_audit(request: AuditRequest):
    """
    Run a hallucination audit on the provided claims.
    
    Args:
        request: Audit request with title and claims
        
    Returns:
        Audit results with verification outcomes
    """
    if not request.claims:
        raise HTTPException(status_code=400, detail="No claims provided")
    
    # Generate unique job ID
    job_id = f"api_{uuid.uuid4().hex[:8]}"
    
    try:
        # Run the audit pipeline
        claim_results = run_audit_pipeline(job_id, request.claims, request.web_search_enabled)
        
        # Calculate summary
        total_claims = len(claim_results)
        total_citations = sum(len(c["citations"]) for c in claim_results)
        
        # Build response
        response = AuditResponse(
            audit_metadata=AuditMetadata(
                job_id=job_id,
                title=request.title or "Citation Audit",
                audited_at=datetime.now(timezone.utc).isoformat()
            ),
            claims=[
                ClaimResult(
                    claim_id=c["claim_id"],
                    text=c["text"],
                    citations=[
                        CitationResult(
                            citation_id=cit["citation_id"],
                            citation_text=cit["citation_text"],
                            outcome=cit["outcome"],
                            hallucination_type=cit.get("hallucination_type"),
                            hallucination_type_name=cit.get("hallucination_type_name"),
                            authority_url=cit.get("authority_url"),
                            authority_title=cit.get("authority_title"),
                            case_retrieved=cit.get("case_retrieved", False),
                            confidence=cit.get("confidence"),
                            notes=cit.get("notes"),
                            source_type=cit.get("source_type"),
                            verification_level=cit.get("verification_level")
                        )
                        for cit in c["citations"]
                    ]
                )
                for c in claim_results
            ],
            summary=AuditSummary(
                total_claims=total_claims,
                total_citations=total_citations
            )
        )
        
        return response
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Audit failed: {str(e)}")


@app.get("/api/reports/{job_id}")
async def get_report(job_id: str):
    """
    Retrieve a previously generated report.
    
    Args:
        job_id: Job identifier
        
    Returns:
        Report JSON if found
    """
    report_path = Path("reports") / f"{job_id}.json"
    
    if not report_path.exists():
        raise HTTPException(status_code=404, detail="Report not found")
    
    return safe_read_json(report_path)


# ===== CLIENT-SIDE PRIVACY MODE ENDPOINTS =====
# These endpoints only accept citation strings, not document content
# For use when document parsing happens client-side in the browser

class CitationWithContext(BaseModel):
    """A citation with optional context like case name"""
    citation: str
    case_name: Optional[str] = None
    claim_text: Optional[str] = None  # The legal proposition for verification context


class CitationResolveRequest(BaseModel):
    """Request to resolve citations - no document content needed"""
    citations: List[str] = []  # Simple list for backward compatibility
    citations_with_context: Optional[List[CitationWithContext]] = None  # New: with case names
    web_search_enabled: bool = False


class ResolvedCitation(BaseModel):
    """Citation with resolved judgment data"""
    citation: str
    case_name: Optional[str] = None
    source_type: str  # 'fcl', 'bailii', 'web_search', 'not_found'
    url: Optional[str] = None
    title: Optional[str] = None
    paragraphs: List[Dict[str, Any]] = []
    error: Optional[str] = None


class CitationResolveResponse(BaseModel):
    """Response with resolved citations and judgment paragraphs"""
    resolved: List[ResolvedCitation]
    summary: Dict[str, int]


def resolve_single_citation(ctx: dict, web_search_enabled: bool) -> ResolvedCitation:
    """
    Resolve a single citation. Used for parallel processing.

    Args:
        ctx: Dict with citation, case_name, claim_text
        web_search_enabled: Whether to use web search fallback

    Returns:
        ResolvedCitation object
    """
    citation_text = ctx["citation"]
    if not citation_text:
        return ResolvedCitation(
            citation="",
            source_type="not_found",
            error="Empty citation"
        )

    case_name = ctx.get("case_name") or extract_case_name_from_citation(citation_text)

    try:
        # Resolve citation to URL
        resolution = resolve_citation_to_urls(
            citation_text=citation_text,
            case_name=case_name,
            enable_web_search=web_search_enabled
        )

        # Check if resolution was successful
        if resolution and resolution.get("resolution_status") == "resolved" and resolution.get("candidate_urls"):
            candidate = resolution["candidate_urls"][0]
            url = candidate["url"]
            source_type = candidate.get("source", "unknown")
            title = resolution.get("case_name") or case_name

            # Fetch and parse the judgment
            paragraphs = []
            try:
                job_id = f"resolve_{uuid.uuid4().hex[:8]}"
                ensure_cache_dir(job_id)

                # Fetch the document
                fetch_result = fetch_and_cache_url(
                    job_id=job_id,
                    url=url
                )

                if fetch_result and fetch_result.get("cache_path"):
                    # Parse it
                    parsed = parse_authority_document(
                        fetch_result["cache_path"],
                        url=url
                    )

                    if parsed and parsed.get("paragraphs"):
                        # Return simplified paragraphs
                        paragraphs = [
                            {
                                "para_num": p.get("para_num", str(i+1)),
                                "text": p.get("text", "")[:500],  # Limit text length
                                "speaker": p.get("speaker")
                            }
                            for i, p in enumerate(parsed["paragraphs"])
                            if p.get("text") and len(p.get("text", "")) > 20
                        ][:100]  # Limit to 100 paragraphs

            except Exception as e:
                logger.error(f"Error fetching/parsing {url}: {e}")

            return ResolvedCitation(
                citation=citation_text,
                case_name=case_name or title,
                source_type=source_type,
                url=url,
                title=title,
                paragraphs=paragraphs
            )

        else:
            return ResolvedCitation(
                citation=citation_text,
                case_name=case_name,
                source_type="not_found",
                error="Citation could not be resolved to a URL"
            )

    except Exception as e:
        logger.error(f"Error resolving {citation_text}: {e}")
        return ResolvedCitation(
            citation=citation_text,
            case_name=case_name,
            source_type="not_found",
            error=str(e)
        )


@app.post("/api/resolve-citations", response_model=CitationResolveResponse)
async def resolve_citations_only(request: CitationResolveRequest):
    """
    Resolve citations to URLs and fetch judgment paragraphs.

    OPTIMIZED: Uses parallel processing for faster resolution.

    This endpoint accepts citation strings with optional case names.
    For use with client-side document parsing where the browser handles
    text extraction and citation extraction locally.

    Privacy: Only citation strings and case names are processed.
    No document content is sent to this endpoint.
    """
    import asyncio
    from concurrent.futures import ThreadPoolExecutor

    # Build unified list of citations with context
    citations_to_process = []

    # Handle new format with case names
    if request.citations_with_context:
        for ctx in request.citations_with_context:
            citations_to_process.append({
                "citation": ctx.citation.strip(),
                "case_name": ctx.case_name,
                "claim_text": ctx.claim_text
            })

    # Handle legacy format (just strings) - backward compatible
    for citation_text in request.citations:
        citation_text = citation_text.strip()
        if citation_text:
            # Check if not already in the list
            existing = [c["citation"] for c in citations_to_process]
            if citation_text not in existing:
                citations_to_process.append({
                    "citation": citation_text,
                    "case_name": extract_case_name_from_citation(citation_text),
                    "claim_text": None
                })

    num_citations = len(citations_to_process)
    logger.info(f"Resolving {num_citations} citations in parallel (client-side mode)")

    if num_citations == 0:
        return CitationResolveResponse(
            resolved=[],
            summary={"total": 0, "found": 0, "not_found": 0}
        )

    # Use ThreadPoolExecutor for parallel I/O-bound operations
    # BAILII and FCL have no explicit rate limits, so we can use more workers
    # 10 concurrent requests is reasonable for a single user session
    max_workers = min(num_citations, 10)

    loop = asyncio.get_event_loop()
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        # Submit all citation resolutions in parallel
        futures = [
            loop.run_in_executor(
                executor,
                resolve_single_citation,
                ctx,
                request.web_search_enabled
            )
            for ctx in citations_to_process
        ]

        # Wait for all to complete
        resolved_citations = await asyncio.gather(*futures)

    # Calculate summary
    found = sum(1 for r in resolved_citations if r.source_type != "not_found")
    not_found = len(resolved_citations) - found

    summary = {"total": num_citations, "found": found, "not_found": not_found}

    logger.info(f"Resolution complete: {found} found, {not_found} not found")

    return CitationResolveResponse(
        resolved=list(resolved_citations),
        summary=summary
    )


@app.post("/api/extract")
async def extract_claims(file: UploadFile = File(...)):
    """
    Extract legal propositions and citations from an uploaded document.
    
    Accepts PDF, TXT, HTML, or Word documents.
    Returns structured claims with their supporting citations.
    
    Args:
        file: The uploaded document
        
    Returns:
        Extracted claims with citations
    """
    # Validate file type
    filename = file.filename or "document"
    extension = filename.lower().split('.')[-1] if '.' in filename else ''
    
    valid_extensions = ['pdf', 'txt', 'html', 'htm', 'doc', 'docx']
    if extension not in valid_extensions:
        raise HTTPException(
            status_code=400, 
            detail=f"Unsupported file type. Please upload: {', '.join(valid_extensions)}"
        )
    
    # Check for required libraries
    if extension == 'pdf' and not HAS_PYMUPDF:
        raise HTTPException(
            status_code=500,
            detail="PDF support not available. Please install PyMuPDF: pip install PyMuPDF"
        )
    
    try:
        # Save uploaded file to temp location
        with tempfile.NamedTemporaryFile(delete=False, suffix=f".{extension}") as tmp:
            content = await file.read()
            tmp.write(content)
            tmp_path = Path(tmp.name)
        
        # Determine file type for extraction
        if extension == 'pdf':
            file_type = 'pdf'
        elif extension in ['html', 'htm']:
            file_type = 'html'
        elif extension in ['doc', 'docx']:
            file_type = 'docx'
        else:
            file_type = 'txt'
        
        # Check for required libraries
        if file_type == 'docx' and not HAS_DOCX:
            raise HTTPException(
                status_code=500,
                detail="DOCX support not available. Please install python-docx: pip install python-docx"
            )
        
        # Extract text
        try:
            text = extract_text_from_file(tmp_path, file_type)
        finally:
            # Clean up temp file
            tmp_path.unlink(missing_ok=True)
        
        if not text or len(text.strip()) < 50:
            raise HTTPException(
                status_code=400,
                detail="Could not extract text from document or document is too short"
            )
        
        # Debug: Log extracted text (first 2000 chars)
        logger.info(f"Extracted text length: {len(text)}")
        logger.info(f"First 2000 chars of extracted text: {text[:2000]}")
        
        # Extract claims with citations
        claims = extract_claims_from_text(text)
        
        logger.info(f"Found {len(claims)} claims")
        
        if not claims:
            # Return more helpful error with sample of text
            sample = text[:500].replace('\n', ' ')
            raise HTTPException(
                status_code=400,
                detail=f"No legal citations found in the document. Text sample: {sample}..."
            )
        
        # Generate suggested title from filename
        suggested_title = filename.rsplit('.', 1)[0].replace('_', ' ').replace('-', ' ').title()
        
        return {
            "success": True,
            "filename": filename,
            "suggested_title": suggested_title,
            "claims": claims,
            "stats": {
                "total_claims": len(claims),
                "total_citations": sum(len(c["citations"]) for c in claims),
                "text_length": len(text)
            }
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to process document: {str(e)}"
        )


# ===== LEE CATEGORY DEFINITIONS =====

LEE_CATEGORIES = {
    "1": {
        "name": "Fabricated Case & Citation",
        "keywords": [
            "fabricated", "fictitious", "invented", "non-existent", "made up",
            "does not exist", "no such case", "cannot be found", "hallucinated",
            "invented case", "fake case", "bogus citation"
        ]
    },
    "2": {
        "name": "Wrong Case Name, Right Citation",
        "keywords": [
            "wrong name", "misnamed", "incorrect name", "different case name",
            "wrong party", "incorrect parties", "name mismatch", "case name error"
        ]
    },
    "3": {
        "name": "Right Case Name, Wrong Citation",
        "keywords": [
            "wrong citation", "incorrect citation", "citation error",
            "wrong reference", "incorrect year", "wrong court", "wrong number"
        ]
    },
    "4": {
        "name": "Conflated Authorities",
        "keywords": [
            "conflated", "merged", "combined", "mixed up", "confused with",
            "amalgamated", "blended", "multiple cases", "different authorities"
        ]
    },
    "5": {
        "name": "Correct Law, Invented Authority",
        "keywords": [
            "correct principle", "right law", "valid legal point", 
            "principle is correct", "law is right", "but no authority",
            "invented authority", "fabricated source"
        ]
    },
    "6": {
        "name": "Real Case, Misstated Facts/Ratio",
        "keywords": [
            "misstated", "misrepresented", "distorted", "inaccurate",
            "mischaracterised", "mischaracterized", "wrong ratio",
            "incorrect holding", "did not hold", "misquoted", "wrong facts"
        ]
    },
    "7": {
        "name": "Misleading Secondary Paraphrase",
        "keywords": [
            "secondary source", "textbook", "commentary", "headnote",
            "paraphrase", "summarised incorrectly", "summary error",
            "misled by", "derived from"
        ]
    },
    "8": {
        "name": "False Citations Citing False",
        "keywords": [
            "chain of", "citing false", "cascade", "series of fabricated",
            "multiple false", "one fabricated citing another"
        ]
    }
}

# Keywords that indicate general hallucination/AI discussion
# Tuple format: (keyword, require_word_boundary)
HALLUCINATION_KEYWORDS = [
    ("hallucination", False),
    ("hallucinated", False),
    ("hallucinating", False),
    ("artificial intelligence", False),
    ("ChatGPT", True),  # Exact match
    ("LLM", True),  # Short - needs word boundary
    ("large language model", False),
    ("generative AI", False),
    ("machine learning", False),
    ("fabricated citation", False),
    ("fictitious case", False),
    ("fictitious citation", False),
    ("invented case", False),
    ("non-existent case", False),
    ("non-existent citation", False),
    ("made up case", False),
    ("bogus citation", False),
    ("fake citation", False),
    ("false authority", False),
    ("chatbot", False),
    ("language model", False),
    ("AI-generated", False),
    ("AI generated", False),
    ("AI tool", False),
    ("AI system", False),
]


def extract_paragraphs_with_numbers(text: str) -> List[Tuple[str, str]]:
    """
    Extract paragraphs with their paragraph numbers from judgment text.

    Returns list of (paragraph_number, paragraph_text) tuples.
    """
    # Pattern to match paragraph numbers like [1], [2], etc.
    pattern = r'\[(\d+)\]\s*([^\[]+?)(?=\[\d+\]|$)'
    matches = re.findall(pattern, text, re.DOTALL)

    if matches:
        return [(num, text.strip()) for num, text in matches]
    
    # Fallback: split by common paragraph markers
    paragraphs = []
    lines = text.split('\n\n')
    for i, para in enumerate(lines, 1):
        if len(para.strip()) > 50:  # Only include substantial paragraphs
            paragraphs.append((str(i), para.strip()))
    
    return paragraphs


def find_hallucination_commentary(text: str, case_name: str = "", citation: str = "") -> List[Dict[str, Any]]:
    """
    Search text for judicial commentary on AI hallucinations.
    
    Returns list of excerpts with Lee category mappings.
    """
    excerpts = []
    paragraphs = extract_paragraphs_with_numbers(text)
    
    for para_num, para_text in paragraphs:
        para_lower = para_text.lower()
        
        # Check if paragraph mentions hallucination-related topics
        matched_keywords = []
        for keyword_tuple in HALLUCINATION_KEYWORDS:
            keyword, require_boundary = keyword_tuple
            keyword_lower = keyword.lower()
            
            if require_boundary:
                # Use word boundary regex for short keywords
                pattern = r'\b' + re.escape(keyword_lower) + r'\b'
                if re.search(pattern, para_lower, re.IGNORECASE):
                    matched_keywords.append(keyword)
            else:
                # Simple substring match for longer phrases
                if keyword_lower in para_lower:
                    matched_keywords.append(keyword)
        
        if not matched_keywords:
            continue
        
        # Determine Lee category based on content
        lee_category = "general"
        lee_category_name = "General AI/Hallucination Commentary"
        max_matches = 0
        
        for cat_id, cat_info in LEE_CATEGORIES.items():
            matches = 0
            for kw in cat_info["keywords"]:
                if kw.lower() in para_lower:
                    matches += 1
            
            if matches > max_matches:
                max_matches = matches
                lee_category = cat_id
                lee_category_name = cat_info["name"]
        
        # Clean up the excerpt
        excerpt_text = para_text.strip()
        # Truncate if too long
        if len(excerpt_text) > 800:
            # #region agent log
            with open(r'c:\Users\James\Desktop\hullucintion detector\.cursor\debug.log', 'a') as f:
                import json; f.write(json.dumps({"location":"server.py:find_commentary","message":"Truncating excerpt","data":{"originalLen":len(excerpt_text),"truncatedAt":800,"endsWithPeriod":excerpt_text[799]=='.' if len(excerpt_text)>799 else False},"timestamp":int(__import__('time').time()*1000),"sessionId":"debug-session","hypothesisId":"H2B"})+'\n')
            # #endregion
            excerpt_text = excerpt_text[:800] + "..."
        
        excerpts.append({
            "text": excerpt_text,
            "paragraph": para_num,
            "lee_category": lee_category,
            "lee_category_name": lee_category_name,
            "keywords_matched": matched_keywords
        })
    
    return excerpts


@app.post("/api/commentary")
async def search_commentary(
    file: Optional[UploadFile] = File(None),
    citations: Optional[str] = Form(None)
):
    """
    Search cases for judicial commentary on AI hallucinations.
    
    Accepts either:
    - A case document file (PDF, TXT, HTML, XML)
    - Citation references to fetch and search
    - Both
    
    Returns excerpts mapped to Lee categories.
    """
    # #region agent log
    with open(r'c:\Users\James\Desktop\hullucintion detector\.cursor\debug.log', 'a') as f:
        import json; f.write(json.dumps({"location":"server.py:search_commentary","message":"Endpoint called","data":{"hasFile":file is not None,"fileName":file.filename if file else None,"hasCitations":citations is not None,"citationsLen":len(citations) if citations else 0},"timestamp":int(__import__('time').time()*1000),"sessionId":"debug-session","hypothesisId":"H1D"})+'\n')
    # #endregion
    results = []
    total_cases_searched = 0
    total_excerpts = 0
    lee_category_counts: Dict[str, int] = {}
    
    # Process uploaded file if provided
    if file and file.filename:
        # #region agent log
        with open(r'c:\Users\James\Desktop\hullucintion detector\.cursor\debug.log', 'a') as f:
            import json; f.write(json.dumps({"location":"server.py:search_commentary","message":"Processing uploaded file","data":{"filename":file.filename},"timestamp":int(__import__('time').time()*1000),"sessionId":"debug-session","hypothesisId":"H1D"})+'\n')
        # #endregion
        total_cases_searched += 1
        filename = file.filename
        extension = filename.lower().split('.')[-1] if '.' in filename else 'txt'
        
        try:
            # Save to temp
            with tempfile.NamedTemporaryFile(delete=False, suffix=f".{extension}") as tmp:
                content = await file.read()
                tmp.write(content)
                tmp_path = Path(tmp.name)
            
            # Extract text
            if extension == 'pdf':
                file_type = 'pdf'
            elif extension in ['html', 'htm', 'xml']:
                file_type = 'html'
            elif extension in ['doc', 'docx']:
                file_type = 'docx'
            else:
                file_type = 'txt'
            
            try:
                text = extract_text_from_file(tmp_path, file_type)
            finally:
                tmp_path.unlink(missing_ok=True)
            
            # Search for commentary
            excerpts = find_hallucination_commentary(text, case_name=filename)
            
            if excerpts:
                # Try to extract case name from content
                case_name = filename.rsplit('.', 1)[0]
                case_citation = ""
                
                # Look for citation in the text
                found_citations = find_citations_in_text(text[:2000])
                if found_citations:
                    case_citation = found_citations[0]["raw"]
                
                results.append({
                    "case_name": case_name,
                    "citation": case_citation,
                    "url": "",
                    "excerpts": excerpts
                })
                
                total_excerpts += len(excerpts)
                for exc in excerpts:
                    cat = exc["lee_category"]
                    lee_category_counts[cat] = lee_category_counts.get(cat, 0) + 1
        
        except Exception as e:
            print(f"Error processing uploaded file: {e}")
    
    # Process citations if provided
    if citations and citations.strip():
        citation_list = [c.strip() for c in citations.split('\n') if c.strip()]
        
        for citation_text in citation_list:
            total_cases_searched += 1
            
            try:
                # Try to resolve the citation
                job_id = f"commentary_{uuid.uuid4().hex[:8]}"
                resolution = resolve_citation_to_urls(
                    citation_text=citation_text,
                    job_id=job_id
                )
                
                if resolution["resolution_status"] == "resolved" and resolution["candidate_urls"]:
                    candidate = resolution["candidate_urls"][0]
                    url = candidate["url"]
                    
                    # Fetch the case
                    fetch_result = fetch_and_cache_url(
                        job_id=job_id,
                        url=url
                    )
                    
                    if fetch_result.get("fetch_status") in ["success", "cached"]:
                        cache_path = Path(fetch_result["cache_path"])
                        
                        # Read and search the content
                        with open(cache_path, 'r', encoding='utf-8', errors='ignore') as f:
                            text = f.read()
                        
                        # For XML, try to extract text properly
                        if cache_path.suffix == '.xml':
                            try:
                                soup = BeautifulSoup(text, 'lxml-xml')
                                text = soup.get_text(separator="\n")
                            except:
                                pass
                        
                        excerpts = find_hallucination_commentary(text)
                        
                        if excerpts:
                            # Try to get case name from parsed content
                            parsed = parse_authority_document(
                                job_id=job_id,
                                cache_path=cache_path,
                                url=url
                            )
                            case_name = parsed.get("title", citation_text)
                            
                            results.append({
                                "case_name": case_name,
                                "citation": citation_text,
                                "url": url,
                                "excerpts": excerpts
                            })
                            
                            total_excerpts += len(excerpts)
                            for exc in excerpts:
                                cat = exc["lee_category"]
                                lee_category_counts[cat] = lee_category_counts.get(cat, 0) + 1
            
            except Exception as e:
                print(f"Error processing citation {citation_text}: {e}")
                continue
    
    if total_cases_searched == 0:
        raise HTTPException(
            status_code=400,
            detail="Please provide case citations or upload a case document"
        )
    
    return {
        "search_metadata": {
            "searched_at": datetime.now(timezone.utc).isoformat(),
            "cases_searched": total_cases_searched,
            "excerpts_found": total_excerpts
        },
        "results": results,
        "lee_category_counts": lee_category_counts
    }


# ===== Static File Serving (MUST be after all API routes) =====
# These catch-all routes serve the frontend SPA and must come LAST

@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy", "name": "Matthew Lee Bot API", "version": "0.2.0"}


if STATIC_DIR.exists():
    @app.get("/")
    async def serve_frontend():
        """Serve the frontend index.html."""
        index_path = STATIC_DIR / "index.html"
        if index_path.exists():
            # Never cache index.html to ensure users get fresh JS bundles
            return FileResponse(index_path, headers={"Cache-Control": "no-cache, no-store, must-revalidate"})
        return {"name": "Matthew Lee Bot API", "status": "online", "version": "0.2.0"}

    @app.get("/{path:path}")
    async def serve_static(path: str):
        """Serve static files or fall back to index.html for SPA routing."""
        # Skip API routes - they should have been handled above
        if path.startswith("api/") or path == "health":
            raise HTTPException(status_code=404, detail="Not found")

        file_path = STATIC_DIR / path
        if file_path.exists() and file_path.is_file():
            # Add cache-control headers based on file type
            # Assets with hash in filename can be cached longer
            if "/assets/" in path and any(c.isdigit() for c in path):
                # Hashed assets - cache for 1 year
                headers = {"Cache-Control": "public, max-age=31536000, immutable"}
            else:
                # Other files - no cache to ensure fresh content
                headers = {"Cache-Control": "no-cache, no-store, must-revalidate"}
            return FileResponse(file_path, headers=headers)

        # Fall back to index.html for SPA routing
        index_path = STATIC_DIR / "index.html"
        if index_path.exists():
            # index.html should never be cached
            return FileResponse(index_path, headers={"Cache-Control": "no-cache, no-store, must-revalidate"})

        raise HTTPException(status_code=404, detail="Not found")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
