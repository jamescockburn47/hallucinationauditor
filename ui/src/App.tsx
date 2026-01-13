import { useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { 
  Scale, 
  FileSearch, 
  CheckCircle2, 
  XCircle, 
  AlertCircle, 
  Plus, 
  Trash2, 
  Loader2,
  BookOpen,
  Sparkles,
  Upload,
  FileText,
  X,
  MessageSquareQuote,
  Gavel,
  Search,
  Shield,
  ShieldCheck
} from 'lucide-react'
import './App.css'

// Client-side processing for privacy mode
import { extractTextFromFile, getFileTypeDescription } from './lib/documentParser'
import { extractCitations, extractPropositions, formatCitation } from './lib/citationExtractor'
import { findMatchingParagraphs, calculateConfidence, determineOutcome } from './lib/verifier'
import { resolveCitations } from './lib/api'

interface Citation {
  raw: string
}

interface Claim {
  id: string
  text: string
  citations: Citation[]
}

interface MatchingParagraph {
  para_num: string
  text: string
  similarity_score: number
  match_type: 'keyword' | 'partial'
}

interface VerificationResult {
  claim_id: string
  text: string
  citations: {
    citation_id: string
    citation_text: string
    case_name?: string | null
    outcome: 'supported' | 'contradicted' | 'unclear' | 'unverifiable' | 'needs_review'
    hallucination_type?: string | null
    hallucination_type_name?: string | null
    authority_url?: string | null
    authority_title?: string | null
    case_retrieved?: boolean
    confidence?: number | null
    notes?: string | null
    source_type?: 'fcl' | 'bailii' | 'web_search' | 'not_found'
    verification_level?: 'primary' | 'secondary' | 'unverified'
    matching_paragraphs?: MatchingParagraph[]
  }[]
}

interface AuditReport {
  audit_metadata: {
    job_id: string
    title: string
    audited_at: string
  }
  claims: VerificationResult[]
  summary: {
    total_claims: number
    total_citations: number
  }
}

interface CommentaryResult {
  case_name: string
  citation: string
  url: string
  excerpts: {
    text: string
    paragraph: string
    lee_category: string
    lee_category_name: string
    keywords_matched: string[]
  }[]
}

interface CommentaryReport {
  search_metadata: {
    searched_at: string
    cases_searched: number
    excerpts_found: number
  }
  results: CommentaryResult[]
  lee_category_counts: Record<string, number>
}

// Lee category definitions
const LEE_CATEGORIES = {
  '1': { name: 'Fabricated Case & Citation', color: '#f87171' },
  '2': { name: 'Wrong Case Name, Right Citation', color: '#fb923c' },
  '3': { name: 'Right Case Name, Wrong Citation', color: '#fbbf24' },
  '4': { name: 'Conflated Authorities', color: '#a3e635' },
  '5': { name: 'Correct Law, Invented Authority', color: '#4ade80' },
  '6': { name: 'Real Case, Misstated Facts/Ratio', color: '#22d3d8' },
  '7': { name: 'Misleading Secondary Paraphrase', color: '#60a5fa' },
  '8': { name: 'False Citations Citing False', color: '#a78bfa' },
  'general': { name: 'General AI/Hallucination Commentary', color: '#8b9bb4' }
}

type TabType = 'audit' | 'commentary'

function App() {
  const [activeTab, setActiveTab] = useState<TabType>('audit')
  const [claims, setClaims] = useState<Claim[]>([
    { id: '1', text: '', citations: [{ raw: '' }] }
  ])
  const [jobTitle, setJobTitle] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isExtracting, setIsExtracting] = useState(false)
  const [report, setReport] = useState<AuditReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [uploadedFile, setUploadedFile] = useState<File | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Web search consent
  const [webSearchEnabled, setWebSearchEnabled] = useState(false)
  
  // Privacy mode - process documents client-side
  const [privacyMode, setPrivacyMode] = useState(true) // Default to privacy mode ON
  const [processingStatus, setProcessingStatus] = useState<string>('')
  
  // How it works section
  const [showHowItWorks, setShowHowItWorks] = useState(false)

  // Commentary state
  const [commentaryCitations, setCommentaryCitations] = useState<string>('')
  const [commentaryFile, setCommentaryFile] = useState<File | null>(null)
  const [isSearchingCommentary, setIsSearchingCommentary] = useState(false)
  const [commentaryReport, setCommentaryReport] = useState<CommentaryReport | null>(null)
  const commentaryFileRef = useRef<HTMLInputElement>(null)
  const [commentaryDragActive, setCommentaryDragActive] = useState(false)

  const addClaim = () => {
    setClaims([
      ...claims,
      { id: String(Date.now()), text: '', citations: [{ raw: '' }] }
    ])
  }

  const removeClaim = (index: number) => {
    if (claims.length > 1) {
      setClaims(claims.filter((_, i) => i !== index))
    }
  }

  const updateClaimText = (index: number, text: string) => {
    const newClaims = [...claims]
    newClaims[index].text = text
    setClaims(newClaims)
  }

  const updateCitation = (claimIndex: number, citationIndex: number, value: string) => {
    const newClaims = [...claims]
    newClaims[claimIndex].citations[citationIndex].raw = value
    setClaims(newClaims)
  }

  const addCitation = (claimIndex: number) => {
    const newClaims = [...claims]
    newClaims[claimIndex].citations.push({ raw: '' })
    setClaims(newClaims)
  }

  const removeCitation = (claimIndex: number, citationIndex: number) => {
    const newClaims = [...claims]
    if (newClaims[claimIndex].citations.length > 1) {
      newClaims[claimIndex].citations = newClaims[claimIndex].citations.filter(
        (_, i) => i !== citationIndex
      )
      setClaims(newClaims)
    }
  }

  // File upload handlers
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true)
    } else if (e.type === 'dragleave') {
      setDragActive(false)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0])
    }
  }

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0])
    }
  }

  const handleFile = (file: File) => {
    const validTypes = ['text/plain', 'application/pdf', 'text/html', 'application/msword', 
                        'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
    
    if (!validTypes.includes(file.type) && !file.name.endsWith('.txt') && !file.name.endsWith('.pdf')) {
      setError('Please upload a PDF, TXT, HTML, or Word document')
      return
    }
    
    setUploadedFile(file)
    setError(null)
  }

  const clearFile = () => {
    setUploadedFile(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const extractFromDocument = async () => {
    if (!uploadedFile) return

    setIsExtracting(true)
    setError(null)
    setProcessingStatus('')

    try {
      if (privacyMode) {
        // CLIENT-SIDE PROCESSING - Document never leaves browser
        setProcessingStatus('Parsing document locally...')
        
        // Extract text from the file in the browser
        const text = await extractTextFromFile(uploadedFile)
        
        if (!text || text.trim().length < 50) {
          throw new Error('Could not extract text from document')
        }
        
        setProcessingStatus('Extracting citations...')
        
        // Extract propositions with their citations
        const propositions = extractPropositions(text)
        
        if (propositions.length > 0) {
          const extractedClaims: Claim[] = propositions.map((prop, i) => ({
            id: String(Date.now() + i),
            text: prop.proposition,
            citations: prop.citations.map(cit => ({ 
              raw: formatCitation(cit)
            }))
          }))
          
          setClaims(extractedClaims)
          setJobTitle(uploadedFile.name.replace(/\.[^/.]+$/, ''))
          setProcessingStatus(`Found ${extractedClaims.length} claims with citations`)
        } else {
          // Try to find just citations without propositions
          const citations = extractCitations(text)
          if (citations.length > 0) {
            // Create claims from citations without specific propositions
            const extractedClaims: Claim[] = citations.slice(0, 20).map((cit, i) => ({
              id: String(Date.now() + i),
              text: `Verify citation: ${formatCitation(cit)}`,
              citations: [{ raw: formatCitation(cit) }]
            }))
            setClaims(extractedClaims)
            setJobTitle(uploadedFile.name.replace(/\.[^/.]+$/, ''))
            setProcessingStatus(`Found ${citations.length} citations (no propositions extracted)`)
          } else {
            setError('No legal citations found in the document')
          }
        }
      } else {
        // SERVER-SIDE PROCESSING - Legacy mode
        setProcessingStatus('Uploading to server...')
        
        const formData = new FormData()
        formData.append('file', uploadedFile)

        const response = await fetch('http://localhost:8000/api/extract', {
          method: 'POST',
          body: formData
        })

        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.detail || 'Extraction failed')
        }

        const data = await response.json()
        
        if (data.claims && data.claims.length > 0) {
          const extractedClaims: Claim[] = data.claims.map((c: any, i: number) => ({
            id: String(Date.now() + i),
            text: c.text,
            citations: c.citations.map((cit: any) => ({ raw: cit.raw }))
          }))
          
          setClaims(extractedClaims)
          setJobTitle(data.suggested_title || uploadedFile.name.replace(/\.[^/.]+$/, ''))
        } else {
          setError('No legal propositions with citations found in the document')
        }
      }
    } catch (err: any) {
      console.error('Extraction error:', err)
      setError(err.message || 'Failed to extract claims from document')
    } finally {
      setIsExtracting(false)
      setProcessingStatus('')
    }
  }

  const runAudit = async () => {
    setIsLoading(true)
    setError(null)
    setReport(null)
    setProcessingStatus('')

    const validClaims = claims.filter(c => c.text.trim() && c.citations.some(cit => cit.raw.trim()))
    
    if (validClaims.length === 0) {
      setError('Please add at least one claim with a citation')
      setIsLoading(false)
      return
    }

    try {
      if (privacyMode) {
        // CLIENT-SIDE AUDIT MODE
        // Only send citation strings to server for resolution
        // Verification happens locally in the browser
        
        // Collect all unique citations
        const allCitations = new Set<string>()
        validClaims.forEach(claim => {
          claim.citations.forEach(cit => {
            if (cit.raw.trim()) {
              allCitations.add(cit.raw.trim())
            }
          })
        })
        
        setProcessingStatus(`Resolving ${allCitations.size} citation(s)...`)
        
        // Send only citation strings to server for resolution
        const resolveResponse = await resolveCitations(
          Array.from(allCitations),
          webSearchEnabled
        )
        
        // Build a map of resolved citations
        const resolvedMap = new Map<string, typeof resolveResponse.resolved[0]>()
        resolveResponse.resolved.forEach(r => {
          resolvedMap.set(r.citation.toLowerCase(), r)
        })
        
        setProcessingStatus('Verifying claims locally...')
        
        // Now verify each claim locally
        const auditResults: VerificationResult[] = []
        
        for (const claim of validClaims) {
          const citationResults: VerificationResult['citations'] = []
          
          for (const citation of claim.citations) {
            const citText = citation.raw.trim()
            if (!citText) continue
            
            const resolved = resolvedMap.get(citText.toLowerCase())
            
            if (resolved && resolved.source_type !== 'not_found') {
              // Case found - verify locally
              const matches = findMatchingParagraphs(
                claim.text,
                resolved.paragraphs.map(p => ({
                  para_num: p.para_num,
                  text: p.text,
                  speaker: p.speaker || undefined
                }))
              )
              
              const { score, level } = calculateConfidence(matches, true)
              const outcome = determineOutcome(
                true,
                matches,
                resolved.source_type as 'fcl' | 'bailii' | 'web_search' | 'not_found'
              )
              
              citationResults.push({
                citation_id: citText,
                citation_text: citText,
                case_name: resolved.case_name,
                outcome,
                source_type: resolved.source_type as 'fcl' | 'bailii' | 'web_search' | 'not_found',
                verification_level: resolved.source_type === 'web_search' ? 'secondary' : 'primary',
                authority_url: resolved.url,
                authority_title: resolved.title,
                case_retrieved: true,
                confidence: Math.round(score * 100),
                notes: matches.length > 0 
                  ? `Found ${matches.length} matching paragraph(s)` 
                  : 'No strong keyword matches found',
                matching_paragraphs: matches.map(m => ({
                  para_num: m.para_num,
                  text: m.text.slice(0, 300) + (m.text.length > 300 ? '...' : ''),
                  similarity_score: m.similarity_score,
                  match_type: m.match_type
                }))
              })
            } else {
              // Case not found
              citationResults.push({
                citation_id: citText,
                citation_text: citText,
                case_name: resolved?.case_name || null,
                outcome: 'unverifiable',
                source_type: 'not_found',
                verification_level: 'unverified',
                case_retrieved: false,
                confidence: 0,
                notes: resolved?.error || 'Citation could not be resolved',
                matching_paragraphs: []
              })
            }
          }
          
          auditResults.push({
            claim_id: claim.id,
            text: claim.text,
            citations: citationResults
          })
        }
        
        // Build the report
        const jobId = `client_${Date.now().toString(16)}`
        const totalCitations = auditResults.reduce((sum, r) => sum + r.citations.length, 0)
        
        setReport({
          audit_metadata: {
            job_id: jobId,
            title: jobTitle || 'Citation Audit (Privacy Mode)',
            audited_at: new Date().toISOString()
          },
          claims: auditResults,
          summary: {
            total_claims: auditResults.length,
            total_citations: totalCitations
          }
        })
        
        setProcessingStatus('')
        
      } else {
        // LEGACY SERVER-SIDE MODE
        setProcessingStatus('Processing on server...')
        
        const response = await fetch('http://localhost:8000/api/audit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: jobTitle || 'Citation Audit',
            claims: validClaims.map((c, i) => ({
              claim_id: `claim_${i + 1}`,
              text: c.text,
              citations: c.citations.filter(cit => cit.raw.trim())
            })),
            web_search_enabled: webSearchEnabled
          })
        })

        if (!response.ok) {
          throw new Error('Audit failed')
        }

        const data = await response.json()
        setReport(data)
      }
    } catch (err) {
      console.error('Audit error:', err)
      setError('Failed to run audit. Make sure the backend is running.')
    } finally {
      setIsLoading(false)
      setProcessingStatus('')
    }
  }

  // Commentary functions
  const handleCommentaryFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setCommentaryFile(e.target.files[0])
      setError(null)
    }
  }

  const handleCommentaryFileDirect = (file: File) => {
    setCommentaryFile(file)
    setError(null)
  }

  const handleCommentaryDrag = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setCommentaryDragActive(true)
    } else if (e.type === 'dragleave') {
      setCommentaryDragActive(false)
    }
  }

  const handleCommentaryDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setCommentaryDragActive(false)
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleCommentaryFileDirect(e.dataTransfer.files[0])
    }
  }

  const clearCommentaryFile = () => {
    setCommentaryFile(null)
    if (commentaryFileRef.current) {
      commentaryFileRef.current.value = ''
    }
  }

  const searchCommentary = async () => {
    setIsSearchingCommentary(true)
    setError(null)
    setCommentaryReport(null)

    try {
      const formData = new FormData()
      
      if (commentaryFile) {
        formData.append('file', commentaryFile)
      }
      
      if (commentaryCitations.trim()) {
        formData.append('citations', commentaryCitations.trim())
      }

      if (!commentaryFile && !commentaryCitations.trim()) {
        setError('Please provide case citations or upload a document')
        setIsSearchingCommentary(false)
        return
      }

      const response = await fetch('http://localhost:8000/api/commentary', {
        method: 'POST',
        body: formData
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.detail || 'Search failed')
      }

      const data = await response.json()
      setCommentaryReport(data)
    } catch (err: any) {
      setError(err.message || 'Failed to search for commentary')
    } finally {
      setIsSearchingCommentary(false)
    }
  }

  const getOutcomeIcon = (outcome: string, caseRetrieved?: boolean) => {
    switch (outcome) {
      case 'supported':
        return <CheckCircle2 className="outcome-icon supported" />
      case 'contradicted':
        return <XCircle className="outcome-icon contradicted" />
      case 'needs_review':
        return <AlertCircle className="outcome-icon needs-review" />
      case 'unverifiable':
        return <XCircle className="outcome-icon unverifiable" />
      default:
        return <AlertCircle className="outcome-icon unclear" />
    }
  }

  const getOutcomeLabel = (outcome: string, caseRetrieved?: boolean) => {
    switch (outcome) {
      case 'supported':
        return 'Verified ✓'
      case 'contradicted':
        return 'Possible Error'
      case 'needs_review':
        return caseRetrieved ? 'Case Found - Review Needed' : 'Review Needed'
      case 'unclear':
        return 'Unclear'
      case 'unverifiable':
        return caseRetrieved ? 'Could Not Verify' : 'Case Not Found'
      default:
        return 'Unknown'
    }
  }

  return (
    <div className="app">
      <div className="grain-overlay" />
      
      {/* Header */}
      <header className="header">
        <motion.div 
          className="logo-container"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <div className="logo-icon">
            <Scale size={28} />
          </div>
          <div className="logo-text">
            <h1>Matthew Lee Bot</h1>
            <span className="tagline">Legal Citation Auditor</span>
          </div>
        </motion.div>

        {/* Tab Navigation */}
        <nav className="tab-nav">
          <button 
            className={`tab-btn ${activeTab === 'audit' ? 'active' : ''}`}
            onClick={() => setActiveTab('audit')}
          >
            <FileSearch size={18} />
            Citation Audit
          </button>
          <button 
            className={`tab-btn ${activeTab === 'commentary' ? 'active' : ''}`}
            onClick={() => setActiveTab('commentary')}
          >
            <Gavel size={18} />
            Judicial Commentary
          </button>
          <button 
            className={`tab-btn info-btn ${showHowItWorks ? 'active' : ''}`}
            onClick={() => setShowHowItWorks(!showHowItWorks)}
          >
            <AlertCircle size={18} />
            How It Works
          </button>
        </nav>
      </header>

      {/* How It Works Section */}
      <AnimatePresence>
        {showHowItWorks && (
          <motion.section
            className="how-it-works-section"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3 }}
          >
            <div className="how-it-works-content">
              <button 
                className="close-btn"
                onClick={() => setShowHowItWorks(false)}
                aria-label="Close"
              >
                <X size={20} />
              </button>
              
              <h2>How It Works</h2>
              
              <div className="info-grid">
                <div className="info-card featured">
                  <h3>⚖️ About Matthew Lee's Hallucination Taxonomy</h3>
                  <p>
                    This tool is inspired by the work of <strong>Matthew Lee</strong>, a barrister (England & Wales) 
                    who has extensively documented and categorised AI-generated citation errors in legal proceedings.
                  </p>
                  <p>
                    Through his blog <a href="https://naturalandartificiallaw.com/" target="_blank" rel="noopener noreferrer">Natural and Artificial Intelligence in Law</a>, 
                    Matthew has tracked over <strong>30 UK cases</strong> involving hallucinated citations — cases where AI tools 
                    have generated fabricated authorities, incorrect citations, or misstated legal principles.
                  </p>
                  <p>
                    His <strong>8 Hallucination Categories</strong> provide a systematic framework for classifying these errors:
                  </p>
                  <ol className="lee-categories-list">
                    <li><strong>Type 1:</strong> Fabricated Case & Citation — completely invented</li>
                    <li><strong>Type 2:</strong> Wrong Case Name, Right Citation</li>
                    <li><strong>Type 3:</strong> Right Case Name, Wrong Citation</li>
                    <li><strong>Type 4:</strong> Conflated Authorities — merging multiple cases</li>
                    <li><strong>Type 5:</strong> Correct Law, Invented Authority</li>
                    <li><strong>Type 6:</strong> Real Case, Misstated Facts/Ratio</li>
                    <li><strong>Type 7:</strong> Misleading Secondary Paraphrase</li>
                    <li><strong>Type 8:</strong> False Citations Citing False</li>
                  </ol>
                  <p className="blog-link">
                    <a href="https://naturalandartificiallaw.com/" target="_blank" rel="noopener noreferrer">
                      Visit Matthew Lee's Blog →
                    </a>
                  </p>
                </div>

                <div className="info-card">
                  <h3>🔍 What This Tool Does</h3>
                  <p>
                    This tool extracts legal citations from uploaded documents and attempts to retrieve 
                    the referenced cases from <strong>Find Case Law</strong> (National Archives) and <strong>BAILII</strong>. 
                    It then uses keyword matching to identify which paragraphs of the judgment may relate 
                    to the propositions in your document.
                  </p>
                  <p>
                    <strong>The goal:</strong> Save you time by automatically retrieving cases for manual verification, 
                    giving you an indication of whether citations exist and where the relevant passages might be found.
                  </p>
                </div>

                <div className="info-card privacy-card">
                  <h3>🔒 Privacy Options</h3>
                  <p>
                    Choose how you want to use this tool based on your privacy requirements:
                  </p>
                  <div className="privacy-options-grid">
                    <div className="privacy-option option-local">
                      <div className="option-header">
                        <span className="option-badge best">⭐ MOST PRIVATE</span>
                        <h4>🖥️ Fully Local</h4>
                      </div>
                      <p className="option-description">Download and run entirely on your machine. Nothing leaves your computer except citation lookups to FCL/BAILII.</p>
                      <ul>
                        <li>✓ All document processing on your machine</li>
                        <li>✓ No data sent to any server</li>
                        <li>✓ Works offline (except case lookups)</li>
                        <li>✓ Suitable for privileged documents</li>
                      </ul>
                      <a 
                        href="https://github.com/jamescockburn47/hallucinationauditor/releases" 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="option-btn primary"
                      >
                        Download Desktop App →
                      </a>
                    </div>

                    <div className="privacy-option option-hybrid">
                      <div className="option-header">
                        <span className="option-badge good">✓ PRIVATE</span>
                        <h4>🔀 Hybrid Mode</h4>
                      </div>
                      <p className="option-description">Document parsing happens in your browser. Only extracted citation strings are sent to the server for resolution.</p>
                      <ul>
                        <li>✓ Documents parsed locally in browser</li>
                        <li>✓ Only citations sent to server</li>
                        <li>✓ No document storage</li>
                        <li>✓ Suitable for most documents</li>
                      </ul>
                      <button 
                        className="option-btn secondary"
                        onClick={() => {
                          setPrivacyMode(true)
                          setActiveTab('audit')
                        }}
                      >
                        Use Hybrid Mode →
                      </button>
                    </div>

                    <div className="privacy-option option-online">
                      <div className="option-header">
                        <span className="option-badge caution">⚠ NOT PRIVATE</span>
                        <h4>☁️ Fully Online</h4>
                      </div>
                      <p className="option-description">Document is uploaded and processed on the server. Faster but not suitable for confidential materials.</p>
                      <ul>
                        <li>⚠ Document sent to server</li>
                        <li>✓ Documents NOT stored</li>
                        <li>✓ Faster processing</li>
                        <li className="warning-item">⛔ Do NOT use for privileged documents</li>
                      </ul>
                      <button 
                        className="option-btn tertiary"
                        onClick={() => {
                          setPrivacyMode(false)
                          setActiveTab('audit')
                        }}
                      >
                        Use Online Mode →
                      </button>
                    </div>
                  </div>
                  <p className="warning-note">
                    <AlertCircle size={14} />
                    <strong>Web Search Fallback:</strong> If enabled, citation text may be sent to external search engines. 
                    This is opt-in and requires your explicit consent.
                  </p>
                </div>

                <div className="info-card">
                  <h3>⚠️ Important Caveats</h3>
                  <ul>
                    <li>
                      <strong>Proof of Concept:</strong> This tool was created as a proof of concept in a single evening 
                      using AI-assisted coding.
                    </li>
                    <li>
                      <strong>Not AI Analysis:</strong> While the code was written with AI assistance, the verification 
                      process itself does <em>not</em> use AI — it relies on pattern matching and keyword analysis.
                    </li>
                    <li>
                      <strong>Always Verify:</strong> All sources and results should be independently checked. 
                      This tool provides <em>indications</em>, not definitive answers.
                    </li>
                    <li>
                      <strong>Do Not Rely Upon:</strong> This tool should not be relied upon for legal advice, 
                      court submissions, or any professional legal work without thorough manual verification.
                    </li>
                  </ul>
                </div>

                <div className="info-card">
                  <h3>📋 The Verification Process</h3>
                  <ol>
                    <li><strong>Extract Citations:</strong> Regex patterns identify legal citations in your document</li>
                    <li><strong>Resolve to URLs:</strong> Citations are matched to Find Case Law or BAILII URLs</li>
                    <li><strong>Fetch Judgments:</strong> Full judgment text is retrieved from official sources</li>
                    <li><strong>Parse Content:</strong> Judgments are parsed into paragraphs</li>
                    <li><strong>Keyword Match:</strong> Your proposition is compared against judgment paragraphs</li>
                    <li><strong>Display Results:</strong> Matching paragraphs are shown with direct links</li>
                  </ol>
                </div>
              </div>

              <div className="info-card get-started-card">
                <h3>🚀 Quick Start</h3>
                <p className="get-started-intro">Choose the option that best fits your privacy requirements:</p>
                <div className="get-started-options three-col">
                  <div className="get-started-option highlight">
                    <span className="quick-badge best">⭐ Recommended</span>
                    <h4>🖥️ Desktop App</h4>
                    <p>Maximum privacy. Download and run locally on Windows.</p>
                    <a 
                      href="https://github.com/jamescockburn47/hallucinationauditor/releases" 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="get-started-btn primary"
                    >
                      Download .exe →
                    </a>
                  </div>
                  <div className="get-started-option">
                    <span className="quick-badge good">✓ Private</span>
                    <h4>🔀 Hybrid Mode</h4>
                    <p>Documents parsed in browser. Only citations sent to server.</p>
                    <button 
                      className="get-started-btn secondary"
                      onClick={() => {
                        setPrivacyMode(true)
                        setActiveTab('audit')
                      }}
                    >
                      Start (Hybrid) →
                    </button>
                  </div>
                  <div className="get-started-option">
                    <span className="quick-badge caution">⚠ Not Private</span>
                    <h4>☁️ Online Mode</h4>
                    <p>Fastest. Do NOT use for privileged documents.</p>
                    <button 
                      className="get-started-btn tertiary"
                      onClick={() => {
                        setPrivacyMode(false)
                        setActiveTab('audit')
                      }}
                    >
                      Start (Online) →
                    </button>
                  </div>
                </div>
              </div>

              <div className="disclaimer-box">
                <strong>Disclaimer:</strong> This is an experimental tool for educational and research purposes only. 
                It is not a substitute for professional legal research. The developers accept no liability for any 
                errors, omissions, or consequences arising from its use. Always verify citations manually before 
                relying on them in any legal context.
              </div>
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      <main className="main-content">
        {/* ===== AUDIT TAB ===== */}
        {activeTab === 'audit' && (
          <>
            {/* Document Upload Section */}
            <motion.section 
              className="upload-section"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.1 }}
            >
              <div className="section-header">
                <Upload size={20} />
                <h2>Upload Document</h2>
              </div>
              
              <p className="section-description">
                Upload a legal document and we'll automatically extract propositions and their supporting citations.
              </p>

              <input
                ref={fileInputRef}
                id="audit-file-input"
                type="file"
                accept=".pdf,.txt,.html,.doc,.docx"
                onChange={handleFileInput}
                style={{ display: 'none' }}
              />
              
              {uploadedFile ? (
                <div className="upload-zone has-file">
                  <div className="uploaded-file">
                    <FileText size={24} />
                    <div className="file-info">
                      <span className="file-name">{uploadedFile.name}</span>
                      <span className="file-size">{(uploadedFile.size / 1024).toFixed(1)} KB</span>
                    </div>
                    <button className="btn-icon small" onClick={() => clearFile()}>
                      <X size={16} />
                    </button>
                  </div>
                </div>
              ) : (
                <div 
                  className={`upload-zone ${dragActive ? 'drag-active' : ''}`}
                  onDragEnter={handleDrag}
                  onDragLeave={handleDrag}
                  onDragOver={handleDrag}
                  onDrop={handleDrop}
                >
                  <div className="upload-prompt">
                    <Upload size={32} />
                    <span>Drag and drop your document here</span>
                    <span className="file-types">PDF, TXT, HTML, Word</span>
                    <button 
                      type="button"
                      className="btn-secondary browse-btn"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <FileSearch size={18} />
                      Browse Files
                    </button>
                  </div>
                </div>
              )}

              {uploadedFile && (
                <button 
                  className="btn-primary extract-btn"
                  onClick={extractFromDocument}
                  disabled={isExtracting}
                >
                  {isExtracting ? (
                    <>
                      <Loader2 size={18} className="spinning" /> Extracting...
                    </>
                  ) : (
                    <>
                      <FileSearch size={18} /> Extract Claims
                    </>
                  )}
                </button>
              )}
            </motion.section>

            {/* Divider */}
            <div className="section-divider">
              <span>or enter claims manually</span>
            </div>

            {/* Input Section */}
            <motion.section 
              className="input-section"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.2 }}
            >
              <div className="section-header">
                <FileSearch size={20} />
                <h2>Claims to Audit</h2>
              </div>

              <div className="job-title-input">
                <label htmlFor="jobTitle">Audit Title (optional)</label>
                <input
                  id="jobTitle"
                  type="text"
                  placeholder="e.g., Contract Review Citations"
                  value={jobTitle}
                  onChange={(e) => setJobTitle(e.target.value)}
                />
              </div>

              <div className="claims-container">
                <AnimatePresence>
                  {claims.map((claim, claimIndex) => (
                    <motion.div
                      key={claim.id}
                      className="claim-card"
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 20 }}
                      transition={{ duration: 0.3 }}
                    >
                      <div className="claim-header">
                        <span className="claim-number">Claim {claimIndex + 1}</span>
                        {claims.length > 1 && (
                          <button 
                            className="btn-icon danger"
                            onClick={() => removeClaim(claimIndex)}
                            title="Remove claim"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>

                      <div className="claim-body">
                        <div className="input-group">
                          <label>Legal Proposition</label>
                          <textarea
                            placeholder="e.g., The court held that informed consent is required before medical procedures"
                            value={claim.text}
                            onChange={(e) => updateClaimText(claimIndex, e.target.value)}
                            rows={3}
                          />
                        </div>

                        <div className="citations-section">
                          <label>Citations</label>
                          {claim.citations.map((citation, citIndex) => (
                            <div key={citIndex} className="citation-row">
                              <input
                                type="text"
                                placeholder="e.g., Montgomery v Lanarkshire [2015] UKSC 11"
                                value={citation.raw}
                                onChange={(e) => updateCitation(claimIndex, citIndex, e.target.value)}
                              />
                              {claim.citations.length > 1 && (
                                <button 
                                  className="btn-icon small danger"
                                  onClick={() => removeCitation(claimIndex, citIndex)}
                                >
                                  <Trash2 size={14} />
                                </button>
                              )}
                            </div>
                          ))}
                          <button 
                            className="btn-text"
                            onClick={() => addCitation(claimIndex)}
                          >
                            <Plus size={14} /> Add citation
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>

              {/* Privacy Mode Toggle */}
              <div className="search-settings privacy-settings">
                <label className="consent-toggle">
                  <input 
                    type="checkbox" 
                    checked={privacyMode}
                    onChange={(e) => setPrivacyMode(e.target.checked)}
                  />
                  <span className={`toggle-switch ${privacyMode ? 'privacy-on' : ''}`}></span>
                  <span className="toggle-label">
                    {privacyMode ? <ShieldCheck size={16} /> : <Shield size={16} />}
                    Privacy mode {privacyMode ? 'ON' : 'OFF'}
                  </span>
                </label>
                <p className={`consent-description ${privacyMode ? 'privacy-enabled' : 'privacy-disabled'}`}>
                  {privacyMode 
                    ? '✓ Document parsing happens locally in your browser. Only citation strings are sent to the server for resolution.'
                    : '⚠ Document will be sent to server for processing (not stored).'}
                </p>
              </div>

              {/* Web Search Consent */}
              <div className="search-settings">
                <label className="consent-toggle">
                  <input 
                    type="checkbox" 
                    checked={webSearchEnabled}
                    onChange={(e) => setWebSearchEnabled(e.target.checked)}
                  />
                  <span className="toggle-switch"></span>
                  <span className="toggle-label">Enable web search fallback</span>
                </label>
                <p className="consent-description">
                  If a case isn't found on National Archives or BAILII, search the web for verification. 
                  Results will be marked as "Secondary Source".
                </p>
                {webSearchEnabled && (
                  <p className="consent-warning">
                    <AlertCircle size={14} />
                    Web searches are sent to external search engines. Citation text will be shared.
                  </p>
                )}
              </div>
              
              {/* Processing status */}
              {processingStatus && (
                <div className="processing-status">
                  <Loader2 size={16} className="spinning" />
                  <span>{processingStatus}</span>
                </div>
              )}

              <div className="actions-row">
                <button className="btn-secondary" onClick={addClaim}>
                  <Plus size={18} /> Add Another Claim
                </button>
                <button 
                  className="btn-primary" 
                  onClick={runAudit}
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <>
                      <Loader2 size={18} className="spinning" /> Auditing...
                    </>
                  ) : (
                    <>
                      <Sparkles size={18} /> Run Audit
                    </>
                  )}
                </button>
              </div>

              {error && (
                <motion.div 
                  className="error-banner"
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                >
                  <AlertCircle size={18} />
                  {error}
                </motion.div>
              )}
            </motion.section>

            {/* Results Section */}
            <AnimatePresence>
              {report && (
                <motion.section 
                  className="results-section"
                  initial={{ opacity: 0, y: 30 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.5 }}
                >
                  <div className="section-header">
                    <BookOpen size={20} />
                    <h2>Audit Results</h2>
                  </div>

                  <div className="results-summary">
                    <div className="summary-stat">
                      <span className="stat-value">{report.summary.total_claims}</span>
                      <span className="stat-label">Claims Checked</span>
                    </div>
                    <div className="summary-stat">
                      <span className="stat-value">
                        {report.claims.reduce((acc, c) => 
                          acc + c.citations.filter(cit => cit.case_retrieved).length, 0
                        )}
                      </span>
                      <span className="stat-label">Cases Retrieved</span>
                    </div>
                    <div className="summary-stat">
                      <span className="stat-value supported">
                        {report.claims.reduce((acc, c) => 
                          acc + c.citations.filter(cit => cit.outcome === 'supported').length, 0
                        )}
                      </span>
                      <span className="stat-label">Verified</span>
                    </div>
                    <div className="summary-stat">
                      <span className="stat-value" style={{ color: '#60a5fa' }}>
                        {report.claims.reduce((acc, c) => 
                          acc + c.citations.filter(cit => cit.outcome === 'needs_review').length, 0
                        )}
                      </span>
                      <span className="stat-label">Needs Review</span>
                    </div>
                    <div className="summary-stat">
                      <span className="stat-value warning">
                        {report.claims.reduce((acc, c) => 
                          acc + c.citations.filter(cit => !cit.case_retrieved && cit.hallucination_type === '1').length, 0
                        )}
                      </span>
                      <span className="stat-label">Not Found</span>
                    </div>
                  </div>

                  <div className="results-list">
                    {report.claims.map((claim, index) => (
                      <motion.div 
                        key={claim.claim_id}
                        className="result-card"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: index * 0.1 }}
                      >
                        <div className="result-claim">
                          <span className="result-label">Claim</span>
                          <p>{claim.text}</p>
                        </div>
                        <div className="result-citations">
                          {claim.citations.map((cit) => (
                            <div key={cit.citation_id} className={`citation-result ${cit.outcome}`}>
                              {getOutcomeIcon(cit.outcome, cit.case_retrieved)}
                              <div className="citation-info">
                                <div className="citation-header">
                                  {cit.case_name ? (
                                    <span className="case-name-main">{cit.case_name}</span>
                                  ) : (
                                    <span className="citation-text">{cit.citation_text}</span>
                                  )}
                                  {cit.case_retrieved && (
                                    <span className={`source-badge ${cit.source_type || 'primary'}`}>
                                      {cit.source_type === 'web_search' 
                                        ? '⚠️ Secondary Source' 
                                        : cit.source_type === 'fcl' 
                                          ? '✓ Find Case Law'
                                          : cit.source_type === 'bailii'
                                            ? '✓ BAILII'
                                            : '✓ Case Retrieved'}
                                    </span>
                                  )}
                                </div>
                                {cit.case_name && (
                                  <div className="citation-ref">
                                    <span className="citation-text-secondary">{cit.citation_text}</span>
                                  </div>
                                )}
                                {cit.authority_title && cit.authority_title !== 'Unknown Case' && cit.authority_title !== cit.case_name && (
                                  <div className="authority-info">
                                    <span className="authority-title">{cit.authority_title}</span>
                                    {cit.authority_url && (
                                      <a 
                                        href={cit.authority_url} 
                                        target="_blank" 
                                        rel="noopener noreferrer"
                                        className="source-link"
                                      >
                                        View Source →
                                      </a>
                                    )}
                                  </div>
                                )}
                                {cit.notes && (
                                  <div className="citation-notes">{cit.notes}</div>
                                )}
                                
                                {/* Matching Paragraphs Section */}
                                {cit.matching_paragraphs && cit.matching_paragraphs.length > 0 && (
                                  <div className="matching-paragraphs">
                                    <div className="matching-header">
                                      <BookOpen size={14} />
                                      <span>Matching Paragraphs in Judgment</span>
                                    </div>
                                    {cit.matching_paragraphs.map((para, idx) => (
                                      <div key={idx} className={`matching-para ${para.match_type}`}>
                                        <div className="para-header">
                                          <span className="para-num">
                                            {para.para_num ? `[${para.para_num}]` : `Para ${idx + 1}`}
                                          </span>
                                          <span className={`match-score ${para.match_type}`}>
                                            {Math.round(para.similarity_score * 100)}% match
                                          </span>
                                          {cit.authority_url && para.para_num && (
                                            <a 
                                              href={`${cit.authority_url}#para${para.para_num}`}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="para-link"
                                              title="Jump to paragraph in judgment"
                                            >
                                              Go to ¶{para.para_num} →
                                            </a>
                                          )}
                                        </div>
                                        <p className="para-text">{para.text}</p>
                                      </div>
                                    ))}
                                  </div>
                                )}
                                
                                <div className="citation-badges">
                                  <span className={`outcome-badge ${cit.outcome}`}>
                                    {getOutcomeLabel(cit.outcome, cit.case_retrieved)}
                                  </span>
                                  {cit.confidence !== null && cit.confidence !== undefined && (
                                    <span className="confidence-badge">
                                      {cit.confidence}% match
                                    </span>
                                  )}
                                  {cit.hallucination_type && cit.hallucination_type !== 'review' && cit.outcome !== 'supported' && (
                                    <span 
                                      className="hallucination-badge"
                                      style={{ 
                                        background: LEE_CATEGORIES[cit.hallucination_type as keyof typeof LEE_CATEGORIES]?.color + '33',
                                        color: LEE_CATEGORIES[cit.hallucination_type as keyof typeof LEE_CATEGORIES]?.color
                                      }}
                                    >
                                      Type {cit.hallucination_type}: {cit.hallucination_type_name}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                    </motion.div>
                  ))}
                </div>

                  <div className="audit-meta">
                    <span>Audited: {new Date(report.audit_metadata.audited_at).toLocaleString()}</span>
                    <span>Job ID: {report.audit_metadata.job_id}</span>
                  </div>
                </motion.section>
              )}
            </AnimatePresence>
          </>
        )}

        {/* ===== COMMENTARY TAB ===== */}
        {activeTab === 'commentary' && (
          <>
            <motion.section 
              className="input-section commentary-section"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
            >
              <div className="section-header">
                <MessageSquareQuote size={20} />
                <h2>Find Judicial Commentary on AI Hallucinations</h2>
              </div>
              
              <p className="section-description">
                Search cases for judicial commentary on AI hallucinations. Enter case citations or upload case documents, 
                and we'll extract relevant excerpts and map them to the <strong>Lee Categories</strong>.
              </p>

              {/* Lee Categories Reference */}
              <div className="lee-categories-grid">
                {Object.entries(LEE_CATEGORIES).map(([key, cat]) => (
                  <div key={key} className="lee-category-chip" style={{ borderColor: cat.color }}>
                    <span className="lee-num" style={{ background: cat.color }}>{key === 'general' ? '•' : key}</span>
                    <span className="lee-name">{cat.name}</span>
                  </div>
                ))}
              </div>

              <div className="commentary-inputs">
                <div className="input-group">
                  <label>Case Citations (one per line)</label>
                  <textarea
                    placeholder={"[2023] EWHC 123 (KB)\nMata v Avianca [2023]\nR (oao) v Secretary of State [2024] EWHC 456"}
                    value={commentaryCitations}
                    onChange={(e) => setCommentaryCitations(e.target.value)}
                    rows={4}
                  />
                </div>

                <div className="section-divider small">
                  <span>or upload case documents</span>
                </div>

                <input
                  ref={commentaryFileRef}
                  id="commentary-file-input"
                  type="file"
                  accept=".pdf,.txt,.html,.xml,.doc,.docx"
                  onChange={handleCommentaryFile}
                  style={{ display: 'none' }}
                />
                
                {commentaryFile ? (
                  <div className="upload-zone has-file">
                    <div className="uploaded-file">
                      <FileText size={24} />
                      <div className="file-info">
                        <span className="file-name">{commentaryFile.name}</span>
                        <span className="file-size">{(commentaryFile.size / 1024).toFixed(1)} KB</span>
                      </div>
                      <button className="btn-icon small" onClick={() => clearCommentaryFile()}>
                        <X size={16} />
                      </button>
                    </div>
                  </div>
                ) : (
                  <div 
                    className={`upload-zone ${commentaryDragActive ? 'drag-active' : ''}`}
                    onDragEnter={handleCommentaryDrag}
                    onDragLeave={handleCommentaryDrag}
                    onDragOver={handleCommentaryDrag}
                    onDrop={handleCommentaryDrop}
                  >
                    <div className="upload-prompt">
                      <Upload size={32} />
                      <span>Drag and drop case document here</span>
                      <span className="file-types">PDF, TXT, HTML, XML, Word</span>
                      <button 
                        type="button"
                        className="btn-secondary browse-btn"
                        onClick={() => commentaryFileRef.current?.click()}
                      >
                        <FileSearch size={18} />
                        Browse Files
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <button 
                className="btn-primary"
                onClick={searchCommentary}
                disabled={isSearchingCommentary}
              >
                {isSearchingCommentary ? (
                  <>
                    <Loader2 size={18} className="spinning" /> Searching...
                  </>
                ) : (
                  <>
                    <Search size={18} /> Find Commentary
                  </>
                )}
              </button>

              {error && activeTab === 'commentary' && (
                <motion.div 
                  className="error-banner"
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                >
                  <AlertCircle size={18} />
                  {error}
                </motion.div>
              )}
            </motion.section>

            {/* Commentary Results */}
            <AnimatePresence>
              {commentaryReport && (
                <motion.section 
                  className="results-section commentary-results"
                  initial={{ opacity: 0, y: 30 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.5 }}
                >
                  <div className="section-header">
                    <Gavel size={20} />
                    <h2>Judicial Commentary Found</h2>
                  </div>

                  <div className="results-summary">
                    <div className="summary-stat">
                      <span className="stat-value">{commentaryReport.search_metadata.cases_searched}</span>
                      <span className="stat-label">Cases Searched</span>
                    </div>
                    <div className="summary-stat">
                      <span className="stat-value">{commentaryReport.search_metadata.excerpts_found}</span>
                      <span className="stat-label">Excerpts Found</span>
                    </div>
                    <div className="summary-stat">
                      <span className="stat-value">
                        {Object.keys(commentaryReport.lee_category_counts).filter(k => k !== 'general').length}
                      </span>
                      <span className="stat-label">Lee Categories</span>
                    </div>
                  </div>

                  {/* Category breakdown */}
                  {Object.entries(commentaryReport.lee_category_counts).length > 0 && (
                    <div className="category-breakdown">
                      <h3>Category Breakdown</h3>
                      <div className="category-bars">
                        {Object.entries(commentaryReport.lee_category_counts).map(([cat, count]) => (
                          <div key={cat} className="category-bar">
                            <span className="cat-label">
                              {LEE_CATEGORIES[cat as keyof typeof LEE_CATEGORIES]?.name || cat}
                            </span>
                            <div className="bar-container">
                              <div 
                                className="bar-fill" 
                                style={{ 
                                  width: `${(count / commentaryReport.search_metadata.excerpts_found) * 100}%`,
                                  background: LEE_CATEGORIES[cat as keyof typeof LEE_CATEGORIES]?.color || '#8b9bb4'
                                }}
                              />
                            </div>
                            <span className="cat-count">{count}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Excerpts by case */}
                  <div className="commentary-list">
                    {commentaryReport.results.map((result, idx) => (
                      <motion.div 
                        key={idx}
                        className="commentary-card"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: idx * 0.1 }}
                      >
                        <div className="case-header">
                          <h4>{result.case_name}</h4>
                          <span className="case-citation">{result.citation}</span>
                        </div>
                        
                        {result.excerpts.map((excerpt, exIdx) => (
                          <div key={exIdx} className="excerpt-card">
                            <div className="excerpt-meta">
                              <span 
                                className="lee-badge"
                                style={{ background: LEE_CATEGORIES[excerpt.lee_category as keyof typeof LEE_CATEGORIES]?.color || '#8b9bb4' }}
                              >
                                {excerpt.lee_category === 'general' ? '•' : excerpt.lee_category}
                              </span>
                              <span className="lee-category-name">{excerpt.lee_category_name}</span>
                              {excerpt.paragraph && <span className="para-ref">[{excerpt.paragraph}]</span>}
                            </div>
                            <blockquote className="excerpt-text">
                              "{excerpt.text}"
                            </blockquote>
                            <div className="keywords-matched">
                              {excerpt.keywords_matched.map((kw, kwIdx) => (
                                <span key={kwIdx} className="keyword-chip">{kw}</span>
                              ))}
                            </div>
                          </div>
                        ))}
                      </motion.div>
                    ))}
                  </div>

                  <div className="audit-meta">
                    <span>Searched: {new Date(commentaryReport.search_metadata.searched_at).toLocaleString()}</span>
                  </div>
                </motion.section>
              )}
            </AnimatePresence>
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="footer">
        <p>Matthew Lee Bot © {new Date().getFullYear()} • Powered by Find Case Law & BAILII</p>
      </footer>
    </div>
  )
}

export default App
