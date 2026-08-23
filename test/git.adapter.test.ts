import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import { GitAdapterImpl } from '../src/git/GitAdapter';
import { GitCommandFailure } from '../src/git/errors';

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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'archguard-test-'));
}

describe('GitAdapter', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkTmp();
  });

  afterEach(() => {
    if (fs.existsSync(tmp)) {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('detects non-git directory', async () => {
    const ga = new GitAdapterImpl(tmp);
    await expect(ga.getChanges('HEAD', 'HEAD')).rejects.toThrow();
  });

  it('detects added, modified, deleted, and renamed in one diff', async () => {
    initRepo(tmp);
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src', 'base.ts'), 'base');
    fs.writeFileSync(path.join(tmp, 'src', 'old.ts'), 'old');
    fs.writeFileSync(path.join(tmp, 'src', 'renamed.ts'), 'rename');
    runGit(tmp, ['add', '.']);
    runGit(tmp, ['commit', '-m', 'seed files']);
    const base = runGit(tmp, ['rev-parse', 'HEAD']);

    fs.writeFileSync(path.join(tmp, 'src', 'base.ts'), 'base-modified');
    fs.writeFileSync(path.join(tmp, 'src', 'new.ts'), 'new');
    fs.unlinkSync(path.join(tmp, 'src', 'old.ts'));
    fs.renameSync(path.join(tmp, 'src', 'renamed.ts'), path.join(tmp, 'src', 'renamed-2.ts'));
    runGit(tmp, ['add', '-A']);
    runGit(tmp, ['commit', '-m', 'multi change']);
    const head = runGit(tmp, ['rev-parse', 'HEAD']);

    const ga = new GitAdapterImpl(tmp);
    const changes = await ga.getChanges(base, head);
    expect(changes).toEqual([
      { type: 'modified', path: 'src/base.ts' },
      { type: 'added', path: 'src/new.ts' },
      { type: 'deleted', path: 'src/old.ts' },
      { type: 'renamed', path: 'src/renamed-2.ts', oldPath: 'src/renamed.ts' }
    ]);
    expect(changes).toHaveLength(4);
  });

  it('returns invalid base ref clearly', async () => {
    initRepo(tmp);
    const ga = new GitAdapterImpl(tmp);
    await expect(ga.getChanges('invalid-base', 'HEAD')).rejects.toThrow('Unable to resolve Git ref: invalid-base');
  });

  it('returns invalid head ref clearly', async () => {
    const base = initRepo(tmp);
    const ga = new GitAdapterImpl(tmp);
    await expect(ga.getChanges(base, 'invalid-head')).rejects.toThrow('Unable to resolve Git ref: invalid-head');
  });

  it('reports revision metadata and treats only absent paths as missing', async () => {
    initRepo(tmp);
    fs.writeFileSync(path.join(tmp, 'tracked.ts'), 'export const value = true;\n');
    fs.writeFileSync(path.join(tmp, '[value].ts'), 'literal pathspec\n');
    fs.writeFileSync(path.join(tmp, 'v.ts'), 'glob match with a different size\n');
    runGit(tmp, ['add', '.']);
    runGit(tmp, ['commit', '-m', 'add tracked source']);

    const ga = new GitAdapterImpl(tmp);
    expect(await ga.fileExistsAtRevision('tracked.ts', 'HEAD')).toBe(true);
    expect(await ga.getFileSizeAtRevision('tracked.ts', 'HEAD')).toBe(Buffer.byteLength('export const value = true;\n'));
    expect(await ga.isSymlinkAtRevision('tracked.ts', 'HEAD')).toBe(false);
    expect(await ga.getFileSizeAtRevision('[value].ts', 'HEAD')).toBe(Buffer.byteLength('literal pathspec\n'));
    expect(await ga.fileExistsAtRevision('missing.ts', 'HEAD')).toBe(false);
    expect(await ga.getFileSizeAtRevision('missing.ts', 'HEAD')).toBeNull();
    expect(await ga.isSymlinkAtRevision('missing.ts', 'HEAD')).toBe(false);
  });

  it('caches successful commit resolutions but does not cache failed refs', async () => {
    initRepo(tmp);
    const ga = new GitAdapterImpl(tmp);
    const internals = ga as unknown as {
      runGit: (args: string[], cwd?: string, maxBuffer?: number) => Promise<{ stdout: string; stderr: string }>;
    };
    const originalRunGit = internals.runGit.bind(ga);
    let verifyCalls = 0;
    internals.runGit = async (args, cwd, maxBuffer) => {
      if (args[0] === 'rev-parse' && args[1] === '--verify') verifyCalls++;
      return originalRunGit(args, cwd, maxBuffer);
    };

    await ga.fileExistsAtRevision('README.md', 'HEAD');
    await ga.getFileSizeAtRevision('README.md', 'HEAD');
    await ga.isSymlinkAtRevision('README.md', 'HEAD');
    expect(verifyCalls).toBe(1);

    await expect(ga.fileExistsAtRevision('README.md', 'invalid-ref')).rejects.toThrow(
      'Unable to resolve Git ref: invalid-ref'
    );
    await expect(ga.fileExistsAtRevision('README.md', 'invalid-ref')).rejects.toThrow(
      'Unable to resolve Git ref: invalid-ref'
    );
    expect(verifyCalls).toBe(3);
  });

  it('propagates Git infrastructure failures from revision metadata helpers', async () => {
    initRepo(tmp);
    const ga = new GitAdapterImpl(tmp);
    await ga.fileExistsAtRevision('README.md', 'HEAD');

    const internals = ga as unknown as {
      runGit: (args: string[], cwd?: string, maxBuffer?: number) => Promise<{ stdout: string; stderr: string }>;
    };
    const originalRunGit = internals.runGit.bind(ga);
    internals.runGit = async (args, cwd, maxBuffer) => {
      if (args[0] === 'ls-tree') {
        throw new GitCommandFailure('simulated Git infrastructure failure');
      }
      return originalRunGit(args, cwd, maxBuffer);
    };

    await expect(ga.fileExistsAtRevision('README.md', 'HEAD')).rejects.toThrow(
      'simulated Git infrastructure failure'
    );
    await expect(ga.getFileSizeAtRevision('README.md', 'HEAD')).rejects.toThrow(
      'simulated Git infrastructure failure'
    );
    await expect(ga.isSymlinkAtRevision('README.md', 'HEAD')).rejects.toThrow(
      'simulated Git infrastructure failure'
    );
  });

  it('reads historical and working content from the repository', async () => {
    initRepo(tmp);
    fs.writeFileSync(path.join(tmp, 'a.txt'), 'v1');
    runGit(tmp, ['add', '.']);
    runGit(tmp, ['commit', '-m', 'add a']);
    const oldCommit = runGit(tmp, ['rev-parse', 'HEAD']);

    fs.writeFileSync(path.join(tmp, 'a.txt'), 'v2');
    const ga = new GitAdapterImpl(tmp);

    expect(await ga.getFileContents('a.txt', oldCommit)).toBe('v1');
    expect(await ga.getFileContents('a.txt')).toBe('v2');
  });

  it('handles spaces and Unicode in file names', async () => {
    initRepo(tmp);
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    const fileName = 'example file テスト.ts';
    const filePath = path.join(tmp, 'src', fileName);
    fs.writeFileSync(filePath, 'before');
    runGit(tmp, ['add', '.']);
    runGit(tmp, ['commit', '-m', 'add spaced file']);
    const base = runGit(tmp, ['rev-parse', 'HEAD']);

    fs.writeFileSync(filePath, 'after');
    runGit(tmp, ['add', '.']);
    runGit(tmp, ['commit', '-m', 'modify spaced file']);
    const head = runGit(tmp, ['rev-parse', 'HEAD']);

    const ga = new GitAdapterImpl(tmp);
    const changes = await ga.getChanges(base, head);
    expect(changes).toEqual([{ type: 'modified', path: `src/${fileName}` }]);
    expect(await ga.getFileContents(`src/${fileName}`)).toBe('after');
  });

  it('detects renames with spaces in file names', async () => {
    initRepo(tmp);
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    const oldPath = path.join(tmp, 'src', 'old file.ts');
    fs.writeFileSync(oldPath, 'old');
    runGit(tmp, ['add', '.']);
    runGit(tmp, ['commit', '-m', 'add old file']);
    const base = runGit(tmp, ['rev-parse', 'HEAD']);

    runGit(tmp, ['mv', 'src/old file.ts', 'src/new file.ts']);
    runGit(tmp, ['commit', '-am', 'rename old file']);
    const head = runGit(tmp, ['rev-parse', 'HEAD']);

    const ga = new GitAdapterImpl(tmp);
    expect(await ga.getChanges(base, head)).toEqual([
      { type: 'renamed', oldPath: 'src/old file.ts', path: 'src/new file.ts' }
    ]);
    expect(await ga.getFileContents('src/new file.ts')).toBe('old');
    expect(await ga.getFileContents('src/old file.ts', base)).toBe('old');
  });

  it('accepts legitimate dotted filenames and rejects traversal and absolute paths', async () => {
    initRepo(tmp);
    fs.mkdirSync(path.join(tmp, 'src', 'version..backup'), { recursive: true });
    fs.mkdirSync(path.join(tmp, '..folder'), { recursive: true });
    const validPath = path.join(tmp, 'src', 'foo..bar.ts');
    const nestedValidPath = path.join(tmp, 'src', 'version..backup', 'file.ts');
    const leadingDottedPath = path.join(tmp, '..config.ts');
    const leadingDottedFolderPath = path.join(tmp, '..folder', 'file.ts');
    fs.writeFileSync(validPath, 'valid');
    fs.writeFileSync(nestedValidPath, 'nested');
    fs.writeFileSync(leadingDottedPath, 'leading');
    fs.writeFileSync(leadingDottedFolderPath, 'folder');
    runGit(tmp, ['add', '.']);
    runGit(tmp, ['commit', '-m', 'add dotted names']);

    const ga = new GitAdapterImpl(tmp);
    expect(await ga.getFileContents('src/foo..bar.ts')).toBe('valid');
    expect(await ga.getFileContents('src/version..backup/file.ts')).toBe('nested');
    expect(await ga.getFileContents('..config.ts', 'HEAD')).toBe('leading');
    expect(await ga.getFileContents('..folder/file.ts', 'HEAD')).toBe('folder');
    await expect(ga.getFileContents('../outside.txt')).rejects.toThrow(/Invalid repository-relative file path|File path escapes repository root/);
    await expect(ga.getFileContents('src/../../secret.txt')).rejects.toThrow(/Invalid repository-relative file path|File path escapes repository root/);
    if (process.platform === 'win32') {
      await expect(ga.getFileContents('C:\\outside.txt')).rejects.toThrow();
    } else {
      await expect(ga.getFileContents('/absolute/outside.txt')).rejects.toThrow();
    }
  });

  it('reads nested repository paths from a nested working directory and detects change', async () => {
    initRepo(tmp);
    const nested = path.join(tmp, 'src', 'domain', 'users', 'internal');
    fs.mkdirSync(nested, { recursive: true });
    const filePath = path.join(nested, 'user.ts');
    fs.writeFileSync(filePath, 'v1');
    runGit(tmp, ['add', '.']);
    runGit(tmp, ['commit', '-m', 'add nested file']);
    const base = runGit(tmp, ['rev-parse', 'HEAD']);

    fs.writeFileSync(filePath, 'v2');
    runGit(tmp, ['add', '.']);
    runGit(tmp, ['commit', '-m', 'modify nested file']);

    const ga = new GitAdapterImpl(path.join(tmp, 'src', 'domain', 'users', 'internal'));
    expect(await ga.getFileContents('src/domain/users/internal/user.ts')).toBe('v2');
    const changes = await ga.getChanges(base, 'HEAD');
    expect(changes).toEqual([{ type: 'modified', path: 'src/domain/users/internal/user.ts' }]);
  });

  it('rejects missing files and invalid historical revisions', async () => {
    initRepo(tmp);
    const ga = new GitAdapterImpl(tmp);
    await expect(ga.getFileContents('missing.ts')).rejects.toThrow(/File not found: missing\.ts|missing\.ts/);
    await expect(ga.getFileContents('README.md', 'invalid-ref')).rejects.toThrow('Unable to resolve Git ref: invalid-ref');
  });

  it.skipIf(process.platform === 'win32')('rejects unsafe symlinks when supported', async () => {
    initRepo(tmp);
    const outsideFile = path.join(os.tmpdir(), `archguard-outside-${Date.now()}.txt`);
    fs.writeFileSync(outsideFile, 'outside');
    const linkPath = path.join(tmp, 'link.txt');
    try {
      fs.symlinkSync(outsideFile, linkPath, 'file');
    } catch {
      return;
    }

    const ga = new GitAdapterImpl(tmp);
    await expect(ga.getFileContents('link.txt')).rejects.toThrow(/Symlinks are not allowed|escapes repository root/);
    fs.unlinkSync(linkPath);
    fs.unlinkSync(outsideFile);
  });

  it.skipIf(process.platform === 'win32')('maps a real Git T status to modified when supported', async () => {
    initRepo(tmp);
    const srcDir = path.join(tmp, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    const filePath = path.join(srcDir, 'a.txt');
    fs.writeFileSync(filePath, 'v1');
    runGit(tmp, ['add', '.']);
    runGit(tmp, ['commit', '-m', 'add file']);
    const base = runGit(tmp, ['rev-parse', 'HEAD']);

    fs.unlinkSync(filePath);
    fs.symlinkSync('target.txt', filePath, 'file');
    runGit(tmp, ['add', '-A']);
    runGit(tmp, ['commit', '-m', 'convert to symlink']);
    const head = runGit(tmp, ['rev-parse', 'HEAD']);

    const gitOutput = execFileSync('git', ['diff', '--name-status', '-z', '--find-renames', base, head], { cwd: tmp, encoding: 'utf8' });
    expect(gitOutput).toContain('T');

    const ga = new GitAdapterImpl(tmp);
    expect(await ga.getChanges(base, head)).toEqual([{ type: 'modified', path: 'src/a.txt' }]);
  });

  it('returns an empty change set for identical refs', async () => {
    const base = initRepo(tmp);
    const ga = new GitAdapterImpl(tmp);
    const changes = await ga.getChanges(base, base);
    expect(changes).toEqual([]);
  });
});
