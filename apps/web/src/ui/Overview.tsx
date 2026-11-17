import type { PolicyFile } from '@routewise/core';
import type { Run } from '../store';
import { Devices } from './Devices';
import { OnAPhone } from './OnAPhone';
import { isDeviceRoute } from './Junction';

type Go = 'desk' | 'routes' | 'calibrate' | 'runs';

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/**
 * What Routewise is, in the order it works: measure each feature, decide its route, ship the routes,
 * and an app that follows them. Each stage shows its live state and opens the page that does it.
 */
export function Overview(props: { live: PolicyFile | null; runs: Run[]; go: (t: Go) => void }) {
  const { live, runs, go } = props;
  const routes = live ? Object.values(live.tasks) : [];
  const onDevice = routes.filter((r) => isDeviceRoute(r.mode)).length;

  const stages: { verb: string; text: string; state: string; action: string; to: Go }[] = [
    {
      verb: 'Measure',
      text: 'Every AI feature runs on the on-device model and in the cloud, on the same examples, and the answers are scored side by side.',
      state: runs.length ? `${runs.length} ${runs.length === 1 ? 'run' : 'runs'} saved in this browser` : 'No runs saved yet',
      action: 'Calibrate',
      to: 'calibrate',
    },
    {
      verb: 'Decide',
      text: 'Each feature gets its own route from what was measured: how often the device was right, how fast it was, and how long an input it handled.',
      state: live ? `${onDevice} of ${routes.length} features run on the device` : 'Routes not loaded yet',
      action: 'See the routes',
      to: 'routes',
    },
    {
      verb: 'Ship',
      text: 'The routes are one Remote Config value. Open copies of the app follow a change within a minute, without a release.',
      state: live ? `Live since the run of ${when(live.createdAt)}` : 'Nothing published yet',
      action: 'Publish routes',
      to: 'routes',
    },
    {
      verb: 'Run',
      text: 'The app sends each feature where its route says and records where every answer came from, so a wrong route shows up.',
      state: 'Shopdesk, a support inbox for a small shop',
      action: 'Open Shopdesk',
      to: 'desk',
    },
  ];

  return (
    <main className="page">
      <section className="intro overview-head">
        <h1>Decide where each AI feature runs, from evidence.</h1>
        <p className="lede">
          Firebase AI Logic can run any feature on the on-device model, in the cloud, or prefer one and fall back to the other. Which one is
          right depends on the feature and on the device. Routewise measures it, picks a route for each feature, and ships the routes
          through Remote Config.
        </p>
        <p className="meta">For developers adding on-device AI to a web or Android app. Shopdesk, a small shop's support inbox, is the worked example.</p>
      </section>

      <ol className="loop" aria-label="How Routewise works">
        {stages.map((s, i) => (
          <li key={s.verb} className="loop-stage">
            <span className="loop-n" aria-hidden="true">{i + 1}</span>
            <h2>{s.verb}</h2>
            <p>{s.text}</p>
            <p className="loop-state">{s.state}</p>
            <button className="btn link" onClick={() => go(s.to)}>{s.action}</button>
          </li>
        ))}
      </ol>

      <OnAPhone go={go} />

      <Devices />
    </main>
  );
}
