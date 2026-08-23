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

const violationConfig = `version: 1
layers:
  - name: ui
    matches:
      - "src/ui/**"
    mayDependOn:
      - application
  - name: application
    matches:
      - "src/application/**"
    mayDependOn: []
  - name: domain
    matches:
      - "src/domain/**"
    mayDependOn: []
`;

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

  it('invalid architecture config returns exitCode 2', async () => {
    fs.writeFileSync(path.join(tmp, '.archguard.yml'), `version: 1
layers:
  - name: application
    matches:
      - "src/application/**"
    mayDependOn:
      - missing
`);

    const res = await performScan({ base: 'HEAD', cwd: tmp });
    expect(res.exitCode).toBe(2);
    expect(res.error).toMatch(/mayDependOn references unknown layer 'missing'/);
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
    expect(res.result!.dependencyGraph).toEqual({});
    expect(res.result!.stats).toEqual({ changedFiles: 0, filesAnalyzed: 0, edgesAnalyzed: 0 });
    expect(out.join('\n')).toContain('No changes detected.');
    expect(out.join('\n')).toContain('0 changed files');
    expect(out.join('\n')).toContain('Architecture rules:');
    expect(out.join('\n')).toContain('No violations found.');
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

  it('performs dependency analysis in scan output', async () => {
    initRepo(tmp);
    fs.writeFileSync(path.join(tmp, '.archguard.yml'), sampleConfig, 'utf8');
    fs.mkdirSync(path.join(tmp, 'src', 'domain'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'src', 'application'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src', 'domain', 'user.ts'), 'export type User = { id: string };\n');
    fs.writeFileSync(path.join(tmp, 'src', 'application', 'service.ts'), "import { User } from '../domain/user';\n");
    runGit(tmp, ['add', '.']);
    runGit(tmp, ['commit', '-m', 'seed service']);
    const base = runGit(tmp, ['rev-parse', 'HEAD']);

    fs.writeFileSync(path.join(tmp, 'src', 'application', 'service.ts'), "import { User } from '../domain/user';\nexport const value = 1;\n");
    runGit(tmp, ['add', '.']);
    runGit(tmp, ['commit', '-m', 'modify service']);
    const head = runGit(tmp, ['rev-parse', 'HEAD']);

    const res = await performScan({ base, head, cwd: tmp });
    expect(res.exitCode).toBe(0);
    expect(res.result).toBeDefined();
    expect(res.result!.dependencyGraph).toBeDefined();
    expect(res.result!.dependencyGraph!['src/application/service.ts']).toContainEqual({
      source: 'src/application/service.ts',
      target: 'src/domain/user.ts',
      specifier: '../domain/user',
      line: 1
    });
    expect(res.result!.findings).toEqual([]);
    expect(res.result!.summary).toEqual({ errors: 0, warnings: 0, info: 0 });
  });

  it('returns exitCode 1 and a finding for a forbidden architecture dependency', async () => {
    initRepo(tmp);
    fs.writeFileSync(path.join(tmp, '.archguard.yml'), violationConfig, 'utf8');
    fs.mkdirSync(path.join(tmp, 'src', 'ui'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'src', 'domain'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src', 'domain', 'user.ts'), 'export type User = { id: string };\n');
    fs.writeFileSync(path.join(tmp, 'src', 'ui', 'App.ts'), "import type { User } from '../domain/user';\nexport const user: User = { id: '1' };\n");
    runGit(tmp, ['add', '.']);
    runGit(tmp, ['commit', '-m', 'seed forbidden dependency']);
    const base = runGit(tmp, ['rev-parse', 'HEAD']);

    fs.appendFileSync(path.join(tmp, 'src', 'ui', 'App.ts'), 'export const version = 2;\n');
    runGit(tmp, ['add', '.']);
    runGit(tmp, ['commit', '-m', 'modify ui source']);
    const head = runGit(tmp, ['rev-parse', 'HEAD']);

    const res = await performScan({ base, head, cwd: tmp });
    expect(res.exitCode).toBe(1);
    expect(res.result!.summary).toEqual({ errors: 1, warnings: 0, info: 0 });
    expect(res.result!.findings).toEqual([
      {
        ruleId: 'architecture/dependency',
        severity: 'error',
        title: 'Forbidden architecture dependency',
        message: 'Layer "ui" may not depend on layer "domain".',
        file: 'src/ui/App.ts',
        line: 1,
        sourceLayer: 'ui',
        targetLayer: 'domain',
        evidence: 'src/ui/App.ts -> src/domain/user.ts via "../domain/user"',
        suggestion: 'Depend on an allowed layer or update .archguard.yml.'
      }
    ]);
  });

  it('returns exitCode 2 when a changed source exceeds the analysis size limit', async () => {
    initRepo(tmp);
    fs.writeFileSync(path.join(tmp, '.archguard.yml'), sampleConfig, 'utf8');
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src', 'huge.ts'), 'export const value = 1;\n');
    runGit(tmp, ['add', '.']);
    runGit(tmp, ['commit', '-m', 'add small source']);
    const base = runGit(tmp, ['rev-parse', 'HEAD']);

    fs.writeFileSync(path.join(tmp, 'src', 'huge.ts'), 'x'.repeat(5 * 1024 * 1024 + 128));
    runGit(tmp, ['add', '.']);
    runGit(tmp, ['commit', '-m', 'oversize source']);
    const head = runGit(tmp, ['rev-parse', 'HEAD']);

    const res = await performScan({ base, head, cwd: tmp });
    expect(res.exitCode).toBe(2);
    expect(res.error).toMatch(/Source file exceeds dependency-analysis size limit/);
  });

  it('reports deleted sources without analyzing them', async () => {
    initRepo(tmp);
    fs.writeFileSync(path.join(tmp, '.archguard.yml'), sampleConfig, 'utf8');
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src', 'deleted.ts'), 'export const deleted = true;\n');
    runGit(tmp, ['add', '.']);
    runGit(tmp, ['commit', '-m', 'add source']);
    const base = runGit(tmp, ['rev-parse', 'HEAD']);

    fs.unlinkSync(path.join(tmp, 'src', 'deleted.ts'));
    runGit(tmp, ['add', '-A']);
    runGit(tmp, ['commit', '-m', 'delete source']);
    const head = runGit(tmp, ['rev-parse', 'HEAD']);

    const res = await performScan({ base, head, cwd: tmp });
    expect(res.exitCode).toBe(0);
    expect(res.result!.changes).toContainEqual({ type: 'deleted', path: 'src/deleted.ts' });
    expect(res.result!.dependencyGraph).not.toHaveProperty('src/deleted.ts');
    expect(res.result!.stats!.filesAnalyzed).toBe(0);
  });

  it('analyzes the new path of a renamed source', async () => {
    initRepo(tmp);
    fs.writeFileSync(path.join(tmp, '.archguard.yml'), sampleConfig, 'utf8');
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src', 'dep.ts'), 'export const dep = true;\n');
    fs.writeFileSync(path.join(tmp, 'src', 'old.ts'), "import './dep';\n");
    runGit(tmp, ['add', '.']);
    runGit(tmp, ['commit', '-m', 'add old source']);
    const base = runGit(tmp, ['rev-parse', 'HEAD']);

    runGit(tmp, ['mv', 'src/old.ts', 'src/new.ts']);
    runGit(tmp, ['commit', '-m', 'rename source']);
    const head = runGit(tmp, ['rev-parse', 'HEAD']);

    const res = await performScan({ base, head, cwd: tmp });
    expect(res.exitCode).toBe(0);
    expect(res.result!.changes).toContainEqual({ type: 'renamed', oldPath: 'src/old.ts', path: 'src/new.ts' });
    expect(res.result!.dependencyGraph).not.toHaveProperty('src/old.ts');
    expect(res.result!.dependencyGraph!['src/new.ts']).toEqual([
      { source: 'src/new.ts', target: 'src/dep.ts', specifier: './dep', line: 1 }
    ]);
  });

  it('counts all changes but analyzes only changed source files and emitted edges', async () => {
    initRepo(tmp);
    fs.writeFileSync(path.join(tmp, '.archguard.yml'), sampleConfig, 'utf8');
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'README.md'), 'before\n');
    fs.writeFileSync(path.join(tmp, 'package.json'), '{"private":true}\n');
    fs.writeFileSync(path.join(tmp, 'image.png'), Buffer.from([0, 1, 2]));
    fs.writeFileSync(path.join(tmp, 'src', 'one.ts'), 'export const one = true;\n');
    fs.writeFileSync(path.join(tmp, 'src', 'two.ts'), 'export const two = true;\n');
    fs.writeFileSync(path.join(tmp, 'src', 'a.ts'), "import './one';\nimport './two';\n");
    runGit(tmp, ['add', '.']);
    runGit(tmp, ['commit', '-m', 'seed mixed files']);
    const base = runGit(tmp, ['rev-parse', 'HEAD']);

    fs.writeFileSync(path.join(tmp, 'README.md'), 'after\n');
    fs.writeFileSync(path.join(tmp, 'package.json'), '{"private":false}\n');
    fs.writeFileSync(path.join(tmp, 'image.png'), Buffer.from([3, 4, 5]));
    fs.appendFileSync(path.join(tmp, 'src', 'a.ts'), 'export const version = 2;\n');
    runGit(tmp, ['add', '.']);
    runGit(tmp, ['commit', '-m', 'change mixed files']);
    const head = runGit(tmp, ['rev-parse', 'HEAD']);

    const res = await performScan({ base, head, cwd: tmp });
    expect(res.exitCode).toBe(0);
    expect(res.result!.changes).toHaveLength(4);
    expect(res.result!.stats).toEqual({ changedFiles: 4, filesAnalyzed: 1, edgesAnalyzed: 2 });
    expect(res.result!.dependencyGraph!['src/a.ts']).toHaveLength(2);
  });

  it('executes the built CLI against a real dependency edge', () => {
    const cliPath = path.resolve(__dirname, '../dist/src/index.js');
    expect(fs.existsSync(cliPath)).toBe(true);

    initRepo(tmp);
    fs.writeFileSync(path.join(tmp, '.archguard.yml'), sampleConfig, 'utf8');
    fs.mkdirSync(path.join(tmp, 'src', 'domain'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'src', 'application'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src', 'domain', 'user.ts'), 'export type User = {\n  id: string;\n};\n');
    fs.writeFileSync(path.join(tmp, 'src', 'application', 'service.ts'), [
      "import type { User } from '../domain/user';",
      '',
      'export function useUser(user: User) {',
      '  return user.id;',
      '}',
      ''
    ].join('\n'));
    runGit(tmp, ['add', '.']);
    runGit(tmp, ['commit', '-m', 'seed dependency graph']);
    const base = runGit(tmp, ['rev-parse', 'HEAD']);

    fs.appendFileSync(path.join(tmp, 'src', 'application', 'service.ts'), 'export const version = 2;\n');
    runGit(tmp, ['add', '.']);
    runGit(tmp, ['commit', '-m', 'modify service']);
    const head = runGit(tmp, ['rev-parse', 'HEAD']);

    const valid = spawnSync(process.execPath, [cliPath, 'scan', '--base', base, '--head', head], { cwd: tmp, encoding: 'utf8' });
    expect(valid.status).toBe(0);
    expect(valid.stderr).toBe('');
    expect(valid.stdout).toContain('ArchGuard');
    expect(valid.stdout).toContain('Comparing:');
    expect(valid.stdout).toContain(base);
    expect(valid.stdout).toContain(head);
    expect(valid.stdout).toContain('src/application/service.ts');
    expect(valid.stdout).toContain('Dependency analysis:');
    expect(valid.stdout).toContain('  1 source files analyzed');
    expect(valid.stdout).toContain('  1 local dependency edges');
    expect(valid.stdout).toContain('Architecture rules:');
    expect(valid.stdout).toContain('  No violations found.');

    const missing = spawnSync(process.execPath, [cliPath, 'scan'], { cwd: tmp, encoding: 'utf8' });
    expect(missing.status).toBe(2);

    const invalidBase = spawnSync(process.execPath, [cliPath, 'scan', '--base', 'does-not-exist'], { cwd: tmp, encoding: 'utf8' });
    expect(invalidBase.status).toBe(2);

    const invalidHead = spawnSync(process.execPath, [cliPath, 'scan', '--base', base, '--head', 'does-not-exist'], { cwd: tmp, encoding: 'utf8' });
    expect(invalidHead.status).toBe(2);

    const json = spawnSync(process.execPath, [cliPath, 'scan', '--base', base, '--head', head, '--format', 'json'], { cwd: tmp, encoding: 'utf8' });
    expect(json.status).toBe(0);
    expect(json.stderr).toBe('');
    const parsed = JSON.parse(json.stdout);
    expect(parsed.comparison.base).toBe(base);
    expect(parsed.comparison.head).toBe(head);
    expect(Array.isArray(parsed.changes)).toBe(true);
    expect(Array.isArray(parsed.findings)).toBe(true);
    expect(parsed.changes.some((item: { path: string }) => item.path === 'src/application/service.ts')).toBe(true);
    expect(parsed.dependencyGraph['src/application/service.ts']).toEqual([
      {
        source: 'src/application/service.ts',
        target: 'src/domain/user.ts',
        specifier: '../domain/user',
        line: 1
      }
    ]);
    expect(parsed.findings).toEqual([]);
    expect(parsed.summary).toEqual({ errors: 0, warnings: 0, info: 0 });

    const noChangeJson = spawnSync(process.execPath, [cliPath, 'scan', '--base', 'HEAD', '--head', 'HEAD', '--format', 'json'], { cwd: tmp, encoding: 'utf8' });
    expect(noChangeJson.status).toBe(0);
    expect(noChangeJson.stderr).toBe('');
    const noChangeParsed = JSON.parse(noChangeJson.stdout);
    expect(noChangeParsed.changes).toEqual([]);
    expect(noChangeParsed.findings).toEqual([]);
    expect(noChangeParsed.comparison.base).toBe('HEAD');
    expect(noChangeParsed.comparison.head).toBe('HEAD');
    expect(noChangeParsed.dependencyGraph).toEqual({});
    expect(noChangeParsed.stats).toEqual({ changedFiles: 0, filesAnalyzed: 0, edgesAnalyzed: 0 });

    const help = spawnSync(process.execPath, [cliPath, 'scan', '--help'], { cwd: tmp, encoding: 'utf8' });
    expect(help.status).toBe(0);
    expect(help.stdout).toContain('--base');
    expect(help.stdout).toContain('--head');
    expect(help.stdout).toContain('--format');
    expect(help.stdout).toContain('default: HEAD');
    expect(help.stdout).toContain('pretty');
    expect(help.stdout).toContain('json');
    expect(help.stdout).toContain('github');
    expect(help.stdout).toContain('sarif');
    expect(help.stdout).toContain('--output');
  });

  it('executes the built CLI for pretty and JSON architecture violations', () => {
    const cliPath = path.resolve(__dirname, '../dist/src/index.js');
    expect(fs.existsSync(cliPath)).toBe(true);

    initRepo(tmp);
    fs.writeFileSync(path.join(tmp, '.archguard.yml'), violationConfig, 'utf8');
    fs.mkdirSync(path.join(tmp, 'src', 'ui'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'src', 'domain'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src', 'domain', 'user.ts'), 'export type User = { id: string };\n');
    fs.writeFileSync(path.join(tmp, 'src', 'ui', 'App.ts'), "import type { User } from '../domain/user';\nexport const user: User = { id: '1' };\n");
    runGit(tmp, ['add', '.']);
    runGit(tmp, ['commit', '-m', 'seed cli violation']);
    const base = runGit(tmp, ['rev-parse', 'HEAD']);

    fs.appendFileSync(path.join(tmp, 'src', 'ui', 'App.ts'), 'export const version = 2;\n');
    runGit(tmp, ['add', '.']);
    runGit(tmp, ['commit', '-m', 'modify cli violation']);
    const head = runGit(tmp, ['rev-parse', 'HEAD']);

    const pretty = spawnSync(process.execPath, [cliPath, 'scan', '--base', base, '--head', head], {
      cwd: tmp,
      encoding: 'utf8'
    });
    expect(pretty.status).toBe(1);
    expect(pretty.stderr).toBe('');
    expect(pretty.stdout).toContain('ERROR architecture/dependency');
    expect(pretty.stdout).toContain('Forbidden architecture dependency');
    expect(pretty.stdout).toContain('src/ui/App.ts:1');
    expect(pretty.stdout).toContain('Layer "ui" may not depend on layer "domain".');

    const json = spawnSync(
      process.execPath,
      [cliPath, 'scan', '--base', base, '--head', head, '--format', 'json'],
      { cwd: tmp, encoding: 'utf8' }
    );
    expect(json.status).toBe(1);
    expect(json.stderr).toBe('');
    const parsed = JSON.parse(json.stdout);
    expect(parsed.summary).toEqual({ errors: 1, warnings: 0, info: 0 });
    expect(parsed.findings).toEqual([
      {
        ruleId: 'architecture/dependency',
        severity: 'error',
        title: 'Forbidden architecture dependency',
        message: 'Layer "ui" may not depend on layer "domain".',
        file: 'src/ui/App.ts',
        line: 1,
        sourceLayer: 'ui',
        targetLayer: 'domain',
        evidence: 'src/ui/App.ts -> src/domain/user.ts via "../domain/user"',
        suggestion: 'Depend on an allowed layer or update .archguard.yml.'
      }
    ]);
  });
});
