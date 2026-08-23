import type { Finding } from '../finding';

export function escapeCommandData(value: string): string {
  return value
    .replace(/%/g, '%25')
    .replace(/\r/g, '%0D')
    .replace(/\n/g, '%0A');
}

export function escapeCommandProperty(value: string): string {
  return escapeCommandData(value)
    .replace(/:/g, '%3A')
    .replace(/,/g, '%2C');
}

export function formatAnnotation(finding: Finding): string {
  const command = finding.severity === 'error'
    ? 'error'
    : finding.severity === 'warning'
      ? 'warning'
      : 'notice';
  const properties: string[] = [];

  if (finding.file) {
    properties.push(`file=${escapeCommandProperty(finding.file)}`);
    if (finding.line !== undefined) {
      properties.push(`line=${finding.line}`);
      if (finding.column !== undefined) properties.push(`col=${finding.column}`);
    }
  }
  const title = finding.ruleId
    ? `ArchGuard ${finding.ruleId}`
    : finding.title || 'ArchGuard finding';
  properties.push(`title=${escapeCommandProperty(title)}`);

  return `::${command} ${properties.join(',')}::${escapeCommandData(finding.message)}`;
}
