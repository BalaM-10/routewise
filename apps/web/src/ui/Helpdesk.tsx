import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchAndActivate, getValue } from 'firebase/remote-config';
import { buildThread, createRouter, derivePolicy, nanoAvailability, parsePolicyFile, tickets, toPolicyFile, words } from '@routewise/core';
import type { Mode, PolicyFile, Report, RouteResult, Task } from '@routewise/core';
import { remoteConfig } from '../firebase';
import { ROUTE_TEXT, isDeviceRoute } from './Junction';
import { IconCloud, IconDevice, IconShield } from './Icons';

const nameOf = (pii: string[]) => pii.find((p) => !p.includes('@') && !/\d/.test(p)) ?? 'Customer';

const inbox = [
  ...tickets.slice(0, 6).map((t, i) => ({ id: `t${i}`, who: nameOf(t.pii), what: t.text, text: t.text })),
  { id: 'long', who: 'Marcus Bell', what: 'Fourteen messages about a parcel that missed its truck', text: buildThread(tickets[0], 3200) },
];

interface Consent {
  task: Task;
  reason: string;
  resolve: (ok: boolean) => void;
}

function Ran({ r }: { r: RouteResult }) {
  if (r.blocked) return <span className="ran kept"><IconShield /> Kept on this computer</span>;
  if (r.source === 'on_device') return <span className="ran device"><IconDevice /> On this computer, {r.ms} ms</span>;
  if (r.source === 'in_cloud') return <span className="ran cloud"><IconCloud /> In the cloud, {r.ms} ms</span>;
  return <span className="ran kept">No answer</span>;
}

export function Helpdesk({ report, tasks }: { report: Report | null; tasks: Task[] }) {
  const [selected, setSelected] = useState(inbox[0].id);
  const [text, setText] = useState(inbox[0].text);
  const [remote, setRemote] = useState<PolicyFile | null>(null);
  const [results, setResults] = useState<Record<string, RouteResult>>({});
  const [log, setLog] = useState<{ at: Date; r: RouteResult }[]>([]);
  const [busy, setBusy] = useState('');
  const [nano, setNano] = useState('checking');
  const [consent, setConsent] = useState<Consent | null>(null);
  const consentRef = useRef(setConsent);

  useEffect(() => {
    nanoAvailability().then(setNano);
    fetchAndActivate(remoteConfig)
      .then(() => setRemote(parsePolicyFile(getValue(remoteConfig, 'routewise_policy').asString())))
      .catch(() => undefined);
  }, []);

  const local = useMemo(() => (report ? toPolicyFile(report, derivePolicy(report)) : null), [report]);
  // Whichever is newer wins: the policy published in Remote Config or the latest calibration.
  const policy = remote && (!local || remote.createdAt >= local.createdAt) ? remote : local;
  const origin = policy === remote && remote ? 'the policy published in Remote Config' : local ? 'the latest calibration' : 'the default routes';

  const router = useMemo(
    () =>
      createRouter({
        policy,
        tasks,
        cloudModel: report?.cloudModel ?? 'gemini-3.5-flash-lite',
        askConsent: (task, reason) => new Promise<boolean>((resolve) => consentRef.current({ task, reason, resolve })),
        onResult: (r) => setLog((l) => [{ at: new Date(), r }, ...l].slice(0, 25)),
      }),
    [policy, tasks, report],
  );

  const run = async (taskId: string) => {
    setBusy(taskId);
    try {
      const r = await router.generate(taskId, text);
      setResults((x) => ({ ...x, [taskId]: r }));
    } finally {
      setBusy('');
    }
  };

  const answer = (ok: boolean) => {
    consent?.resolve(ok);
    setConsent(null);
  };

  const modeOf = (id: string): Mode | undefined => policy?.tasks[id]?.mode;

  return (
    <main className="page">
      <section className="intro">
        <h1>Helpdesk</h1>
        <p className="lede">
          A support inbox for a small online shop. Every action goes through the Routewise router, which follows {origin}.
          {nano !== 'available' && nano !== 'checking' && ' This browser has no on-device model, so device-first actions fall back to the cloud and personal data asks first.'}
        </p>
      </section>

      <div className="desk">
        <nav className="inbox" aria-label="Inbox">
          <div className="inbox-head"><span>Open tickets</span><span className="muted">{inbox.length}</span></div>
          {inbox.map((m) => (
            <button
              key={m.id}
              className="ticket"
              aria-current={selected === m.id}
              onClick={() => { setSelected(m.id); setText(m.text); setResults({}); }}
            >
              <span className="who">{m.who}</span>
              <span className="what">{m.what}</span>
            </button>
          ))}
        </nav>

        <section className="thread" aria-label="Ticket">
          <label className="field">
            Ticket, {words(text).toLocaleString()} words
            <textarea rows={7} value={text} onChange={(e) => setText(e.target.value)} />
          </label>

          <div className="toolbar" role="toolbar" aria-label="Actions">
            {tasks.map((t) => {
              const mode = modeOf(t.id);
              return (
                <button key={t.id} className="tool" onClick={() => run(t.id)} disabled={!!busy} title={mode ? ROUTE_TEXT[mode] : undefined}>
                  {mode && <span className={`dot ${isDeviceRoute(mode) ? 'device' : 'cloud'}`} aria-hidden="true" />}
                  {busy === t.id ? 'Working…' : t.name}
                </button>
              );
            })}
          </div>

          {consent && (
            <div className="consent" role="alertdialog" aria-labelledby="consent-title">
              <strong id="consent-title">Send this ticket to the cloud?</strong>
              <p className="note">{consent.reason} {consent.task.name} would send the customer's personal details to Gemini in the cloud.</p>
              <div className="row">
                <button className="btn quiet" onClick={() => answer(false)}>Keep it on this computer</button>
                <button className="btn" onClick={() => answer(true)}>Send to the cloud</button>
              </div>
            </div>
          )}

          {Object.keys(results).length === 0 && !consent && (
            <p className="muted">Choose an action. The answer appears here with where it ran and why.</p>
          )}
          {tasks.filter((t) => results[t.id]).map((t) => {
            const r = results[t.id];
            return (
              <article className="answer" key={t.id}>
                <div className="answer-head">
                  <h3>{t.name}</h3>
                  <Ran r={r} />
                </div>
                {r.error ? <p className="error">{r.error}</p> : r.text && <pre>{r.text}</pre>}
                <p className="why">{r.escalated ? 'Escalated. ' : ''}{r.reason}</p>
              </article>
            );
          })}
        </section>
      </div>

      <section className="panel">
        <h2>Routing log</h2>
        {log.length === 0 ? (
          <p className="muted">Each action is listed here with where it ran and why.</p>
        ) : (
          <ol className="log">
            {log.map(({ at, r }, i) => (
              <li key={i}>
                <span className="muted">{at.toLocaleTimeString()}</span>
                <Ran r={r} />
                <span><b>{tasks.find((t) => t.id === r.taskId)?.name}</b>. {r.reason}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}
