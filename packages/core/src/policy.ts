import { percentile, wilsonLower } from './stats';
import { describeDevice } from './device';
import type { Mode, Pair, PolicyEntry, PolicyFile, Report, Task, TaskResult, TierStat } from './types';

const pct = (n: number) => `${Math.round(n * 100)}%`;
const TIER_PASS = 0.75;
const DEVICE_FIRST_BOUND = 0.7;
const MIN_SAMPLES = 4;

export function acceptable(task: Task, p: Pair): boolean {
  if (p.status !== 'scored' || p.deviceScore === null) return false;
  if (p.deviceScore < 4) return false;
  // For judged tasks the device answer may not be clearly worse than the cloud answer.
  return task.scoring !== 'judge' || p.cloudScore === null || p.deviceScore >= p.cloudScore - 1;
}

function tierStats(task: Task, pairs: Pair[]): TierStat[] {
  const tiers = [...new Set(pairs.map((p) => p.tier).filter((t): t is number => t !== undefined))].sort((a, b) => a - b);
  return tiers.map((tier) => {
    const inTier = pairs.filter((p) => p.tier === tier && p.status !== 'reference-missing');
    return { tier, n: inTier.length, acceptable: inTier.filter((p) => acceptable(task, p)).length };
  });
}

export function deriveEntry(task: Task, result: TaskResult): PolicyEntry {
  const all = result.pairs;
  const tiers = task.lengthSweep ? tierStats(task, all) : [];

  // Longest input size at which the device still passes, with every smaller size passing too.
  let maxWords: number | null = null;
  let firstFailedTier: number | null = null;
  let firstUnmeasuredTier: number | null = null;
  if (tiers.length) {
    for (const t of tiers) {
      if (t.n === 0) { firstUnmeasuredTier = t.tier; break; }
      if (t.acceptable / t.n >= TIER_PASS) maxWords = t.tier;
      else { firstFailedTier = t.tier; break; }
    }
  }
  const inScope = tiers.length && maxWords !== null ? all.filter((p) => (p.tier ?? 0) <= maxWords!) : all;
  const counted = inScope.filter((p) => p.status !== 'reference-missing');
  const n = counted.length;
  const ok = counted.filter((p) => acceptable(task, p)).length;
  const rate = n ? ok / n : 0;
  const lb = wilsonLower(ok, n);
  const validRate = n ? counted.filter((p) => p.onDevice.valid).length / n : 0;
  const deviceMs = inScope.filter((p) => p.onDevice.ok).map((p) => p.onDevice.ms);
  const cloudMs = inScope.filter((p) => p.cloud.ok).map((p) => p.cloud.ms);
  const dP90 = percentile(deviceMs, 90);
  const cloudScored = all.filter((p) => p.cloudScore !== null);
  const cloudRate = task.scoring !== 'judge' && cloudScored.length
    ? cloudScored.filter((p) => (p.cloudScore ?? 0) >= 4).length / cloudScored.length
    : null;

  const reasons: string[] = [];
  const warnings: string[] = [];
  let mode: Mode;
  const inconclusive = n < MIN_SAMPLES;
  const deviceDead = all.length > 0 && all.every((p) => !p.onDevice.ok);

  if (deviceDead) {
    mode = 'ONLY_IN_CLOUD';
    reasons.push('The on-device model could not complete this task on the tested device.');
  } else if (inconclusive) {
    mode = 'PREFER_IN_CLOUD';
    reasons.push(`Only ${n} usable samples, which is not enough evidence. The cloud stays primary until you calibrate with more inputs.`);
  } else if (lb >= DEVICE_FIRST_BOUND) {
    mode = task.sensitive ? 'ONLY_ON_DEVICE' : 'PREFER_ON_DEVICE';
    reasons.push(`${ok} of ${n} on-device answers were acceptable (${pct(rate)}; at least ${pct(lb)} with 95% confidence).`);
    if (task.sensitive) reasons.push('This task handles personal data, so it is kept on the device. Users without an on-device model are asked before anything goes to the cloud.');
    if (!task.sensitive && dP90 > task.latencyBudgetMs) {
      mode = 'PREFER_IN_CLOUD';
      reasons.push(`But the on-device p90 latency of ${dP90} ms is over this feature's ${task.latencyBudgetMs} ms budget, so the cloud answers first.`);
    }
    if (task.sensitive && dP90 > task.latencyBudgetMs) {
      warnings.push(`On-device p90 latency of ${dP90} ms is over the ${task.latencyBudgetMs} ms budget. Privacy wins here, but show progress in the UI.`);
    }
  } else if (rate >= 0.85 && task.sensitive) {
    mode = 'ONLY_ON_DEVICE';
    reasons.push(`${ok} of ${n} on-device answers were acceptable (${pct(rate)}). This task handles personal data, so privacy wins: it stays on the device, and the user is asked before anything goes to the cloud.`);
    warnings.push(`${n} samples is too few to be 95% sure (lower bound ${pct(lb)}). Calibrate with more inputs to confirm.`);
  } else if (rate >= 0.85) {
    mode = 'PREFER_IN_CLOUD';
    reasons.push(`${ok} of ${n} on-device answers were acceptable (${pct(rate)}), but ${n} samples is too few to be 95% sure. The cloud answers first until more inputs confirm it.`);
  } else if (rate >= 0.5) {
    mode = 'PREFER_IN_CLOUD';
    reasons.push(`${ok} of ${n} on-device answers were acceptable (${pct(rate)}), not enough to lead. The cloud answers first and the device is the offline fallback.`);
  } else {
    mode = 'ONLY_IN_CLOUD';
    reasons.push(`Only ${ok} of ${n} on-device answers were acceptable (${pct(rate)}), which is too low to ship.`);
  }

  if (tiers.length) {
    if (maxWords !== null && maxWords === tiers[tiers.length - 1].tier)
      reasons.push(`Quality held at every length tested, up to ${maxWords.toLocaleString()} words.`);
    else if (maxWords !== null)
      reasons.push(`Quality holds up to about ${maxWords.toLocaleString()} words. Longer inputs go to the cloud automatically.`);
    if (firstFailedTier !== null)
      reasons.push(`At ${firstFailedTier.toLocaleString()} words the device was no longer good enough.`);
    if (firstUnmeasuredTier !== null)
      warnings.push(`No scored samples at ${firstUnmeasuredTier.toLocaleString()} words, so the length limit is not measured beyond that point.`);
  }
  if (validRate < 1 && task.validator.kind !== 'text')
    reasons.push(`${pct(validRate)} of on-device outputs matched the required ${task.validator.kind === 'json' ? 'JSON' : 'label'} format.`);
  if (cloudRate !== null && cloudRate < 1)
    reasons.push(`For comparison, the cloud model got ${pct(cloudRate)} of the same answers right.`);
  if (task.sensitive && (mode === 'ONLY_IN_CLOUD' || mode === 'PREFER_IN_CLOUD'))
    warnings.push('Personal data would leave the device. The router will ask the user before sending it.');
  const excluded = inScope.length - n;
  if (excluded) {
    const notes = inScope.filter((p) => p.status === 'reference-missing' && p.note).map((p) => p.note!);
    const top = notes.sort((a, b) => notes.filter((x) => x === b).length - notes.filter((x) => x === a).length)[0];
    warnings.push(`${excluded} sample(s) were left out because the cloud reference or the judge failed${top ? `, for example: ${top}` : '.'}`);
  }

  return {
    taskId: task.id,
    name: task.name,
    mode,
    maxWords: tiers.length ? maxWords : null,
    sensitive: task.sensitive,
    inconclusive,
    reasons,
    warnings,
    metrics: {
      n, acceptable: ok, rate, lowerBound: lb, validRate, excluded,
      deviceP50: percentile(deviceMs, 50), deviceP90: dP90,
      cloudP50: percentile(cloudMs, 50), cloudP90: percentile(cloudMs, 90),
      cloudRate,
    },
    tiers,
  };
}

export function derivePolicy(report: Report): PolicyEntry[] {
  return report.results.flatMap((r) => {
    const task = report.tasks.find((t) => t.id === r.taskId);
    return task ? [deriveEntry(task, r)] : [];
  });
}

export function toPolicyFile(report: Report, entries: PolicyEntry[]): PolicyFile {
  return {
    version: 1,
    createdAt: report.createdAt,
    measuredOn: describeDevice(report.device),
    cloudModel: report.cloudModel,
    tasks: Object.fromEntries(
      entries.map((e) => [e.taskId, { mode: e.mode, maxWords: e.maxWords, sensitive: e.sensitive }]),
    ),
  };
}

const MODES: Mode[] = ['PREFER_ON_DEVICE', 'PREFER_IN_CLOUD', 'ONLY_ON_DEVICE', 'ONLY_IN_CLOUD'];

export function parsePolicyFile(raw: string): PolicyFile | null {
  try {
    const p = JSON.parse(raw) as PolicyFile;
    if (p.version !== 1 || typeof p.tasks !== 'object') return null;
    const valid = Object.values(p.tasks).every((t) => MODES.includes(t.mode));
    return valid ? p : null;
  } catch {
    return null;
  }
}
