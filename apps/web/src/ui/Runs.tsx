import { useMemo, useState } from 'react';
import { derivePolicy, describeDevice, download } from '@routewise/core';
import type { PolicyEntry, Report } from '@routewise/core';
import type { Run } from '../store';
import { ROUTE_TEXT, isDeviceRoute } from './Junction';
import { IconDownload } from './Icons';

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const pct = (n: number) => `${Math.round(n * 100)}%`;
const time = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)} s` : `${n} ms`);
const ORIGIN: Record<Run['origin'], string> = {
  'this browser': 'Calibrated in this browser',
  recorded: 'Ships with the app',
  imported: 'Opened from a file',
};

/** The models that reviewed written answers in a run, or an empty string when none did. */
function reviewers(report: Report): string {
  const used = [...new Set(report.results.flatMap((r) => r.pairs).map((p) => p.judgedBy).filter(Boolean))] as string[];
  return used.length <= 1 ? used.join('') : `${used.slice(0, -1).join(', ')} and ${used[used.length - 1]}`;
}

const measured = (e: PolicyEntry | undefined): e is PolicyEntry => !!e && e.metrics.n > 0;

/** Short text for one feature in one run, e.g. "46 of 48". */
function score(e: PolicyEntry | undefined): string {
  if (!measured(e)) return 'not measured';
  return `${e.metrics.acceptable} of ${e.metrics.n}${e.maxWords ? `, up to ${e.maxWords.toLocaleString()} words` : ''}`;
}

export function Runs(props: {
  runs: Run[];
  current: string | null;
  liveId: string | null;
  /** Shows the run on the Routes page, with one feature opened when given. */
  onOpen: (run: Run, taskId?: string) => void;
  onRemove: (id: string) => void;
}) {
  const { runs, current, liveId, onOpen, onRemove } = props;
  const [picked, setPicked] = useState<string[]>([]);
  const [removing, setRemoving] = useState<string | null>(null);

  const entries = useMemo(() => new Map(runs.map((r) => [r.id, derivePolicy(r.report)])), [runs]);
  // Feature columns in the order they were first measured, across every run.
  const features = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of [...runs].reverse()) for (const t of r.report.tasks) if (!seen.has(t.id)) seen.set(t.id, t.name);
    return [...seen].map(([id, name]) => ({ id, name }));
  }, [runs]);

  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id].slice(-2)));
  // Older run first, so changes read from then to now.
  const pair = picked.length === 2 ? [...picked].sort().map((id) => runs.find((r) => r.id === id)!) : null;

  if (runs.length === 0) {
    return (
      <main className="page">
        <section className="intro">
          <h1>Runs</h1>
          <p className="lede">No calibrations saved yet. Each run you finish on the Calibrate page is kept here, so you can come back to it and compare it with later runs.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="page">
      <section className="intro">
        <h1>Runs</h1>
        <p className="lede">
          Every calibration saved in this browser, newest first. Chrome updates Gemini Nano from time to time, so running again and
          comparing shows whether a feature got better or worse before you change its route. Click a feature to see its evidence.
        </p>
      </section>

      <section className="runs" aria-label="Saved runs">
        {runs.map((run) => {
          const list = entries.get(run.id) ?? [];
          const live = run.id === liveId;
          return (
            <article key={run.id} className={`run${current === run.id ? ' shown' : ''}`}>
              <div className="run-head">
                <label className="run-pick">
                  <input type="checkbox" checked={picked.includes(run.id)} onChange={() => toggle(run.id)} aria-label={`Compare the run from ${when(run.id)}`} />
                  <span className="run-when">{when(run.id)}</span>
                </label>
                <div className="run-tags">
                  {live && <span className="tag live">Live in Remote Config</span>}
                  {current === run.id && <span className="tag">On the Routes page</span>}
                  {run.partial && <span className="tag warn">Stopped part-way</span>}
                </div>
              </div>
              <p className="run-meta">
                {ORIGIN[run.origin]}. {describeDevice(run.report.device)}. Cloud answers from {run.report.cloudModel}
                {reviewers(run.report) ? `; written answers reviewed by ${reviewers(run.report)}.` : '; no written answers were reviewed.'}
                {run.mergedFrom && <> Features left out of this run were kept from the run of {when(run.mergedFrom)}.</>}
              </p>
              <ul className="run-steps">
                {features.map((f) => {
                  const e = list.find((x) => x.taskId === f.id);
                  return (
                    <li key={f.id} className={e ? (isDeviceRoute(e.mode) ? 'device' : 'cloud') : 'none'}>
                      {e ? (
                        <button className="run-step" onClick={() => onOpen(run, f.id)} aria-label={`${f.name}: ${score(e)}, ${ROUTE_TEXT[e.mode]}. Show the evidence`}>
                          <span className="run-step-name">{f.name}</span>
                          <b>{score(e)}</b>
                          <span className="run-step-route">{ROUTE_TEXT[e.mode]}</span>
                        </button>
                      ) : (
                        <div className="run-step">
                          <span className="run-step-name">{f.name}</span>
                          <b>{score(e)}</b>
                          <span className="run-step-route">—</span>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
              <div className="row">
                <button className="btn quiet" onClick={() => onOpen(run)} disabled={current === run.id}>Show on the Routes page</button>
                <button className="btn quiet" onClick={() => download(`routewise-report-${run.id.slice(0, 16).replace(/[:T]/g, '-')}.json`, JSON.stringify(run.report, null, 2))}>
                  <IconDownload /> Save report
                </button>
                {run.origin !== 'recorded' && (removing === run.id ? (
                  <span className="confirm">
                    Remove this run from this browser?
                    <button className="btn link" onClick={() => { onRemove(run.id); setRemoving(null); setPicked((p) => p.filter((x) => x !== run.id)); }}>Remove</button>
                    <button className="btn link" onClick={() => setRemoving(null)}>Keep</button>
                  </span>
                ) : (
                  <button className="btn link" onClick={() => setRemoving(run.id)}>Remove</button>
                ))}
              </div>
            </article>
          );
        })}
      </section>

      <section className="panel" aria-label="Compare two runs">
        <div className="panel-head">
          <h2>Compare two runs</h2>
          {picked.length > 0 && <button className="btn link" onClick={() => setPicked([])}>Clear</button>}
        </div>
        {!pair ? (
          <p className="muted">
            {runs.length < 2
              ? 'Save a second run to compare. A run on another day, after a Chrome update or with a different reviewing model shows what changed.'
              : `Tick two runs above. ${picked.length === 1 ? 'One picked.' : ''}`}
          </p>
        ) : (
          <Compare a={pair[0]} b={pair[1]} ea={entries.get(pair[0].id) ?? []} eb={entries.get(pair[1].id) ?? []} features={features} />
        )}
      </section>
    </main>
  );
}

function Compare(props: { a: Run; b: Run; ea: PolicyEntry[]; eb: PolicyEntry[]; features: { id: string; name: string }[] }) {
  const { a, b, ea, eb, features } = props;
  const notes: string[] = [];
  if (a.report.cloudModel !== b.report.cloudModel) notes.push(`The cloud model changed from ${a.report.cloudModel} to ${b.report.cloudModel}.`);
  const ra = reviewers(a.report) || 'no model';
  const rb = reviewers(b.report) || 'no model';
  if (ra !== rb) notes.push(`Written answers were reviewed by ${ra} in the earlier run and by ${rb} in the later one, so part of a change in those scores can come from the reviewer.`);
  if (a.report.device.chrome !== b.report.device.chrome) notes.push(`Chrome changed from ${a.report.device.chrome} to ${b.report.device.chrome}.`);
  if ((a.report.device.model ?? '') !== (b.report.device.model ?? '')) notes.push(`The on-device model changed from ${a.report.device.model ?? 'one not recorded'} to ${b.report.device.model ?? 'one not recorded'}.`);

  return (
    <>
      <p className="muted">From {when(a.id)} to {when(b.id)}.</p>
      {notes.map((n) => <p key={n} className="callout info">{n}</p>)}
      <div className="compare" role="table" aria-label="Changes per feature">
        <div className="compare-row head" role="row">
          <span role="columnheader">Feature</span>
          <span role="columnheader">Good on device</span>
          <span role="columnheader">Lower bound, 95%</span>
          <span role="columnheader">Route</span>
          <span role="columnheader">Slowest typical answer on device</span>
        </div>
        {features.map((f) => {
          const x = ea.find((e) => e.taskId === f.id);
          const y = eb.find((e) => e.taskId === f.id);
          if (!x && !y) return null;
          const delta = measured(x) && measured(y) ? Math.round((y.metrics.lowerBound - x.metrics.lowerBound) * 100) : null;
          const routeChanged = !!x && !!y && x.mode !== y.mode;
          return (
            <div key={f.id} className="compare-row" role="row">
              <span role="cell" className="compare-name">{f.name}</span>
              <span role="cell">{score(x)} → {score(y)}</span>
              <span role="cell">
                {measured(x) ? pct(x.metrics.lowerBound) : '—'} → {measured(y) ? pct(y.metrics.lowerBound) : '—'}
                {delta !== null && delta !== 0 && <em className={delta > 0 ? 'up' : 'down'}> {delta > 0 ? '+' : ''}{delta} points</em>}
              </span>
              <span role="cell" className={routeChanged ? 'changed' : ''}>
                {x ? ROUTE_TEXT[x.mode] : '—'}{routeChanged || !x || !y ? <> → {y ? ROUTE_TEXT[y.mode] : '—'}</> : <span className="muted"> (same)</span>}
              </span>
              <span role="cell">{x ? time(x.metrics.deviceP90) : '—'} → {y ? time(y.metrics.deviceP90) : '—'}</span>
            </div>
          );
        })}
      </div>
    </>
  );
}
