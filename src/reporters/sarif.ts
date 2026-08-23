import type { Finding, Severity } from '../finding';
import type { Reporter } from '../interfaces';
import type { ScanResult } from '../types';

const ARCHITECTURE_RULE_ID = 'architecture/dependency';

function sarifLevel(severity: Severity | undefined): 'error' | 'warning' | 'note' {
  if (severity === 'error') return 'error';
  if (severity === 'warning') return 'warning';
  return 'note';
}

function ruleDefinition(finding: Finding) {
  const id = finding.ruleId || 'archguard/finding';
  const architectureRule = id === ARCHITECTURE_RULE_ID;

  return {
    id,
    name: architectureRule ? 'ArchitectureDependency' : id.replace(/[^a-zA-Z0-9]/g, '_'),
    shortDescription: {
      text: finding.title || (architectureRule ? 'Forbidden architecture dependency' : 'ArchGuard finding')
    },
    fullDescription: {
      text: architectureRule
        ? 'A source file depends on a layer that is not allowed by the repository architecture configuration.'
        : 'ArchGuard reported a repository architecture finding.'
    },
    defaultConfiguration: { level: sarifLevel(finding.severity) },
    properties: {
      tags: architectureRule ? ['architecture', 'dependency'] : ['architecture']
    }
  };
}

function sarifResult(finding: Finding) {
  const location = finding.file
    ? {
        physicalLocation: {
          artifactLocation: { uri: finding.file.replace(/\\/g, '/') },
          ...(finding.line !== undefined
            ? {
                region: {
                  startLine: finding.line,
                  ...(finding.column === undefined ? {} : { startColumn: finding.column })
                }
              }
            : {})
        }
      }
    : undefined;

  return {
    ruleId: finding.ruleId || 'archguard/finding',
    level: sarifLevel(finding.severity),
    message: { text: finding.message },
    ...(location ? { locations: [location] } : {})
  };
}

export function createSarifLog(result: ScanResult) {
  const findings = result.findings || [];
  const rules = new Map<string, ReturnType<typeof ruleDefinition>>();
  for (const finding of findings) {
    const id = finding.ruleId || 'archguard/finding';
    if (!rules.has(id)) rules.set(id, ruleDefinition(finding));
  }

  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [{
      tool: {
        driver: {
          name: 'ArchGuard',
          informationUri: 'https://github.com/dudemeflex/archguard',
          rules: Array.from(rules.values())
        }
      },
      results: findings.map(sarifResult)
    }]
  } as const;
}

export function renderSarif(result: ScanResult): string {
  return JSON.stringify(createSarifLog(result), null, 2);
}

export class SarifReporter implements Reporter {
  async report(result: ScanResult): Promise<void> {
    console.log(renderSarif(result));
  }
}
