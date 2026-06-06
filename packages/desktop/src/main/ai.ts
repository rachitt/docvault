import { spawn, type ChildProcess } from 'node:child_process';
import type { WebContents } from 'electron';
import { EV } from '../shared/ipc.js';

/**
 * Runs the in-app AI assistant by spawning Claude Code (or Codex) in headless
 * mode with the vault as the working directory. No API key required — it reuses
 * the user's logged-in CLI and the registered DocVault MCP for grounded answers.
 */
export class AiBridge {
  private procs = new Map<string, ChildProcess>();

  constructor(
    private readonly vaultDir: string,
    private readonly backend: 'claude' | 'codex' = 'claude',
    /** When false (default) the full answer is delivered once on completion. */
    private readonly streaming = false,
  ) {}

  ask(sender: WebContents, requestId: string, prompt: string): void {
    this.cancel(requestId);
    const { cmd, args } =
      this.backend === 'codex'
        ? { cmd: 'codex', args: ['exec', prompt] }
        : { cmd: 'claude', args: ['-p', prompt] };

    let proc: ChildProcess;
    try {
      proc = spawn(cmd, args, { cwd: this.vaultDir, env: process.env });
    } catch (err) {
      sender.send(EV.aiDone, requestId, String(err));
      return;
    }
    this.procs.set(requestId, proc);

    let buffer = '';
    proc.stdout?.on('data', (d: Buffer) => {
      const text = d.toString();
      if (this.streaming) sender.send(EV.aiChunk, requestId, text);
      else buffer += text;
    });
    proc.stderr?.on('data', (d: Buffer) => {
      // Surface CLI progress/errors quietly to the console, not the chat stream.
      console.error(`[ai:${this.backend}]`, d.toString().trim());
    });
    proc.on('close', (code) => {
      this.procs.delete(requestId);
      if (!this.streaming && buffer) sender.send(EV.aiChunk, requestId, buffer);
      sender.send(EV.aiDone, requestId, code === 0 ? undefined : `exited with code ${code}`);
    });
    proc.on('error', (err) => {
      this.procs.delete(requestId);
      sender.send(EV.aiDone, requestId, err.message);
    });
  }

  cancel(requestId: string): void {
    const proc = this.procs.get(requestId);
    if (proc) {
      proc.kill('SIGTERM');
      this.procs.delete(requestId);
    }
  }
}
