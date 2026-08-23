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

interface RevisionTreeEntry {
  mode: string;
  type: string;
  size: number | null;
}

export class GitAdapterImpl implements GitAdapter {
  private repoRoot: string | null = null;
  private readonly resolvedCommitCache = new Map<string, string>();

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
    const cacheKey = ref;
    const cached = this.resolvedCommitCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const repoRoot = await this.ensureGitRepo();
    try {
      const { stdout } = await this.runGit(['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`], repoRoot);
      const sha = stdout.trim();
      if (sha) {
        this.resolvedCommitCache.set(cacheKey, sha);
      }
      return sha;
    } catch {
      throw new InvalidGitRef(ref);
    }
  }

  private async verifyRef(ref: string): Promise<string> {
    return this.resolveCommit(ref);
  }

  public async getRepositoryRoot(): Promise<string> {
    return this.ensureGitRepo();
  }

  public async resolveRevision(revision: string): Promise<string> {
    return this.resolveCommit(revision);
  }

  public async listFilesAtRevision(revision: string): Promise<string[]> {
    const repoRoot = await this.ensureGitRepo();
    const sha = await this.resolveCommit(revision);
    const { stdout } = await this.runGit(
      ['ls-tree', '-r', '-z', '--name-only', sha],
      repoRoot,
      64 * 1024 * 1024
    );
    if (!stdout) return [];
    return stdout
      .split('\0')
      .filter(Boolean)
      .map(normalizePath);
  }

  private async getRevisionTreeEntry(filePath: string, rev: string): Promise<RevisionTreeEntry | null> {
    const repoRoot = await this.ensureGitRepo();
    const safePath = this.normalizeRepoRelativePath(filePath);
    const sha = await this.resolveCommit(rev);
    const literalPathspec = `:(literal)${safePath}`;
    const { stdout } = await this.runGit(['ls-tree', '-l', '-z', sha, '--', literalPathspec], repoRoot);
    if (!stdout) return null;

    const entry = stdout.split('\0', 1)[0];
    const separator = entry.indexOf('\t');
    if (separator === -1 || normalizePath(entry.slice(separator + 1)) !== safePath) {
      throw new GitCommandFailure(`Malformed git ls-tree output for path: ${safePath}`);
    }

    const fields = entry.slice(0, separator).trim().split(/\s+/);
    if (fields.length !== 4) {
      throw new GitCommandFailure(`Malformed git ls-tree metadata for path: ${safePath}`);
    }

    const [mode, type, , sizeText] = fields;
    let size: number | null = null;
    if (sizeText !== '-') {
      size = Number.parseInt(sizeText, 10);
      if (!Number.isSafeInteger(size) || size < 0) {
        throw new GitCommandFailure(`Invalid git object size for path: ${safePath}`);
      }
    }

    return { mode, type, size };
  }

  public async fileExistsAtRevision(filePath: string, rev: string): Promise<boolean> {
    const entry = await this.getRevisionTreeEntry(filePath, rev);
    return entry?.type === 'blob';
  }

  public async getFileSizeAtRevision(filePath: string, rev: string): Promise<number | null> {
    const entry = await this.getRevisionTreeEntry(filePath, rev);
    return entry?.type === 'blob' ? entry.size : null;
  }

  public async isSymlinkAtRevision(filePath: string, rev: string): Promise<boolean> {
    const entry = await this.getRevisionTreeEntry(filePath, rev);
    return entry?.mode === '120000';
  }

  private escapesRoot(relativePath: string): boolean {
    const normalized = relativePath.replace(/\\/g, '/');
    return normalized === '..' || normalized.startsWith('../') || path.isAbsolute(relativePath) || normalized.startsWith('/');
  }

  private normalizeRepoRelativePath(filePath: string): string {
    if (!filePath) {
      throw new GitCommandFailure('File path is required');
    }

    const normalized = normalizePath(filePath).replace(/^\.\//, '');
    if (
      normalized === '' ||
      normalized === '.' ||
      this.escapesRoot(normalized) ||
      path.posix.isAbsolute(normalized) ||
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
    if (posix === '.' || posix === '..' || this.escapesRoot(posix) || path.posix.isAbsolute(posix)) {
      throw new GitCommandFailure(`Invalid repository-relative file path: ${filePath}`);
    }

    return posix;
  }

  private resolveRepoPath(filePath: string, repoRoot: string): string {
    const safePath = this.normalizeRepoRelativePath(filePath);
    const abs = path.resolve(repoRoot, safePath);
    const relativeToRoot = path.relative(repoRoot, abs).replace(/\\/g, '/');
    if (relativeToRoot === '' || this.escapesRoot(relativeToRoot) || path.isAbsolute(relativeToRoot)) {
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
      const realRelative = path.relative(repoRoot, realPath).replace(/\\/g, '/');
      if (this.escapesRoot(realRelative) || path.isAbsolute(realRelative)) {
        throw new GitCommandFailure(`File escapes repository root: ${filePath}`);
      }

      return fs.readFileSync(abs, 'utf8');
    } catch (err) {
      if (err instanceof GitCommandFailure) throw err;
      throw new GitCommandFailure((err as Error).message);
    }
  }
}
