/**
 * Extract raw text from a PDF file by rendering each page to a canvas
 * and extracting the embedded text layer using PDF.js.
 *
 * Worker is served locally from /public/pdf.worker.min.mjs to avoid
 * CDN dependency issues (no network required, no CORS problems).
 */
export async function extractTextFromPDF(file: File): Promise<string> {
  const pdfjsLib = await import('pdfjs-dist');

  // Use the locally copied worker (copied from node_modules at build time).
  // This avoids unpkg CDN failures and version mismatches.
  pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

  const arrayBuffer = await file.arrayBuffer();

  let pdf: Awaited<ReturnType<typeof pdfjsLib.getDocument>['promise']>;
  try {
    pdf = await pdfjsLib.getDocument({
      data: new Uint8Array(arrayBuffer),
      // Suppress warnings about missing CMap resources for obscure fonts
      cMapUrl: 'https://unpkg.com/pdfjs-dist@6.0.227/cmaps/',
      cMapPacked: true,
      // Disable range requests which can fail in some environments
      disableRange: true,
      disableStream: true,
    }).promise;
  } catch (err: any) {
    throw new Error(
      `Failed to load PDF: ${err?.message || 'Unknown error'}. ` +
      'Make sure the file is a valid, non-password-protected PDF.'
    );
  }

  let fullText = '';

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();

    const pageText = content.items
      .map((item: any) => {
        // Each item has a `str` (text) and `hasEOL` (end of line)
        const text = item.str ?? '';
        const eol = item.hasEOL ? '\n' : ' ';
        return text + eol;
      })
      .join('');

    fullText += pageText + '\n';
  }

  return fullText.trim();
}


/**
 * Extract text from an image file using Tesseract.js OCR.
 */
export async function extractTextFromImage(file: File): Promise<string> {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('eng', 1, {
    // Suppress verbose Tesseract logs
    logger: () => {},
  });
  const url = URL.createObjectURL(file);
  try {
    const { data } = await worker.recognize(url);
    return data.text;
  } finally {
    await worker.terminate();
    URL.revokeObjectURL(url);
  }
}

/**
 * Unified entry point: routes to the correct extractor based on MIME type.
 */
export async function extractText(file: File): Promise<string> {
  if (file.type === 'application/pdf') {
    return await extractTextFromPDF(file);
  }
  // For images (PNG, JPEG, WEBP) use OCR
  return await extractTextFromImage(file);
}
