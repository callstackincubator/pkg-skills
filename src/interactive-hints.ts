import { note } from '@clack/prompts';
import { bold, dim, white } from 'colorette';

export const INTERACTIVE_KEYBOARD_HINTS = [
  { keys: '↑/↓', description: 'navigate' },
  { keys: 'Space', description: 'toggle' },
  { keys: 'a', description: 'toggle all' },
  { keys: 'i', description: 'invert selection' },
  { keys: 'Enter', description: 'confirm' },
  { keys: 'Ctrl+C', description: 'cancel' },
] as const;

export function formatInteractiveKeyboardHints(): string {
  return INTERACTIVE_KEYBOARD_HINTS.map(
    ({ keys, description }) =>
      `${dim(white(bold(keys)))} ${dim(white(description))}`
  ).join(dim(white(' • ')));
}

export function showInteractiveKeyboardHints(): void {
  note(formatInteractiveKeyboardHints(), 'Keyboard shortcuts');
}
