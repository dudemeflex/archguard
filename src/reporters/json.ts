import { Reporter } from '../interfaces';
import { ScanResult } from '../types';

export class JsonReporter implements Reporter {
  async report(result: ScanResult): Promise<void> {
    const findings = result.findings || [];
    const summary = { errors: 0, warnings: 0, info: 0 };
    for (const f of findings) {
      if (f.severity === 'error') summary.errors++;
      else if (f.severity === 'warning') summary.warnings++;
      else summary.info++;
    }

    const output = {
      findings,
      summary
    } as const;

    // deterministic JSON output
    console.log(JSON.stringify(output, null, 2));
  }
}
