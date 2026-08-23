import { describe, expect, it } from 'vitest';
import { ArchitectureGraphImpl } from '../src/architecture/ArchitectureGraph';
import { ArchitectureRuleEvaluator } from '../src/rules/ArchitectureRuleEvaluator';
import type { ArchguardConfig } from '../src/config/schema';
import type { DependencyGraph } from '../src/types';

function createConfig(
  layers: ArchguardConfig['layers'],
  rules: ArchguardConfig['rules'] = []
): ArchguardConfig {
  return { version: 1, layers, rules };
}

describe('ArchitectureGraphImpl', () => {
  it('maps basic and nested paths while leaving unmatched files unclassified', () => {
    const graph = new ArchitectureGraphImpl(createConfig([
      { name: 'ui', matches: ['src/ui/**'] },
      { name: 'domain', matches: ['src/domain/**'] }
    ]));

    expect(graph.fileToLayers('src/ui/App.ts')).toEqual(['ui']);
    expect(graph.fileToLayers('src/domain/user.ts')).toEqual(['domain']);
    expect(graph.fileToLayers('src/domain/models/user.ts')).toEqual(['domain']);
    expect(graph.fileToLayers('src/application/domain.ts')).toEqual([]);
    expect(graph.fileToLayers('README.md')).toEqual([]);
  });

  it('supports practical middle-glob and single-segment patterns', () => {
    const graph = new ArchitectureGraphImpl(createConfig([
      { name: 'services', matches: ['src/**/services/**'] },
      { name: 'package-domain', matches: ['packages/*/domain/**'] }
    ]));

    expect(graph.fileToLayers('src/application/services/user.ts')).toEqual(['services']);
    expect(graph.fileToLayers('packages/accounts/domain/user.ts')).toEqual(['package-domain']);
    expect(graph.fileToLayers('packages/accounts/nested/domain/user.ts')).toEqual([]);
  });

  it('returns every overlapping layer in configuration order', () => {
    const graph = new ArchitectureGraphImpl(createConfig([
      { name: 'broad', matches: ['src/**'] },
      { name: 'domain', matches: ['src/domain/**'] }
    ]));

    expect(graph.getLayers()).toEqual(['broad', 'domain']);
    expect(graph.fileToLayers('src/domain/user.ts')).toEqual(['broad', 'domain']);
  });
});

describe('ArchitectureRuleEvaluator', () => {
  it('allows a configured cross-layer dependency', async () => {
    const config = createConfig([
      { name: 'application', matches: ['src/application/**'], mayDependOn: ['domain'] },
      { name: 'domain', matches: ['src/domain/**'], mayDependOn: [] }
    ]);
    const dependencyGraph: DependencyGraph = {
      'src/application/service.ts': [
        {
          source: 'src/application/service.ts',
          target: 'src/domain/user.ts',
          specifier: '../domain/user',
          line: 1
        }
      ]
    };

    await expect(new ArchitectureRuleEvaluator().evaluate(dependencyGraph, config)).resolves.toEqual([]);
  });

  it('creates one deterministic error finding for a forbidden dependency', async () => {
    const config = createConfig([
      { name: 'ui', matches: ['src/ui/**'], mayDependOn: ['application'] },
      { name: 'application', matches: ['src/application/**'], mayDependOn: [] },
      { name: 'domain', matches: ['src/domain/**'], mayDependOn: [] }
    ]);
    const dependencyGraph: DependencyGraph = {
      'src/ui/App.ts': [
        {
          source: 'src/ui/App.ts',
          target: 'src/domain/user.ts',
          specifier: '../domain/user',
          line: 7
        }
      ]
    };

    await expect(new ArchitectureRuleEvaluator().evaluate(dependencyGraph, config)).resolves.toEqual([
      {
        ruleId: 'architecture/dependency',
        severity: 'error',
        title: 'Forbidden architecture dependency',
        message: 'Layer "ui" may not depend on layer "domain".',
        file: 'src/ui/App.ts',
        line: 7,
        sourceLayer: 'ui',
        targetLayer: 'domain',
        evidence: 'src/ui/App.ts -> src/domain/user.ts via "../domain/user"',
        suggestion: 'Depend on an allowed layer or update .archguard.yml.'
      }
    ]);
  });

  it('allows same-layer dependencies when mayDependOn is empty', async () => {
    const config = createConfig([
      { name: 'domain', matches: ['src/domain/**'], mayDependOn: [] }
    ]);
    const dependencyGraph: DependencyGraph = {
      'src/domain/user.ts': [
        { source: 'src/domain/user.ts', target: 'src/domain/email.ts', specifier: './email', line: 1 }
      ]
    };

    await expect(new ArchitectureRuleEvaluator().evaluate(dependencyGraph, config)).resolves.toEqual([]);
  });

  it('skips edges with an unmatched source or target', async () => {
    const config = createConfig([
      { name: 'application', matches: ['src/application/**'], mayDependOn: [] },
      { name: 'domain', matches: ['src/domain/**'], mayDependOn: [] }
    ]);
    const dependencyGraph: DependencyGraph = {
      'src/application/service.ts': [
        { source: 'src/application/service.ts', target: 'scripts/helper.ts', specifier: '../../scripts/helper', line: 1 }
      ],
      'scripts/build.ts': [
        { source: 'scripts/build.ts', target: 'src/domain/user.ts', specifier: '../src/domain/user', line: 2 }
      ]
    };

    await expect(new ArchitectureRuleEvaluator().evaluate(dependencyGraph, config)).resolves.toEqual([]);
  });

  it('evaluates every overlapping layer combination in deterministic order', async () => {
    const config = createConfig([
      { name: 'source-broad', matches: ['src/source/**'], mayDependOn: ['target-broad'] },
      { name: 'source-specific', matches: ['src/source/special/**'], mayDependOn: ['target-specific'] },
      { name: 'target-broad', matches: ['src/target/**'], mayDependOn: [] },
      { name: 'target-specific', matches: ['src/target/special/**'], mayDependOn: [] }
    ]);
    const firstEdge = {
      source: 'src/source/special/service.ts',
      target: 'src/target/special/user.ts',
      specifier: '../../target/special/user',
      line: 7
    };
    const dependencyGraph: DependencyGraph = {
      'src/source/special/service.ts': [
        firstEdge,
        firstEdge,
        {
          source: 'src/source/special/service.ts',
          target: 'src/target/special/account.ts',
          specifier: '../../target/special/account',
          line: 9
        }
      ]
    };
    const evaluator = new ArchitectureRuleEvaluator();

    const first = await evaluator.evaluate(dependencyGraph, config);
    const second = await evaluator.evaluate(dependencyGraph, config);

    expect(second).toEqual(first);
    expect(first.map(finding => [finding.line, finding.sourceLayer, finding.targetLayer])).toEqual([
      [7, 'source-broad', 'target-specific'],
      [7, 'source-specific', 'target-broad'],
      [9, 'source-broad', 'target-specific'],
      [9, 'source-specific', 'target-broad']
    ]);
  });

  it('preserves explicit rule compatibility as an override', async () => {
    const config = createConfig([
      { name: 'application', matches: ['src/application/**'] },
      { name: 'domain', matches: ['src/domain/**'] }
    ], [
      { name: 'allow-application-domain', from: 'application', to: 'domain', allow: true }
    ]);
    const dependencyGraph: DependencyGraph = {
      'src/application/service.ts': [
        { source: 'src/application/service.ts', target: 'src/domain/user.ts', line: 1 }
      ]
    };

    await expect(new ArchitectureRuleEvaluator().evaluate(dependencyGraph, config)).resolves.toEqual([]);
  });

  it('allows an explicit rule to forbid an otherwise allowed same-layer dependency', async () => {
    const config = createConfig([
      { name: 'domain', matches: ['src/domain/**'], mayDependOn: [] }
    ], [
      { name: 'forbid-domain-cycle', from: 'domain', to: 'domain', allow: false }
    ]);
    const dependencyGraph: DependencyGraph = {
      'src/domain/user.ts': [
        { source: 'src/domain/user.ts', target: 'src/domain/email.ts', line: 2 }
      ]
    };

    const findings = await new ArchitectureRuleEvaluator().evaluate(dependencyGraph, config);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ sourceLayer: 'domain', targetLayer: 'domain' });
  });

  it('treats a missing mayDependOn as no allowed cross-layer dependencies', async () => {
    const config = createConfig([
      { name: 'application', matches: ['src/application/**'] },
      { name: 'domain', matches: ['src/domain/**'] }
    ]);
    const dependencyGraph: DependencyGraph = {
      'src/application/service.ts': [
        { source: 'src/application/service.ts', target: 'src/domain/user.ts', line: 1 }
      ]
    };

    const findings = await new ArchitectureRuleEvaluator().evaluate(dependencyGraph, config);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ sourceLayer: 'application', targetLayer: 'domain' });
  });
});
