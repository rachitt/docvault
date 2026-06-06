import type { WebContents } from 'electron';
import { EV } from '../shared/ipc.js';

/**
 * AI bridge (backend disconnected).
 *
 * This previously spawned the Claude Code CLI (`claude -p`) headless with the
 * vault as the working directory. That has been removed: a full-permission
 * agent running over untrusted document content is an unacceptable
 * prompt-injection surface. The renderer AI panel still calls `ask`/`cancel`,
 * so the interface is preserved, but no process is launched — requests resolve
 * immediately with a "not connected" notice until a safe backend is wired up.
 */
export class AiBridge {
  ask(sender: WebContents, requestId: string, _prompt: string): void {
    sender.send(EV.aiDone, requestId, 'AI assistant is not connected to a backend yet.');
  }

  cancel(_requestId: string): void {
    // No-op: nothing is running.
  }
}
