import { useEffect, useRef, useState } from 'react';
import { calibrate, mergeReports, nanoAvailability, prepareOnDevice, tickets } from '@routewise/core';
import type { Progress, Report, Task } from '@routewise/core';
import { appCheckConfigured } from '../firebase';
import type { SaveMeta } from '../App';
import { IconAlert } from './Icons';

const ON_DEVICE_MODELS = ['Gemini Nano (Chrome default)', 'Gemma 4 (Gemma 4 for Built-in AI flag)'];
const CLOUD_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.8-flash'];
/** Each model has its own daily free-tier allowance, so reviews spread across them. */
const JUDGE_MODELS = ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.1-flash-lite', 'gemini-3.5-flash-lite'];
const SEP = '\n---\n';

const STATUS_TEXT: Record<string, string> = {
  available: 'Gemini Nano is ready in this browser.',
  downloadable: 'Gemini Nano can be downloaded in this browser.',
  downloading: 'Gemini Nano is downloading.',
  unavailable: 'Gemini Nano cannot run in this browser.',
  unsupported: 'This browser has no on-device model.',
  unknown: 'Could not check for an on-device model.',
  checking: 'Checking for an on-device model…',
};

const scoringText = (t: Task) =>
  t.scoring === 'judge' ? 'Reviewed by a cloud model' : t.scoring === 'gold-masking' || t.scoring === 'gold-redaction' ? 'Checked for leaked details' : 'Checked against known answers';

export function Calibrate(props: { tasks: Task[]; setTasks: (t: Task[]) => void; base: Report | null; onReport: (r: Report, meta: SaveMeta) => void }) {
  const { tasks, setTasks, base, onReport } = props;
  const [nano, setNano] = useState('checking');
  const [download, setDownload] = useState<number | null>(null);
  const [ready, setReady] = useState(false);
  const [cloudModel, setCloudModel] = useState(CLOUD_MODELS[0]);
  const [onDeviceModel, setOnDeviceModel] = useState(() => {
    try { return localStorage.getItem('routewise.onDeviceModel') ?? ''; } catch { return ''; }
  });
  const chooseOnDeviceModel = (v: string) => {
    setOnDeviceModel(v);
    try { localStorage.setItem('routewise.onDeviceModel', v); } catch { /* the choice is only a convenience */ }
  };
  const [judgeModel, setJudgeModel] = useState(JUDGE_MODELS[0]);
  const [rpm, setRpm] = useState(9);
  const [progress, setProgress] = useState<Progress | null>(null);
  // A refresh or closing the tab ends a run and loses the feature in progress, so the browser asks first.
  useEffect(() => {
    if (!progress) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [!!progress]);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [mergeRun, setMergeRun] = useState(true);
  const abort = useRef<AbortController | null>(null);
  const [enabled, setEnabled] = useState<Record<string, boolean>>(Object.fromEntries(tasks.map((t) => [t.id, true])));

  useEffect(() => {
    nanoAvailability().then((s) => {
      setNano(s);
      if (s === 'available') setReady(true);
    });
  }, []);

  const startModel = async () => {
    setError('');
    try {
      await prepareOnDevice(cloudModel, setDownload);
      const s = await nanoAvailability();
      setNano(s);
      setReady(s === 'available');
    } catch (e) {
      setError(`Gemini Nano did not start: ${e instanceof Error ? e.message : e}`);
    }
  };

  const run = async () => {
    setError('');
    abort.current = new AbortController();
    try {
      const chosen = tasks.filter((t) => enabled[t.id]);
      const judgeFallbacks = JUDGE_MODELS.filter((m) => m !== judgeModel && m !== cloudModel);
      const partial = chosen.length < tasks.length;
      // Results kept from earlier runs: only when some features are left out and the owner asked to keep them.
      const keep = base && partial && mergeRun ? base : null;
      const save = (r: Report, partialSave: boolean) =>
        onReport(keep ? mergeReports(keep, r, tasks.map((t) => t.id)) : r, { show: !partialSave, partial: partialSave, mergedFrom: keep?.createdAt });
      const fresh = await calibrate(chosen, {
        cloudModel, judgeModel, judgeFallbacks, cloudRpm: rpm, onProgress: setProgress, signal: abort.current.signal,
        onDeviceModel: onDeviceModel || undefined,
        // Each finished feature is saved at once, so a stopped run keeps what it completed.
        onTaskDone: (r) => { if (r.tasks.length < chosen.length) save(r, true); },
      });
      save(fresh, false);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProgress(null);
    }
  };

  const update = (id: string, patch: Partial<Task>) => setTasks(tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  const addTask = () => {
    const id = `custom-${Date.now().toString(36)}`;
    setTasks([
      ...tasks,
      {
        id,
        name: 'New feature',
        instruction: 'Say what the model should do with the text.',
        inputs: [{ text: 'Paste a realistic example here. Put a line with only --- between examples.' }],
        validator: { kind: 'text', maxWords: 150 },
        scoring: 'judge',
        sensitive: false,
        latencyBudgetMs: 5000,
      },
    ]);
    setEnabled({ ...enabled, [id]: true });
    setOpen(id);
  };

  const chosen = tasks.filter((t) => enabled[t.id]);
  const inputs = chosen.reduce((n, t) => n + t.inputs.length, 0);
  // One cloud answer per example, plus one review for each written answer.
  const requests = inputs + chosen.filter((t) => t.scoring === 'judge').reduce((n, t) => n + t.inputs.length, 0);
  const blocked = nano === 'unsupported' || nano === 'unavailable';

  return (
    <main className="page">
      <section className="head">
      <div className="intro">
        <h1>Calibrate</h1>
        <p className="lede">
          Every example below runs once on the on-device model in this browser (Gemini Nano, or Gemma 4 with its Chrome flag) and once in the cloud, both through Firebase AI Logic. The
          answers are scored, and each feature gets a route backed by what was measured.
        </p>
      </div>

      <aside className="panel status-panel" aria-label="This browser">
        <div className="status">
          <span className={`lamp ${nano === 'available' ? 'go' : blocked ? 'stop' : ''}`} />
          {STATUS_TEXT[nano] ?? `On-device model: ${nano}.`}
        </div>
        {blocked && (
          <p className="note">Many of your users will be in the same position. Calibrate in desktop Chrome on supported hardware; the Routes page already shows results recorded on such a machine.</p>
        )}
        {!appCheckConfigured && <p className="callout"><IconAlert /> App Check is not set up, so cloud requests will be refused. The README explains the setup.</p>}
        {!ready && !blocked && nano !== 'checking' && (
          <div className="row">
            <button className="btn" onClick={startModel}>Prepare Gemini Nano</button>
            {download !== null && <span className="muted">Downloading, {Math.round(download * 100)}%</span>}
          </div>
        )}
      </aside>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div className="intro">
            <h2>Features</h2>
            <p className="note">The five AI steps Shopdesk uses, tested on {tickets.length} fictional support tickets: tidy and messy, with typos, shouting, missing order numbers, phone numbers from several countries and messages that are not about an order. Replies are tested on tickets with personal details already hidden, exactly as Shopdesk sends them.</p>
          </div>
          <button className="btn quiet" onClick={addTask}>Add a feature</button>
        </div>
        <div className="features">
          {tasks.map((t) => (
            <div className="feature" key={t.id}>
              <div className="feature-line">
                <input type="checkbox" aria-label={`Include ${t.name}`} checked={!!enabled[t.id]} onChange={(e) => setEnabled({ ...enabled, [t.id]: e.target.checked })} />
                <span className="feature-name">{t.name}</span>
                <span className="feature-meta">
                  {t.inputs.length} examples, {scoringText(t).toLowerCase()}
                  {t.sensitive ? ', personal data' : ''}
                </span>
                <button className="btn link" onClick={() => setOpen(open === t.id ? null : t.id)}>{open === t.id ? 'Done' : 'Edit'}</button>
              </div>
              {open === t.id && (
                <div className="editor">
                  <label className="field">Name<input type="text" value={t.name} onChange={(e) => update(t.id, { name: e.target.value })} /></label>
                  <label className="field">Instruction<textarea rows={3} value={t.instruction} onChange={(e) => update(t.id, { instruction: e.target.value })} /></label>
                  <label className="field">
                    Examples, separated by a line with only ---
                    <textarea
                      rows={6}
                      value={t.inputs.map((i) => i.text).join(SEP)}
                      onChange={(e) => {
                        const texts = e.target.value.split(/\n---\n/);
                        update(t.id, {
                          inputs: texts.map((text, i) => (t.inputs[i] && t.inputs[i].text === text ? t.inputs[i] : { text, tier: t.inputs[i]?.tier })),
                        });
                      }}
                    />
                  </label>
                  <p className="muted">An edited example loses its known answer and is reviewed by a cloud model instead.</p>
                  <div className="row">
                    <label className="check"><input type="checkbox" checked={t.sensitive} onChange={(e) => update(t.id, { sensitive: e.target.checked })} /> Handles personal data</label>
                    <label className="field">Slowest acceptable answer (ms)<input type="number" min={100} step={100} value={t.latencyBudgetMs} onChange={(e) => update(t.id, { latencyBudgetMs: Number(e.target.value) })} /></label>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>Run</h2>
        <div className="row">
          <label className="field">Cloud model
            <select value={cloudModel} onChange={(e) => setCloudModel(e.target.value)}>{CLOUD_MODELS.map((m) => <option key={m}>{m}</option>)}</select>
          </label>
          <label className="field">Reviewing model
            <select value={judgeModel} onChange={(e) => setJudgeModel(e.target.value)}>{JUDGE_MODELS.map((m) => <option key={m}>{m}</option>)}</select>
          </label>
          <label className="field">On-device model
            <select value={onDeviceModel} onChange={(e) => chooseOnDeviceModel(e.target.value)}>
              <option value="">Not recorded</option>
              {ON_DEVICE_MODELS.map((m) => <option key={m}>{m}</option>)}
            </select>
          </label>
          <label className="field">Cloud requests a minute
            <input type="number" min={1} max={1000} value={rpm} onChange={(e) => setRpm(Math.max(1, Number(e.target.value)))} />
          </label>
        </div>
        <p className="note">
          Chrome does not tell a page which on-device model answers. Check chrome://on-device-internals, Broker State: Gemma 4 is in use when the
          "Gemma 4 for Built-in AI" flag is on and gemma4_component is Ready; otherwise it is Gemini Nano. The choice is saved with the run.
        </p>
        <p className="note">
          {inputs} examples need about {requests} cloud requests, which takes about {Math.ceil(requests / rpm)} {Math.ceil(requests / rpm) === 1 ? 'minute' : 'minutes'} at {rpm} a minute.
          Written answers are reviewed by {judgeModel}; when its daily allowance runs out, the next model takes over, and the cloud model never reviews its own answers unless every other one is unavailable.
          Free-tier allowances: 500 a day for the flash-lite models, 20 a day for gemini-3.8-flash and gemini-3.6-flash. Use made-up or consented data only.
        </p>
        {base && chosen.length < tasks.length && (
          <label className="check">
            <input type="checkbox" checked={mergeRun} onChange={(e) => setMergeRun(e.target.checked)} />
            Keep the current results for the features left out
          </label>
        )}
        <div className="row">
          <button className="btn" onClick={run} disabled={!ready || !!progress || chosen.length === 0}>Run calibration</button>
          {progress && <button className="btn quiet" onClick={() => abort.current?.abort()}>Stop</button>}
          {!ready && !blocked && <span className="muted">Prepare Gemini Nano first.</span>}
        </div>
        {progress && (
          <div aria-live="polite" className="progress">
            <div className="meter"><div style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} /></div>
            <span className="muted">{progress.done} of {progress.total}. {progress.label}</span>
            <ul className="progress-features">
              {(() => {
                // The first step is the warm-up; after it, examples run feature by feature in this order.
                let left = Math.max(0, progress.done - 1);
                return chosen.map((t) => {
                  const n = t.inputs.length;
                  const d = Math.min(left, n);
                  left -= d;
                  return (
                    <li key={t.id} className={d === n ? 'done' : d > 0 ? 'running' : ''}>
                      <span>{t.name}</span>
                      <span className="meter"><span style={{ width: `${(d / n) * 100}%` }} /></span>
                      <span className="muted">{d} of {n}</span>
                    </li>
                  );
                });
              })()}
            </ul>
          </div>
        )}
        {error && <p className="error">{error}</p>}
      </section>
    </main>
  );
}
