import mammoth from 'mammoth';

/**
 * Extract text from a .docx file using mammoth. We use extractRawText for a
 * reliable, well-typed plain-text result (the desktop app renders the original
 * .docx faithfully via docx-preview; this sidecar exists for search + agents).
 */
export async function extractDocx(absPath: string): Promise<string> {
  const { value } = await mammoth.extractRawText({ path: absPath });
  return value.trim();
}
