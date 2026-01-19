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
  Search,
  Plus,
  Eye,
  EyeOff,
  HelpCircle,
  Shield
} from 'lucide-react'
import './App.css'

// Client-side processing for privacy mode
import { extractTextFromFile } from './lib/documentParser'
import { extractCitationsWithContext } from './lib/citationExtractor'
// Verifier functions removed - user verifies manually using the judgment viewer
import { resolveCitations } from './lib/api'

interface SourceParagraph {
  paragraphNumber: number
  text: string
  citationPosition: number
}

interface JudgmentParagraph {
  para_num: string
  text: string
  speaker?: string | null
}

interface ExtractedCitationItem {
  id: string
  caseName: string | null
  citation: string
  sourceParagraph?: SourceParagraph  // The actual paragraph from the document where citation appears
  status: 'pending' | 'resolving' | 'verifying' | 'done' | 'error'
  result?: {
    outcome: 'verified' | 'not_found' | 'needs_review'
    caseFound: boolean
    sourceType?: string
    url?: string
    title?: string
    notes?: string
    judgmentParagraphs?: JudgmentParagraph[]  // Full judgment for embedded viewer
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

type AppView = 'splash' | 'upload' | 'audit'

function App() {
  const [view, setView] = useState<AppView>('splash')
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

  // Document viewer state
  const [documentText, setDocumentText] = useState('')
  const [showDocumentViewer, setShowDocumentViewer] = useState(false)
  const [documentSearch, setDocumentSearch] = useState('')

  // Manual citation adding
  const [showAddCitation, setShowAddCitation] = useState(false)
  const [manualCitation, setManualCitation] = useState('')
  const [manualCaseName, setManualCaseName] = useState('')

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
    setDocumentText('')
    setShowDocumentViewer(false)
    setView('upload')
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  // Extract citations from document or pasted text
  const extractFromDocument = async () => {
    // Allow either file upload or pasted text
    if (!uploadedFile && documentText.trim().length < 50) return

    setIsExtracting(true)
    setError(null)

    try {
      let text: string

      if (uploadedFile) {
        // Extract from uploaded file
        text = await extractTextFromFile(uploadedFile)
        // Store document text for the document viewer (locally only)
        setDocumentText(text)
      } else {
        // Use pasted text directly
        text = documentText
      }

      if (!text || text.trim().length < 50) {
        throw new Error('Could not extract text - please provide more content')
      }

      // Extract citations with their source paragraphs (for context)
      const citationsWithContext = extractCitationsWithContext(text)

      if (citationsWithContext.length > 0) {
        const items: ExtractedCitationItem[] = citationsWithContext.map((cit, i) => ({
          id: `cit-${i}`,
          caseName: cit.caseName || null,
          citation: cit.raw,
          sourceParagraph: cit.sourceParagraph,  // The paragraph where citation was found
          status: 'pending'
        }))
        setExtractedCitations(items)
        setDocumentTitle(uploadedFile ? uploadedFile.name.replace(/\.[^/.]+$/, '') : 'Pasted Text')
        setView('audit')
      } else {
        setError('No legal citations found in the text')
      }
    } catch (err: any) {
      console.error('Extraction error:', err)
      setError(err.message || 'Failed to extract citations')
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
      type CitationWithContext = { citation: string; case_name?: string | null }
      const citationMap = new Map<string, CitationWithContext>()

      extractedCitations.forEach(item => {
        const key = item.citation.toLowerCase()
        if (!citationMap.has(key)) {
          citationMap.set(key, {
            citation: item.citation,
            case_name: item.caseName
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

      setAuditProgress({ current: 0, total, phase: 'Processing results...' })

      // Process each citation
      const updatedCitations = [...extractedCitations]

      for (let i = 0; i < updatedCitations.length; i++) {
        const item = updatedCitations[i]
        setAuditProgress({ current: i + 1, total, phase: `Processing ${i + 1} of ${total}...` })

        const resolved = resolvedMap.get(item.citation.toLowerCase())

        if (resolved && resolved.source_type !== 'not_found') {
          // Case found on BAILII/FCL
          updatedCitations[i] = {
            ...item,
            caseName: resolved.case_name || item.caseName,
            status: 'done',
            result: {
              outcome: 'verified',
              caseFound: true,
              sourceType: resolved.source_type,
              url: resolved.url || undefined,
              title: resolved.title || undefined,
              notes: `Case found on ${resolved.source_type === 'fcl' ? 'Find Case Law' : 'BAILII'}`,
              judgmentParagraphs: resolved.paragraphs.map(p => ({
                para_num: p.para_num,
                text: p.text,
                speaker: p.speaker
              }))
            }
          }
        } else {
          // Case not found - potential hallucination
          updatedCitations[i] = {
            ...item,
            status: 'done',
            result: {
              outcome: 'not_found',
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
      else if (c.result?.outcome === 'verified') counts.verified++
      else if (c.result?.outcome === 'not_found') counts.notFound++
      else counts.needsReview++
    })
    return counts
  }

  // Add manual citation
  const handleAddManualCitation = () => {
    if (!manualCitation.trim()) return

    const newId = `manual-${Date.now()}`
    const newItem: ExtractedCitationItem = {
      id: newId,
      caseName: manualCaseName.trim() || null,
      citation: manualCitation.trim(),
      status: 'pending'
    }

    setExtractedCitations(prev => [...prev, newItem])
    setManualCitation('')
    setManualCaseName('')
    setShowAddCitation(false)
  }

  // Get all citation strings for highlighting in document viewer
  const getCitationPatterns = () => {
    return extractedCitations.map(c => c.citation)
  }

  // Highlight citations in document text
  const getHighlightedDocumentHtml = () => {
    if (!documentText) return ''

    let html = documentText
    const patterns = getCitationPatterns()

    // Escape HTML first
    html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

    // Highlight each citation
    patterns.forEach(pattern => {
      const escapedPattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const regex = new RegExp(`(${escapedPattern})`, 'gi')
      html = html.replace(regex, '<mark class="citation-highlight">$1</mark>')
    })

    // Also highlight any citation patterns that might have been missed
    // Neutral citations: [YYYY] COURT NUM
    html = html.replace(
      /(\[\d{4}\]\s+(?:UKSC|UKPC|UKHL|EWCA\s+(?:Civ|Crim)|EWHC|UKUT|UKEAT|CSIH|CSOH)\s+\d+(?:\s*\([A-Za-z]+\))?)/gi,
      (match) => {
        // Only wrap if not already wrapped
        if (match.includes('citation-highlight')) return match
        return `<mark class="citation-highlight potential">${match}</mark>`
      }
    )

    // Convert newlines to paragraphs
    html = html.split(/\n\n+/).map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('')

    return html
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
        {/* Splash Page - Full Screen Welcome */}
        {view === 'splash' && (
          <motion.div
            className="splash-page"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            <div className="splash-content">
              <div className="splash-header">
                <div className="splash-logo">
                  <Scale size={48} />
                </div>
                <h1>Citation Auditor</h1>
                <p className="splash-tagline">Deterministic verification of legal citations</p>
              </div>

              <div className="splash-motto">
                <p>"AI is not perfect - always check your work"</p>
              </div>

              <div className="splash-section">
                <h2>What is this tool?</h2>
                <p>
                  Citation Auditor helps identify potentially fabricated legal citations in AI-generated
                  legal documents. It checks whether cited cases actually exist on official legal databases
                  (BAILII and Find Case Law).
                </p>
              </div>

              <div className="splash-section">
                <h2>Why do citation hallucinations happen?</h2>
                <p>
                  LLMs sometimes retrieve accurate information, sometimes draw from unreliable sources,
                  and sometimes invent content entirely. Hallucinations are more likely in <em>edge cases</em>:
                  obscure topics, older cases, specific jurisdictions, or novel legal questions where
                  training data is sparse or conflicting.
                </p>
                <p className="hallucination-note">
                  <a href="https://naturalandartificiallaw.com/" target="_blank" rel="noopener noreferrer">Matthew Lee</a> has
                  identified <strong>8 types of legal citation hallucinations</strong>, ranging from completely
                  fabricated cases to subtle misstatements of ratio. This tool currently detects only <em>Type 1:
                  Fabricated Case & Citation</em> - where the case simply does not exist. See the "How It Works"
                  section in the main app for the full taxonomy.
                </p>
                <div className="hallucination-examples">
                  <div className="example-item">
                    <strong>Type 1 - Pure invention:</strong>
                    <span>A case name and citation that do not exist at all - this is what we check</span>
                  </div>
                  <div className="example-item">
                    <strong>Types 2-8 - Subtle errors:</strong>
                    <span>Wrong citation for real case, misstated facts/ratio, conflated authorities, and more</span>
                  </div>
                  <div className="example-item">
                    <strong>Confidently presented:</strong>
                    <span>LLMs present all citations with equal confidence - fabricated or real</span>
                  </div>
                </div>
              </div>

              <div className="splash-section highlight-section">
                <h2>No AI in this tool</h2>
                <p>
                  This tool uses <strong>no LLMs or AI</strong> for verification. It is fully deterministic:
                  citations are matched against official databases using exact pattern matching and API lookups.
                  The same input will always produce the same output.
                </p>
                <div className="deterministic-badge">
                  <Shield size={20} />
                  <span>100% Deterministic - No AI/LLM Used</span>
                </div>
              </div>

              <div className="splash-section">
                <h2>How it works</h2>
                <div className="splash-steps">
                  <div className="splash-step">
                    <span className="step-num">1</span>
                    <div>
                      <strong>Local document parsing</strong>
                      <p>Your document is processed in your browser - content never leaves your device</p>
                    </div>
                  </div>
                  <div className="splash-step">
                    <span className="step-num">2</span>
                    <div>
                      <strong>Citation extraction</strong>
                      <p>Legal citations are identified using regex pattern matching</p>
                    </div>
                  </div>
                  <div className="splash-step">
                    <span className="step-num">3</span>
                    <div>
                      <strong>Database verification</strong>
                      <p>Each citation is checked against BAILII and Find Case Law databases</p>
                    </div>
                  </div>
                  <div className="splash-step">
                    <span className="step-num">4</span>
                    <div>
                      <strong>Manual review</strong>
                      <p>You review the judgment text to verify legal propositions yourself</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="splash-section warning-section">
                <h2>Important Disclaimer</h2>
                <ul className="disclaimer-list">
                  <li>This tool provides <strong>indications only</strong>, not definitive legal verification</li>
                  <li>A "not found" result does not guarantee a case is fabricated - it may exist in databases we don't search</li>
                  <li>A "found" result does not guarantee the legal proposition attributed to it is correct</li>
                  <li>This tool is <strong>not a substitute</strong> for proper legal research by a qualified professional</li>
                  <li>You are solely responsible for verifying any citations before relying on them</li>
                </ul>
              </div>

              <div className="splash-accept">
                <p className="accept-text">
                  By continuing, you acknowledge that you have read and understood the above information,
                  and accept full responsibility for how you use the results of this tool.
                </p>
                <button
                  className="continue-btn"
                  onClick={() => setView('upload')}
                >
                  I Understand - Continue to Tool
                  <ChevronRight size={20} />
                </button>
              </div>

              <div className="splash-footer">
                <p>
                  Inspired by <a href="https://naturalandartificiallaw.com/" target="_blank" rel="noopener noreferrer">Matthew Lee's research</a> on
                  AI hallucinations in legal practice.
                </p>
              </div>
            </div>
          </motion.div>
        )}

        {/* Upload View - Simple Upload Page */}
        {view === 'upload' && (
          <motion.div
            className="upload-view"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
          >
            {/* Hero Section */}
            <div className="landing-hero">
              <h1>Citation Auditor</h1>
              <p className="hero-subtitle">Verify legal citations against official databases</p>
            </div>

            {/* Upload Section */}
            <div className="upload-section">
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.txt,.html,.doc,.docx,application/pdf,text/plain,text/html,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
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
                    <span className="upload-text">Drop your document here or tap to browse</span>
                    <span className="file-types">PDF, Word, TXT, HTML</span>
                  </div>
                )}
              </div>

              <div className="input-divider">
                <span>or paste text directly</span>
              </div>

              <textarea
                className="paste-textarea"
                placeholder="Paste LLM output or any text containing legal citations here..."
                value={documentText}
                onChange={(e) => {
                  setDocumentText(e.target.value)
                  setUploadedFile(null) // Clear file if user pastes text
                }}
              />

              {(uploadedFile || documentText.trim().length > 50) && (
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
            </div>

            {/* Privacy Note */}
            <div className="privacy-note">
              <Shield size={16} />
              <span>Your text is processed locally and never stored on our servers</span>
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
                <div className="panel-actions">
                  <button
                    className="view-doc-btn"
                    onClick={() => setShowDocumentViewer(!showDocumentViewer)}
                    title={showDocumentViewer ? "Hide document" : "View document"}
                  >
                    {showDocumentViewer ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                  <button className="back-btn" onClick={clearFile}>
                    <X size={16} />
                  </button>
                </div>
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
                      {item.status === 'done' && item.result?.outcome === 'verified' && <CheckCircle2 size={14} className="icon-verified" />}
                      {item.status === 'done' && item.result?.outcome === 'not_found' && <XCircle size={14} className="icon-not-found" />}
                      {item.status === 'done' && item.result?.outcome === 'needs_review' && <AlertCircle size={14} className="icon-review" />}
                    </div>
                    <div className="citation-item-content">
                      <span className="citation-case-name">{item.caseName || 'Unknown Case'}</span>
                      <span className="citation-ref">{item.citation}</span>
                    </div>
                    <ChevronRight size={14} className="chevron" />
                  </div>
                ))}
              </div>

              {/* Citation count warning */}
              {extractedCitations.length >= 20 && (
                <div className="citation-warning">
                  <AlertCircle size={14} />
                  <span>Large document: {extractedCitations.length} citations found. Use "View Document" to check for missed citations.</span>
                </div>
              )}

              {/* Add Citation Button */}
              {!showAddCitation ? (
                <button
                  className="add-citation-btn"
                  onClick={() => setShowAddCitation(true)}
                >
                  <Plus size={14} />
                  Add Citation
                </button>
              ) : (
                <div className="add-citation-form">
                  <input
                    type="text"
                    placeholder="Citation (e.g., [2019] UKSC 12)"
                    value={manualCitation}
                    onChange={(e) => setManualCitation(e.target.value)}
                    autoFocus
                  />
                  <input
                    type="text"
                    placeholder="Case name (optional)"
                    value={manualCaseName}
                    onChange={(e) => setManualCaseName(e.target.value)}
                  />
                  <div className="add-citation-actions">
                    <button onClick={handleAddManualCitation} disabled={!manualCitation.trim()}>
                      Add
                    </button>
                    <button onClick={() => { setShowAddCitation(false); setManualCitation(''); setManualCaseName(''); }}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}

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
                    Run Audit ({extractedCitations.filter(c => c.status === 'pending').length} citations)
                  </button>
                </div>
              )}
            </div>

            {/* Document Viewer Panel */}
            {showDocumentViewer && documentText && (
              <div className="document-viewer-panel">
                <div className="doc-viewer-header">
                  <h3>Document Preview</h3>
                  <div className="doc-viewer-info">
                    <span className="highlight-legend">
                      <span className="highlight-dot detected"></span> Detected
                    </span>
                    <span className="highlight-legend">
                      <span className="highlight-dot potential"></span> Potential (click to add)
                    </span>
                  </div>
                  <button onClick={() => setShowDocumentViewer(false)}>
                    <X size={16} />
                  </button>
                </div>
                <div className="doc-viewer-search">
                  <Search size={14} />
                  <input
                    type="text"
                    placeholder="Search document..."
                    value={documentSearch}
                    onChange={(e) => setDocumentSearch(e.target.value)}
                  />
                </div>
                <div
                  className="doc-viewer-content"
                  dangerouslySetInnerHTML={{ __html: getHighlightedDocumentHtml() }}
                  onClick={(e) => {
                    // Handle clicking on potential citations to add them
                    const target = e.target as HTMLElement
                    if (target.classList.contains('potential')) {
                      const citationText = target.textContent || ''
                      if (citationText && !extractedCitations.find(c => c.citation.toLowerCase() === citationText.toLowerCase())) {
                        setManualCitation(citationText)
                        setShowAddCitation(true)
                      }
                    }
                  }}
                />
                <div className="doc-viewer-footer">
                  <span>Document processed locally. Content never leaves your browser.</span>
                </div>
              </div>
            )}

            {/* Right Panel - Detail View with Split Layout */}
            <div className="detail-panel">
              {selectedItem ? (
                <div className="detail-content split-layout">
                  {/* Left Column - Case Info & Source */}
                  <div className="detail-left-column">
                    <div className="detail-header">
                      <div className={`outcome-badge large ${selectedItem.result?.outcome || 'pending'}`}>
                        {selectedItem.status === 'pending' && 'Pending'}
                        {selectedItem.status === 'resolving' && 'Resolving...'}
                        {selectedItem.status === 'verifying' && 'Processing...'}
                        {selectedItem.status === 'done' && selectedItem.result?.outcome === 'verified' && 'Case Found'}
                        {selectedItem.status === 'done' && selectedItem.result?.outcome === 'not_found' && 'Not Found'}
                        {selectedItem.status === 'done' && selectedItem.result?.outcome === 'needs_review' && 'Needs Review'}
                      </div>
                      <div className="tooltip-trigger">
                        <HelpCircle size={14} />
                        <div className="tooltip">
                          <strong>Case Found:</strong> Citation exists in database<br/>
                          <strong>Not Found:</strong> Potential fabricated case<br/>
                          <strong>Review:</strong> Manual verification needed
                        </div>
                      </div>
                    </div>

                    <div className="detail-section case-info-compact">
                      <h3>
                        Case
                        <span className="tooltip-trigger inline">
                          <HelpCircle size={12} />
                          <div className="tooltip">The case name and citation extracted from your document</div>
                        </span>
                      </h3>
                      <p className="case-name-display">{selectedItem.caseName || 'Unknown Case Name'}</p>
                      <p className="citation-display">{selectedItem.citation}</p>
                      {selectedItem.result?.title && selectedItem.result.title !== selectedItem.caseName && (
                        <p className="official-title">Official: {selectedItem.result.title}</p>
                      )}
                      {selectedItem.result?.url && selectedItem.result?.caseFound && (
                        <a
                          href={selectedItem.result.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="source-link"
                        >
                          View on {selectedItem.result.sourceType === 'fcl' ? 'Find Case Law' : 'BAILII'} <ExternalLink size={14} />
                        </a>
                      )}
                    </div>

                    {/* Source Paragraph - Compact */}
                    {selectedItem.sourceParagraph && (
                      <div className="detail-section source-section-compact">
                        <h3>
                          Your Document
                          <span className="para-badge">[{selectedItem.sourceParagraph.paragraphNumber}]</span>
                          <span className="tooltip-trigger inline">
                            <HelpCircle size={12} />
                            <div className="tooltip">The paragraph from your document where this citation appears</div>
                          </span>
                        </h3>
                        <div className="source-paragraph-compact">
                          <p>{selectedItem.sourceParagraph.text.length > 300
                            ? selectedItem.sourceParagraph.text.slice(0, 300) + '...'
                            : selectedItem.sourceParagraph.text}</p>
                        </div>
                      </div>
                    )}

                    {selectedItem.result?.caseFound === false && (
                      <div className="warning-box compact">
                        <AlertCircle size={16} />
                        <div>
                          <strong>Potential Hallucination</strong>
                          <p>This citation could not be found. The case may be fabricated or exist in a database we don't search.</p>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Right Column - Judgment Viewer */}
                  <div className="detail-right-column">
                    {selectedItem.result?.judgmentParagraphs && selectedItem.result.judgmentParagraphs.length > 0 ? (
                      <div className="judgment-viewer-full">
                        <div className="judgment-header">
                          <h3>
                            Judgment Text
                            <span className="tooltip-trigger inline">
                              <HelpCircle size={12} />
                              <div className="tooltip">Full text from the official case database. Search to find relevant passages.</div>
                            </span>
                          </h3>
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
                            placeholder="Search judgment text..."
                            value={judgmentSearch}
                            onChange={(e) => setJudgmentSearch(e.target.value)}
                          />
                          {judgmentSearch && (
                            <button className="clear-search" onClick={() => setJudgmentSearch('')}>
                              <X size={12} />
                            </button>
                          )}
                        </div>
                        <div className="judgment-content-scrollable">
                          {(() => {
                            const searchLower = judgmentSearch.toLowerCase()

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
                              let displayText = para.text

                              // Highlight search terms
                              if (judgmentSearch) {
                                const regex = new RegExp(`(${judgmentSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
                                displayText = para.text.replace(regex, '<mark>$1</mark>')
                              }

                              return (
                                <div
                                  key={idx}
                                  className="judgment-para"
                                  id={`para-${para.para_num}`}
                                >
                                  <span className="para-num">[{para.para_num}]</span>
                                  {para.speaker && <span className="para-speaker">{para.speaker}:</span>}
                                  <p dangerouslySetInnerHTML={{ __html: displayText }} />
                                </div>
                              )
                            })
                          })()}
                        </div>
                      </div>
                    ) : selectedItem.result?.caseFound ? (
                      <div className="judgment-placeholder">
                        <BookOpen size={32} />
                        <p>Judgment text loading...</p>
                        {selectedItem.result?.url && (
                          <a href={selectedItem.result.url} target="_blank" rel="noopener noreferrer" className="source-link">
                            View on {selectedItem.result.sourceType === 'fcl' ? 'Find Case Law' : 'BAILII'} <ExternalLink size={14} />
                          </a>
                        )}
                      </div>
                    ) : (
                      <div className="judgment-placeholder not-found">
                        <XCircle size={32} />
                        <p>No judgment text available</p>
                        <span className="placeholder-hint">This citation could not be found in our databases</span>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="detail-placeholder">
                  <BookOpen size={48} />
                  <p>Select a citation to view details</p>
                  <span className="placeholder-hint">Click on any citation in the list to see case information and judgment text</span>
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
