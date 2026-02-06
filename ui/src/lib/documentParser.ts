/**
 * Client-side document parsing
 * Documents are processed entirely in the browser - no content sent to server
 */

import * as pdfjsLib from 'pdfjs-dist';
import mammoth from 'mammoth';

// Configure PDF.js worker
// Use unpkg CDN with exact version match for reliability
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

/**
 * Extract text from a PDF file in the browser.
 * 
 * Uses PDF.js text item positioning to reconstruct proper line breaks
 * and paragraph structure. PDF text items are positioned fragments -
 * we detect vertical gaps between items to insert newlines, preserving
 * the document structure that citation extraction depends on.
 */
async function extractPdfText(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  
  const pageTexts: string[] = [];
  
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    
    if (!textContent.items || textContent.items.length === 0) {
      continue;
    }

    // Reconstruct text with proper line breaks using item positions.
    // Each PDF text item has a transform matrix [a, b, c, d, tx, ty]
    // where ty is the vertical position (higher = further up the page).
    const lines: string[] = [];
    let currentLine = '';
    let lastY: number | null = null;
    let lastEndX: number | null = null;

    for (const item of textContent.items as any[]) {
      if (!item.str && !item.hasEOL) continue;

      const ty = item.transform ? item.transform[5] : null;
      const tx = item.transform ? item.transform[4] : null;
      const fontSize = item.transform ? Math.abs(item.transform[0]) : 12;

      // Detect line break: significant vertical gap between items
      if (lastY !== null && ty !== null) {
        const yDiff = Math.abs(lastY - ty);

        if (yDiff > fontSize * 0.5) {
          // New line - push current line and start fresh
          if (currentLine.trim()) {
            lines.push(currentLine.trim());
          }
          currentLine = '';

          // Large vertical gap = paragraph break
          if (yDiff > fontSize * 1.5) {
            lines.push('');
          }
        } else if (lastEndX !== null && tx !== null) {
          // Same line - check horizontal gap for word spacing
          const xGap = tx - lastEndX;
          if (xGap > fontSize * 0.3 && currentLine && !currentLine.endsWith(' ')) {
            currentLine += ' ';
          }
        }
      }

      currentLine += item.str || '';

      if (ty !== null) lastY = ty;
      if (tx !== null && item.width) {
        lastEndX = tx + item.width;
      } else {
        lastEndX = null;
      }

      // PDF.js explicit end-of-line marker
      if (item.hasEOL) {
        if (currentLine.trim()) {
          lines.push(currentLine.trim());
        }
        currentLine = '';
      }
    }

    // Don't forget the last line
    if (currentLine.trim()) {
      lines.push(currentLine.trim());
    }

    const pageText = lines.join('\n');
    if (pageText.trim()) {
      pageTexts.push(pageText);
    }
  }
  
  return pageTexts.join('\n\n');
}

/**
 * Extract text from a DOCX file in the browser
 */
async function extractDocxText(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value;
}

/**
 * Extract text from an HTML file in the browser
 */
async function extractHtmlText(file: File): Promise<string> {
  const html = await file.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  return doc.body.textContent || '';
}

/**
 * Extract text from a plain text file
 */
async function extractPlainText(file: File): Promise<string> {
  return await file.text();
}

/**
 * Main function to extract text from any supported file type
 * All processing happens client-side - no data sent to server
 */
export async function extractTextFromFile(file: File): Promise<string> {
  const fileName = file.name.toLowerCase();
  const mimeType = file.type;

  // Determine file type and extract accordingly
  if (mimeType === 'application/pdf' || fileName.endsWith('.pdf')) {
    return extractPdfText(file);
  }
  
  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    fileName.endsWith('.docx')
  ) {
    return extractDocxText(file);
  }
  
  if (mimeType === 'text/html' || fileName.endsWith('.html') || fileName.endsWith('.htm')) {
    return extractHtmlText(file);
  }
  
  if (mimeType === 'text/plain' || fileName.endsWith('.txt')) {
    return extractPlainText(file);
  }

  // Fallback: try as plain text
  return extractPlainText(file);
}

/**
 * Get file type description for UI
 */
export function getFileTypeDescription(file: File): string {
  const fileName = file.name.toLowerCase();
  if (fileName.endsWith('.pdf')) return 'PDF Document';
  if (fileName.endsWith('.docx')) return 'Word Document';
  if (fileName.endsWith('.html') || fileName.endsWith('.htm')) return 'HTML Document';
  if (fileName.endsWith('.txt')) return 'Text File';
  return 'Document';
}
