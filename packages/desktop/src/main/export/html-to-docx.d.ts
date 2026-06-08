declare module 'html-to-docx' {
  interface DocxOptions {
    title?: string;
    orientation?: 'portrait' | 'landscape';
    margins?: Record<string, number>;
    [key: string]: unknown;
  }
  /** Converts an HTML string to a .docx document, resolving to its bytes. */
  export default function HTMLtoDOCX(
    htmlString: string,
    headerHTMLString?: string | null,
    documentOptions?: DocxOptions,
    footerHTMLString?: string | null,
  ): Promise<Buffer | ArrayBuffer | Blob>;
}
