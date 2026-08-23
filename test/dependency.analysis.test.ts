import { beforeEach, afterEach, describe, expect, it } from 'vitest';
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

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'archguard-dep-'));
}

describe('TypeScriptDependencyAnalyzer', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkTmp();
  });

  afterEach(() => {
    if (fs.existsSync(tmp)) {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('resolves relative imports and .js to source mappings', async () => {
    initRepo(tmp);
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src', 'a.ts'), "import { b } from './b';\nimport './b.js';\n");
    fs.writeFileSync(path.join(tmp, 'src', 'b.ts'), 'export const b = 1;\n');
    runGit(tmp, ['add', '.']);
    runGit(tmp, ['commit', '-m', 'add imports']);

    const git = new GitAdapterImpl(tmp);
    const analyzer = new TypeScriptDependencyAnalyzer({ repoRoot: await git.getRepositoryRoot(), gitAdapter: git });
    const graph = await analyzer.analyze(['src/a.ts'], 'HEAD');

    expect(graph['src/a.ts']).toEqual([
      { source: 'src/a.ts', target: 'src/b.ts', specifier: './b', line: 1 },
      { source: 'src/a.ts', target: 'src/b.ts', specifier: './b.js', line: 2 }
    ]);
  });

  it('handles export-from, type-only imports, require, and dynamic import', async () => {
    initRepo(tmp);
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src', 'user.ts'), 'export type User = { id: string };\n');
    fs.writeFileSync(path.join(tmp, 'src', 'shared.ts'), 'export const shared = 1;\n');
    fs.writeFileSync(path.join(tmp, 'src', 'x.ts'), 'export const x = 1;\n');
    fs.writeFileSync(path.join(tmp, 'src', 'lazy.ts'), 'export const lazy = 1;\n');
    fs.writeFileSync(path.join(tmp, 'src', 'a.ts'), [
      "import type { User } from './user';",
      "export { User } from './user';",
      "export * from './shared';",
      "const x = require('./x');",
      "const y = import('./lazy');"
    ].join('\n'));
    runGit(tmp, ['add', '.']);
    runGit(tmp, ['commit', '-m', 'add module graph']);

    const git = new GitAdapterImpl(tmp);
    const analyzer = new TypeScriptDependencyAnalyzer({ repoRoot: tmp, gitAdapter: git });
    const graph = await analyzer.analyze(['src/a.ts'], 'HEAD');
    const edges = graph['src/a.ts'];

    expect(edges).toHaveLength(5);
    expect(edges).toContainEqual({ source: 'src/a.ts', target: 'src/user.ts', specifier: './user', line: 1 });
    expect(edges).toContainEqual({ source: 'src/a.ts', target: 'src/user.ts', specifier: './user', line: 2 });
    expect(edges).toContainEqual({ source: 'src/a.ts', target: 'src/shared.ts', specifier: './shared', line: 3 });
    expect(edges).toContainEqual({ source: 'src/a.ts', target: 'src/x.ts', specifier: './x', line: 4 });
    expect(edges).toContainEqual({ source: 'src/a.ts', target: 'src/lazy.ts', specifier: './lazy', line: 5 });
  });

  it('ignores external packages and unresolved non-local imports', async () => {
    initRepo(tmp);
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src', 'a.ts'), [
      "import express from 'express';",
      "import { z } from 'zod';",
      "import fs from 'node:fs';",
      "import './missing';"
    ].join('\n'));
    runGit(tmp, ['add', '.']);
    runGit(tmp, ['commit', '-m', 'external imports']);

    const git = new GitAdapterImpl(tmp);
    const analyzer = new TypeScriptDependencyAnalyzer({ repoRoot: tmp, gitAdapter: git });
    const graph = await analyzer.analyze(['src/a.ts'], 'HEAD');

    expect(graph['src/a.ts']).toEqual([]);
  });

  it('supports index resolution, JSX and nested imports', async () => {
    initRepo(tmp);
    fs.mkdirSync(path.join(tmp, 'src', 'app'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'src', 'domain', 'models'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src', 'app', 'App.tsx'), "import { Button } from '../Button';\nimport '../domain/models/user';\n");
    fs.writeFileSync(path.join(tmp, 'src', 'Button.tsx'), 'export const Button = 1;\n');
    fs.writeFileSync(path.join(tmp, 'src', 'domain', 'models', 'user.ts'), 'export const user = 1;\n');
    fs.writeFileSync(path.join(tmp, 'src', 'app', 'index.ts'), 'export * from "./App";\n');
    fs.writeFileSync(path.join(tmp, 'src', 'index.ts'), "import './app';\n");
    runGit(tmp, ['add', '.']);
    runGit(tmp, ['commit', '-m', 'tsx and index']);

    const git = new GitAdapterImpl(tmp);
    const analyzer = new TypeScriptDependencyAnalyzer({ repoRoot: tmp, gitAdapter: git });
    const graph = await analyzer.analyze(['src/index.ts', 'src/app/App.tsx'], 'HEAD');

    expect(graph['src/index.ts']).toEqual([
      { source: 'src/index.ts', target: 'src/app/index.ts', specifier: './app', line: 1 }
    ]);
    expect(graph['src/app/App.tsx']).toEqual([
      { source: 'src/app/App.tsx', target: 'src/Button.tsx', specifier: '../Button', line: 1 },
      { source: 'src/app/App.tsx', target: 'src/domain/models/user.ts', specifier: '../domain/models/user', line: 2 }
    ]);
  });

  it('ignores malicious escape paths and keeps analysis inside the repository', async () => {
    initRepo(tmp);
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src', 'a.ts'), "import '../../../../../../etc/passwd';\n");
    runGit(tmp, ['add', '.']);
    runGit(tmp, ['commit', '-m', 'escape attempt']);

    const git = new GitAdapterImpl(tmp);
    const analyzer = new TypeScriptDependencyAnalyzer({ repoRoot: tmp, gitAdapter: git });
    const graph = await analyzer.analyze(['src/a.ts'], 'HEAD');

    expect(graph['src/a.ts']).toEqual([]);
  });

  it('accepts dotted relative filenames and rejects invalid analyzer source paths', async () => {
    initRepo(tmp);
    fs.writeFileSync(path.join(tmp, '..foo.ts'), 'export const value = 1;\n');
    fs.writeFileSync(path.join(tmp, 'a.ts'), "import './..foo';\n");
    runGit(tmp, ['add', '.']);
    runGit(tmp, ['commit', '-m', 'dotted names']);

    const git = new GitAdapterImpl(tmp);
    const analyzer = new TypeScriptDependencyAnalyzer({ repoRoot: tmp, gitAdapter: git });
    const graph = await analyzer.analyze(['a.ts'], 'HEAD');

    expect(graph['a.ts']).toEqual([
      { source: 'a.ts', target: '..foo.ts', specifier: './..foo', line: 1 }
    ]);
    expect(await git.getFileContents('..foo.ts', 'HEAD')).toContain('value');

    await expect(analyzer.analyze(['./a.ts'], 'HEAD')).resolves.toEqual(graph);

    for (const invalidPath of [
      '/outside/a.ts',
      '../outside.ts',
      'src/../outside.ts',
      'C:\\outside\\a.ts',
      '\\\\server\\share\\a.ts'
    ]) {
      await expect(analyzer.analyze([invalidPath], 'HEAD')).rejects.toThrow(
        /Invalid repository-relative source path/
      );
    }
  });

  it('uses HEAD revision content rather than stale working tree content', async () => {
    // This is now covered by more explicit tests added below
    // keep a small smoke test for parity
    initRepo(tmp);
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src', 'oldDep.ts'), 'export const oldDep = 1;\n');
    fs.writeFileSync(path.join(tmp, 'src', 'a.ts'), "import './oldDep';\n");
    runGit(tmp, ['add', '.']);
    runGit(tmp, ['commit', '-m', 'first version']);
    const base = runGit(tmp, ['rev-parse', 'HEAD']);

    fs.writeFileSync(path.join(tmp, 'src', 'newDep.ts'), 'export const newDep = 1;\n');
    fs.writeFileSync(path.join(tmp, 'src', 'a.ts'), "import './newDep';\n");
    runGit(tmp, ['add', '.']);
    runGit(tmp, ['commit', '-m', 'new dep']);
    const head = runGit(tmp, ['rev-parse', 'HEAD']);

    // Now delete newDep from working tree to simulate missing working file
    fs.unlinkSync(path.join(tmp, 'src', 'newDep.ts'));

    const git = new GitAdapterImpl(tmp);
    const analyzer = new TypeScriptDependencyAnalyzer({ repoRoot: await git.getRepositoryRoot(), gitAdapter: git });
    const graph = await analyzer.analyze(['src/a.ts'], head);

    expect(graph['src/a.ts']).toEqual([
      { source: 'src/a.ts', target: 'src/newDep.ts', specifier: './newDep', line: 1 }
    ]);
    expect(await git.getFileContents('src/a.ts', base)).toContain("'./oldDep'");
  });

  it('resolves target that exists at revision even if removed from working tree', async () => {
    initRepo(tmp);
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src', 'newDep.ts'), 'export const newDep = 1;\n');
    fs.writeFileSync(path.join(tmp, 'src', 'a.ts'), "import './newDep';\n");
    runGit(tmp, ['add', '.']);
    runGit(tmp, ['commit', '-m', 'add a and newDep']);
    const head = runGit(tmp, ['rev-parse', 'HEAD']);

    // remove from working tree only
    fs.unlinkSync(path.join(tmp, 'src', 'newDep.ts'));

    const git = new GitAdapterImpl(tmp);
    const analyzer = new TypeScriptDependencyAnalyzer({ repoRoot: await git.getRepositoryRoot(), gitAdapter: git });
    const graph = await analyzer.analyze(['src/a.ts'], head);

    expect(graph['src/a.ts']).toEqual([
      { source: 'src/a.ts', target: 'src/newDep.ts', specifier: './newDep', line: 1 }
    ]);
  });

  it('does not resolve uncommitted working-tree files as targets for a committed import', async () => {
    initRepo(tmp);
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src', 'a.ts'), "import './ghost';\n");
    runGit(tmp, ['add', 'src/a.ts']);
    runGit(tmp, ['commit', '-m', 'commit a referencing ghost']);
    const head = runGit(tmp, ['rev-parse', 'HEAD']);

    // create ghost.ts only in working tree (uncommitted)
    fs.writeFileSync(path.join(tmp, 'src', 'ghost.ts'), 'export const ghost = 1;\n');

    const git = new GitAdapterImpl(tmp);
    const analyzer = new TypeScriptDependencyAnalyzer({ repoRoot: await git.getRepositoryRoot(), gitAdapter: git });
    const graph = await analyzer.analyze(['src/a.ts'], head);

    expect(graph['src/a.ts']).toEqual([]);
  });

  it('rejects an oversized source before parsing it', async () => {
    initRepo(tmp);
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src', 'huge.ts'), 'x'.repeat(5 * 1024 * 1024 + 128));
    runGit(tmp, ['add', '.']);
    runGit(tmp, ['commit', '-m', 'add oversized source']);

    const git = new GitAdapterImpl(tmp);
    const analyzer = new TypeScriptDependencyAnalyzer({ repoRoot: tmp, gitAdapter: git });

    await expect(analyzer.analyze(['src/huge.ts'], 'HEAD')).rejects.toThrow(
      /Source file exceeds dependency-analysis size limit/
    );
  });

  it('ignores dynamic require and import expressions', async () => {
    initRepo(tmp);
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src', 'a.ts'), [
      "const name = 'foo';",
      'require(name);',
      "require('./' + name);",
      'import(name);',
      'import(`./${name}`);'
    ].join('\n'));
    fs.writeFileSync(path.join(tmp, 'src', 'foo.ts'), 'export const foo = true;\n');
    runGit(tmp, ['add', '.']);
    runGit(tmp, ['commit', '-m', 'add dynamic expressions']);

    const git = new GitAdapterImpl(tmp);
    const analyzer = new TypeScriptDependencyAnalyzer({ repoRoot: tmp, gitAdapter: git });
    const graph = await analyzer.analyze(['src/a.ts'], 'HEAD');

    expect(graph['src/a.ts']).toEqual([]);
  });

  it('records a side-effect require call', async () => {
    initRepo(tmp);
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src', 'a.js'), "require('./setup');\n");
    fs.writeFileSync(path.join(tmp, 'src', 'setup.js'), 'globalThis.ready = true;\n');
    runGit(tmp, ['add', '.']);
    runGit(tmp, ['commit', '-m', 'add side-effect require']);

    const git = new GitAdapterImpl(tmp);
    const analyzer = new TypeScriptDependencyAnalyzer({ repoRoot: tmp, gitAdapter: git });
    const graph = await analyzer.analyze(['src/a.js'], 'HEAD');

    expect(graph['src/a.js']).toEqual([
      { source: 'src/a.js', target: 'src/setup.js', specifier: './setup', line: 1 }
    ]);
  });

  it('never executes target source while parsing dependencies', async () => {
    initRepo(tmp);
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src', 'a.ts'), [
      'process.exit(99);',
      "throw new Error('THIS MUST NEVER EXECUTE');",
      "import './dependency';"
    ].join('\n'));
    fs.writeFileSync(path.join(tmp, 'src', 'dependency.ts'), 'export const dependency = true;\n');
    runGit(tmp, ['add', '.']);
    runGit(tmp, ['commit', '-m', 'add inert source']);

    const git = new GitAdapterImpl(tmp);
    const analyzer = new TypeScriptDependencyAnalyzer({ repoRoot: tmp, gitAdapter: git });
    const graph = await analyzer.analyze(['src/a.ts'], 'HEAD');

    expect(graph['src/a.ts']).toEqual([
      { source: 'src/a.ts', target: 'src/dependency.ts', specifier: './dependency', line: 3 }
    ]);
  });

  it('keeps a graph source that has no imports', async () => {
    initRepo(tmp);
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src', 'value.ts'), 'export const value = 123;\n');
    runGit(tmp, ['add', '.']);
    runGit(tmp, ['commit', '-m', 'add zero-import source']);

    const git = new GitAdapterImpl(tmp);
    const analyzer = new TypeScriptDependencyAnalyzer({ repoRoot: tmp, gitAdapter: git });

    await expect(analyzer.analyze(['src/value.ts'], 'HEAD')).resolves.toEqual({
      'src/value.ts': []
    });
  });

  it('resolves dependency paths containing spaces and Unicode', async () => {
    initRepo(tmp);
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src', 'my module.ts'), 'export const spaced = true;\n');
    fs.writeFileSync(path.join(tmp, 'src', 'модуль.ts'), 'export const unicode = true;\n');
    fs.writeFileSync(path.join(tmp, 'src', 'a.ts'), "import './my module';\nimport './модуль';\n");
    runGit(tmp, ['add', '.']);
    runGit(tmp, ['commit', '-m', 'add path variants']);

    const git = new GitAdapterImpl(tmp);
    const analyzer = new TypeScriptDependencyAnalyzer({ repoRoot: tmp, gitAdapter: git });
    const graph = await analyzer.analyze(['src/a.ts'], 'HEAD');

    expect(graph['src/a.ts']).toEqual([
      { source: 'src/a.ts', target: 'src/my module.ts', specifier: './my module', line: 1 },
      { source: 'src/a.ts', target: 'src/модуль.ts', specifier: './модуль', line: 2 }
    ]);
  });

  it('preserves source import order and line numbers', async () => {
    initRepo(tmp);
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    for (const name of ['a', 'b', 'c']) {
      fs.writeFileSync(path.join(tmp, 'src', `${name}.ts`), `export const ${name} = true;\n`);
    }
    fs.writeFileSync(path.join(tmp, 'src', 'source.ts'), "import './a';\nimport './b';\nimport './c';\n");
    runGit(tmp, ['add', '.']);
    runGit(tmp, ['commit', '-m', 'add ordered imports']);

    const git = new GitAdapterImpl(tmp);
    const analyzer = new TypeScriptDependencyAnalyzer({ repoRoot: tmp, gitAdapter: git });
    const graph = await analyzer.analyze(['src/source.ts'], 'HEAD');

    expect(graph['src/source.ts'].map(edge => edge.target)).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);
    expect(graph['src/source.ts'].map(edge => edge.line)).toEqual([1, 2, 3]);
  });

  it.skipIf(process.platform === 'win32')('ignores Git symlink dependency targets', async () => {
    initRepo(tmp);
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src', 'a.ts'), "import './linked';\n");
    fs.symlinkSync('../../outside.ts', path.join(tmp, 'src', 'linked.ts'));
    runGit(tmp, ['add', '.']);
    runGit(tmp, ['commit', '-m', 'add symlink target']);

    const git = new GitAdapterImpl(tmp);
    const analyzer = new TypeScriptDependencyAnalyzer({ repoRoot: tmp, gitAdapter: git });
    const graph = await analyzer.analyze(['src/a.ts'], 'HEAD');

    expect(graph['src/a.ts']).toEqual([]);
    expect(await git.isSymlinkAtRevision('src/linked.ts', 'HEAD')).toBe(true);
  });
});
