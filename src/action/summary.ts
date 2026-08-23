import fs from 'fs';
import type { Finding } from '../finding';
import type { ScanResult } from '../types';
import { emptyArchitectureImpact } from '../impact/empty';
import { activeFindings } from '../findings/summary';

const MAX_SUMMARY_FINDINGS = 50;
const MAX_CELL_LENGTH = 500;

function cell(value: string): string {
  const singleLine = value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/`/g, '&#96;')
    .replace(/\r?\n/g, ' ')
    .replace(/\|/g, '\\|');
  return singleLine.length > MAX_CELL_LENGTH
    ? `${singleLine.slice(0, MAX_CELL_LENGTH - 1)}…`
    : singleLine;
}

function findingLocation(finding: Finding): string {
  if (!finding.file) return '';
  return `${finding.file}${finding.line === undefined ? '' : `:${finding.line}`}`;
}

function layerDependency(finding: Finding): string {
  if (!finding.sourceLayer && !finding.targetLayer) return '';
  if (!finding.targetLayer) return finding.sourceLayer || '';
  return `${finding.sourceLayer || '?'} → ${finding.targetLayer || '?'}`;
}

export function renderStepSummary(result: ScanResult): string {
  const allFindings = result.findings || [];
  const findings = activeFindings(allFindings);
  const baselineSuppressed = allFindings.length - findings.length;
  const summary = result.summary ?? { errors: 0, warnings: 0, info: 0 };
  const stats = result.stats ?? {};
  const impact = result.impact ?? emptyArchitectureImpact();
  const comparison = result.comparison ?? { base: 'unknown', head: 'HEAD' };
  const lines = [
    '## ArchGuard',
    '',
    `Compared \`${cell(comparison.base)}\` to \`${cell(comparison.head)}\`.`,
    '',
    `- Changed files: ${stats.changedFiles ?? result.changes?.length ?? 0}`,
    `- Files analyzed: ${stats.filesAnalyzed ?? Object.keys(result.dependencyGraph ?? {}).length}`,
    `- Dependency edges: ${stats.edgesAnalyzed ?? 0}`,
    `- Architecture violations: ${allFindings.length}`,
    `- Severity: ${summary.errors ?? 0} error(s), ${summary.warnings ?? 0} warning(s), `
      + `${summary.info ?? 0} notice(s)`
  ];

  lines.push(
    '',
    '### Architecture findings',
    '',
    `- New violations: ${findings.length}`,
    `- Baseline violations: ${baselineSuppressed}`
  );
  if (findings.length === 0) lines.push('', 'No new architecture violations.');

  lines.push(
    '',
    '## Architecture impact',
    '',
    `**Layers touched:** ${impact.layersTouched.length > 0 ? impact.layersTouched.map(cell).join(', ') : '(none)'}`
  );

  if (impact.crossLayerDependencies.length > 0) {
    lines.push('', '| From | To | Source |', '| --- | --- | --- |');
    for (const dependency of impact.crossLayerDependencies.slice(0, MAX_SUMMARY_FINDINGS)) {
      lines.push(
        `| ${cell(dependency.sourceLayer)} | ${cell(dependency.targetLayer)} | `
        + `${cell(dependency.source)} |`
      );
    }
    if (impact.crossLayerDependencies.length > MAX_SUMMARY_FINDINGS) {
      lines.push('', `_Showing the first ${MAX_SUMMARY_FINDINGS} cross-layer dependencies._`);
    }
  }

  lines.push(
    '',
    '### Configuration coverage',
    '',
    `- Unmapped changed source files: ${impact.unmappedChangedFiles.length}`,
    `- Overlapping layer assignments: ${impact.overlappingChangedFiles.length}`
  );

  if (findings.length > 0) {
    lines.push('', '| File | Layer dependency | Rule |', '| --- | --- | --- |');
    for (const finding of findings.slice(0, MAX_SUMMARY_FINDINGS)) {
      lines.push(
        `| ${cell(findingLocation(finding))} | ${cell(layerDependency(finding))} | `
        + `${cell(finding.ruleId || '')} |`
      );
    }
    if (findings.length > MAX_SUMMARY_FINDINGS) {
      lines.push('', `_Showing the first ${MAX_SUMMARY_FINDINGS} findings._`);
    }
  }

  return `${lines.join('\n')}\n`;
}

export function appendStepSummary(summaryPath: string, result: ScanResult): void {
  fs.appendFileSync(summaryPath, renderStepSummary(result), 'utf8');
}
