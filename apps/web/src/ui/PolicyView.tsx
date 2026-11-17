import { useEffect, useMemo, useState } from 'react';
import { derivePolicy, describeDevice, download, kotlinSnippet, remoteConfigValue, toPolicyFile, webSnippet } from '@routewise/core';
import type { Report } from '@routewise/core';
import { isReport } from '../store';
import type { ReportOrigin } from '../store';
import { Junction, ROUTE_TEXT, isDeviceRoute } from './Junction';
import { Lanes } from './Lanes';
import type { Lane, Station } from './Lanes';
import { IconAlert, IconChevron, IconCloud, IconDevice, IconDownload, IconInfo, IconUpload } from './Icons';

const pct = (n: number) => `${Math.round(n * 100)}%`;
const time = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)} s` : `${n} ms`);
const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
const count = (n: number) => WORDS[n] ?? String(n);

export function PolicyView(props: {
  report: Report | null;
  origin: ReportOrigin;
  /** Start time of the run whose routes are published in Remote Config. */
  liveId: string | null;
  goRuns: () => void;
  focus: string | null;
  onImport: (r: Report) => void;
  goCalibrate: () => void;
}) {
  const { report, origin, liveId, goRuns, focus, onImport, goCalibrate } = props;
  const entries = useMemo(() => (report ? derivePolicy(report) : []), [report]);
  const [open, setOpen] = useState<string | null>(focus);

  // Arriving from a "Why?" link opens that feature and brings it into view.
  useEffect(() => {
    if (!focus) return;
    setAnswers(null);
    setOpen(focus);
    requestAnimationFrame(() => document.getElementById(`route-${focus}`)?.scrollIntoView({ block: 'center' }));
  }, [focus]);
  const [answers, setAnswers] = useState<string | null>(null);
  const [platform, setPlatform] = useState<'web' | 'android'>('web');
  const [importError, setImportError] = useState('');

  const importFile = async (file: File) => {
    setImportError('');
    try {
      const r = JSON.parse(await file.text());
      if (isReport(r)) onImport(r);
      else setImportError('That file is not a Routewise report.');
    } catch {
      setImportError('That file could not be read as JSON.');
    }
  };

  const loader = (
    <label className="btn quiet file">
      <IconUpload /> Open a report
      <input type="file" accept="application/json" onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
    </label>
  );

  if (!report) {
    return (
      <main className="page">
        <section className="intro">
          <h1>No measurements yet</h1>
          <p className="lede">Run a calibration in a browser that has Gemini Nano, or open a report saved earlier.</p>
        </section>
        <div className="row">
          <button className="btn" onClick={goCalibrate}>Start a calibration</button>
          {loader}
        </div>
        {importError && <p className="error">{importError}</p>}
      </main>
    );
  }

  const policy = toPolicyFile(report, entries);
  // The steps Shopdesk runs for every ticket, in order.
  const flow = ['triage', 'extract', 'pii', 'reply'].map((id) => entries.find((e) => e.taskId === id)).filter((e): e is NonNullable<typeof e> => !!e);
  const onDevice = flow.filter((e) => isDeviceRoute(e.mode));
  const list = (names: string[]) => names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  const local = entries.filter((e) => isDeviceRoute(e.mode)).length;
  const taken = new Date(report.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <main className="page">
      <section className="head">
        <div className="intro">
          <h1>{local === 0 ? `None of the ${count(entries.length).toLowerCase()} AI steps can run on the device` : `${count(local)} of ${count(entries.length).toLowerCase()} AI steps can run on the device`}</h1>
          <p className="lede">
            Measured in {describeDevice(report.device)} on {taken}. Each feature was run on the on-device model and on {report.cloudModel}, and
            the answers were scored side by side.{origin === 'recorded' && ' These results were recorded on real hardware and ship with this demo; run your own calibration to replace them.'}
          </p>
        </div>
        <div className="reach">
          {flow.length > 0 && (
            <>
              <strong>
                {onDevice.length === flow.length ? (flow.length === 2 ? 'Both steps' : `All ${count(flow.length).toLowerCase()} steps`) : `${count(onDevice.length)} of ${count(flow.length).toLowerCase()} steps`}{' '}
                per ticket stay on the shop owner's computer
              </strong>
              <span>In Shopdesk: {list(onDevice.map((e) => e.name.toLowerCase()))}.</span>
            </>
          )}
          <span className="muted">
            This applies to visitors whose browser can run Gemini Nano. One published production app found that 41% of its users met
            Chrome's requirements, and fewer had the model downloaded. Everyone else chooses between the cloud and keeping tickets on
            their computer; replies are always written from text with personal details removed.
          </span>
        </div>
      </section>

      {(() => {
        // The route map, in the order Shopdesk meets the steps for one ticket.
        const order = ['triage', 'extract', 'pii', 'reply', 'summary'];
        const lane = (e: (typeof entries)[number]): Lane => (isDeviceRoute(e.mode) ? 'device' : 'cloud');
        const stations: Station[] = [...entries]
          .sort((a, b) => (order.indexOf(a.taskId) + 99) % 99 - (order.indexOf(b.taskId) + 99) % 99)
          .map((e) => ({
            id: e.taskId,
            label: e.name,
            detail: e.metrics.n ? `${e.metrics.acceptable} of ${e.metrics.n} good on device` : 'Not measured',
            lane: lane(e),
            state: 'done' as const,
            alt: e.mode === 'PREFER_ON_DEVICE' ? 'cloud' as const : e.mode === 'PREFER_IN_CLOUD' ? 'device' as const : undefined,
          }));
        const cross = stations.findIndex((st, i) => i > 0 && st.lane === 'cloud' && stations[i - 1].lane === 'device');
        return (
          <section className="map" aria-label="Route map">
            <div className="map-head">
              <h2>Route map</h2>
              <p>A filled dot is where a step runs. A small ring is its fallback. Click a step for its evidence.</p>
            </div>
            <Lanes
              stations={stations}
              crossing={cross >= 0 && stations[cross].id === 'reply' ? 'Personal details removed' : undefined}
              onPick={(id) => {
                setAnswers(null);
                setOpen(id);
                requestAnimationFrame(() => document.getElementById(`route-${id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
              }}
              label="Route map"
            />
          </section>
        );
      })()}

      {liveId === report.createdAt ? (
        <p className="callout info live-note"><IconInfo /> These are the routes published in Remote Config, so Shopdesk and every open copy of the app follow them.</p>
      ) : liveId ? (
        <p className="callout"><IconAlert /> This run is not the one published in Remote Config. <button className="btn link" onClick={goRuns}>Compare it with the live run</button></p>
      ) : null}
      {(() => {
        const judged = report.results.flatMap((r) => r.pairs).filter((p) => p.judgedBy);
        const self = judged.filter((p) => p.judgedBy === report.cloudModel).length;
        const reviewers = [...new Set(judged.map((p) => p.judgedBy))].filter((m) => m !== report.cloudModel);
        if (self > 0)
          return <p className="callout"><IconAlert /> {self} of {judged.length} written answers were reviewed by the model that produced the cloud answers, which can favour the cloud. Run those features again with a different reviewing model.</p>;
        if (judged.length > 0)
          return <p className="callout info"><IconInfo /> Written answers were reviewed by {reviewers.join(' and ')}, separate from the model that produced the cloud answers.</p>;
        return null;
      })()}

      {focus && !entries.some((e) => e.taskId === focus) && (
        <p className="callout"><IconAlert /> This report has no measurements for that step yet, so Shopdesk uses its safe default for it. Calibrate that step to measure it.</p>
      )}

      <section className="board" aria-label="Route for each feature">
        <div className="board-head" aria-hidden="true">
          <span>Feature</span><span>Route</span><span>Decision</span><span>Good on device</span><span>Slowest typical answer</span><span />
        </div>
        {entries.map((e) => {
          const res = report.results.find((r) => r.taskId === e.taskId);
          const isOpen = open === e.taskId;
          return (
            <div className="board-row" key={e.taskId} data-open={isOpen} id={`route-${e.taskId}`}>
              <button className="line" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : e.taskId)}>
                <span className="feature-name">{e.name}</span>
                <Junction mode={e.mode} />
                <span className={`route ${isDeviceRoute(e.mode) ? 'device' : 'cloud'}`}>{ROUTE_TEXT[e.mode]}</span>
                <span className="evidence"><b>{e.metrics.acceptable} of {e.metrics.n}</b><span>at least {pct(e.metrics.lowerBound)} at 95% confidence</span></span>
                <span className="speed"><b>{time(e.metrics.deviceP90)}</b><span>device, against {time(e.metrics.cloudP90)} in the cloud</span></span>
                <IconChevron className="chev" />
              </button>
              {isOpen && (
                <div className="detail">
                  <ul className="reasons">{e.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
                  {e.warnings.map((w) => <p className="callout" key={w}><IconAlert /> {w}</p>)}
                  <div className="figures">
                    <div><b>{pct(e.metrics.rate)}</b><span>good on device</span></div>
                    <div><b>{pct(e.metrics.lowerBound)}</b><span>lower bound, 95%</span></div>
                    <div><b>{time(e.metrics.deviceP50)}</b><span>device, median</span></div>
                    <div><b>{time(e.metrics.cloudP50)}</b><span>cloud, median</span></div>
                  </div>
                  {e.tiers.length > 0 && (
                    <div className="track">
                      <span className="muted">Quality by input length</span>
                      <div className="track-cells">
                        {e.tiers.map((t) => {
                          const pass = t.n > 0 && t.acceptable / t.n >= 0.75;
                          return (
                            <div key={t.tier} className={t.n === 0 ? '' : pass ? 'pass' : 'fail'}>
                              <b>{t.tier.toLocaleString()} words</b>
                              {t.n ? `${t.acceptable} of ${t.n} good` : 'not measured'}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {res && (
                    <div className="row">
                      <button className="btn link" onClick={() => setAnswers(answers === e.taskId ? null : e.taskId)}>
                        {answers === e.taskId ? 'Hide the answers' : `Read all ${res.pairs.length} answers side by side`}
                      </button>
                    </div>
                  )}
                  {res && answers === e.taskId && (
                    <div className="pairs">
                      {res.pairs.map((p, i) => (
                        <div className="pair" key={i}>
                          <div className="pair-head">
                            <span>Input {p.input + 1}</span>
                            <span>{p.words.toLocaleString()} words</span>
                            {p.judgedBy && <span>Reviewed by {p.judgedBy}</span>}
                            {p.note && <span>{p.note}</span>}
                          </div>
                          <div className="pair-cols">
                            <div>
                              <span className="ran device"><IconDevice /> Device, {time(p.onDevice.ms)}, score {p.deviceScore ?? 'none'}</span>
                              <pre>{p.onDevice.text || p.onDevice.error || 'No answer'}</pre>
                            </div>
                            <div>
                              <span className="ran cloud"><IconCloud /> Cloud, {time(p.cloud.ms)}, score {p.cloudScore ?? 'none'}</span>
                              <pre>{p.cloud.text || p.cloud.error || 'No answer'}</pre>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </section>

      <section className="panel">
        <div className="panel-head">
          <div className="intro">
            <h2>Ship the policy</h2>
            <p className="note">Paste the downloaded file's contents as the value of the Remote Config parameter <code>routewise_policy</code> and publish. Open copies of the app pick up the change within a minute, without a release.</p>
          </div>
          <div className="row">
            <button className="btn" onClick={() => download('routewise_policy.json', remoteConfigValue(policy))}><IconDownload /> Remote Config value</button>
            <button className="btn quiet" onClick={() => download('routewise-report.json', JSON.stringify(report, null, 2))}><IconDownload /> Save report</button>
            {loader}
          </div>
        </div>
        {importError && <p className="error">{importError}</p>}
        <div className="tabs" role="tablist" aria-label="Platform">
          {(['web', 'android'] as const).map((p) => (
            <button key={p} role="tab" aria-selected={platform === p} onClick={() => setPlatform(p)}>
              {p === 'web' ? 'Web' : 'Android'}
            </button>
          ))}
        </div>
        {platform !== 'web' && (
          <p className="callout info"><IconInfo /> These routes were measured in Chrome. The Android app in this project calibrates on the phone and reads its own parameter, <code>routewise_policy_android</code>; use the phone's routes for a phone.</p>
        )}
        <pre className="code">{platform === 'web' ? webSnippet() : kotlinSnippet(policy)}</pre>
      </section>
    </main>
  );
}
