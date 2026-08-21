import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import type { GitAdapter } from '../interfaces';
import type { RepositoryChange } from '../types';
import { GitCommandFailure, InvalidGitRef, NotGitRepository } from './errors';

const execFileP = promisify(execFile);

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

export class GitAdapterImpl implements GitAdapter {
  private repoRoot: string | null = null;

  constructor(private readonly cwd: string = process.cwd()) {}

  private async runGit(args: string[], cwd?: string, maxBuffer = 32 * 1024 * 1024): Promise<{ stdout: string; stderr: string }> {
    try {
      return await execFileP('git', args, { cwd: cwd ?? this.cwd, encoding: 'utf8', maxBuffer });
    } catch (err) {
      const error = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
      if (error.code === 'ENOENT') {
        throw new GitCommandFailure('Git executable is not available');
      }

      const message = (error.stderr ?? error.message ?? 'Git command failed').toString().trim();
      if (/not a git repository/i.test(message)) {
        throw new NotGitRepository();
      }
      throw new GitCommandFailure(message || 'Git command failed');
    }
  }

  private async ensureGitRepo(): Promise<string> {
    if (this.repoRoot) return this.repoRoot;

    try {
      const { stdout } = await this.runGit(['rev-parse', '--is-inside-work-tree'], this.cwd);
      if (!stdout || stdout.trim() !== 'true') {
        throw new NotGitRepository();
      }
    } catch (err) {
      if (err instanceof NotGitRepository) throw err;
      throw err;
    }

    const { stdout } = await this.runGit(['rev-parse', '--show-toplevel'], this.cwd);
    this.repoRoot = normalizePath(stdout.trim());
    return this.repoRoot;
  }

  private async resolveCommit(ref: string): Promise<string> {
    const repoRoot = await this.ensureGitRepo();
    try {
      const { stdout } = await this.runGit(['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`], repoRoot);
      return stdout.trim();
    } catch {
      throw new InvalidGitRef(ref);
    }
  }

  private async verifyRef(ref: string): Promise<string> {
    return this.resolveCommit(ref);
  }

  private normalizeRepoRelativePath(filePath: string): string {
    if (!filePath) {
      throw new GitCommandFailure('File path is required');
    }

    const normalized = normalizePath(filePath).replace(/^\.\//, '');
    if (
      normalized === '' ||
      normalized === '.' ||
      normalized.startsWith('/') ||
      normalized.startsWith('\\') ||
      /^[A-Za-z]:/.test(normalized) ||
      normalized.includes('\0')
    ) {
      throw new GitCommandFailure(`Invalid repository-relative file path: ${filePath}`);
    }

    const segments = normalized.split('/');
    if (segments.some(segment => segment === '..')) {
      throw new GitCommandFailure(`Invalid repository-relative file path: ${filePath}`);
    }

    const posix = path.posix.normalize(normalized);
    if (posix === '.' || posix === '..' || posix.startsWith('../') || path.posix.isAbsolute(posix)) {
      throw new GitCommandFailure(`Invalid repository-relative file path: ${filePath}`);
    }

    return posix;
  }

  private resolveRepoPath(filePath: string, repoRoot: string): string {
    const safePath = this.normalizeRepoRelativePath(filePath);
    const abs = path.resolve(repoRoot, safePath);
    const relativeToRoot = path.relative(repoRoot, abs);
    if (relativeToRoot === '' || relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
      throw new GitCommandFailure(`File path escapes repository root: ${filePath}`);
    }
    return abs;
  }

  public async getChanges(base: string, head: string): Promise<RepositoryChange[]> {
    const repoRoot = await this.ensureGitRepo();
    const baseSha = await this.verifyRef(base);
    const headSha = await this.verifyRef(head);

    try {
      const { stdout } = await this.runGit(['diff', '--name-status', '-z', '--find-renames', baseSha, headSha], repoRoot);
      if (!stdout) return [];

      const tokens = stdout.split('\0').filter(Boolean);
      const changes: RepositoryChange[] = [];

      for (let i = 0; i < tokens.length; ) {
        const status = tokens[i++];
        if (!status) continue;

        const first = status[0];
        if (status === 'A' || status === 'M' || status === 'D' || status === 'T') {
          const filePath = tokens[i++];
          if (!filePath) throw new GitCommandFailure(`Malformed git output: missing path after status ${status}`);
          const p = normalizePath(filePath);
          if (status === 'A') changes.push({ type: 'added', path: p });
          if (status === 'M' || status === 'T') changes.push({ type: 'modified', path: p });
          if (status === 'D') changes.push({ type: 'deleted', path: p });
          continue;
        }

        if (first === 'R' || first === 'C') {
          const oldPath = tokens[i++];
          const newPath = tokens[i++];
          if (!oldPath || !newPath) throw new GitCommandFailure(`Malformed git rename entry: ${status}`);
          const oldP = normalizePath(oldPath);
          const newP = normalizePath(newPath);
          if (first === 'R') {
            changes.push({ type: 'renamed', path: newP, oldPath: oldP });
          } else {
            changes.push({ type: 'added', path: newP });
          }
          continue;
        }

        throw new GitCommandFailure(`Unsupported git status code: ${status}`);
      }

      return changes;
    } catch (err) {
      if (err instanceof InvalidGitRef || err instanceof NotGitRepository) throw err;
      throw err instanceof GitCommandFailure ? err : new GitCommandFailure((err as Error).message);
    }
  }

  public async getFileContents(filePath: string, rev?: string): Promise<string> {
    const repoRoot = await this.ensureGitRepo();
    const safePath = this.normalizeRepoRelativePath(filePath);

    if (rev) {
      const sha = await this.verifyRef(rev);
      const objectSpec = `${sha}:${safePath}`;
      try {
        const { stdout } = await this.runGit(['show', objectSpec], repoRoot, 32 * 1024 * 1024);
        return stdout;
      } catch (err) {
        if (err instanceof InvalidGitRef) throw err;
        if (err instanceof NotGitRepository) throw err;
        throw err instanceof GitCommandFailure ? err : new GitCommandFailure((err as Error).message);
      }
    }

    const abs = this.resolveRepoPath(safePath, repoRoot);
    try {
      if (!fs.existsSync(abs)) {
        throw new GitCommandFailure(`File not found: ${filePath}`);
      }

      const stat = fs.lstatSync(abs);
      if (stat.isSymbolicLink()) {
        throw new GitCommandFailure(`Symlinks are not allowed for repository file reads: ${filePath}`);
      }

      const realPath = fs.realpathSync(abs);
      const realRelative = path.relative(repoRoot, realPath);
      if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
        throw new GitCommandFailure(`File escapes repository root: ${filePath}`);
      }

      return fs.readFileSync(abs, 'utf8');
    } catch (err) {
      if (err instanceof GitCommandFailure) throw err;
      throw new GitCommandFailure((err as Error).message);
    }
  }
}
