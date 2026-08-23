import { compileRepositoryGlob } from '../architecture/globs';
import { isSupportedSourcePath } from '../sourceFiles';

export const DEFAULT_AUDIT_EXCLUDES = [
  'node_modules/**',
  '**/node_modules/**',
  'dist/**',
  '**/dist/**',
  'build/**',
  '**/build/**',
  'coverage/**',
  '**/coverage/**',
  '.git/**'
] as const;

export function selectAuditSourceFiles(files: string[], configuredExcludes: string[]): string[] {
  const exclude = [...DEFAULT_AUDIT_EXCLUDES, ...configuredExcludes]
    .map(compileRepositoryGlob);
  return files
    .filter(isSupportedSourcePath)
    .filter(file => !exclude.some(matches => matches(file)))
    .sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
}
