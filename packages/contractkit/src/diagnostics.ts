export interface Diagnostic {
  file: string;
  line: number;
  message: string;
  severity: 'error' | 'warning';
}

export class DiagnosticCollector {
  private diagnostics: Diagnostic[] = [];

  error(file: string, line: number, message: string): void {
    this.diagnostics.push({ file, line, message, severity: 'error' });
  }

  warn(file: string, line: number, message: string): void {
    this.diagnostics.push({ file, line, message, severity: 'warning' });
  }

  hasErrors(): boolean {
    return this.diagnostics.some(d => d.severity === 'error');
  }

  getAll(): Diagnostic[] {
    return [...this.diagnostics];
  }

  report(): void {
    for (const d of this.diagnostics) {
      const prefix = d.severity === 'error' ? '\x1b[31mERROR\x1b[0m' : '\x1b[33mWARN\x1b[0m';
      console.error(`${prefix}  ${d.file}:${d.line}  ${d.message}`);
    }
    const errors = this.diagnostics.filter(d => d.severity === 'error').length;
    const warns = this.diagnostics.filter(d => d.severity === 'warning').length;
    if (errors > 0 || warns > 0) {
      console.error(`\n${errors} error(s), ${warns} warning(s)`);
    }
  }
}
