import { readFile } from 'node:fs/promises';

/** Extract plain text from a .txt file (identity read). */
export async function extractTxt(absPath: string): Promise<string> {
  return readFile(absPath, 'utf8');
}
