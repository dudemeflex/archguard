import { ScanResult } from '../types';
import { Reporter as ReporterInterface } from '../interfaces';

function formatChangeType(type: string): string {
  switch (type) {
    case 'added':
      return 'A';
    case 'modified':
      return 'M';
    case 'deleted':
      return 'D';
    case 'renamed':
      return 'R';
    default:
      return '?';
  }
}

export class TerminalReporter implements ReporterInterface {
  async report(result: ScanResult): Promise<void> {
    const findings = result.findings || [];
    const changes = result.changes || [];
    const comparison = result.comparison ?? { base: 'unknown', head: 'HEAD' };
    const graph = result.dependencyGraph || {};
    const filesAnalyzed = Object.keys(graph).length;
    const edgesAnalyzed = Object.values(graph).reduce((sum, edges) => sum + edges.length, 0);

    console.log('ArchGuard');
    console.log('');
    console.log('Comparing:');
    console.log(`  base: ${comparison.base}`);
    console.log(`  head: ${comparison.head}`);
    console.log('');
    console.log('Changes:');
    if (changes.length === 0) {
      console.log('  No changes detected.');
    } else {
      for (const change of changes) {
        if (change.type === 'renamed') {
          console.log(`  ${formatChangeType(change.type)}  ${change.oldPath ?? ''} -> ${change.path}`);
        } else {
          console.log(`  ${formatChangeType(change.type)}  ${change.path}`);
        }
      }
    }
    console.log('');
    console.log(`${changes.length} changed files`);
    console.log('');

    console.log('Dependency analysis:');
    console.log(`  ${filesAnalyzed} source files analyzed`);
    console.log(`  ${edgesAnalyzed} local dependency edges`);
    console.log('');

    console.log('Architecture rules:');

    if (findings.length > 0) {
      console.log('');
      for (const f of findings) {
        const header = `${(f.severity || 'info').toUpperCase()} ${f.ruleId || ''}`.trim();
        console.log(header);
        if (f.file) {
          console.log(`${f.file}${f.line ? `:${f.line}` : ''}`);
        }
        console.log('');
        if (f.title) {
          console.log(f.title);
          console.log('');
        }
        console.log(f.message);
        if (f.evidence) {
          console.log('');
          console.log('Evidence:');
          console.log(`  ${f.evidence}`);
        }
        if (f.suggestion) {
          console.log('');
          console.log('Suggestion:');
          console.log(`  ${f.suggestion}`);
        }
        console.log('');
      }

      console.log(`Total findings: ${findings.length}`);
      return;
    }

    console.log('  No violations found.');
  }
}
