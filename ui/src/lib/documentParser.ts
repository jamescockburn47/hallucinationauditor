/**
 * Client-side document parsing
 * Documents are processed entirely in the browser - no content sent to server
 */

import * as pdfjsLib from 'pdfjs-dist';
import mammoth from 'mammoth';

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

/**
 * Extract text from a PDF file in the browser
 */
async function extractPdfText(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  
  const textParts: string[] = [];
  
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item: any) => item.str)
      .join(' ');
    textParts.push(pageText);
  }
  
  return textParts.join('\n\n');
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
