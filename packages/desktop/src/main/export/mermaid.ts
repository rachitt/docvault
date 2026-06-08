import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { BrowserWindow } from 'electron';

const require = createRequire(import.meta.url);

/**
 * Light-theme Mermaid variables for export — mirrors the in-app LIGHT_VARS so a
 * diagram looks the same on the exported page (which is always a light document)
 * as it does in the editor. Kept in sync with renderer/editor/Mermaid.tsx.
 */
const LIGHT_VARS = {
  primaryColor: '#ede9fe',
  primaryBorderColor: '#7c3aed',
  primaryTextColor: '#312e81',
  nodeTextColor: '#312e81',
  lineColor: '#8b5cf6',
  secondaryColor: '#f5f3ff',
  tertiaryColor: '#faf5ff',
  actorBkg: '#ede9fe',
  actorBorder: '#7c3aed',
  actorTextColor: '#312e81',
  signalColor: '#6d28d9',
  signalTextColor: '#312e81',
  labelBoxBkgColor: '#ede9fe',
  labelBoxBorderColor: '#7c3aed',
  labelTextColor: '#312e81',
  loopTextColor: '#312e81',
  noteBkgColor: '#fef9c3',
  noteBorderColor: '#eab308',
  noteTextColor: '#422006',
  fontFamily: 'ui-sans-serif, system-ui, sans-serif',
  fontSize: '14px',
};

/**
 * Renders Mermaid diagram sources to SVG (and optionally PNG) inside a single
 * hidden, reusable BrowserWindow — the only place that can run Mermaid, which
 * needs a real DOM. The window is created lazily on first render and disposed by
 * the caller when an export batch finishes. Mermaid runs with securityLevel
 * 'strict' + SVG text labels (no foreignObject HTML), matching the editor's
 * hardened posture so agent/import-authored diagrams can't inject markup.
 */
export class MermaidRenderer {
  private win: BrowserWindow | null = null;
  private ready: Promise<void> | null = null;
  private seq = 0;

  private async ensure(): Promise<BrowserWindow> {
    if (this.win && !this.win.isDestroyed()) {
      await this.ready;
      return this.win;
    }
    const win = new BrowserWindow({
      show: false,
      width: 1200,
      height: 900,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    this.win = win;
    this.ready = (async () => {
      await win.loadURL('about:blank');
      const mermaidSrc = await readFile(require.resolve('mermaid/dist/mermaid.min.js'), 'utf8');
      // The UMD bundle's completion value isn't structured-cloneable, which makes
      // executeJavaScript reject with "An object could not be cloned"; append a
      // primitive statement so the call resolves cleanly.
      await win.webContents.executeJavaScript(`${mermaidSrc}\n;true`);
      await win.webContents.executeJavaScript(
        `mermaid.initialize(${JSON.stringify({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: 'base',
          htmlLabels: false,
          flowchart: { htmlLabels: false },
          themeVariables: LIGHT_VARS,
        })}); 'ok'`,
      );
    })();
    await this.ready;
    return win;
  }

  /** Render one diagram to an SVG string. Throws if the source is invalid. */
  async renderSvg(code: string): Promise<string> {
    const win = await this.ensure();
    const id = `dv-export-${this.seq++}`;
    // Catch in-page and return a plain cloneable object: a thrown Error would
    // come back across the IPC boundary as the opaque "An object could not be
    // cloned", hiding the real Mermaid parse/render message.
    const res = (await win.webContents.executeJavaScript(`(async () => {
      try {
        const r = await mermaid.render(${JSON.stringify(id)}, ${JSON.stringify(code)});
        return { ok: true, svg: r.svg };
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) };
      }
    })()`)) as { ok: true; svg: string } | { ok: false; error: string };
    if (!res.ok) throw new Error(res.error);
    return res.svg;
  }

  /**
   * Render one diagram to a PNG data URI by drawing the SVG onto a canvas at the
   * given scale. Used for DOCX, which can't embed inline SVG.
   */
  async renderPngDataUri(code: string, scale = 2): Promise<string> {
    const win = await this.ensure();
    const svg = await this.renderSvg(code);
    return win.webContents.executeJavaScript(`(async () => {
      const svg = ${JSON.stringify(svg)};
      const blobUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = blobUrl; });
      const w = (img.naturalWidth || 800), h = (img.naturalHeight || 600);
      const canvas = document.createElement('canvas');
      canvas.width = w * ${scale}; canvas.height = h * ${scale};
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.scale(${scale}, ${scale});
      ctx.drawImage(img, 0, 0, w, h);
      return canvas.toDataURL('image/png');
    })()`);
  }

  dispose(): void {
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
    this.ready = null;
  }
}
