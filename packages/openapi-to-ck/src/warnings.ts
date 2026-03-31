import type { Warning } from './types.js';

export class WarningCollector {
  readonly warnings: Warning[] = [];
  private onWarning?: (w: Warning) => void;

  constructor(onWarning?: (w: Warning) => void) {
    this.onWarning = onWarning;
  }

  warn(path: string, message: string): void {
    this.add({ path, message, severity: 'warn' });
  }

  info(path: string, message: string): void {
    this.add({ path, message, severity: 'info' });
  }

  private add(warning: Warning): void {
    this.warnings.push(warning);
    this.onWarning?.(warning);
  }
}
