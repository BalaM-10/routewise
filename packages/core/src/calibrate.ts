import { buildPrompt, modelFor, timedGenerate } from './runner';
import type { Timed } from './runner';
import type { GenerativeModel } from 'firebase/ai';
import { goldScore, validate } from './scoring';
import { deviceProfile } from './device';
import { words } from './stats';
import type { Pair, Report, Sample, Task, TaskResult } from './types';

export interface Progress {
  done: number;
  total: number;
  label: string;
}

const JUDGE_SCHEMA = {
  type: 'object',
  properties: { a: { type: 'number' }, b: { type: 'number' } },
  required: ['a', 'b'],
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const TRANSIENT = /429|quota|rate|exhausted|500|502|503|504|internal|unavailable|overloaded|deadline|timeout/i;
/** Server trouble rather than a rate limit: another model is a better bet than waiting. */
const SERVER = /500|502|503|504|internal|unavailable|overloaded|deadline|timeout/i;
/** A cloud answer that takes longer than this is treated as failed and retried. */
const CLOUD_TIMEOUT_MS = 60000;
/** Gemini Nano answers the longest test input in well under this; a stalled answer counts as a failure. */
const DEVICE_TIMEOUT_MS = 90000;
/** A daily quota will not recover during the run, so retrying only wastes time. */
const DAILY = /per ?day|perday/i;

/** Models whose daily quota ran out during this run. */
const exhausted = new Set<string>();
/** Reviewing models that kept failing with server errors; skipped for the rest of the run. */
const strikes = new Map<string, number>();

/**
 * Spaces cloud requests so a run stays under the per-minute limit instead of hitting it.
 * The free tier allows 10 requests a minute on gemini-3.5-flash-lite; the default of 9 leaves headroom.
 */
let minGapMs = 60000 / 9;
let lastCloudStart = 0;
async function pace(): Promise<void> {
  const wait = lastCloudStart + minGapMs - Date.now();
  if (wait > 0) await sleep(wait);
  lastCloudStart = Date.now();
}

/** Cloud call with backoff for per-minute limits and overload; gives up at once on daily limits. */
async function cloudWithRetry(model: GenerativeModel, prompt: string, name: string, retries = 3): Promise<Timed> {
  await pace();
  let out = await timedGenerate(model, prompt, CLOUD_TIMEOUT_MS);
  for (let attempt = 1; attempt <= retries && !out.ok; attempt++) {
    const err = out.error ?? '';
    if (DAILY.test(err)) {
      exhausted.add(name);
      break;
    }
    if (!TRANSIENT.test(err)) break;
    // A per-minute window needs most of a minute to clear; server errors need less.
    await sleep((SERVER.test(err) ? 5000 : 15000) * attempt);
    await pace();
    out = await timedGenerate(model, prompt, CLOUD_TIMEOUT_MS);
  }
  return out;
}

type JudgeResult = { device: number; cloud: number; model: string } | { error: string };

/**
 * Blind judge: both answers are scored on the same rubric, in random order, by a cloud model.
 * Neither answer is treated as the truth. Transient errors are retried; if the judge model
 * keeps failing, the reference cloud model judges instead and the report records which one did.
 */
async function judgePair(
  models: string[],
  task: Task,
  input: string,
  device: string,
  cloud: string,
): Promise<JudgeResult> {
  const flip = Math.random() < 0.5;
  const [a, b] = flip ? [cloud, device] : [device, cloud];
  const prompt =
    `You review answers from an AI feature before it ships to real users.\n` +
    `Score each answer from 1 (unusable) to 5 (ready to ship) for this instruction. Penalize invented facts, missing important facts, ignored format or length rules and unsafe promises. Judge each answer on its own merits.\n\n` +
    `INSTRUCTION:\n${task.instruction}\n\nINPUT:\n${input}\n\nANSWER A:\n${a}\n\nANSWER B:\n${b}\n\n` +
    `Return JSON {"a": score, "b": score}.`;
  let lastError = 'unknown error';
  for (const model of models) {
    if (exhausted.has(model)) {
      lastError = `${model} has used its daily quota`;
      continue;
    }
    if ((strikes.get(model) ?? 0) >= 3) {
      lastError = `${model} kept returning server errors`;
      continue;
    }
    // One retry only: another reviewing model is waiting, so a struggling one is not worth minutes.
    const out = await cloudWithRetry(modelFor('ONLY_IN_CLOUD', model, undefined, JUDGE_SCHEMA), prompt, model, 1);
    if (!out.ok) {
      lastError = `${model}: ${out.error ?? 'request failed'}`;
      if (SERVER.test(out.error ?? '')) strikes.set(model, (strikes.get(model) ?? 0) + 1);
      console.warn(`[routewise] judge failed: ${lastError}`);
      continue;
    }
    strikes.set(model, 0);
    try {
      const j = JSON.parse(out.text) as { a: number; b: number };
      const clamp = (n: number) => Math.max(1, Math.min(5, Number(n)));
      if (Number.isFinite(Number(j.a)) && Number.isFinite(Number(j.b))) {
        return flip
          ? { device: clamp(j.b), cloud: clamp(j.a), model }
          : { device: clamp(j.a), cloud: clamp(j.b), model };
      }
      lastError = `${model} returned scores that were not numbers`;
    } catch {
      lastError = `${model} returned invalid JSON`;
    }
  }
  return { error: lastError };
}

function checked(s: Sample, task: Task): Sample {
  return { ...s, valid: s.ok && validate(s.text, task.validator) };
}

export async function calibrate(
  tasks: Task[],
  opts: {
    cloudModel: string;
    judgeModel: string;
    /** Cloud requests per minute to stay under (default 9). */
    cloudRpm?: number;
    /**
     * Reviewers to try, in order, when the judge model fails or runs out of daily quota.
     * The cloud model is only used to review its own answers as a last resort.
     */
    judgeFallbacks?: string[];
    onProgress: (p: Progress) => void;
    /** Called after each feature finishes, with a report covering the features done so far. */
    onTaskDone?: (partial: Report) => void;
    signal: AbortSignal;
    /** The on-device model in use, recorded in the report; see DeviceProfile.model. */
    onDeviceModel?: string;
  },
): Promise<Report> {
  exhausted.clear();
  minGapMs = 60000 / Math.max(1, opts.cloudRpm ?? 9);
  lastCloudStart = 0;
  strikes.clear();
  // One timestamp for the whole run, so reports saved part-way and the final one are the same run.
  const startedAt = new Date().toISOString();
  const total = tasks.reduce((n, t) => n + t.inputs.length, 0) + 1;
  let done = 0;
  const step = (label: string) => opts.onProgress({ done, total, label });

  // Warm-up: Chrome unloads the model when idle, and the first call pays the load cost.
  step('Warming up the on-device model');
  const warm = await timedGenerate(modelFor('ONLY_ON_DEVICE', opts.cloudModel), 'Reply with the word ready.');
  const coldStartMs = warm.ok ? warm.ms : null;
  done++;

  const results: TaskResult[] = [];
  for (const task of tasks) {
    const pairs: Pair[] = [];
    const device = modelFor('ONLY_ON_DEVICE', opts.cloudModel, task);
    const cloud = modelFor('ONLY_IN_CLOUD', opts.cloudModel, task);

    for (let i = 0; i < task.inputs.length; i++) {
      if (opts.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      const input = task.inputs[i];
      step(`${task.name}: input ${i + 1} of ${task.inputs.length}${input.tier ? ` (${input.tier} words)` : ''}`);
      const prompt = buildPrompt(task, input.text);
      const d = checked(await timedGenerate(device, prompt, DEVICE_TIMEOUT_MS), task);
      const c = checked(await cloudWithRetry(cloud, prompt, opts.cloudModel), task);

      let deviceScore: number | null = null;
      let cloudScore: number | null = null;
      let status: Pair['status'];
      let note: string | undefined;
      let judgedBy: string | undefined;

      const gold = task.scoring !== 'judge' && input.gold;
      if (!d.ok) status = 'device-failed';
      else if (!d.valid) status = 'device-invalid';
      else status = 'scored';

      if (gold) {
        if (d.valid) deviceScore = goldScore(d.text, input.gold!, task.scoring, input.text);
        if (c.valid) cloudScore = goldScore(c.text, input.gold!, task.scoring, input.text);
      } else if (d.valid) {
        if (!c.valid) {
          status = 'reference-missing';
          note = c.ok ? 'The cloud answer failed the format check.' : `Cloud call failed: ${c.error ?? 'unknown error'}`;
        } else {
          const models = [...new Set([opts.judgeModel, ...(opts.judgeFallbacks ?? []).filter((m) => m !== opts.cloudModel), opts.cloudModel])];
          const j = await judgePair(models, task, input.text, d.text, c.text);
          if ('error' in j) {
            status = 'reference-missing';
            note = `Judge failed: ${j.error}`;
          } else {
            deviceScore = j.device;
            cloudScore = j.cloud;
            judgedBy = j.model;
          }
        }
      }

      pairs.push({ input: i, words: words(input.text), tier: input.tier, onDevice: d, cloud: c, deviceScore, cloudScore, status, judgedBy, note });
      done++;
    }
    results.push({ taskId: task.id, pairs });
    // Hand back each finished feature, so stopping a long run does not lose completed work.
    opts.onTaskDone?.(await report(tasks.slice(0, results.length)));
  }
  step('Finished');
  return report(tasks);

  async function report(done: Task[]): Promise<Report> {
    return {
      version: 2,
      createdAt: startedAt,
      device: { ...(await deviceProfile()), ...(opts.onDeviceModel ? { model: opts.onDeviceModel } : {}) },
      cloudModel: opts.cloudModel,
      judgeModel: opts.judgeModel,
      coldStartMs,
      tasks: done,
      results: [...results],
    };
  }
}
