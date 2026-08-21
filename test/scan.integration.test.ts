import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync, spawnSync } from 'child_process';
import { performScan } from '../src/commands/scan';
import { sampleConfig } from '../src/config/sample';

function runGit(cwd: string, args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function initRepo(tmp: string) {
  runGit(tmp, ['init']);
  runGit(tmp, ['config', 'user.email', 'tests@example.invalid']);
  runGit(tmp, ['config', 'user.name', 'ArchGuard Tests']);
}

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'archguard-test-'));
}

describe('scan integration', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkTmp();
  });

  afterEach(() => {
    if (fs.existsSync(tmp)) {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('requires base argument', async () => {
    const res = await performScan({ base: '', cwd: tmp });
    expect(res.exitCode).toBe(2);
  });

  it('performs git-only scan and returns changes (pretty)', async () => {
    initRepo(tmp);
    fs.writeFileSync(path.join(tmp, '.archguard.yml'), sampleConfig, 'utf8');
    fs.writeFileSync(path.join(tmp, 'a.txt'), '1');
    runGit(tmp, ['add', '.']);
    runGit(tmp, ['commit', '-m', 'initial']);
    const base = runGit(tmp, ['rev-parse', 'HEAD']);

    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src', 'new.ts'), 'x');
    runGit(tmp, ['add', '.']);
    runGit(tmp, ['commit', '-m', 'add new']);
    const head = runGit(tmp, ['rev-parse', 'HEAD']);

    const res = await performScan({ base, head, format: 'pretty', cwd: tmp });
    expect(res.exitCode).toBe(0);
    expect(res.result).toBeDefined();
    expect(res.result!.changes).toBeDefined();
    expect(res.result!.changes!.some(c => c.type === 'added' && c.path === 'src/new.ts')).toBe(true);
  });

  it('invalid base ref returns exitCode 2', async () => {
    initRepo(tmp);
    fs.writeFileSync(path.join(tmp, '.archguard.yml'), sampleConfig, 'utf8');
    fs.writeFileSync(path.join(tmp, 'a.txt'), '1');
    runGit(tmp, ['add', '.']);
    runGit(tmp, ['commit', '-m', 'initial']);
    const head = runGit(tmp, ['rev-parse', 'HEAD']);

    const res = await performScan({ base: 'invalid-base', head, cwd: tmp });
    expect(res.exitCode).toBe(2);
    expect(res.error).toMatch(/Unable to resolve Git ref: invalid-base/);
  });

  it('invalid head ref returns exitCode 2', async () => {
    initRepo(tmp);
    fs.writeFileSync(path.join(tmp, '.archguard.yml'), sampleConfig, 'utf8');
    fs.writeFileSync(path.join(tmp, 'a.txt'), '1');
    runGit(tmp, ['add', '.']);
    runGit(tmp, ['commit', '-m', 'initial']);
    const base = runGit(tmp, ['rev-parse', 'HEAD']);

    const res = await performScan({ base, head: 'invalid-head', cwd: tmp });
    expect(res.exitCode).toBe(2);
    expect(res.error).toMatch(/Unable to resolve Git ref: invalid-head/);
  });

  it('no changes are reported cleanly and emit the expected pretty output', async () => {
    initRepo(tmp);
    fs.writeFileSync(path.join(tmp, '.archguard.yml'), sampleConfig, 'utf8');
    fs.writeFileSync(path.join(tmp, 'a.txt'), '1');
    runGit(tmp, ['add', '.']);
    runGit(tmp, ['commit', '-m', 'initial']);
    const base = runGit(tmp, ['rev-parse', 'HEAD']);

    const out: string[] = [];
    const orig = console.log;
    console.log = (msg?: string) => { out.push(String(msg)); };
    const res = await performScan({ base, head: base, format: 'pretty', cwd: tmp });
    console.log = orig;

    expect(res.exitCode).toBe(0);
    expect(res.result!.changes).toEqual([]);
    expect(res.result!.comparison).toEqual({ base, head: base });
    expect(out.join('\n')).toContain('No changes detected.');
    expect(out.join('\n')).toContain('0 changed files');
    expect(out.join('\n')).toContain('Architecture analysis is not implemented yet.');
  });

  it('json output is parseable and contains the expected comparison and changes', async () => {
    initRepo(tmp);
    fs.writeFileSync(path.join(tmp, '.archguard.yml'), sampleConfig, 'utf8');
    fs.writeFileSync(path.join(tmp, 'b.txt'), '1');
    runGit(tmp, ['add', '.']);
    runGit(tmp, ['commit', '-m', 'initial']);
    const base = runGit(tmp, ['rev-parse', 'HEAD']);

    fs.writeFileSync(path.join(tmp, 'b.txt'), '2');
    runGit(tmp, ['add', '.']);
    runGit(tmp, ['commit', '-m', 'mod b']);
    const head = runGit(tmp, ['rev-parse', 'HEAD']);

    const out: string[] = [];
    const orig = console.log;
    console.log = (msg?: string) => { out.push(String(msg)); };
    const res = await performScan({ base, head, format: 'json', cwd: tmp });
    console.log = orig;

    expect(res.exitCode).toBe(0);
    expect(out).toHaveLength(1);
    const parsed = JSON.parse(out[0]);
    expect(parsed.comparison.base).toBe(base);
    expect(parsed.comparison.head).toBe(head);
    expect(Array.isArray(parsed.changes)).toBe(true);
    expect(Array.isArray(parsed.findings)).toBe(true);
    expect(parsed.changes.some((item: { path: string }) => item.path === 'b.txt')).toBe(true);
  });

  it('executes the built CLI smoke tests', () => {
    const cliPath = path.resolve(__dirname, '../dist/src/index.js');
    expect(fs.existsSync(cliPath)).toBe(true);

    initRepo(tmp);
    fs.writeFileSync(path.join(tmp, '.archguard.yml'), sampleConfig, 'utf8');
    fs.writeFileSync(path.join(tmp, 'a.txt'), '1');
    runGit(tmp, ['add', '.']);
    runGit(tmp, ['commit', '-m', 'initial']);
    const base = runGit(tmp, ['rev-parse', 'HEAD']);
    fs.writeFileSync(path.join(tmp, 'a.txt'), '2');
    runGit(tmp, ['add', '.']);
    runGit(tmp, ['commit', '-m', 'modify']);

    const valid = spawnSync(process.execPath, [cliPath, 'scan', '--base', base, '--head', 'HEAD'], { cwd: tmp, encoding: 'utf8' });
    expect(valid.status).toBe(0);
    expect(valid.stderr).toBe('');
    expect(valid.stdout).toContain('ArchGuard');
    expect(valid.stdout).toContain('Comparing:');
    expect(valid.stdout).toContain(base);
    expect(valid.stdout).toContain('HEAD');
    expect(valid.stdout).toContain('a.txt');

    const missing = spawnSync(process.execPath, [cliPath, 'scan'], { cwd: tmp, encoding: 'utf8' });
    expect(missing.status).toBe(2);

    const invalidBase = spawnSync(process.execPath, [cliPath, 'scan', '--base', 'does-not-exist'], { cwd: tmp, encoding: 'utf8' });
    expect(invalidBase.status).toBe(2);

    const invalidHead = spawnSync(process.execPath, [cliPath, 'scan', '--base', base, '--head', 'does-not-exist'], { cwd: tmp, encoding: 'utf8' });
    expect(invalidHead.status).toBe(2);

    const json = spawnSync(process.execPath, [cliPath, 'scan', '--base', base, '--head', 'HEAD', '--format', 'json'], { cwd: tmp, encoding: 'utf8' });
    expect(json.status).toBe(0);
    expect(json.stderr).toBe('');
    const parsed = JSON.parse(json.stdout);
    expect(parsed.comparison.base).toBe(base);
    expect(parsed.comparison.head).toBe('HEAD');
    expect(Array.isArray(parsed.changes)).toBe(true);
    expect(Array.isArray(parsed.findings)).toBe(true);
    expect(parsed.changes.some((item: { path: string }) => item.path === 'a.txt')).toBe(true);

    const noChangeJson = spawnSync(process.execPath, [cliPath, 'scan', '--base', 'HEAD', '--head', 'HEAD', '--format', 'json'], { cwd: tmp, encoding: 'utf8' });
    expect(noChangeJson.status).toBe(0);
    expect(noChangeJson.stderr).toBe('');
    const noChangeParsed = JSON.parse(noChangeJson.stdout);
    expect(noChangeParsed.changes).toEqual([]);
    expect(noChangeParsed.findings).toEqual([]);
    expect(noChangeParsed.comparison.base).toBe('HEAD');
    expect(noChangeParsed.comparison.head).toBe('HEAD');

    const help = spawnSync(process.execPath, [cliPath, 'scan', '--help'], { cwd: tmp, encoding: 'utf8' });
    expect(help.status).toBe(0);
    expect(help.stdout).toContain('--base');
    expect(help.stdout).toContain('--head');
    expect(help.stdout).toContain('--format');
    expect(help.stdout).toContain('default: HEAD');
    expect(help.stdout).toContain('pretty');
    expect(help.stdout).toContain('json');
  });
});
