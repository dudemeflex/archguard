import { ScanResult } from '../types';
import { Reporter as ReporterInterface } from '../interfaces';

export class TerminalReporter implements ReporterInterface {
  async report(result: ScanResult): Promise<void> {
    const findings = result.findings || [];
    if (findings.length === 0) {
      console.log('No findings.');
      return;
    }

    for (const f of findings) {
      const header = `${(f.severity || 'info').toUpperCase()} ${f.ruleId || ''}`.trim();
      console.log(header);
      if (f.file) {
        console.log(`${f.file}${f.line ? `:${f.line}` : ''}`);
      }
      console.log(f.title || f.message);
      if (f.evidence) console.log(`Evidence: ${f.evidence}`);
      if (f.suggestion) console.log(`Suggestion: ${f.suggestion}`);
      console.log('');
    }

    console.log(`Total findings: ${findings.length}`);
  }
}
