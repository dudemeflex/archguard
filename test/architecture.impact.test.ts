import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArchitectureGraphImpl } from '../src/architecture/ArchitectureGraph';
import { performValidate } from '../src/commands/validate';
import { performScan } from '../src/commands/scan';
import type { ArchguardConfig } from '../src/config/schema';
import { createArchitecturePolicyGraph } from '../src/graph/policy';
import { ArchitectureImpactAnalyzer } from '../src/impact/ArchitectureImpactAnalyzer';
import { renderDotGraph } from '../src/reporters/graph/dot';
import { renderJsonGraph } from '../src/reporters/graph/json';
import { renderMermaidGraph } from '../src/reporters/graph/mermaid';
import { CompanionChangeEvaluator } from '../src/rules/CompanionChangeEvaluator';
import { CoverageRuleEvaluator } from '../src/rules/CoverageRuleEvaluator';
import type { ArchitectureImpact, DependencyGraph, RepositoryChange } from '../src/types';

function config(layers: ArchguardConfig['layers']): ArchguardConfig {
  return { version: 1, layers, rules: [] };
}

function runGit(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

describe('architecture impact and policy features', () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    for (const directory of temporaryDirectories.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('accepts a companion change, including the old path of a rename', () => {
    const cfg = config([{
      name: 'domain',
      matches: ['src/domain/**'],
      companionChange: ['test/domain/**']
    }]);
    const architecture = new ArchitectureGraphImpl(cfg);
    const changes: RepositoryChange[] = [
      { type: 'modified', path: 'src/domain/user.ts' },
      {
        type: 'renamed',
        oldPath: 'test/domain/user.test.ts',
        path: 'test/archive/user.test.ts'
      }
    ];

    expect(new CompanionChangeEvaluator(cfg, architecture).evaluate(changes)).toEqual([]);
  });

  it('emits one deterministic companion finding per changed layer', () => {
    const cfg = config([{
      name: 'domain',
      matches: ['src/domain/**'],
      companionChange: ['test/domain/**', 'docs/domain/**']
    }]);
    const architecture = new ArchitectureGraphImpl(cfg);
    const findings = new CompanionChangeEvaluator(cfg, architecture).evaluate([
      { type: 'modified', path: 'src/domain/user.ts' },
      { type: 'added', path: 'src/domain/account.ts' },
      { type: 'modified', path: 'README.md' }
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      ruleId: 'architecture/companion-change',
      severity: 'error',
      file: 'src/domain/user.ts',
      message: 'Layer "domain" changed without a required companion change.'
    });
    expect(findings[0].evidence).toContain('- test/domain/**\n- docs/domain/**');
  });

  it('calculates deterministic layer, cross-layer, unmapped, and overlap impact', () => {
    const cfg = config([
      { name: 'ui', matches: ['src/ui/**'] },
      { name: 'domain', matches: ['src/domain/**'] },
      { name: 'all-domain', matches: ['src/domain/**'] }
    ]);
    const architecture = new ArchitectureGraphImpl(cfg);
    const dependencyGraph: DependencyGraph = {
      'src/ui/App.ts': [{ source: 'src/ui/App.ts', target: 'src/domain/user.ts' }]
    };
    const impact = new ArchitectureImpactAnalyzer(architecture).analyze([
      { type: 'modified', path: 'src/ui/App.ts' },
      { type: 'modified', path: 'src/domain/user.ts' },
      { type: 'added', path: 'src/legacy/foo.ts' }
    ], dependencyGraph);

    expect(impact.layersTouched).toEqual(['ui', 'domain', 'all-domain']);
    expect(impact.crossLayerDependencies).toEqual([
      { sourceLayer: 'ui', targetLayer: 'domain', source: 'src/ui/App.ts', target: 'src/domain/user.ts' },
      { sourceLayer: 'ui', targetLayer: 'all-domain', source: 'src/ui/App.ts', target: 'src/domain/user.ts' }
    ]);
    expect(impact.unmappedChangedFiles).toEqual(['src/legacy/foo.ts']);
    expect(impact.overlappingChangedFiles).toEqual([
      { file: 'src/domain/user.ts', layers: ['domain', 'all-domain'] }
    ]);
  });

  it('turns unmapped impact into a strict coverage finding', () => {
    const impact: ArchitectureImpact = {
      layersTouched: [],
      crossLayerDependencies: [],
      unmappedChangedFiles: ['src/legacy/foo.ts'],
      overlappingChangedFiles: []
    };
    const findings = new CoverageRuleEvaluator().evaluate(impact, {
      requireMappedChangedFiles: true,
      forbidOverlappingLayers: false
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      ruleId: 'architecture/unmapped-file',
      file: 'src/legacy/foo.ts'
    });
  });

  it('turns overlapping impact into a strict coverage finding', () => {
    const impact: ArchitectureImpact = {
      layersTouched: ['broad', 'domain'],
      crossLayerDependencies: [],
      unmappedChangedFiles: [],
      overlappingChangedFiles: [{ file: 'src/domain/user.ts', layers: ['broad', 'domain'] }]
    };
    const findings = new CoverageRuleEvaluator().evaluate(impact, {
      requireMappedChangedFiles: false,
      forbidOverlappingLayers: true
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      ruleId: 'architecture/overlapping-layers',
      file: 'src/domain/user.ts'
    });
  });

  it('validates config without a Git repository', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archguard-validate-'));
    temporaryDirectories.push(directory);
    fs.writeFileSync(path.join(directory, '.archguard.yml'), `version: 1
layers:
  - name: domain
    matches: ["src/domain/**"]
`);

    expect(performValidate({ cwd: directory })).toEqual({ exitCode: 0 });
  });

  it('reports malformed layer and companion globs as controlled validation errors', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archguard-bad-glob-'));
    temporaryDirectories.push(directory);
    fs.writeFileSync(path.join(directory, '.archguard.yml'), `version: 1
layers:
  - name: domain
    matches: ["src/domain/**"]
    companionChange: ["test/domain/["]
`);

    const result = performValidate({ cwd: directory });
    expect(result.exitCode).toBe(2);
    expect(result.error).toMatch(/Invalid glob.*companionChange/);
  });

  it('renders Mermaid with generated node IDs and escaped display labels', () => {
    const graph = createArchitecturePolicyGraph(config([
      { name: 'UI "Layer"\nnext', matches: ['src/ui/**'], mayDependOn: ['domain'] },
      { name: 'domain', matches: ['src/domain/**'] }
    ]));
    const output = renderMermaidGraph(graph);

    expect(output).toContain('layer_0["UI &quot;Layer&quot;&#10;next"]');
    expect(output).toContain('layer_0 --> layer_1');
    expect(output).not.toContain('\nnext -->');
  });

  it('renders valid escaped DOT and deterministic JSON graph output', () => {
    const cfg = config([
      { name: 'ui', matches: ['src/ui/**'], mayDependOn: ['domain'] },
      { name: 'domain"\\core\nnext', matches: ['src/domain/**'] }
    ]);
    cfg.layers[0].mayDependOn = ['domain"\\core\nnext'];
    const graph = createArchitecturePolicyGraph(cfg);
    const dot = renderDotGraph(graph);
    const json = JSON.parse(renderJsonGraph(graph));

    expect(dot).toContain('"domain\\"\\\\core\\nnext";');
    expect(dot).toContain('"ui" -> "domain\\"\\\\core\\nnext";');
    expect(json.layers.map((layer: { name: string }) => layer.name)).toEqual([
      'ui', 'domain"\\core\nnext'
    ]);
    expect(json.edges).toEqual([{
      from: 'ui',
      to: 'domain"\\core\nnext',
      allowed: true
    }]);
  });

  it('applies --strict coverage for one scan without changing config', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archguard-strict-'));
    temporaryDirectories.push(directory);
    runGit(directory, ['init']);
    runGit(directory, ['config', 'user.email', 'tests@example.invalid']);
    runGit(directory, ['config', 'user.name', 'ArchGuard Tests']);
    fs.writeFileSync(path.join(directory, '.archguard.yml'), `version: 1
layers:
  - name: domain
    matches: ["src/domain/**"]
`);
    fs.writeFileSync(path.join(directory, 'README.md'), 'seed\n');
    runGit(directory, ['add', '.']);
    runGit(directory, ['commit', '-m', 'seed']);
    const base = runGit(directory, ['rev-parse', 'HEAD']);
    fs.mkdirSync(path.join(directory, 'src', 'legacy'), { recursive: true });
    fs.writeFileSync(path.join(directory, 'src', 'legacy', 'foo.ts'), 'export const value = 1;\n');
    runGit(directory, ['add', '.']);
    runGit(directory, ['commit', '-m', 'add legacy source']);
    const head = runGit(directory, ['rev-parse', 'HEAD']);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const baseline = await performScan({ base, head, cwd: directory, format: 'json' });
    expect(baseline.exitCode).toBe(0);
    expect(baseline.result?.impact?.unmappedChangedFiles).toEqual(['src/legacy/foo.ts']);

    const result = await performScan({ base, head, cwd: directory, strict: true, format: 'json' });
    expect(result.exitCode).toBe(1);
    expect(result.result?.findings).toContainEqual(expect.objectContaining({
      ruleId: 'architecture/unmapped-file',
      file: 'src/legacy/foo.ts'
    }));
    expect(result.result?.impact?.unmappedChangedFiles).toEqual(['src/legacy/foo.ts']);
  });
});
