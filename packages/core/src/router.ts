import { trace } from 'firebase/performance';
import { getPerformanceOrNull } from './context';
import { nanoAvailability } from './device';
import { buildPrompt, modelFor, timedGenerate } from './runner';
import { validate } from './scoring';
import { words } from './stats';
import type { Mode, PolicyFile, Task } from './types';

/** Longest a user waits for one AI step before it counts as failed and the normal fallback applies. */
const ANSWER_TIMEOUT_MS = 30000;

export interface RouteResult {
  taskId: string;
  text: string;
  source: 'on_device' | 'in_cloud' | 'none';
  ms: number;
  mode: Mode;
  reason: string;
  escalated: boolean;
  blocked: boolean;
  error?: string;
}

export interface RouterConfig {
  policy: PolicyFile | null;
  tasks: Task[];
  cloudModel: string;
  /** Asked before personal data from a sensitive task leaves the device. */
  askConsent: (task: Task, reason: string) => Promise<boolean>;
  onResult?: (r: RouteResult) => void;
}

const LABEL: Record<Mode, string> = {
  PREFER_ON_DEVICE: 'device first',
  ONLY_ON_DEVICE: 'device only',
  PREFER_IN_CLOUD: 'cloud first',
  ONLY_IN_CLOUD: 'cloud only',
};

function record(r: RouteResult) {
  const perf = getPerformanceOrNull();
  if (!perf) return;
  try {
    const t = trace(perf, 'routewise_generate');
    t.putAttribute('task', r.taskId);
    t.putAttribute('source', r.source);
    t.putAttribute('mode', r.mode);
    t.putAttribute('escalated', r.escalated ? 'yes' : 'no');
    t.record(Date.now() - r.ms, r.ms);
  } catch {
    /* Performance Monitoring is optional */
  }
}

/** Applies a calibrated policy at runtime: mode, length limit, format check with cloud escalation, consent. */
export function createRouter(cfg: RouterConfig) {
  async function generate(taskId: string, input: string): Promise<RouteResult> {
    const task = cfg.tasks.find((t) => t.id === taskId);
    if (!task) throw new Error(`Unknown task ${taskId}`);
    const entry = cfg.policy?.tasks[taskId] ?? {
      mode: (task.sensitive ? 'ONLY_ON_DEVICE' : 'PREFER_ON_DEVICE') as Mode,
      maxWords: null,
      sensitive: task.sensitive,
    };
    const sensitive = entry.sensitive || task.sensitive;
    let mode: Mode = sensitive && entry.mode === 'PREFER_ON_DEVICE' ? 'ONLY_ON_DEVICE' : entry.mode;
    let reason = `Policy says ${LABEL[mode]}.`;
    const n = words(input);

    if (entry.maxWords !== null && n > entry.maxWords && mode !== 'ONLY_IN_CLOUD') {
      mode = 'ONLY_IN_CLOUD';
      reason = `${n.toLocaleString()} words is over the ${entry.maxWords.toLocaleString()}-word on-device limit, so it went to the cloud.`;
    }
    if (mode === 'ONLY_ON_DEVICE' && (await nanoAvailability()) !== 'available') {
      mode = 'ONLY_IN_CLOUD';
      reason = 'This browser has no on-device model ready.';
    }

    const blocked = (why: string): RouteResult => ({
      taskId, text: '', source: 'none', ms: 0, mode, reason: why, escalated: false, blocked: true,
    });

    if (sensitive && (mode === 'ONLY_IN_CLOUD' || mode === 'PREFER_IN_CLOUD')) {
      if (!(await cfg.askConsent(task, reason))) return done(blocked(`${reason} The user kept the data on the device.`));
    }

    const prompt = buildPrompt(task, input);
    // Calibration caught Gemini Nano stuck on one answer for minutes; a live user should never wait that long.
    let r = await timedGenerate(modelFor(mode, cfg.cloudModel, task), prompt, ANSWER_TIMEOUT_MS);
    let escalated = false;

    const deviceMissed =
      (r.ok && r.source === 'on_device' && !validate(r.text, task.validator)) ||
      (!r.ok && (mode === 'ONLY_ON_DEVICE' || mode === 'PREFER_ON_DEVICE'));
    if (deviceMissed) {
      const why = r.ok
        ? 'The on-device answer failed the format check, so it was retried in the cloud.'
        : 'The on-device model failed, so it was retried in the cloud.';
      if (sensitive && !(await cfg.askConsent(task, why))) return done(blocked(`${why} The user kept the data on the device.`));
      const retry = await timedGenerate(modelFor('ONLY_IN_CLOUD', cfg.cloudModel, task), prompt, ANSWER_TIMEOUT_MS);
      r = { ...retry, ms: retry.ms + r.ms };
      escalated = true;
      reason = why;
    }

    return done({
      taskId,
      text: r.text,
      source: r.ok ? (r.source ?? 'in_cloud') : 'none',
      ms: r.ms,
      mode,
      reason,
      escalated,
      blocked: false,
      error: r.error,
    });
  }

  function done(r: RouteResult): RouteResult {
    if (!r.blocked) record(r);
    cfg.onResult?.(r);
    return r;
  }

  return { generate };
}
