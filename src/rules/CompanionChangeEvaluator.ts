import type { ArchguardConfig } from '../config/schema';
import type { Finding } from '../finding';
import type { ArchitectureGraph } from '../interfaces';
import type { RepositoryChange } from '../types';
import { compileRepositoryGlob, normalizeRepositoryPath } from '../architecture/globs';

interface CompanionLayer {
  name: string;
  patterns: string[];
  matchers: Array<ReturnType<typeof compileRepositoryGlob>>;
}

function changePaths(change: RepositoryChange): string[] {
  return [change.path, ...(change.type === 'renamed' && change.oldPath ? [change.oldPath] : [])];
}

export class CompanionChangeEvaluator {
  private readonly layers: CompanionLayer[];

  constructor(
    config: Pick<ArchguardConfig, 'layers'>,
    private readonly architecture: ArchitectureGraph
  ) {
    this.layers = config.layers
      .filter(layer => (layer.companionChange?.length ?? 0) > 0)
      .map(layer => ({
        name: layer.name,
        patterns: layer.companionChange || [],
        matchers: (layer.companionChange || []).map(compileRepositoryGlob)
      }));
  }

  evaluate(changes: RepositoryChange[]): Finding[] {
    const changedPaths = changes.flatMap(changePaths).map(normalizeRepositoryPath);
    const findings: Finding[] = [];

    for (const layer of this.layers) {
      const trigger = changedPaths.find(filePath =>
        this.architecture.fileToLayers(filePath).includes(layer.name)
      );
      if (!trigger) continue;
      if (changedPaths.some(filePath => layer.matchers.some(matches => matches(filePath)))) continue;

      findings.push({
        ruleId: 'architecture/companion-change',
        severity: 'error',
        title: 'Required companion change missing',
        message: `Layer "${layer.name}" changed without a required companion change.`,
        file: trigger,
        sourceLayer: layer.name,
        evidence: [
          `changed layer: ${layer.name}`,
          `trigger file: ${trigger}`,
          'required companion patterns:',
          ...layer.patterns.map(pattern => `- ${pattern}`)
        ].join('\n'),
        suggestion: 'Add a matching companion change or update the layer configuration.'
      });
    }

    return findings;
  }
}
