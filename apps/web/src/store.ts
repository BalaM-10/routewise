import { fromAndroidReport, fromReport } from '@routewise/core';
import type { DeviceRun, Report } from '@routewise/core';

const KEY = 'routewise.report.v2';

export type ReportOrigin = 'this browser' | 'recorded' | 'imported';

export function loadReport(): Report | null {
  try {
    const raw = localStorage.getItem(KEY);
    const r = raw ? (JSON.parse(raw) as Report) : null;
    return r && r.version === 2 ? r : null;
  } catch {
    return null;
  }
}

export function saveReport(r: Report): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(r));
  } catch {
    /* storage unavailable: the report stays in memory only */
  }
}

/** A report recorded on real hardware and shipped with the app, so visitors without Gemini Nano still see real numbers. */
export async function loadRecordedReport(): Promise<Report | null> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}reports/recorded.json`, { cache: 'no-store' });
    if (!res.ok) return null;
    const r = (await res.json()) as Report;
    return r.version === 2 ? r : null;
  } catch {
    return null;
  }
}

/**
 * Calibrations shipped with the app from other hardware, so the Routes page can set devices side by side.
 * A file that is not there yet is skipped.
 */
const DEVICE_REPORTS: { file: string; kind: 'web' | 'android' }[] = [
  { file: 'recorded.json', kind: 'web' },
  { file: 'laptop-gemma4.json', kind: 'web' },
  { file: 'pixel-11-pro-nano4-full.json', kind: 'android' },
  { file: 'pixel-11-pro-nano4-fast.json', kind: 'android' },
];

export async function loadDeviceRuns(): Promise<DeviceRun[]> {
  const runs = await Promise.all(
    DEVICE_REPORTS.map(async ({ file, kind }) => {
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}reports/${file}`, { cache: 'no-store' });
        if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null;
        const data = await res.json();
        return kind === 'web' ? (isReport(data) ? fromReport(data) : null) : fromAndroidReport(data);
      } catch {
        return null;
      }
    }),
  );
  return runs.filter((r): r is DeviceRun => r !== null);
}

export function isReport(x: unknown): x is Report {
  const r = x as Report;
  return !!r && r.version === 2 && Array.isArray(r.results) && Array.isArray(r.tasks);
}

/** One saved calibration. Its id is the report's start time, which the published policy also carries. */
export interface Run {
  id: string;
  report: Report;
  origin: ReportOrigin;
  /** Stopped before every chosen feature finished. */
  partial: boolean;
  /** Some features were kept from this earlier run rather than measured again. */
  mergedFrom?: string;
}

const RUNS_KEY = 'routewise.runs.v1';
/** A full run is about 350 KB; browsers allow roughly 5 MB per site. */
const MAX_RUNS = 10;

export function loadRuns(): Run[] {
  try {
    const raw = localStorage.getItem(RUNS_KEY);
    if (raw === null) {
      // Before runs were kept, only the latest report was saved; start the list with it, once.
      const latest = loadReport();
      return saveRuns(latest ? [{ id: latest.createdAt, report: latest, origin: 'this browser', partial: false }] : []);
    }
    return (JSON.parse(raw) as Run[]).filter((r) => isReport(r.report));
  } catch {
    return [];
  }
}

/** Saves the list, newest first. When storage is full, the oldest runs are dropped until it fits. */
export function saveRuns(runs: Run[]): Run[] {
  let keep = [...runs].sort((a, b) => b.id.localeCompare(a.id)).slice(0, MAX_RUNS);
  if (keep.length === 0) {
    try { localStorage.setItem(RUNS_KEY, '[]'); } catch { /* storage unavailable */ }
    return keep;
  }
  while (keep.length > 0) {
    try {
      localStorage.setItem(RUNS_KEY, JSON.stringify(keep));
      return keep;
    } catch {
      if (keep.length === 1) return keep;
      keep = keep.slice(0, -1);
    }
  }
  return keep;
}

export function upsertRun(runs: Run[], run: Run): Run[] {
  return saveRuns([run, ...runs.filter((r) => r.id !== run.id)]);
}
