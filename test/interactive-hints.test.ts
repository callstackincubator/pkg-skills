import { describe, expect, it } from 'vitest';

import {
  INTERACTIVE_KEYBOARD_HINTS,
  buildInteractiveActionOptions,
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

  it('builds interactive action options from available work', () => {
    expect(
      buildInteractiveActionOptions({
        updateCount: 2,
        installCount: 3,
        removeCount: 1,
        removeEnabled: true,
      })
    ).toEqual([
      {
        value: 'update',
        label: 'Update',
        hint: '2 installed recommended skills',
        selected: true,
        disabled: false,
      },
      {
        value: 'install',
        label: 'Install',
        hint: '3 missing skills',
        selected: true,
        disabled: false,
      },
      {
        value: 'remove',
        label: 'Remove',
        hint: '1 extra managed skill',
        selected: true,
        disabled: false,
      },
    ]);
  });

  it('shows unavailable actions as disabled with reasons', () => {
    expect(
      buildInteractiveActionOptions({
        updateCount: 0,
        installCount: 1,
        removeCount: 2,
        removeEnabled: false,
      })
    ).toEqual([
      {
        value: 'update',
        label: 'Update',
        hint: 'No installed recommended skills',
        selected: false,
        disabled: true,
      },
      {
        value: 'install',
        label: 'Install',
        hint: '1 missing skill',
        selected: true,
        disabled: false,
      },
      {
        value: 'remove',
        label: 'Remove',
        hint: 'Disabled by --no-remove',
        selected: false,
        disabled: true,
      },
    ]);
  });
});
