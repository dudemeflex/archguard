import picomatch from 'picomatch';

export const GLOB_OPTIONS = {
  dot: true,
  nonegate: true,
  posixSlashes: true,
  strictBrackets: true
} as const;

export function normalizeRepositoryPath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\.\//, '');
}

export function compileRepositoryGlob(pattern: string): ReturnType<typeof picomatch> {
  return picomatch(normalizeRepositoryPath(pattern), GLOB_OPTIONS);
}
