import path from 'path';
import ts from 'typescript';
import type { DependencyAnalyzer, GitAdapter } from '../interfaces';
import type { DependencyEdge, DependencyGraph } from '../types';

const SUPPORTED_SOURCE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mts',
  '.cts',
  '.mjs',
  '.cjs'
]);

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'];

export interface TypeScriptDependencyAnalyzerOptions {
  repoRoot: string;
  gitAdapter: GitAdapter;
}

export class TypeScriptDependencyAnalyzer implements DependencyAnalyzer {
  private readonly repoRoot: string;
  private readonly gitAdapter: GitAdapter;

  constructor(options: TypeScriptDependencyAnalyzerOptions) {
    this.repoRoot = path.resolve(options.repoRoot);
    this.gitAdapter = options.gitAdapter;
  }

  private static readonly MAX_SOURCE_FILE_BYTES = 5 * 1024 * 1024; // 5 MB

  private static escapesRoot(relativePath: string): boolean {
    const normalized = relativePath.replace(/\\/g, '/');
    return normalized === '..' || normalized.startsWith('../') || path.isAbsolute(relativePath) || normalized.startsWith('/');
  }

  async analyze(files: string[], revision = 'HEAD'): Promise<DependencyGraph> {
    const uniqueFiles = Array.from(new Set(files.map(file => this.normalizeRepoRelative(file))));
    const graph: DependencyGraph = {};

    for (const file of uniqueFiles) {
      if (!this.isSupportedSourceFile(file)) continue;

      // Check size at revision before reading
      const size = await this.gitAdapter.getFileSizeAtRevision(file, revision);
      if (size !== null && size > TypeScriptDependencyAnalyzer.MAX_SOURCE_FILE_BYTES) {
        throw new Error(`Source file exceeds dependency-analysis size limit: ${file}`);
      }

      let text: string;
      try {
        text = await this.gitAdapter.getFileContents(file, revision);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Unable to read source file for dependency analysis: ${file} (${message})`);
      }

      const edges = await this.parseSourceDependencies(file, text, revision);
      graph[file] = edges;
    }

    return graph;
  }

  private isSupportedSourceFile(file: string): boolean {
    return SUPPORTED_SOURCE_EXTENSIONS.has(path.extname(file).toLowerCase());
  }

  private normalizeRepoRelative(file: string): string {
    const invalidPath = (): never => {
      throw new Error(`Invalid repository-relative source path: ${file}`);
    };

    if (!file) invalidPath();

    const normalized = file.replace(/\\/g, '/');
    if (
      normalized === '' ||
      normalized === '.' ||
      TypeScriptDependencyAnalyzer.escapesRoot(normalized) ||
      path.posix.isAbsolute(normalized) ||
      /^[A-Za-z]:/.test(normalized) ||
      normalized.includes('\0')
    ) {
      invalidPath();
    }

    const trimmed = normalized.replace(/^\.\//, '');
    if (
      trimmed === '' ||
      trimmed === '.' ||
      TypeScriptDependencyAnalyzer.escapesRoot(trimmed) ||
      path.posix.isAbsolute(trimmed) ||
      /^[A-Za-z]:/.test(trimmed) ||
      trimmed.split('/').some(segment => segment === '..')
    ) {
      invalidPath();
    }

    const posix = path.posix.normalize(trimmed);
    if (posix === '.' || posix === '..' || TypeScriptDependencyAnalyzer.escapesRoot(posix) || path.posix.isAbsolute(posix)) {
      invalidPath();
    }
    return posix;
  }

  private getScriptKind(fileName: string): ts.ScriptKind {
    const ext = path.extname(fileName).toLowerCase();
    switch (ext) {
      case '.tsx':
        return ts.ScriptKind.TSX;
      case '.jsx':
        return ts.ScriptKind.JSX;
      case '.mjs':
      case '.cjs':
      case '.js':
        return ts.ScriptKind.JS;
      case '.mts':
      case '.cts':
        return ts.ScriptKind.TS;
      default:
        return ts.ScriptKind.TS;
    }
  }

  private isRelativeSpecifier(specifier: string): boolean {
    return specifier.startsWith('./') || specifier.startsWith('../') || specifier === '.' || specifier === '..';
  }

  private async resolveRelativeImport(importerPath: string, specifier: string, revision: string): Promise<string | null> {
    if (!this.isRelativeSpecifier(specifier)) {
      return null;
    }

    const importerAbsolute = path.resolve(this.repoRoot, importerPath);
    const importerDir = path.dirname(importerAbsolute);
    const absoluteBase = path.resolve(importerDir, specifier);
    const candidatePaths = this.buildCandidatePaths(absoluteBase, specifier);

    for (const candidate of candidatePaths) {
      const relativeCandidate = path.relative(this.repoRoot, candidate).replace(/\\/g, '/');
      // ensure not escaping repo
      if (TypeScriptDependencyAnalyzer.escapesRoot(relativeCandidate) || path.isAbsolute(relativeCandidate)) continue;
      const exists = await this.gitAdapter.fileExistsAtRevision(relativeCandidate, revision);
      if (!exists) continue;
      const isSymlink = await this.gitAdapter.isSymlinkAtRevision(relativeCandidate, revision);
      if (isSymlink) {
        // do not follow symlink targets in revision-based analysis
        continue;
      }
      return relativeCandidate;
    }

    return null;
  }

  private buildCandidatePaths(basePath: string, specifier: string): string[] {
    const candidates = new Set<string>();
    const ext = path.extname(basePath).toLowerCase();
    const knownSourceExt = SOURCE_EXTENSIONS.includes(ext.toLowerCase());
    const baseWithoutExt = knownSourceExt ? basePath.slice(0, -ext.length) : basePath;

    candidates.add(basePath);

    if (knownSourceExt) {
      const preferred = this.preferredExtensionsFor(ext);
      for (const nextExt of preferred) {
        const candidate = `${baseWithoutExt}${nextExt}`;
        if (candidate !== basePath) candidates.add(candidate);
      }
    } else {
      for (const nextExt of SOURCE_EXTENSIONS) {
        candidates.add(`${basePath}${nextExt}`);
        candidates.add(path.join(basePath, `index${nextExt}`));
      }
    }

    if (specifier.endsWith('/') || specifier === '.' || specifier === '..') {
      for (const nextExt of SOURCE_EXTENSIONS) {
        candidates.add(path.join(basePath, `index${nextExt}`));
      }
    }

    return Array.from(candidates);
  }

  private preferredExtensionsFor(ext: string): string[] {
    const lower = ext.toLowerCase();
    switch (lower) {
      case '.js':
        // prefer TypeScript sources after exact .js
        return ['.js', '.ts', '.tsx', '.jsx', '.mjs', '.mts', '.cjs', '.cts'];
      case '.jsx':
        return ['.jsx', '.tsx', '.ts', '.js'];
      case '.mjs':
        return ['.mjs', '.mts', '.js', '.ts'];
      case '.cjs':
        return ['.cjs', '.cts', '.js', '.ts'];
      case '.ts':
        return ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'];
      case '.tsx':
        return ['.tsx', '.ts', '.jsx', '.js'];
      case '.mts':
        return ['.mts', '.mjs', '.ts', '.js'];
      case '.cts':
        return ['.cts', '.cjs', '.ts', '.js'];
      default:
        return SOURCE_EXTENSIONS;
    }
  }

  private async parseSourceDependencies(filePath: string, sourceText: string, revision: string): Promise<DependencyEdge[]> {
    const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, this.getScriptKind(filePath));
    const edges: DependencyEdge[] = [];

    const record = async (specifier: string | undefined, node: ts.Node): Promise<void> => {
      if (!specifier) return;
      // external or alias specifier
      if (!this.isRelativeSpecifier(specifier)) return;
      const target = await this.resolveRelativeImport(filePath, specifier, revision);
      if (!target) return;
      const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      edges.push({
        source: this.normalizeRepoRelative(filePath),
        target,
        specifier,
        line
      });
    };

    const entries: Array<{ specifier: string; node: ts.Node }> = [];

    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        if (node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
          entries.push({ specifier: node.moduleSpecifier.text, node });
        }
        return;
      }

      if (ts.isCallExpression(node)) {
        const firstArg = node.arguments[0];

        if (node.expression.kind === ts.SyntaxKind.ImportKeyword && firstArg && ts.isStringLiteralLike(firstArg)) {
          entries.push({ specifier: firstArg.text, node });
          return;
        }

        if (
          ts.isIdentifier(node.expression) &&
          node.expression.text === 'require' &&
          firstArg &&
          ts.isStringLiteralLike(firstArg)
        ) {
          entries.push({ specifier: firstArg.text, node });
          return;
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);

    for (const e of entries) {
      await record(e.specifier, e.node);
    }

    return edges;
  }
}

