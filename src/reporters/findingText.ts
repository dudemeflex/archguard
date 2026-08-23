import type { Finding } from '../finding';

export function findingTextLines(finding: Finding): string[] {
  const lines: string[] = [];
  const header = `${(finding.severity || 'info').toUpperCase()} ${finding.ruleId || ''}`.trim();
  lines.push(header);
  if (finding.file) lines.push(`${finding.file}${finding.line ? `:${finding.line}` : ''}`);
  lines.push('');
  if (finding.title) lines.push(finding.title, '');
  lines.push(finding.message);
  if (finding.evidence) lines.push('', 'Evidence:', `  ${finding.evidence}`);
  if (finding.suggestion) lines.push('', 'Suggestion:', `  ${finding.suggestion}`);
  return lines;
}
