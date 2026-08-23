import type { AuditResult } from '../types';
import { activeFindings } from '../findings/summary';
import { findingTextLines } from './findingText';

export function renderAuditJson(result: AuditResult): string {
  return JSON.stringify(result, null, 2);
}

export interface AuditTerminalReporterOptions {
  showBaseline?: boolean;
}

export class AuditTerminalReporter {
  constructor(private readonly options: AuditTerminalReporterOptions = {}) {}

  async report(result: AuditResult): Promise<void> {
    const active = activeFindings(result.findings);
    const displayed = this.options.showBaseline ? result.findings : active;

    console.log('ArchGuard repository audit');
    console.log('');
    console.log('Revision:');
    console.log(`  ${result.revision}`);
    console.log('');
    console.log('Architecture health:');
    console.log('');
    console.log(`  Source files audited: ${result.stats.filesAudited}`);
    console.log(`  Dependency edges: ${result.stats.edgesAnalyzed}`);
    console.log(`  Layers used: ${result.stats.layersUsed}`);
    console.log(`  Cross-layer dependencies: ${result.impact.crossLayerDependencies.length}`);
    console.log(`  Unmapped source files: ${result.impact.unmappedChangedFiles.length}`);
    console.log(`  Overlapping layer assignments: ${result.impact.overlappingChangedFiles.length}`);
    console.log(`  Architecture violations: ${result.findings.length}`);
    console.log('');
    console.log('Architecture findings:');
    console.log(`  New violations: ${active.length}`);
    console.log(`  Existing baseline violations: ${result.summary.baselineSuppressed}`);
    console.log('');
    console.log('Result:');
    console.log(`  ${result.summary.errors > 0 ? 'FAILED' : 'PASSED'}`);

    if (displayed.length > 0) {
      console.log('');
      for (const finding of displayed) {
        for (const line of findingTextLines(finding)) console.log(line);
        if (finding.baseline?.suppressed) console.log('', '  Baseline: suppressed');
        console.log('');
      }
    } else if (result.findings.length === 0) {
      console.log('');
      console.log('No architecture violations found.');
    }
  }
}
