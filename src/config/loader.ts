import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { ConfigSchema, ArchguardConfig } from './schema';
import { ZodError } from 'zod';
import { compileRepositoryGlob } from '../architecture/globs';

function validateGlob(pattern: string, location: string): void {
  try {
    compileRepositoryGlob(pattern);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid glob in ${location}: "${pattern}": ${message}`);
  }
}

export function loadConfig(cwd = process.cwd(), configPath = '.archguard.yml'): ArchguardConfig | null {
  const target = path.resolve(cwd, configPath);
  if (!fs.existsSync(target)) return null;

  let raw: string;
  try {
    raw = fs.readFileSync(target, 'utf8');
  } catch (err) {
    const msg = err && (err as Error).message ? (err as Error).message : String(err);
    throw new Error(`Failed to read config: ${msg}`);
  }

  let parsed: unknown;
  try {
    parsed = yaml.load(raw);
  } catch (err) {
    const msg = err && (err as Error).message ? (err as Error).message : String(err);
    throw new Error(`Invalid YAML in ${configPath}: ${msg}`);
  }

  if (parsed === undefined || parsed === null) {
    throw new Error('Configuration file is empty');
  }

  try {
    const cfg = ConfigSchema.parse(parsed);

    // semantic validation: duplicates and references
    const layerNames = cfg.layers.map(l => l.name);
    const dupLayers = layerNames.filter((n, i) => layerNames.indexOf(n) !== i);
    if (dupLayers.length > 0) {
      throw new Error(`Duplicate layer names found: ${Array.from(new Set(dupLayers)).join(', ')}`);
    }

    const ruleNames = (cfg.rules || []).map(r => r.name);
    const dupRules = ruleNames.filter((n, i) => ruleNames.indexOf(n) !== i);
    if (dupRules.length > 0) {
      throw new Error(`Duplicate rule names found: ${Array.from(new Set(dupRules)).join(', ')}`);
    }

    // mayDependOn references should exist
    for (const layer of cfg.layers) {
      const deps = layer.mayDependOn || [];
      for (const d of deps) {
        if (!layerNames.includes(d)) {
          throw new Error(`Layer '${layer.name}' mayDependOn references unknown layer '${d}'`);
        }
      }
      for (const pattern of layer.matches) {
        validateGlob(pattern, `layer '${layer.name}' matches`);
      }
      for (const pattern of layer.companionChange || []) {
        validateGlob(pattern, `layer '${layer.name}' companionChange`);
      }
    }

    // rules reference known layers
    for (const rule of cfg.rules || []) {
      if (!layerNames.includes(rule.from)) {
        throw new Error(`Rule '${rule.name}' references unknown source layer '${rule.from}'`);
      }
      if (!layerNames.includes(rule.to)) {
        throw new Error(`Rule '${rule.name}' references unknown target layer '${rule.to}'`);
      }
    }

    return cfg;
  } catch (err) {
    if (err instanceof ZodError) {
      const friendly = err.errors.map(e => `${e.path.join('.') || '<root>'}: ${e.message}`).join('\n');
      throw new Error(`Configuration validation failed:\n${friendly}`);
    }
    throw err as Error;
  }
}
