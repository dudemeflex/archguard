import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveActionRefs } from '../src/action/context';
import { runAction } from '../src/action/run';
import { formatAnnotation } from '../src/github/workflowCommands';
import { createSarifLog } from '../src/reporters/sarif';

function runGit(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

describe('GitHub integration', () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    for (const directory of temporaryDirectories.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('converts findings to SARIF 2.1.0 with deduplicated rule metadata', () => {
    const sarif = createSarifLog({
      findings: [
        {
          ruleId: 'architecture/dependency',
          severity: 'error',
          title: 'Forbidden architecture dependency',
          message: 'UI may not depend on domain.',
          file: 'src\\ui\\App.ts',
          line: 7
        },
        {
          ruleId: 'architecture/dependency',
          severity: 'warning',
          message: 'A second dependency is discouraged.',
          file: 'src/ui/Other.ts'
        }
      ]
    });

    expect(sarif.version).toBe('2.1.0');
    expect(sarif.runs[0].tool.driver.rules).toHaveLength(1);
    expect(sarif.runs[0].tool.driver.rules[0].properties.tags).toEqual(['architecture', 'dependency']);
    expect(sarif.runs[0].results[0]).toMatchObject({
      ruleId: 'architecture/dependency',
      level: 'error',
      message: { text: 'UI may not depend on domain.' },
      locations: [{ physicalLocation: { artifactLocation: { uri: 'src/ui/App.ts' }, region: { startLine: 7 } } }]
    });
    expect(sarif.runs[0].results[1].level).toBe('warning');
  });

  it('escapes GitHub workflow annotation data and properties', () => {
    expect(formatAnnotation({
      severity: 'error',
      title: 'Rule: unsafe, 100%',
      ruleId: 'unsafe:rule,100%',
      message: 'first%\nsecond',
      file: 'src/a,b.ts',
      line: 4
    })).toBe(
      '::error file=src/a%2Cb.ts,line=4,title=ArchGuard unsafe%3Arule%2C100%25::first%25%0Asecond'
    );
  });

  it('detects exact pull request base and head SHAs from the event payload', () => {
    const refs = resolveActionRefs(
      { GITHUB_EVENT_PATH: 'event.json', GITHUB_BASE_REF: 'main', GITHUB_SHA: 'merge-sha' },
      () => JSON.stringify({
        pull_request: {
          base: { sha: 'exact-base-sha' },
          head: { sha: 'exact-head-sha' }
        }
      })
    );

    expect(refs).toEqual({ base: 'exact-base-sha', head: 'exact-head-sha' });
  });

  it('runs the action against a real repository, emits an annotation, and writes a summary', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archguard-action-'));
    temporaryDirectories.push(directory);
    runGit(directory, ['init']);
    runGit(directory, ['config', 'user.email', 'tests@example.invalid']);
    runGit(directory, ['config', 'user.name', 'ArchGuard Tests']);
    fs.writeFileSync(path.join(directory, '.archguard.yml'), `version: 1
layers:
  - name: ui
    matches: ["src/ui/**"]
    mayDependOn: []
  - name: domain
    matches: ["src/domain/**"]
    mayDependOn: []
`);
    fs.mkdirSync(path.join(directory, 'src', 'ui'), { recursive: true });
    fs.mkdirSync(path.join(directory, 'src', 'domain'), { recursive: true });
    fs.writeFileSync(path.join(directory, 'src', 'domain', 'user.ts'), 'export type User = { id: string };\n');
    fs.writeFileSync(
      path.join(directory, 'src', 'ui', 'App.ts'),
      "import type { User } from '../domain/user';\nexport const user: User = { id: '1' };\n"
    );
    runGit(directory, ['add', '.']);
    runGit(directory, ['commit', '-m', 'seed']);
    const base = runGit(directory, ['rev-parse', 'HEAD']);
    fs.appendFileSync(path.join(directory, 'src', 'ui', 'App.ts'), 'export const version = 2;\n');
    runGit(directory, ['add', '.']);
    runGit(directory, ['commit', '-m', 'change ui']);
    const head = runGit(directory, ['rev-parse', 'HEAD']);
    const summaryPath = path.join(directory, 'summary.md');
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const exitCode = await runAction({
      INPUT_BASE: base,
      INPUT_HEAD: head,
      GITHUB_WORKSPACE: directory,
      GITHUB_STEP_SUMMARY: summaryPath
    });

    expect(exitCode).toBe(1);
    expect(log.mock.calls.flat().join('\n')).toContain('::error file=src/ui/App.ts,line=1');
    const summary = fs.readFileSync(summaryPath, 'utf8');
    expect(summary).toContain('## ArchGuard');
    expect(summary).toContain('Changed files: 1');
    expect(summary).toContain('ui → domain');
    expect(summary).toContain('architecture/dependency');
  });
});
