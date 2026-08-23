import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runAction } from '../src/action/run';
import { ArchitectureGraphImpl } from '../src/architecture/ArchitectureGraph';
import { performAudit } from '../src/commands/audit';
import { performBaseline } from '../src/commands/baseline';
import { performExplain } from '../src/commands/explain';
import { performValidate } from '../src/commands/validate';
import type { ArchguardConfig } from '../src/config/schema';
import { GitAdapterImpl } from '../src/git/GitAdapter';
import { createActualArchitectureGraph } from '../src/graph/actual';
import { renderMermaidGraph } from '../src/reporters/graph/mermaid';
import { ArchitectureRuleEvaluator } from '../src/rules/ArchitectureRuleEvaluator';
import type { DependencyGraph } from '../src/types';

const POLICY = `version: 1
layers:
  - name: ui
    matches: ["src/ui/**"]
    mayDependOn: []
  - name: domain
    matches: ["src/domain/**"]
    mayDependOn: []
`;

function runGit(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function write(directory: string, relativePath: string, contents: string): void {
  const target = path.join(directory, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents, 'utf8');
}

function initializeRepository(
  temporaryDirectories: string[],
  config = POLICY,
  files: Record<string, string> = {}
): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archguard-audit-test-'));
  temporaryDirectories.push(directory);
  runGit(directory, ['init']);
  runGit(directory, ['config', 'user.email', 'tests@example.invalid']);
  runGit(directory, ['config', 'user.name', 'ArchGuard Tests']);
  write(directory, '.archguard.yml', config);
  for (const [file, contents] of Object.entries(files)) write(directory, file, contents);
  runGit(directory, ['add', '.']);
  runGit(directory, ['commit', '-m', 'seed']);
  return directory;
}

describe('repository audits, baselines, and explanations', () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    for (const directory of temporaryDirectories.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('lists normalized tracked files from the requested Git revision', async () => {
    const directory = initializeRepository(temporaryDirectories, POLICY, {
      'src/ui/App.ts': 'export const app = 1;\n'
    });
    const first = runGit(directory, ['rev-parse', 'HEAD']);
    write(directory, 'src/domain/user.ts', 'export const user = 1;\n');
    runGit(directory, ['add', '.']);
    runGit(directory, ['commit', '-m', 'add domain']);

    const adapter = new GitAdapterImpl(directory);
    expect(await adapter.listFilesAtRevision(first)).toEqual([
      '.archguard.yml',
      'src/ui/App.ts'
    ]);
  });

  it('audits the full repository and finds a forbidden dependency', async () => {
    const directory = initializeRepository(temporaryDirectories, POLICY, {
      'src/domain/user.ts': 'export type User = { id: string };\n',
      'src/ui/App.ts': "import type { User } from '../domain/user';\nexport const value: User = { id: '1' };\n"
    });

    const audit = await performAudit({ cwd: directory, noBaseline: true, emit: false });
    expect(audit.exitCode).toBe(1);
    expect(audit.result?.stats.filesAudited).toBe(2);
    expect(audit.result?.findings.map(finding => finding.ruleId)).toEqual([
      'architecture/dependency'
    ]);
  });

  it('does not evaluate changeset-only companion policies during an audit', async () => {
    const config = `version: 1
layers:
  - name: ui
    matches: ["src/ui/**"]
    companionChange: ["test/ui/**"]
`;
    const directory = initializeRepository(temporaryDirectories, config, {
      'src/ui/App.ts': 'export const app = 1;\n'
    });

    const audit = await performAudit({ cwd: directory, noBaseline: true, emit: false });
    expect(audit.exitCode).toBe(0);
    expect(audit.result?.findings).toEqual([]);
  });

  it('applies default and configured audit exclusions before enforcing the file limit', async () => {
    const config = `version: 1
audit:
  exclude: ["vendor/**"]
layers:
  - name: source
    matches: ["src/**"]
`;
    const directory = initializeRepository(temporaryDirectories, config, {
      'src/a.ts': 'export const a = 1;\n',
      'src/b.ts': 'export const b = 1;\n',
      'dist/generated.ts': 'export const generated = 1;\n',
      'vendor/generated.ts': 'export const vendor = 1;\n'
    });

    const limited = await performAudit({ cwd: directory, maxFiles: 1, emit: false });
    expect(limited).toMatchObject({ exitCode: 2 });
    expect(limited.error).toContain('Audit exceeds maximum source-file limit: 2 > 1');
    const audit = await performAudit({ cwd: directory, maxFiles: 2, emit: false });
    expect(audit.result?.stats.filesAudited).toBe(2);
  });

  it('keeps dependency fingerprints stable when only the line number moves', async () => {
    const config: ArchguardConfig = {
      version: 1,
      layers: [
        { name: 'ui', matches: ['src/ui/**'], mayDependOn: [] },
        { name: 'domain', matches: ['src/domain/**'], mayDependOn: [] }
      ],
      rules: []
    };
    const graph = new ArchitectureGraphImpl(config);
    const atLine = (line: number): DependencyGraph => ({
      'src/ui/App.ts': [{
        source: 'src/ui/App.ts',
        target: 'src/domain/user.ts',
        specifier: '../domain/user',
        line
      }]
    });
    const first = await new ArchitectureRuleEvaluator(graph).evaluate(atLine(1), config);
    const shifted = await new ArchitectureRuleEvaluator(graph).evaluate(atLine(99), config);
    expect(first[0].fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(shifted[0].fingerprint).toBe(first[0].fingerprint);
  });

  it('suppresses stored debt while baseline update leaves new violations active', async () => {
    const directory = initializeRepository(temporaryDirectories, POLICY, {
      'src/domain/user.ts': 'export type User = { id: string };\n',
      'src/ui/App.ts': "import type { User } from '../domain/user';\nexport const app: User = { id: '1' };\n"
    });
    expect((await performBaseline({ operation: 'create', cwd: directory, emit: false })).exitCode)
      .toBe(0);
    const suppressed = await performAudit({ cwd: directory, emit: false });
    expect(suppressed.exitCode).toBe(0);
    expect(suppressed.result?.summary.baselineSuppressed).toBe(1);

    write(
      directory,
      'src/ui/Other.ts',
      "import type { User } from '../domain/user';\nexport const other: User = { id: '2' };\n"
    );
    runGit(directory, ['add', '.']);
    runGit(directory, ['commit', '-m', 'add new violation']);

    const withNewFinding = await performAudit({ cwd: directory, emit: false });
    expect(withNewFinding.exitCode).toBe(1);
    expect(withNewFinding.result?.summary).toMatchObject({
      errors: 1,
      baselineSuppressed: 1
    });

    const update = await performBaseline({ operation: 'update', cwd: directory, emit: false });
    expect(update).toMatchObject({
      exitCode: 0,
      stats: { stored: 1, stillPresent: 1, resolved: 0, newViolations: 1 }
    });
    const baseline = JSON.parse(
      fs.readFileSync(path.join(directory, '.archguard-baseline.json'), 'utf8')
    );
    expect(baseline.findings).toHaveLength(1);
    expect((await performBaseline({ operation: 'status', cwd: directory, emit: false })).exitCode)
      .toBe(1);
  });

  it('explains explicit overrides, default decisions, overlaps, and unmapped paths without Git', () => {
    const config = `version: 1
layers:
  - name: broad
    matches: ["src/**"]
    mayDependOn: []
  - name: ui
    matches: ["src/ui/**"]
    mayDependOn: []
  - name: domain
    matches: ["src/domain/**"]
    mayDependOn: []
rules:
  - name: legacy-ui-domain
    from: ui
    to: domain
    allow: true
`;
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archguard-explain-'));
    temporaryDirectories.push(directory);
    write(directory, '.archguard.yml', config);

    const explanation = performExplain({
      cwd: directory,
      source: 'src/ui/App.ts',
      target: 'src/domain/user.ts',
      emit: false
    });
    expect(explanation.result?.evaluations).toEqual([
      { from: 'broad', to: 'broad', allowed: true, reason: 'sameLayer' },
      { from: 'broad', to: 'domain', allowed: false, reason: 'mayDependOn' },
      { from: 'ui', to: 'broad', allowed: false, reason: 'mayDependOn' },
      {
        from: 'ui',
        to: 'domain',
        allowed: true,
        reason: 'explicitRule',
        rule: 'legacy-ui-domain'
      }
    ]);
    expect(explanation.result?.allowed).toBe(false);
    expect(performExplain({
      cwd: directory,
      source: 'scripts/build.ts',
      target: 'src/domain/user.ts',
      emit: false
    }).result?.allowed).toBeNull();
  });

  it('aggregates observed layer dependencies in an actual graph', async () => {
    const directory = initializeRepository(temporaryDirectories, POLICY, {
      'src/domain/user.ts': 'export type User = { id: string };\n',
      'src/ui/App.ts': "import type { User } from '../domain/user';\nexport const app = {} as User;\n",
      'src/ui/Other.ts': "import type { User } from '../domain/user';\nexport const other = {} as User;\n"
    });
    const audit = await performAudit({ cwd: directory, noBaseline: true, emit: false });
    const config = (await import('../src/config/loader')).loadConfig(directory)!;
    const actual = createActualArchitectureGraph(config, audit.result!);
    expect(actual.edges).toContainEqual({
      from: 'ui',
      to: 'domain',
      count: 2,
      allowed: false
    });
    expect(renderMermaidGraph(actual)).toContain('-->|2 forbidden|');
  });

  it('validates explicit baseline existence, JSON shape, and duplicate fingerprints', () => {
    const config = `version: 1
baseline:
  path: debt.json
layers:
  - name: source
    matches: ["src/**"]
`;
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archguard-baseline-validation-'));
    temporaryDirectories.push(directory);
    write(directory, '.archguard.yml', config);
    expect(performValidate({ cwd: directory }).error).toContain('Baseline file not found');

    const repeated = {
      fingerprint: 'b'.repeat(64),
      ruleId: 'architecture/dependency',
      file: 'src/a.ts'
    };
    write(directory, 'debt.json', JSON.stringify({
      version: 1,
      revision: 'a'.repeat(40),
      createdAt: new Date().toISOString(),
      findings: [repeated, repeated]
    }));
    expect(performValidate({ cwd: directory }).error).toContain('Duplicate baseline fingerprint');
  });

  it('honors the discovered baseline in GitHub annotations and summaries', async () => {
    const directory = initializeRepository(temporaryDirectories, POLICY, {
      'src/domain/user.ts': 'export type User = { id: string };\n',
      'src/ui/App.ts': "import type { User } from '../domain/user';\nexport const app = {} as User;\n"
    });
    const base = runGit(directory, ['rev-parse', 'HEAD']);
    await performBaseline({ operation: 'create', cwd: directory, emit: false });
    write(
      directory,
      'src/ui/App.ts',
      "\nimport type { User } from '../domain/user';\nexport const app = {} as User;\n"
    );
    runGit(directory, ['add', '.']);
    runGit(directory, ['commit', '-m', 'shift violation line']);
    const head = runGit(directory, ['rev-parse', 'HEAD']);
    const summaryPath = path.join(directory, 'summary.md');
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const exitCode = await runAction({
      INPUT_BASE: base,
      INPUT_HEAD: head,
      GITHUB_WORKSPACE: directory,
      GITHUB_STEP_SUMMARY: summaryPath
    });

    expect(exitCode).toBe(0);
    expect(log.mock.calls.flat().join('\n')).not.toContain('::error');
    const summary = fs.readFileSync(summaryPath, 'utf8');
    expect(summary).toContain('New violations: 0');
    expect(summary).toContain('Baseline violations: 1');
    expect(summary).toContain('No new architecture violations.');
  });
});
