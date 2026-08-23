import { describe, it, expect, vi } from 'vitest';
import { TerminalReporter } from '../src/reporters';
import { JsonReporter } from '../src/reporters/json';

import type { ScanResult } from '../src/types';

describe('reporters', () => {
  it('terminal reporter reports successful architecture evaluation', async () => {
    const r = new TerminalReporter();
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await r.report({ findings: [] });
    expect(spy).toHaveBeenCalledWith('Comparing:');
    expect(spy).toHaveBeenCalledWith('Architecture rules:');
    expect(spy).toHaveBeenCalledWith('  No violations found.');
    spy.mockRestore();
  });

  it('terminal reporter prints a concise change summary', async () => {
    const r = new TerminalReporter();
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const res: ScanResult = {
      comparison: { base: 'main', head: 'HEAD' },
      findings: [],
      changes: [{ type: 'modified', path: 'src/domain.ts' }, { type: 'renamed', oldPath: 'src/old.ts', path: 'src/new.ts' }]
    };
    await r.report(res);
    expect(spy).toHaveBeenCalledWith('ArchGuard');
    expect(spy).toHaveBeenCalledWith('Comparing:');
    expect(spy).toHaveBeenCalledWith('  M  src/domain.ts');
    spy.mockRestore();
  });

  it('terminal reporter prints architecture finding details', async () => {
    const r = new TerminalReporter();
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await r.report({
      findings: [{
        ruleId: 'architecture/dependency',
        severity: 'error',
        title: 'Forbidden architecture dependency',
        message: 'Layer "ui" may not depend on layer "domain".',
        file: 'src/ui/App.ts',
        line: 3,
        sourceLayer: 'ui',
        targetLayer: 'domain',
        evidence: 'src/ui/App.ts -> src/domain/user.ts via "../domain/user"',
        suggestion: 'Depend on an allowed layer or update .archguard.yml.'
      }]
    });

    expect(spy).toHaveBeenCalledWith('ERROR architecture/dependency');
    expect(spy).toHaveBeenCalledWith('src/ui/App.ts:3');
    expect(spy).toHaveBeenCalledWith('Forbidden architecture dependency');
    expect(spy).toHaveBeenCalledWith('Layer "ui" may not depend on layer "domain".');
    expect(spy).toHaveBeenCalledWith('  src/ui/App.ts -> src/domain/user.ts via "../domain/user"');
    expect(spy).toHaveBeenCalledWith('Total findings: 1');
    spy.mockRestore();
  });

  it('json reporter outputs valid JSON with computed finding counts', async () => {
    const r = new JsonReporter();
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const res: ScanResult = {
      findings: [{ ruleId: 'r1', severity: 'error', title: 'T', message: 'm' }],
      summary: { errors: 0, warnings: 0, info: 0 }
    };
    await r.report(res);
    expect(spy).toHaveBeenCalled();
    const outArg = spy.mock.calls[0][0] as string;
    const parsed = JSON.parse(outArg);
    expect(parsed.summary).toEqual({ errors: 1, warnings: 0, info: 0 });
    spy.mockRestore();
  });
});
