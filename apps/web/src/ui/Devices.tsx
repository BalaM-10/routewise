import { useEffect, useState } from 'react';
import { defaultTasks } from '@routewise/core';
import type { DeviceRun, StepMeasure } from '@routewise/core';
import { loadDeviceRuns } from '../store';
import { ROUTE_TEXT, isDeviceRoute } from './Junction';

const secs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`);
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

function Cell({ s, label }: { s: StepMeasure | undefined; label: string }) {
  const tag = <span className="dev-label" aria-hidden="true">{label}</span>;
  if (!s) return <div className="dev-cell none" role="cell">{tag}Not measured</div>;
  return (
    <div className={`dev-cell ${isDeviceRoute(s.mode) ? 'device' : 'cloud'}`} role="cell">
      {tag}
      <b>{s.good} of {s.n} right</b>
      <span className="muted">at least {Math.round(s.lowerBound * 100)}% with 95% confidence</span>
      <span>On device {secs(s.deviceP50)}, cloud {secs(s.cloudP50)}</span>
      <span className="dev-route">{ROUTE_TEXT[s.mode]}</span>
      {s.cloudErrors > 0 && <span className="muted">{s.cloudErrors} cloud {s.cloudErrors === 1 ? 'call' : 'calls'} failed and {s.cloudErrors === 1 ? 'is' : 'are'} left out of the cloud figures</span>}
    </div>
  );
}

/**
 * The same steps calibrated on other hardware and other on-device models, side by side. Each column is
 * one complete run shipped with the app; the point is that the right route depends on where the model runs.
 */
export function Devices() {
  const [runs, setRuns] = useState<DeviceRun[]>([]);
  useEffect(() => { loadDeviceRuns().then(setRuns); }, []);
  if (runs.length < 2) return null;

  const ids = [...new Set(runs.flatMap((r) => r.steps.map((s) => s.taskId)))];
  const name = (id: string) => defaultTasks.find((t) => t.id === id)?.name ?? id;
  const cols = { gridTemplateColumns: `minmax(140px, 0.8fr) repeat(${runs.length}, minmax(190px, 1fr))` };

  return (
    <section className="panel" aria-labelledby="devices-title">
      <div className="intro">
        <h2 id="devices-title">The same steps on other hardware</h2>
        <p className="note">
          Each column is one calibration against the same cloud model, gemini-3.5-flash-lite. Times are medians. A step that is fast and right on one
          device can be slow on another, which is why the route is measured where the app runs instead of assumed.
        </p>
      </div>
      <div className="devices" role="table" aria-label="Results per device">
        <div className="dev-row head" role="row" style={cols}>
          <span role="columnheader">Step</span>
          {runs.map((r) => (
            <span key={r.id} role="columnheader">
              <b>{r.model}</b>
              <span className="muted">{r.device}, {day(r.createdAt)}</span>
            </span>
          ))}
        </div>
        {ids.map((id) => (
          <div key={id} className="dev-row" role="row" style={cols}>
            <span role="rowheader" className="dev-step">{name(id)}</span>
            {runs.map((r) => <Cell key={r.id} label={`${r.model}, ${r.device.split(',')[0]}`} s={r.steps.find((s) => s.taskId === id)} />)}
          </div>
        ))}
      </div>
    </section>
  );
}
