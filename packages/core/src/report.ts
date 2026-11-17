import type { Report } from './types';

/**
 * Combines a partial re-run with an earlier report from the same browser: re-run features are
 * replaced, and features no longer in the app's feature list are dropped.
 */
export function mergeReports(base: Report, fresh: Report, currentIds: string[]): Report {
  const rerun = new Set(fresh.tasks.map((t) => t.id));
  const keep = (id: string) => !rerun.has(id) && currentIds.includes(id);
  return {
    ...fresh,
    tasks: [...base.tasks.filter((t) => keep(t.id)), ...fresh.tasks],
    results: [...base.results.filter((r) => keep(r.taskId)), ...fresh.results],
  };
}
