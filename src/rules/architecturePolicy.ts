import type { ArchguardConfig } from '../config/schema';

export type ArchitectureDecisionReason = 'explicitRule' | 'sameLayer' | 'mayDependOn';

export interface ArchitectureDecision {
  allowed: boolean;
  reason: ArchitectureDecisionReason;
  ruleName?: string;
}

export function evaluateLayerDependency(
  config: Pick<ArchguardConfig, 'layers' | 'rules'>,
  sourceLayer: string,
  targetLayer: string
): ArchitectureDecision {
  const explicitRule = [...config.rules]
    .reverse()
    .find(rule => rule.from === sourceLayer && rule.to === targetLayer);
  if (explicitRule) {
    return {
      allowed: explicitRule.allow,
      reason: 'explicitRule',
      ruleName: explicitRule.name
    };
  }

  if (sourceLayer === targetLayer) {
    return { allowed: true, reason: 'sameLayer' };
  }

  const source = config.layers.find(layer => layer.name === sourceLayer);
  return {
    allowed: source?.mayDependOn?.includes(targetLayer) === true,
    reason: 'mayDependOn'
  };
}
