import type { TemplateMeta } from '@docvault/core';

/**
 * Placeholders the template engine always auto-fills (mirrors core's
 * `BUILTIN_VARIABLES`). Inlined rather than imported because importing a runtime
 * value from `@docvault/core` would drag node-only modules (fs, etc.) into the
 * renderer bundle — renderer code only ever type-imports from core.
 */
const BUILTIN_VARIABLES = ['title', 'date', 'author'];

/**
 * The custom `{{variables}}` a template declares that the user must fill in,
 * i.e. everything except the built-ins (title/date/author) the instantiation
 * flow auto-fills. Order is preserved from the template's declaration order.
 */
export function customVariables(template: Pick<TemplateMeta, 'variables'>): string[] {
  const builtins = new Set<string>(BUILTIN_VARIABLES);
  return template.variables.filter((v) => !builtins.has(v));
}
