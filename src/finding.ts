export type Severity = 'info' | 'warning' | 'error';

export interface Finding {
  ruleId?: string;
  severity?: Severity;
  title?: string;
  message: string;
  file?: string;
  line?: number;
  column?: number;
  evidence?: string;
  sourceLayer?: string;
  targetLayer?: string;
  suggestion?: string;
  fingerprint?: string;
  baseline?: {
    suppressed: boolean;
  };
}
