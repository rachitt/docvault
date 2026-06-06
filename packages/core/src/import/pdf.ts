import { readFile } from 'node:fs/promises';
import { extractText, getDocumentProxy } from 'unpdf';

/** Extract text from a PDF using unpdf (a node-friendly pdf.js wrapper). */
export async function extractPdf(absPath: string): Promise<string> {
  const buffer = await readFile(absPath);
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: true });
  return (Array.isArray(text) ? text.join('\n\n') : text).trim();
}
