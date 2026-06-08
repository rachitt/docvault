import { describe, expect, it } from 'vitest';
import { BUILTIN_VARIABLES } from '@docvault/core';
import { customVariables } from './templates';

describe('customVariables', () => {
  it('treats exactly core BUILTIN_VARIABLES as built-ins (guard against drift)', () => {
    // The renderer inlines the built-in names to avoid pulling core's node-only
    // runtime into the browser bundle; assert they still match core's source.
    expect(customVariables({ variables: [...BUILTIN_VARIABLES, 'x'] })).toEqual(['x']);
  });


  it('drops the built-in title/date/author placeholders', () => {
    expect(
      customVariables({ variables: ['title', 'date', 'author', 'project', 'owner'] }),
    ).toEqual(['project', 'owner']);
  });

  it('preserves declaration order of the remaining custom variables', () => {
    expect(customVariables({ variables: ['owner', 'title', 'project'] })).toEqual([
      'owner',
      'project',
    ]);
  });

  it('returns an empty list when a template declares only built-ins', () => {
    expect(customVariables({ variables: ['title', 'date'] })).toEqual([]);
  });

  it('returns an empty list when no variables are declared', () => {
    expect(customVariables({ variables: [] })).toEqual([]);
  });
});
