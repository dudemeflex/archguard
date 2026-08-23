import { z } from 'zod';

export const LayerSchema = z.object({
  name: z.string().min(1),
  matches: z.array(z.string()).nonempty(),
  mayDependOn: z.array(z.string()).optional(),
  companionChange: z.array(z.string()).optional()
}).strict();

export const RuleSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  from: z.string().min(1),
  to: z.string().min(1),
  allow: z.boolean().optional().default(false)
}).strict();

export const CoverageSchema = z.object({
  requireMappedChangedFiles: z.boolean().optional().default(false),
  forbidOverlappingLayers: z.boolean().optional().default(false)
}).strict();

export const ConfigSchema = z.object({
  // Currently supported config schema version
  version: z.literal(1),
  coverage: CoverageSchema.optional(),
  layers: z.array(LayerSchema).nonempty(),
  rules: z.array(RuleSchema).optional().default([])
}).strict();

export type ArchguardConfig = z.infer<typeof ConfigSchema>;
