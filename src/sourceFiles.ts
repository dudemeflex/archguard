import path from 'path';

const SUPPORTED_SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'
]);

export function isSupportedSourcePath(filePath: string): boolean {
  return SUPPORTED_SOURCE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}
