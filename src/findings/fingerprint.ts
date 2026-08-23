import { createHash } from 'crypto';
import { normalizeRepositoryPath } from '../architecture/globs';

export function findingFingerprint(parts: string[]): string {
  return createHash('sha256').update(JSON.stringify(parts), 'utf8').digest('hex');
}

export function dependencyFindingFingerprint(input: {
  ruleId: string;
  source: string;
  target: string;
  sourceLayer: string;
  targetLayer: string;
  specifier?: string;
}): string {
  return findingFingerprint([
    input.ruleId,
    normalizeRepositoryPath(input.source),
    normalizeRepositoryPath(input.target),
    input.sourceLayer,
    input.targetLayer,
    input.specifier ?? ''
  ]);
}

export function companionFindingFingerprint(input: {
  ruleId: string;
  layer: string;
  trigger: string;
  patterns: string[];
}): string {
  return findingFingerprint([
    input.ruleId,
    input.layer,
    normalizeRepositoryPath(input.trigger),
    ...input.patterns.map(normalizeRepositoryPath)
  ]);
}

export function unmappedFindingFingerprint(ruleId: string, file: string): string {
  return findingFingerprint([ruleId, normalizeRepositoryPath(file)]);
}

export function overlapFindingFingerprint(ruleId: string, file: string, layers: string[]): string {
  return findingFingerprint([ruleId, normalizeRepositoryPath(file), ...layers]);
}
