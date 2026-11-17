export type Mode =
  | 'PREFER_ON_DEVICE'
  | 'PREFER_IN_CLOUD'
  | 'ONLY_ON_DEVICE'
  | 'ONLY_IN_CLOUD';

export type Validator =
  | { kind: 'text'; maxWords: number }
  | { kind: 'json'; schema: JsonSchema }
  | { kind: 'enum'; values: string[] };

/** Minimal JSON Schema subset, accepted by both cloud and on-device structured output. */
export interface JsonSchema {
  type: 'object' | 'array' | 'string' | 'number' | 'boolean';
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: string[];
  nullable?: boolean;
}

/** How a sample is graded. Gold scoring needs no cloud reference. */
export type Scoring = 'gold-label' | 'gold-fields' | 'gold-redaction' | 'gold-masking' | 'judge';

export interface Gold {
  label?: string;
  fields?: Record<string, string | null>;
  mustNotContain?: string[];
}

export interface Input {
  text: string;
  gold?: Gold;
  /** Set for length-sweep inputs: the target size in words. */
  tier?: number;
}

export interface Task {
  id: string;
  name: string;
  instruction: string;
  inputs: Input[];
  validator: Validator;
  scoring: Scoring;
  sensitive: boolean;
  /** Optional: the app's own monthly volume for this feature, if known. */
  monthlyRequests?: number;
  /** Slowest acceptable p90 latency for this feature, in ms. */
  latencyBudgetMs: number;
  /** Calibrate this task at increasing input lengths. */
  lengthSweep?: boolean;
}

export interface Sample {
  ok: boolean;
  valid: boolean;
  ms: number;
  text: string;
  error?: string;
}

export type PairStatus = 'scored' | 'device-failed' | 'device-invalid' | 'reference-missing';

export interface Pair {
  input: number;
  words: number;
  tier?: number;
  onDevice: Sample;
  cloud: Sample;
  deviceScore: number | null;
  cloudScore: number | null;
  status: PairStatus;
  /** Which model judged this pair, when a judge was used. */
  judgedBy?: string;
  /** Why the pair could not be scored, when it was excluded. */
  note?: string;
}

export interface TaskResult {
  taskId: string;
  pairs: Pair[];
}

export interface DeviceProfile {
  chrome: string;
  platform: string;
  memoryGb: number | null;
  cores: number | null;
  nano: string;
  /**
   * The on-device model that answered, as the person running the calibration read it from
   * chrome://on-device-internals (the Prompt API does not report it). Absent in older reports.
   */
  model?: string;
}

export interface Report {
  version: 2;
  createdAt: string;
  device: DeviceProfile;
  cloudModel: string;
  judgeModel: string;
  coldStartMs: number | null;
  tasks: Task[];
  results: TaskResult[];
}

export interface TierStat {
  tier: number;
  n: number;
  acceptable: number;
}

export interface PolicyEntry {
  taskId: string;
  name: string;
  mode: Mode;
  maxWords: number | null;
  sensitive: boolean;
  inconclusive: boolean;
  reasons: string[];
  warnings: string[];
  metrics: {
    n: number;
    acceptable: number;
    rate: number;
    lowerBound: number;
    validRate: number;
    excluded: number;
    deviceP50: number;
    deviceP90: number;
    cloudP50: number;
    cloudP90: number;
    cloudRate: number | null;
  };
  tiers: TierStat[];
}

export interface PolicyFile {
  version: 1;
  createdAt: string;
  measuredOn: string;
  cloudModel: string;
  tasks: Record<string, { mode: Mode; maxWords: number | null; sensitive: boolean }>;
}
