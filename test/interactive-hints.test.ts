import { describe, expect, it } from 'vitest';

import {
  INTERACTIVE_KEYBOARD_HINTS,
  formatInteractiveKeyboardHints,
} from '../src/interactive-hints';
import { stripAnsi } from './strip-ansi';

describe('interactive keyboard hints', () => {
  it('lists multiselect shortcuts', () => {
    expect(INTERACTIVE_KEYBOARD_HINTS).toEqual([
      { keys: '↑/↓', description: 'navigate' },
      { keys: 'Space', description: 'toggle' },
      { keys: 'a', description: 'toggle all' },
      { keys: 'i', description: 'invert selection' },
      { keys: 'Enter', description: 'confirm' },
      { keys: 'Ctrl+C', description: 'cancel' },
    ]);
  });

  it('formats hints for display', () => {
    const plainHints = INTERACTIVE_KEYBOARD_HINTS.map(
      ({ keys, description }) => `${keys} ${description}`
    );

    expect(stripAnsi(formatInteractiveKeyboardHints())).toBe(
      plainHints.join(' • ')
    );
  });
});
