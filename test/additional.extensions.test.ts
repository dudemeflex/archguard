import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import { GitAdapterImpl } from '../src/git/GitAdapter';
import { TypeScriptDependencyAnalyzer } from '../src/dependencies/TypeScriptDependencyAnalyzer';

function runGit(cwd: string, args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function initRepo(tmp: string) {
  runGit(tmp, ['init']);
  runGit(tmp, ['config', 'user.email', 'tests@example.invalid']);
  runGit(tmp, ['config', 'user.name', 'ArchGuard Tests']);
  fs.writeFileSync(path.join(tmp, 'README.md'), 'init');
  runGit(tmp, ['add', '.']);
  runGit(tmp, ['commit', '-m', 'initial']);
  return runGit(tmp, ['rev-parse', 'HEAD']);
}

function mkTmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'archguard-ext-')); }

describe('additional extension and JS/JSX support', () => {
  let tmp: string;
  beforeEach(() => { tmp = mkTmp(); });
  afterEach(() => { if (fs.existsSync(tmp)) fs.rmSync(tmp, { recursive: true, force: true }); });

  it.each([
    { extension: '.ts', source: "import './dep';\n" },
    { extension: '.tsx', source: "import './dep';\nexport const view = <div />;\n" },
    { extension: '.js', source: "import './dep';\n" },
    { extension: '.jsx', source: "import './dep';\nexport const view = <div />;\n" },
    { extension: '.mts', source: "import './dep';\n" },
    { extension: '.cts', source: "require('./dep');\n" },
    { extension: '.mjs', source: "import './dep';\n" },
    { extension: '.cjs', source: "require('./dep');\n" }
  ])('parses actual $extension source files', async ({ extension, source }) => {
    initRepo(tmp);
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    const sourcePath = `src/source${extension}`;
    const targetPath = `src/dep${extension}`;
    fs.writeFileSync(path.join(tmp, sourcePath), source);
    fs.writeFileSync(path.join(tmp, targetPath), 'export const value = 1;\n');
    runGit(tmp, ['add', '.']);
    runGit(tmp, ['commit', '-m', `add ${extension} source`]);

    const git = new GitAdapterImpl(tmp);
    const analyzer = new TypeScriptDependencyAnalyzer({ repoRoot: await git.getRepositoryRoot(), gitAdapter: git });
    const graph = await analyzer.analyze([sourcePath], 'HEAD');

    expect(graph[sourcePath]).toEqual([
      { source: sourcePath, target: targetPath, specifier: './dep', line: 1 }
    ]);
  });

  it.each([
    { label: '.js exact', specifier: './foo.js', exact: '.js', fallback: '.ts', includeExact: true, expected: '.js' },
    { label: '.js fallback', specifier: './foo.js', exact: '.js', fallback: '.ts', includeExact: false, expected: '.ts' },
    { label: '.mjs exact', specifier: './foo.mjs', exact: '.mjs', fallback: '.mts', includeExact: true, expected: '.mjs' },
    { label: '.mjs fallback', specifier: './foo.mjs', exact: '.mjs', fallback: '.mts', includeExact: false, expected: '.mts' },
    { label: '.cjs exact', specifier: './foo.cjs', exact: '.cjs', fallback: '.cts', includeExact: true, expected: '.cjs' },
    { label: '.cjs fallback', specifier: './foo.cjs', exact: '.cjs', fallback: '.cts', includeExact: false, expected: '.cts' }
  ])('uses emitted-extension precedence for $label', async ({ specifier, exact, fallback, includeExact, expected }) => {
    initRepo(tmp);
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src', 'source.ts'), `import '${specifier}';\n`);
    fs.writeFileSync(path.join(tmp, 'src', `foo${fallback}`), 'export const fallback = true;\n');
    if (includeExact) {
      fs.writeFileSync(path.join(tmp, 'src', `foo${exact}`), 'export const exact = true;\n');
    }
    runGit(tmp, ['add', '.']);
    runGit(tmp, ['commit', '-m', 'add precedence fixture']);

    const git = new GitAdapterImpl(tmp);
    const analyzer = new TypeScriptDependencyAnalyzer({ repoRoot: await git.getRepositoryRoot(), gitAdapter: git });
    const graph = await analyzer.analyze(['src/source.ts'], 'HEAD');

    expect(graph['src/source.ts']).toEqual([
      { source: 'src/source.ts', target: `src/foo${expected}`, specifier, line: 1 }
    ]);
  });
});
