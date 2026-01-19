import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Scale,
  FileSearch,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2,
  BookOpen,
  Upload,
  FileText,
  X,
  Info,
  ExternalLink,
  ChevronRight,
  Search
} from 'lucide-react'
import './App.css'

// Client-side processing for privacy mode
import { extractTextFromFile } from './lib/documentParser'
import { extractCitations, extractPropositions, formatCitation, extractCaseNameFromText } from './lib/citationExtractor'
import { findMatchingParagraphs, calculateConfidence, determineOutcome } from './lib/verifier'
import { resolveCitations } from './lib/api'

interface SourceParagraph {
  paragraphNumber: number
  text: string
  citationPosition: number
}

interface JudgmentParagraph {
  para_num: string
  text: string
  speaker?: string
}

interface ExtractedCitationItem {
  id: string
  caseName: string | null
  citation: string
  proposition: string
  sourceParagraph?: SourceParagraph  // The actual paragraph from the document
  status: 'pending' | 'resolving' | 'verifying' | 'done' | 'error'
  result?: {
    outcome: 'supported' | 'contradicted' | 'unclear' | 'unverifiable' | 'needs_review'
    caseFound: boolean
    sourceType?: string
    url?: string
    title?: string
    confidence?: number
    notes?: string
    judgmentParagraphs?: JudgmentParagraph[]  // Full judgment for embedded viewer
    matchingParagraphs?: Array<{
      para_num: string
      text: string
      similarity_score: number
      match_type: 'keyword' | 'partial'
    }>
  }
}

// Lee category definitions
const LEE_CATEGORIES = {
  '1': { name: 'Fabricated Case & Citation', description: 'Completely invented case that does not exist' },
  '2': { name: 'Wrong Case Name, Right Citation', description: 'Citation exists but refers to a different case' },
  '3': { name: 'Right Case Name, Wrong Citation', description: 'Case exists but citation is incorrect' },
  '4': { name: 'Conflated Authorities', description: 'Two or more cases merged into one' },
  '5': { name: 'Correct Law, Invented Authority', description: 'Legal principle is accurate but attributed to non-existent case' },
  '6': { name: 'Real Case, Misstated Facts/Ratio', description: 'Case exists but facts or ratio decidendi are wrong' },
  '7': { name: 'Misleading Secondary Paraphrase', description: 'Inaccurate summary from secondary sources' },
  '8': { name: 'False Citations Citing False', description: 'Chain of fabricated citations' },
}

type AppView = 'upload' | 'audit'

function App() {
  const [view, setView] = useState<AppView>('upload')
  const [showHowItWorks, setShowHowItWorks] = useState(false)

  // Document state
  const [uploadedFile, setUploadedFile] = useState<File | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isExtracting, setIsExtracting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Extracted citations
  const [extractedCitations, setExtractedCitations] = useState<ExtractedCitationItem[]>([])
  const [documentTitle, setDocumentTitle] = useState('')

  // Audit state
  const [isAuditing, setIsAuditing] = useState(false)
  const [auditProgress, setAuditProgress] = useState({ current: 0, total: 0, phase: '' })
  const [webSearchEnabled, setWebSearchEnabled] = useState(false)

  // Selected citation for detail view
  const [selectedCitation, setSelectedCitation] = useState<string | null>(null)

  // Judgment viewer search
  const [judgmentSearch, setJudgmentSearch] = useState('')

  // File handlers
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
    setExtractedCitations([])
    setView('upload')
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  // Extract citations from document
  const extractFromDocument = async () => {
    if (!uploadedFile) return

    setIsExtracting(true)
    setError(null)

    try {
      const text = await extractTextFromFile(uploadedFile)

      if (!text || text.trim().length < 50) {
        throw new Error('Could not extract text from document')
      }

      const propositions = extractPropositions(text)

      if (propositions.length > 0) {
        const items: ExtractedCitationItem[] = []
        propositions.forEach((prop, i) => {
          prop.citations.forEach((cit, j) => {
            // Try to get case name from citation first, then from proposition text
            const caseName = cit.caseName || extractCaseNameFromText(prop.proposition) || null
            items.push({
              id: `${i}-${j}`,
              caseName,
              citation: cit.raw,
              proposition: prop.proposition,
              sourceParagraph: prop.sourceParagraph,  // Store the actual document paragraph
              status: 'pending'
            })
          })
        })
        setExtractedCitations(items)
        setDocumentTitle(uploadedFile.name.replace(/\.[^/.]+$/, ''))
        setView('audit')
      } else {
        // Try just citations
        const citations = extractCitations(text)
        if (citations.length > 0) {
          const items: ExtractedCitationItem[] = citations.slice(0, 30).map((cit, i) => ({
            id: `cit-${i}`,
            caseName: cit.caseName || null,
            citation: cit.raw,
            proposition: `Citation reference: ${formatCitation(cit)}`,
            status: 'pending'
          }))
          setExtractedCitations(items)
          setDocumentTitle(uploadedFile.name.replace(/\.[^/.]+$/, ''))
          setView('audit')
        } else {
          setError('No legal citations found in the document')
        }
      }
    } catch (err: any) {
      console.error('Extraction error:', err)
      setError(err.message || 'Failed to extract citations from document')
    } finally {
      setIsExtracting(false)
    }
  }

  // Run the audit
  const runAudit = async () => {
    if (extractedCitations.length === 0) return

    setIsAuditing(true)
    setError(null)

    const total = extractedCitations.length
    setAuditProgress({ current: 0, total, phase: 'Resolving citations...' })

    // Reset all statuses
    setExtractedCitations(prev => prev.map(c => ({ ...c, status: 'pending' as const, result: undefined })))

    try {
      // Build citations with context for resolution
      type CitationWithContext = { citation: string; case_name?: string | null; claim_text?: string | null }
      const citationMap = new Map<string, CitationWithContext>()

      extractedCitations.forEach(item => {
        const key = item.citation.toLowerCase()
        if (!citationMap.has(key)) {
          // Use the case name we already extracted, or try again from proposition
          const caseName = item.caseName || extractCaseNameFromText(item.proposition) || null

          citationMap.set(key, {
            citation: item.citation,
            case_name: caseName,
            claim_text: item.proposition.slice(0, 200)
          })
        }
      })

      const citationsWithContext = Array.from(citationMap.values())

      // Mark all as resolving
      setExtractedCitations(prev => prev.map(c => ({ ...c, status: 'resolving' as const })))

      // Resolve citations
      const resolveResponse = await resolveCitations(citationsWithContext, webSearchEnabled)

      // Build resolved map
      const resolvedMap = new Map<string, typeof resolveResponse.resolved[0]>()
      resolveResponse.resolved.forEach(r => {
        resolvedMap.set(r.citation.toLowerCase(), r)
      })

      setAuditProgress({ current: 0, total, phase: 'Verifying claims...' })

      // Now verify each citation
      const updatedCitations = [...extractedCitations]

      for (let i = 0; i < updatedCitations.length; i++) {
        const item = updatedCitations[i]

        // Update status to verifying
        updatedCitations[i] = { ...item, status: 'verifying' }
        setExtractedCitations([...updatedCitations])
        setAuditProgress({ current: i + 1, total, phase: `Verifying ${i + 1} of ${total}...` })

        const resolved = resolvedMap.get(item.citation.toLowerCase())

        if (resolved && resolved.source_type !== 'not_found') {
          // Case found - verify
          const matches = findMatchingParagraphs(
            item.proposition,
            resolved.paragraphs.map(p => ({
              para_num: p.para_num,
              text: p.text,
              speaker: p.speaker || undefined
            }))
          )

          const { score } = calculateConfidence(matches, true)
          const outcome = determineOutcome(
            true,
            matches,
            resolved.source_type as 'fcl' | 'bailii' | 'web_search' | 'not_found'
          )

          updatedCitations[i] = {
            ...item,
            caseName: resolved.case_name || item.caseName,
            status: 'done',
            result: {
              outcome,
              caseFound: true,
              sourceType: resolved.source_type,
              url: resolved.url || undefined,
              title: resolved.title || undefined,
              confidence: Math.round(score * 100),
              notes: matches.length > 0
                ? `Case verified. Found ${matches.length} matching paragraph(s).`
                : 'Case verified on BAILII/FCL. No keyword matches for proposition specifics.',
              judgmentParagraphs: resolved.paragraphs.map(p => ({
                para_num: p.para_num,
                text: p.text,
                speaker: p.speaker
              })),
              matchingParagraphs: matches.map(m => ({
                para_num: m.para_num,
                text: m.text.slice(0, 400) + (m.text.length > 400 ? '...' : ''),
                similarity_score: m.similarity_score,
                match_type: m.match_type
              }))
            }
          }
        } else {
          // Case not found
          updatedCitations[i] = {
            ...item,
            status: 'done',
            result: {
              outcome: 'unverifiable',
              caseFound: false,
              notes: resolved?.error || 'Citation could not be found on BAILII or Find Case Law'
            }
          }
        }

        setExtractedCitations([...updatedCitations])

        // Small delay for visual feedback
        await new Promise(r => setTimeout(r, 100))
      }

      setAuditProgress({ current: total, total, phase: 'Complete' })

    } catch (err) {
      console.error('Audit error:', err)
      setError('Failed to run audit. Please try again.')
    } finally {
      setIsAuditing(false)
    }
  }

  // Get status counts
  const getStatusCounts = () => {
    const counts = { verified: 0, needsReview: 0, notFound: 0, pending: 0 }
    extractedCitations.forEach(c => {
      if (c.status !== 'done') counts.pending++
      else if (c.result?.outcome === 'supported') counts.verified++
      else if (c.result?.caseFound === false) counts.notFound++
      else counts.needsReview++
    })
    return counts
  }

  const selectedItem = extractedCitations.find(c => c.id === selectedCitation)

  // Auto-select first citation with result when audit completes
  useEffect(() => {
    if (!isAuditing && extractedCitations.some(c => c.status === 'done') && !selectedCitation) {
      const firstDone = extractedCitations.find(c => c.status === 'done')
      if (firstDone) setSelectedCitation(firstDone.id)
    }
  }, [isAuditing, extractedCitations, selectedCitation])

  return (
    <div className="app">
      <div className="grain-overlay" />

      {/* Header */}
      <header className="header-compact">
        <div className="header-content">
          <div className="logo-container" onClick={() => { setView('upload'); setExtractedCitations([]); setSelectedCitation(null); }}>
            <div className="logo-icon">
              <Scale size={24} />
            </div>
            <div className="logo-text">
              <h1>Citation Auditor</h1>
            </div>
          </div>

          <button
            className="how-it-works-btn"
            onClick={() => setShowHowItWorks(true)}
          >
            <Info size={16} />
            How It Works
          </button>
        </div>
      </header>

      {/* How It Works Modal */}
      <AnimatePresence>
        {showHowItWorks && (
          <motion.div
            className="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowHowItWorks(false)}
          >
            <motion.div
              className="modal-content how-it-works-modal"
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.95 }}
              onClick={e => e.stopPropagation()}
            >
              <button className="modal-close" onClick={() => setShowHowItWorks(false)}>
                <X size={20} />
              </button>

              <h2>How Citation Auditor Works</h2>

              <div className="modal-section">
                <h3>What This Tool Checks</h3>
                <p>
                  This tool checks for <strong>Type 1 hallucinations</strong> from Matthew Lee's taxonomy:
                  <em>fabricated cases and citations</em> that do not exist. It verifies whether cited cases
                  can be found on official legal databases.
                </p>

                <div className="lee-taxonomy">
                  <h4>Matthew Lee's 8 Types of Legal AI Hallucinations</h4>
                  <div className="taxonomy-grid">
                    {Object.entries(LEE_CATEGORIES).map(([num, cat]) => (
                      <div key={num} className={`taxonomy-item ${num === '1' ? 'active' : ''}`}>
                        <span className="taxonomy-num">{num}</span>
                        <div className="taxonomy-info">
                          <strong>{cat.name}</strong>
                          <span>{cat.description}</span>
                        </div>
                        {num === '1' && <span className="check-badge">Checked</span>}
                      </div>
                    ))}
                  </div>
                  <p className="taxonomy-note">
                    We are actively working on methods to detect Types 2-8. Currently, only Type 1
                    (completely fabricated cases) can be reliably detected through database lookup.
                  </p>
                </div>
              </div>

              <div className="modal-section">
                <h3>The Process</h3>
                <div className="process-steps">
                  <div className="process-step">
                    <span className="step-number">1</span>
                    <div>
                      <strong>Document Parsing</strong>
                      <p>Your document is parsed entirely in your browser. The file never leaves your device.</p>
                    </div>
                  </div>
                  <div className="process-step">
                    <span className="step-number">2</span>
                    <div>
                      <strong>Citation Extraction</strong>
                      <p>Legal citations and associated propositions are extracted using pattern matching.</p>
                    </div>
                  </div>
                  <div className="process-step">
                    <span className="step-number">3</span>
                    <div>
                      <strong>Case Resolution</strong>
                      <p>Citation strings are sent to our server to find cases on Find Case Law and BAILII.</p>
                    </div>
                  </div>
                  <div className="process-step">
                    <span className="step-number">4</span>
                    <div>
                      <strong>Verification</strong>
                      <p>Case text is compared against your claims using keyword matching in your browser.</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="modal-section privacy-section">
                <h3>Privacy</h3>
                <p>
                  <strong>Your document content never leaves your browser.</strong> Only citation strings
                  (e.g., "[2019] UKSC 12") and case names are sent to our server for resolution.
                  We do not store any data.
                </p>
              </div>

              <div className="modal-section disclaimer-section">
                <h3>Important Disclaimer</h3>
                <p>
                  This is an experimental tool for research purposes. It provides <em>indications</em>,
                  not definitive answers. Always verify citations manually before relying on them in
                  any legal context. This tool should not be used as a substitute for proper legal research.
                </p>
              </div>

              <div className="modal-credits">
                <p>
                  Inspired by <a href="https://naturalandartificiallaw.com/" target="_blank" rel="noopener noreferrer">Matthew Lee's research</a> on AI hallucinations in legal practice.
                </p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <main className="main-container">
        {/* Upload View */}
        {view === 'upload' && (
          <motion.div
            className="upload-view"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <div className="upload-hero">
              <h2>Check Your Citations</h2>
              <p>Upload a legal document to verify that cited cases exist and can be found on official databases.</p>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.txt,.html,.doc,.docx"
              onChange={handleFileInput}
              style={{ display: 'none' }}
            />

            <div
              className={`upload-zone-large ${dragActive ? 'drag-active' : ''} ${uploadedFile ? 'has-file' : ''}`}
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              onClick={() => !uploadedFile && fileInputRef.current?.click()}
            >
              {uploadedFile ? (
                <div className="uploaded-file-display">
                  <FileText size={40} />
                  <div className="file-details">
                    <span className="file-name">{uploadedFile.name}</span>
                    <span className="file-size">{(uploadedFile.size / 1024).toFixed(1)} KB</span>
                  </div>
                  <button className="remove-file-btn" onClick={(e) => { e.stopPropagation(); clearFile(); }}>
                    <X size={18} />
                  </button>
                </div>
              ) : (
                <div className="upload-prompt-large">
                  <Upload size={48} />
                  <span className="upload-text">Drop your document here or click to browse</span>
                  <span className="file-types">PDF, Word, TXT, HTML</span>
                </div>
              )}
            </div>

            {uploadedFile && (
              <button
                className="extract-btn-large"
                onClick={extractFromDocument}
                disabled={isExtracting}
              >
                {isExtracting ? (
                  <>
                    <Loader2 size={20} className="spinning" />
                    Extracting Citations...
                  </>
                ) : (
                  <>
                    <FileSearch size={20} />
                    Extract Citations
                  </>
                )}
              </button>
            )}

            {error && (
              <div className="error-message">
                <AlertCircle size={18} />
                {error}
              </div>
            )}

            <div className="upload-info">
              <div className="info-item">
                <CheckCircle2 size={16} />
                <span>Detects Type 1 hallucinations (fabricated cases)</span>
              </div>
              <div className="info-item">
                <CheckCircle2 size={16} />
                <span>Document parsed locally - never uploaded</span>
              </div>
              <div className="info-item">
                <CheckCircle2 size={16} />
                <span>Checks against BAILII & Find Case Law</span>
              </div>
            </div>
          </motion.div>
        )}

        {/* Audit View */}
        {view === 'audit' && (
          <div className="audit-view">
            {/* Left Panel - Citation List */}
            <div className="citations-panel">
              <div className="panel-header">
                <div className="panel-title">
                  <FileText size={18} />
                  <span>{documentTitle}</span>
                </div>
                <button className="back-btn" onClick={clearFile}>
                  <X size={16} />
                </button>
              </div>

              {/* Status Summary */}
              <div className="status-summary">
                {(() => {
                  const counts = getStatusCounts()
                  return (
                    <>
                      <div className="status-item verified">
                        <span className="count">{counts.verified}</span>
                        <span className="label">Verified</span>
                      </div>
                      <div className="status-item review">
                        <span className="count">{counts.needsReview}</span>
                        <span className="label">Review</span>
                      </div>
                      <div className="status-item not-found">
                        <span className="count">{counts.notFound}</span>
                        <span className="label">Not Found</span>
                      </div>
                    </>
                  )
                })()}
              </div>

              {/* Progress Bar */}
              {isAuditing && (
                <div className="audit-progress">
                  <div className="progress-bar">
                    <div
                      className="progress-fill"
                      style={{ width: `${(auditProgress.current / auditProgress.total) * 100}%` }}
                    />
                  </div>
                  <span className="progress-text">{auditProgress.phase}</span>
                </div>
              )}

              {/* Citation List */}
              <div className="citation-list">
                {extractedCitations.map((item) => (
                  <div
                    key={item.id}
                    className={`citation-item ${item.status} ${selectedCitation === item.id ? 'selected' : ''} ${item.result?.outcome || ''}`}
                    onClick={() => setSelectedCitation(item.id)}
                  >
                    <div className="citation-status-icon">
                      {item.status === 'pending' && <div className="status-dot pending" />}
                      {item.status === 'resolving' && <Loader2 size={14} className="spinning" />}
                      {item.status === 'verifying' && <Loader2 size={14} className="spinning" />}
                      {item.status === 'done' && item.result?.outcome === 'supported' && <CheckCircle2 size={14} className="icon-verified" />}
                      {item.status === 'done' && item.result?.caseFound === false && <XCircle size={14} className="icon-not-found" />}
                      {item.status === 'done' && item.result?.caseFound && item.result?.outcome !== 'supported' && <AlertCircle size={14} className="icon-review" />}
                    </div>
                    <div className="citation-item-content">
                      <span className="citation-case-name">{item.caseName || 'Unknown Case'}</span>
                      <span className="citation-ref">{item.citation}</span>
                    </div>
                    <ChevronRight size={14} className="chevron" />
                  </div>
                ))}
              </div>

              {/* Run Audit Button */}
              {!isAuditing && extractedCitations.some(c => c.status === 'pending') && (
                <div className="audit-controls">
                  <label className="web-search-toggle">
                    <input
                      type="checkbox"
                      checked={webSearchEnabled}
                      onChange={(e) => setWebSearchEnabled(e.target.checked)}
                    />
                    <span>Enable web search fallback</span>
                  </label>
                  <button className="run-audit-btn" onClick={runAudit}>
                    <FileSearch size={18} />
                    Run Audit
                  </button>
                </div>
              )}
            </div>

            {/* Right Panel - Detail View */}
            <div className="detail-panel">
              {selectedItem ? (
                <div className="detail-content">
                  <div className="detail-header">
                    <div className={`outcome-badge large ${selectedItem.result?.outcome || 'pending'}`}>
                      {selectedItem.status === 'pending' && 'Pending'}
                      {selectedItem.status === 'resolving' && 'Resolving...'}
                      {selectedItem.status === 'verifying' && 'Verifying...'}
                      {selectedItem.status === 'done' && selectedItem.result?.outcome === 'supported' && 'Verified'}
                      {selectedItem.status === 'done' && selectedItem.result?.caseFound === false && 'Case Not Found'}
                      {selectedItem.status === 'done' && selectedItem.result?.caseFound && selectedItem.result?.outcome !== 'supported' && 'Needs Review'}
                    </div>
                    {selectedItem.result?.confidence !== undefined && selectedItem.result.confidence > 0 && (
                      <span className="confidence-score">{selectedItem.result.confidence}% match</span>
                    )}
                  </div>

                  <div className="detail-section">
                    <h3>Case</h3>
                    <p className="case-name-display">{selectedItem.caseName || 'Unknown Case Name'}</p>
                    <p className="citation-display">{selectedItem.citation}</p>
                    {selectedItem.result?.title && selectedItem.result.title !== selectedItem.caseName && (
                      <p className="official-title">{selectedItem.result.title}</p>
                    )}
                  </div>

                  {/* Source Paragraph from Document */}
                  {selectedItem.sourceParagraph && (
                    <div className="detail-section source-section">
                      <h3>Source Paragraph <span className="para-badge">[{selectedItem.sourceParagraph.paragraphNumber}]</span></h3>
                      <div className="source-paragraph">
                        <p>{selectedItem.sourceParagraph.text}</p>
                      </div>
                    </div>
                  )}

                  {selectedItem.result?.caseFound === false && (
                    <div className="warning-box">
                      <AlertCircle size={18} />
                      <div>
                        <strong>Potential Type 1 Hallucination</strong>
                        <p>This citation could not be found on BAILII or Find Case Law.
                        The case may be fabricated, or may exist in a database we don't search.
                        Please verify manually.</p>
                      </div>
                    </div>
                  )}

                  {/* Embedded Judgment Viewer with Search */}
                  {selectedItem.result?.judgmentParagraphs && selectedItem.result.judgmentParagraphs.length > 0 && (
                    <div className="detail-section judgment-viewer-section">
                      <div className="judgment-header">
                        <h3>Judgment Text</h3>
                        {selectedItem.result?.url && (
                          <a href={selectedItem.result.url} target="_blank" rel="noopener noreferrer" className="source-link-small">
                            Open Full <ExternalLink size={12} />
                          </a>
                        )}
                      </div>
                      <div className="judgment-search">
                        <Search size={14} />
                        <input
                          type="text"
                          placeholder="Search judgment..."
                          value={judgmentSearch}
                          onChange={(e) => setJudgmentSearch(e.target.value)}
                        />
                        {judgmentSearch && (
                          <button className="clear-search" onClick={() => setJudgmentSearch('')}>
                            <X size={12} />
                          </button>
                        )}
                      </div>
                      <div className="judgment-content">
                        {(() => {
                          const searchLower = judgmentSearch.toLowerCase()
                          const matchingParaNums = new Set(selectedItem.result?.matchingParagraphs?.map(m => m.para_num) || [])

                          const filteredParas = judgmentSearch
                            ? selectedItem.result?.judgmentParagraphs?.filter(p =>
                                p.text.toLowerCase().includes(searchLower) ||
                                p.para_num.includes(judgmentSearch)
                              )
                            : selectedItem.result?.judgmentParagraphs

                          if (!filteredParas || filteredParas.length === 0) {
                            return <p className="no-results">No matching paragraphs found</p>
                          }

                          return filteredParas.map((para, idx) => {
                            const isMatch = matchingParaNums.has(para.para_num)
                            let displayText = para.text

                            // Highlight search terms
                            if (judgmentSearch) {
                              const regex = new RegExp(`(${judgmentSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
                              displayText = para.text.replace(regex, '<mark>$1</mark>')
                            }

                            return (
                              <div
                                key={idx}
                                className={`judgment-para ${isMatch ? 'highlighted' : ''}`}
                                id={`para-${para.para_num}`}
                              >
                                <span className="para-num">[{para.para_num}]</span>
                                {para.speaker && <span className="para-speaker">{para.speaker}:</span>}
                                <p dangerouslySetInnerHTML={{ __html: displayText }} />
                                {isMatch && <span className="match-indicator">Match</span>}
                              </div>
                            )
                          })
                        })()}
                      </div>
                    </div>
                  )}

                  {selectedItem.result?.notes && (
                    <div className="detail-section notes-section">
                      <h3>Notes</h3>
                      <p className="notes-text">{selectedItem.result.notes}</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="detail-placeholder">
                  <BookOpen size={48} />
                  <p>Select a citation to view details</p>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="footer-compact">
        <span>Powered by <a href="https://caselaw.nationalarchives.gov.uk/" target="_blank" rel="noopener noreferrer">Find Case Law</a> & <a href="https://www.bailii.org/" target="_blank" rel="noopener noreferrer">BAILII</a></span>
        <span className="separator">|</span>
        <span>Developed by <a href="https://www.jamescockburn.io" target="_blank" rel="noopener noreferrer">James Cockburn</a></span>
      </footer>
    </div>
  )
}

export default App
