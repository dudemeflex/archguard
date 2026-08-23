import fs from 'fs';
import path from 'path';
import { z, ZodError } from 'zod';
import type { ArchguardConfig } from '../config/schema';
import type { Finding } from '../finding';
import type { ArchguardBaseline, BaselineFinding } from './types';

export const DEFAULT_BASELINE_PATH = '.archguard-baseline.json';
export const MAX_BASELINE_BYTES = 5 * 1024 * 1024;

const BaselineFindingSchema = z.object({
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/, 'must be a lowercase SHA-256 fingerprint'),
  ruleId: z.string().min(1),
  file: z.string().min(1).optional()
}).strict();

const BaselineSchema = z.object({
  version: z.literal(1),
  revision: z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/, 'must be a Git commit SHA'),
  createdAt: z.string().datetime(),
  findings: z.array(BaselineFindingSchema)
}).strict();

export interface BaselineLocation {
  filePath: string;
  explicit: boolean;
}

export function resolveBaselineLocation(
  repoRoot: string,
  config: Pick<ArchguardConfig, 'baseline'>,
  overridePath?: string
): BaselineLocation {
  const configuredPath = overridePath || config.baseline?.path;
  return {
    filePath: path.resolve(repoRoot, configuredPath || DEFAULT_BASELINE_PATH),
    explicit: configuredPath !== undefined
  };
}

export function parseBaseline(raw: string, displayPath: string): ArchguardBaseline {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid baseline JSON in ${displayPath}: ${message}`);
  }

  try {
    const baseline = BaselineSchema.parse(parsed);
    const seen = new Set<string>();
    for (const finding of baseline.findings) {
      if (seen.has(finding.fingerprint)) {
        throw new Error(`Duplicate baseline fingerprint: ${finding.fingerprint}`);
      }
      seen.add(finding.fingerprint);
    }
    return baseline;
  } catch (err) {
    if (err instanceof ZodError) {
      const friendly = err.errors
        .map(error => `${error.path.join('.') || '<root>'}: ${error.message}`)
        .join('\n');
      throw new Error(`Baseline validation failed in ${displayPath}:\n${friendly}`);
    }
    throw err;
  }
}

export function loadBaseline(
  location: BaselineLocation,
  requireExisting = false
): ArchguardBaseline | null {
  if (!fs.existsSync(location.filePath)) {
    if (location.explicit || requireExisting) {
      throw new Error(`Baseline file not found: ${location.filePath}`);
    }
    return null;
  }

  const stat = fs.statSync(location.filePath);
  if (!stat.isFile()) throw new Error(`Baseline path is not a file: ${location.filePath}`);
  if (stat.size > MAX_BASELINE_BYTES) {
    throw new Error(`Baseline exceeds ${MAX_BASELINE_BYTES} byte size limit: ${location.filePath}`);
  }

  try {
    return parseBaseline(fs.readFileSync(location.filePath, 'utf8'), location.filePath);
  } catch (err) {
    if (err instanceof Error) throw err;
    throw new Error(`Unable to read baseline ${location.filePath}: ${String(err)}`);
  }
}

export function applyBaseline(findings: Finding[], baseline: ArchguardBaseline | null): Finding[] {
  if (!baseline) return findings;
  const stored = new Set(baseline.findings.map(finding => finding.fingerprint));
  return findings.map(finding => ({
    ...finding,
    baseline: { suppressed: finding.fingerprint !== undefined && stored.has(finding.fingerprint) }
  }));
}

export function baselineFinding(finding: Finding): BaselineFinding {
  if (!finding.fingerprint) {
    throw new Error(`Architecture finding is missing a fingerprint: ${finding.ruleId || 'unknown rule'}`);
  }
  return {
    fingerprint: finding.fingerprint,
    ruleId: finding.ruleId || 'archguard/finding',
    ...(finding.file ? { file: finding.file } : {})
  };
}

export function writeBaseline(filePath: string, baseline: ArchguardBaseline): void {
  const validated = parseBaseline(JSON.stringify(baseline), filePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(validated, null, 2)}\n`, 'utf8');
}
