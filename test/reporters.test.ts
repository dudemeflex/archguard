import { describe, it, expect, vi } from 'vitest';
import { TerminalReporter } from '../src/reporters';
import { JsonReporter } from '../src/reporters/json';
import { scanNotImplemented } from '../src/commands/scan';

import type { ScanResult } from '../src/types';

describe('reporters', () => {
  it('terminal reporter handles empty findings', async () => {
    const r = new TerminalReporter();
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await r.report({ findings: [] });
    expect(spy).toHaveBeenCalledWith('No findings.');
    spy.mockRestore();
  });

  it('terminal reporter prints a finding concisely', async () => {
    const r = new TerminalReporter();
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const res: ScanResult = { findings: [{ ruleId: 'r1', severity: 'error', title: 'Domain boundary', message: 'Domain cannot depend on infra', file: 'src/domain.ts', line: 4 }] };
        await r.report(res);
    expect(spy).toHaveBeenCalled();
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

  it('scanNotImplemented returns code 2', () => {
    const info = scanNotImplemented();
    expect(info.code).toBe(2);
    expect(info.message).toMatch(/not implemented/i);
  });
});
