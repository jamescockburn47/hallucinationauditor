/**
 * Client-side judgment parser
 *
 * Parses BAILII HTML and FCL XML judgment documents in the browser.
 * No server-side processing needed.
 *
 * PRIVACY: All parsing happens in the browser. Judgment content
 * (which is public data) is processed locally.
 */

export interface JudgmentParagraph {
  para_num: string;
  text: string;
  speaker?: string | null;
}

export interface ParsedJudgment {
  title: string;
  paragraphs: JudgmentParagraph[];
  source: 'bailii' | 'fcl' | 'unknown';
  url: string;
}

/**
 * Detect whether content is BAILII HTML, FCL XML, or unknown
 */
function detectContentType(content: string, url: string): 'bailii_html' | 'fcl_xml' | 'unknown' {
  if (url.includes('caselaw.nationalarchives.gov.uk') && content.includes('<akomaNtoso')) {
    return 'fcl_xml';
  }
  if (url.includes('bailii.org') || content.includes('bailii.org')) {
    return 'bailii_html';
  }
  if (content.includes('<akomaNtoso') || content.includes('<FRBRWork')) {
    return 'fcl_xml';
  }
  if (content.includes('<html') || content.includes('<HTML')) {
    return 'bailii_html';
  }
  return 'unknown';
}

/**
 * Parse BAILII HTML judgment into structured paragraphs
 */
function parseBailiiHtml(html: string, url: string): ParsedJudgment {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  // Extract title
  const titleEl = doc.querySelector('title');
  let title = titleEl?.textContent?.trim() || 'Unknown Case';
  // Clean up BAILII title format
  title = title.replace(/\s*\[.*?\]\s*$/, '').trim();
  if (title.startsWith('BAILII - ')) {
    title = title.slice(9);
  }

  const paragraphs: JudgmentParagraph[] = [];

  // Strategy 1: Look for numbered paragraphs [1], [2], etc. in the text
  const bodyText = doc.body?.textContent || '';
  const paraPattern = /\[(\d+)\]\s+([\s\S]*?)(?=\[\d+\]|$)/g;
  let match;

  while ((match = paraPattern.exec(bodyText)) !== null) {
    const paraNum = match[1];
    let text = match[2].trim();

    // Clean up whitespace
    text = text.replace(/\s+/g, ' ').trim();

    if (text.length > 20) {
      // Try to detect speaker (e.g., "LORD REED:", "Lady Hale:")
      let speaker: string | null = null;
      const speakerMatch = text.match(/^((?:LORD|LADY|SIR|DAME|MR|MRS|MS)\s+(?:JUSTICE\s+)?[A-Z][A-Za-z\s]+?)(?:\s*:|\s*\()/i);
      if (speakerMatch) {
        speaker = speakerMatch[1].trim();
      }

      paragraphs.push({
        para_num: paraNum,
        text,
        speaker,
      });
    }
  }

  // Strategy 2: If no numbered paragraphs found, split by <p> tags or double newlines
  if (paragraphs.length === 0) {
    const pElements = doc.querySelectorAll('p, blockquote');
    let paraNum = 1;

    pElements.forEach((el) => {
      const text = el.textContent?.trim() || '';
      if (text.length > 30) {
        paragraphs.push({
          para_num: String(paraNum++),
          text,
        });
      }
    });
  }

  return {
    title,
    paragraphs,
    source: 'bailii',
    url,
  };
}

/**
 * Parse FCL Akoma Ntoso XML judgment into structured paragraphs
 */
function parseFclXml(xml: string, url: string): ParsedJudgment {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'text/xml');

  // Check for parse errors
  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    // Fall back to treating as text
    return parsePlainText(xml, url, 'fcl');
  }

  // Extract title - try multiple locations
  let title = 'Unknown Case';

  // Try FRBRWork name
  const nameEl = doc.querySelector('FRBRWork FRBRname');
  if (nameEl) {
    title = nameEl.getAttribute('value') || title;
  }

  // Try proprietary metadata
  const docTitle = doc.querySelector('proprietary uk\\:court, proprietary court');
  if (!nameEl && docTitle) {
    title = docTitle.textContent || title;
  }

  // Try header
  const headerEl = doc.querySelector('header p, header block');
  if (headerEl && !nameEl) {
    const headerText = headerEl.textContent?.trim() || '';
    if (headerText.length > 5 && headerText.length < 200) {
      title = headerText;
    }
  }

  const paragraphs: JudgmentParagraph[] = [];

  // Extract paragraphs from judgmentBody
  const paraElements = doc.querySelectorAll('paragraph, p[eId]');

  paraElements.forEach((el, idx) => {
    const eId = el.getAttribute('eId') || '';
    const paraNum = eId.replace(/[^0-9]/g, '') || String(idx + 1);

    // Get text content, excluding nested metadata
    let text = '';
    el.querySelectorAll('content, num, p').forEach(child => {
      text += (child.textContent || '') + ' ';
    });

    if (!text.trim()) {
      text = el.textContent || '';
    }

    text = text.replace(/\s+/g, ' ').trim();

    if (text.length > 20) {
      paragraphs.push({
        para_num: paraNum,
        text,
      });
    }
  });

  // Fallback: if no structured paragraphs, try to extract from judgmentBody text
  if (paragraphs.length === 0) {
    const bodyEl = doc.querySelector('judgmentBody, body');
    if (bodyEl) {
      const bodyText = bodyEl.textContent || '';
      return parsePlainText(bodyText, url, 'fcl');
    }
  }

  return {
    title,
    paragraphs,
    source: 'fcl',
    url,
  };
}

/**
 * Parse plain text into paragraphs (fallback)
 */
function parsePlainText(text: string, url: string, source: 'bailii' | 'fcl' | 'unknown' = 'unknown'): ParsedJudgment {
  const paragraphs: JudgmentParagraph[] = [];

  // Try numbered paragraph extraction
  const paraPattern = /\[(\d+)\]\s+([\s\S]*?)(?=\[\d+\]|$)/g;
  let match;

  while ((match = paraPattern.exec(text)) !== null) {
    const paraText = match[2].replace(/\s+/g, ' ').trim();
    if (paraText.length > 20) {
      paragraphs.push({
        para_num: match[1],
        text: paraText,
      });
    }
  }

  // Fallback: split by double newlines
  if (paragraphs.length === 0) {
    const chunks = text.split(/\n\n+/);
    chunks.forEach((chunk, idx) => {
      const trimmed = chunk.replace(/\s+/g, ' ').trim();
      if (trimmed.length > 30) {
        paragraphs.push({
          para_num: String(idx + 1),
          text: trimmed,
        });
      }
    });
  }

  return {
    title: 'Unknown Case',
    paragraphs,
    source,
    url,
  };
}

/**
 * Parse judgment content (HTML or XML) into structured paragraphs.
 * Runs entirely in the browser.
 */
export function parseJudgment(content: string, url: string): ParsedJudgment {
  const contentType = detectContentType(content, url);

  switch (contentType) {
    case 'bailii_html':
      return parseBailiiHtml(content, url);
    case 'fcl_xml':
      return parseFclXml(content, url);
    default:
      return parsePlainText(content, url);
  }
}

/**
 * Validate that fetched content looks like a real judgment (not a 404/error page)
 */
export function isValidJudgmentContent(content: string, url: string): boolean {
  if (!content || content.length < 500) return false;

  const lower = content.toLowerCase();

  // Check for error pages
  const errorIndicators = [
    'page not found',
    'error 404',
    '404 not found',
    'not found on this server',
    'this page does not exist',
  ];

  for (const indicator of errorIndicators) {
    if (lower.slice(0, 1000).includes(indicator)) {
      return false;
    }
  }

  // For FCL XML, check for Akoma Ntoso structure
  if (url.includes('caselaw.nationalarchives.gov.uk') || url.endsWith('.xml')) {
    return content.includes('<akomaNtoso') || content.includes('<FRBRWork');
  }

  // For BAILII HTML, check for legal content indicators
  const legalIndicators = [
    'judgment', 'court', 'justice', 'appeal', 'claimant',
    'defendant', 'respondent', 'appellant', 'held', 'ordered',
  ];

  const matches = legalIndicators.filter(ind => lower.includes(ind));
  return matches.length >= 2;
}
