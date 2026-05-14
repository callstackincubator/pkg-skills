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

export type InteractiveAction = 'update' | 'install' | 'remove';

export type InteractiveActionOption = {
  value: InteractiveAction;
  label: string;
  hint: string;
  selected: boolean;
  disabled?: boolean;
};

export function buildInteractiveActionOptions(options: {
  updateCount: number;
  installCount: number;
  removeCount: number;
  removeEnabled: boolean;
}): InteractiveActionOption[] {
  const updateAvailable = options.updateCount > 0;
  const installAvailable = options.installCount > 0;
  const removeAvailable = options.removeEnabled && options.removeCount > 0;

  return [
    {
      value: 'update',
      label: 'Update',
      hint: updateAvailable
        ? `${options.updateCount} installed recommended skill${
            options.updateCount === 1 ? '' : 's'
          }`
        : 'No installed recommended skills',
      selected: updateAvailable,
      disabled: !updateAvailable,
    },
    {
      value: 'install',
      label: 'Install',
      hint: installAvailable
        ? `${options.installCount} missing skill${
            options.installCount === 1 ? '' : 's'
          }`
        : 'No missing skills',
      selected: installAvailable,
      disabled: !installAvailable,
    },
    {
      value: 'remove',
      label: 'Remove',
      hint: !options.removeEnabled
        ? 'Disabled by --no-remove'
        : removeAvailable
          ? `${options.removeCount} extra managed skill${
              options.removeCount === 1 ? '' : 's'
            }`
          : 'No extra managed skills',
      selected: removeAvailable,
      disabled: !removeAvailable,
    },
  ];
}
