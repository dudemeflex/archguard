import { describe, it, expect, vi } from 'vitest';
import { TerminalReporter } from '../src/reporters';
import { JsonReporter } from '../src/reporters/json';

import type { ScanResult } from '../src/types';

describe('reporters', () => {
  it('terminal reporter handles empty findings without claiming rule evaluation passed', async () => {
    const r = new TerminalReporter();
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await r.report({ findings: [] });
    expect(spy).toHaveBeenCalledWith('Comparing:');
    expect(spy).toHaveBeenCalledWith('Architecture rule evaluation is not implemented yet.');
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

  it('json reporter outputs valid JSON', async () => {
    const r = new JsonReporter();
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const res: ScanResult = { findings: [{ ruleId: 'r1', severity: 'warning', title: 'T', message: 'm' }] };
    await r.report(res);
    expect(spy).toHaveBeenCalled();
    const outArg = spy.mock.calls[0][0] as string;
    const parsed = JSON.parse(outArg);
    expect(parsed).toHaveProperty('summary');
    spy.mockRestore();
  });
});
