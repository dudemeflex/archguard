import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { loadConfig } from '../src/config/loader';

let tmpDir: string;

function setup(contents: string) {
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  fs.writeFileSync(path.join(tmpDir, '.archguard.yml'), contents, 'utf8');
}

function cleanup() {
  try {
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch (e) {
    // ignore
  }
}

describe('config loader', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archguard-config-'));
  });

  afterEach(() => cleanup());

  it('returns null when config missing', () => {
    cleanup();
    const cfg = loadConfig(tmpDir);
    expect(cfg).toBeNull();
  });

  it('fails on empty YAML', () => {
    setup('');
    expect(() => loadConfig(tmpDir)).toThrow();
  });

  it('fails on invalid YAML', () => {
    setup('version: [1');
    expect(() => loadConfig(tmpDir)).toThrow(/Invalid YAML/);
  });

  it('fails on unknown version', () => {
    setup('version: 999\nlayers:\n  - name: a\n    matches:\n      - "src/**"\n');
    expect(() => loadConfig(tmpDir)).toThrow(/Configuration validation failed/);
  });

  it('fails on duplicate layer names', () => {
    setup(`version: 1\nlayers:\n  - name: a\n    matches:\n      - "src/**"\n  - name: a\n    matches:\n      - "lib/**"\n`);
    expect(() => loadConfig(tmpDir)).toThrow(/Duplicate layer names/);
  });

  it('parses a minimal valid config', () => {
    setup(`version: 1\nlayers:\n  - name: infra\n    matches:\n      - "src/infra/**"\nrules: []\n`);
    const cfg = loadConfig(tmpDir);
    expect(cfg).not.toBeNull();
    expect(cfg!.version).toBe(1);
  });

  it('fails when mayDependOn references unknown layer', () => {
    setup(`version: 1\nlayers:\n  - name: domain\n    matches:\n      - "src/domain/**"\n    mayDependOn:\n      - infrastructure\n`);
    expect(() => loadConfig(tmpDir)).toThrow(/mayDependOn references unknown layer/);
  });

  it('fails on duplicate rule names', () => {
    setup(`version: 1\nlayers:\n  - name: a\n    matches:\n      - "src/**"\nrules:\n  - name: r1\n    from: a\n    to: a\n  - name: r1\n    from: a\n    to: a\n`);
    expect(() => loadConfig(tmpDir)).toThrow(/Duplicate rule names/);
  });

  it('fails when rule references missing layer', () => {
    setup(`version: 1\nlayers:\n  - name: a\n    matches:\n      - "src/**"\nrules:\n  - name: r2\n    from: missing\n    to: a\n`);
    expect(() => loadConfig(tmpDir)).toThrow(/references unknown source layer/);
  });
});
