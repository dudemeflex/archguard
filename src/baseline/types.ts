export interface BaselineFinding {
  fingerprint: string;
  ruleId: string;
  file?: string;
}

export interface ArchguardBaseline {
  version: 1;
  revision: string;
  createdAt: string;
  findings: BaselineFinding[];
}
