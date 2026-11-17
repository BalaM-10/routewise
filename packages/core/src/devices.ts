import { derivePolicy } from './policy';
import { wilsonLower } from './stats';
import { describeDevice } from './device';
import type { Mode, Report } from './types';

/** One step as measured on one device: how often the on-device model was right, and how long each side took. */
export interface StepMeasure {
  taskId: string;
  n: number;
  good: number;
  lowerBound: number;
  deviceP50: number;
  deviceP90: number;
  cloudP50: number;
  cloudP90: number;
  /** Cloud answers that were right, of those that came back; null when the step has no known answers. */
  cloudGood: number | null;
  /** Cloud calls that failed (for example a free-tier limit), so they say nothing about the cloud model. */
  cloudErrors: number;
  mode: Mode;
}

/** A calibration reduced to what is needed to set devices side by side. */
export interface DeviceRun {
  id: string;
  device: string;
  model: string;
  createdAt: string;
  steps: StepMeasure[];
}

/** From a web report: the same numbers the Routes page shows. */
export function fromReport(report: Report): DeviceRun {
  const steps = derivePolicy(report).map((e) => {
    const pairs = report.results.find((r) => r.taskId === e.taskId)?.pairs ?? [];
    const gold = report.tasks.find((t) => t.id === e.taskId)?.scoring !== 'judge';
    const cloudBack = pairs.filter((p) => p.cloud.ok);
    return {
      taskId: e.taskId,
      n: e.metrics.n,
      good: e.metrics.acceptable,
      lowerBound: e.metrics.lowerBound,
      deviceP50: e.metrics.deviceP50,
      deviceP90: e.metrics.deviceP90,
      cloudP50: e.metrics.cloudP50,
      cloudP90: e.metrics.cloudP90,
      cloudGood: gold ? cloudBack.filter((p) => (p.cloudScore ?? 0) >= 4).length : null,
      cloudErrors: pairs.length - cloudBack.length,
      mode: e.mode,
    };
  });
  const d = report.device;
  return { id: report.createdAt, device: describeDevice({ ...d, model: undefined }), model: d.model ?? 'Gemini Nano (model not recorded)', createdAt: report.createdAt, steps };
}

interface AndroidAnswer { ms: number; good: boolean; error: string | null }
interface AndroidReport {
  createdAt: string;
  device: string;
  onDeviceModelName?: string;
  tasks: {
    id: string; mode: string; trials: { device: AndroidAnswer; cloud: AndroidAnswer }[];
    /** The phone's own figures, shown on its Calibrate tab; used as they are so both screens agree. */
    deviceP50?: number; deviceP90?: number; cloudP50?: number; cloudP90?: number;
  }[];
}

const pct = (xs: number[], q: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

/** From the report the Android app saves after an on-phone calibration. */
export function fromAndroidReport(r: AndroidReport): DeviceRun {
  const steps = r.tasks.map((t) => {
    const ok = (a: AndroidAnswer) => !a.error;
    const dev = t.trials.filter((x) => ok(x.device)).map((x) => x.device.ms);
    const cloudBack = t.trials.filter((x) => ok(x.cloud));
    const good = t.trials.filter((x) => x.device.good).length;
    return {
      taskId: t.id,
      n: t.trials.length,
      good,
      lowerBound: wilsonLower(good, t.trials.length),
      deviceP50: t.deviceP50 ?? pct(dev, 0.5),
      deviceP90: t.deviceP90 ?? pct(dev, 0.9),
      cloudP50: t.cloudP50 ?? pct(cloudBack.map((x) => x.cloud.ms), 0.5),
      cloudP90: t.cloudP90 ?? pct(cloudBack.map((x) => x.cloud.ms), 0.9),
      cloudGood: cloudBack.filter((x) => x.cloud.good).length,
      cloudErrors: t.trials.length - cloudBack.length,
      mode: t.mode as Mode,
    };
  });
  return { id: r.createdAt, device: r.device, model: r.onDeviceModelName ?? 'Gemini Nano (model not recorded)', createdAt: r.createdAt, steps };
}
