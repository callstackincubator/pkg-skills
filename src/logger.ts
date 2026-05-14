import { bold, cyan, dim, green, magenta, red, yellow } from 'colorette';

let verboseLoggingEnabled = false;

export function setVerboseLogging(enabled: boolean): void {
  verboseLoggingEnabled = enabled;
}

export function resetLoggingForTests(): void {
  verboseLoggingEnabled = false;
}

export function verbose(message: string): void {
  if (!verboseLoggingEnabled) {
    return;
  }

  process.stdout.write(`${dim('verbose')} ${dim(message)}\n`);
}

export function printBanner(): void {
  process.stdout.write(
    bold(
      magenta(
        '██████╗ ██╗  ██╗ ██████╗     ███████╗██╗  ██╗██╗██╗     ██╗     ███████╗\n' +
          '██╔══██╗██║ ██╔╝██╔════╝     ██╔════╝██║ ██╔╝██║██║     ██║     ██╔════╝\n' +
          '██████╔╝█████╔╝ ██║  ███╗    ███████╗█████╔╝ ██║██║     ██║     ███████╗\n' +
          '██╔═══╝ ██╔═██╗ ██║   ██║    ╚════██║██╔═██╗ ██║██║     ██║     ╚════██║\n' +
          '██║     ██║  ██╗╚██████╔╝    ███████║██║  ██╗██║███████╗███████╗███████║\n' +
          '╚═╝     ╚═╝  ╚═╝ ╚═════╝     ╚══════╝╚═╝  ╚═╝╚═╝╚══════╝╚══════╝╚══════╝\n'
      )
    ) + `${dim('Pkg Skills by Callstack')}\n\n`
  );
}

export function info(message: string): void {
  process.stdout.write(`${cyan('info')} ${message}\n`);
}

export function success(message: string): void {
  process.stdout.write(`${green('success')} ${message}\n`);
}

export function warn(message: string): void {
  process.stdout.write(`${yellow('warn')} ${message}\n`);
}

export function error(message: string): void {
  process.stderr.write(`${red('error')} ${message}\n`);
}

export function section(title: string): void {
  process.stdout.write(`\n${bold(title)}\n`);
}
