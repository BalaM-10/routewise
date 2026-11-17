import { useEffect, useMemo, useRef, useState } from 'react';
import {
  buildThread, composeReplyInput, createRoutewise, derivePolicy, findOrder, guessHiddenType, leftoverTokens, mask, maskWith, mergeEntities, nanoAvailability, orderFacts, orderIdIn,
  normalizeLabel, prepareOnDevice, stripFences, tickets, toPolicyFile, unmask, words,
} from '@routewise/core';
import type { Entity, Masked, PolicyFile, Report, RouteResult, Task, Voice } from '@routewise/core';
import { IconCloud, IconDevice, IconShield, IconUpload } from './Icons';
import { Lanes } from './Lanes';
import type { Lane, Station } from './Lanes';
import { ai } from '../firebase';

interface Ticket { id: string; who: string; text: string }

const nameOf = (pii: string[]) => pii.find((p) => !p.includes('@') && !/\d/.test(p)) ?? 'Customer';
const SAMPLES: Ticket[] = [
  // A realistic morning: tidy and messy tickets, including one shouting and one that is not about an order.
  ...[0, 1, 2, 3, 16, 19, 24, 25, 47].map((n) => ({ id: `s${n}`, who: nameOf(tickets[n].pii), text: tickets[n].text })),
  { id: 'thread', who: 'Marcus Bell', text: buildThread(tickets[0], 1200) },
];
const LABELS: Record<string, string> = { shipping: 'Shipping', refund: 'Refund', product: 'Product', account: 'Account', other: 'Other' };
const TYPE_TEXT: Record<string, string> = { name: 'Name', email: 'Email', phone: 'Phone', address: 'Address', detail: 'Detail' };
const LONG = 250;

// Owner conveniences kept in this browser only. Tickets themselves are never stored.
const VOICE_KEY = 'routewise.voice';
const RESOLVED_KEY = 'routewise.resolved';
const DEFAULT_VOICE: Voice = { shop: 'Hearth & Grain', signOff: 'The Hearth & Grain team', tone: 'warm' };
function readStored<T>(key: string, fallback: T): T {
  try { const raw = localStorage.getItem(key); return raw ? (JSON.parse(raw) as T) : fallback; } catch { return fallback; }
}
function store(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable: kept for this visit only */ }
}

type Kind = 'reply' | 'summary';
interface Draft {
  kind: Kind;
  /** Found by rules only, because no on-device model could look for names and addresses. */
  rulesOnly?: boolean;
  leftovers?: string[];
  /** Facts from the shop's order system sent with the reply; no personal details. */
  facts?: string[];
  /** Exactly what the cloud receives. */
  input?: string;
  stage: 'finding' | 'review' | 'writing' | 'done' | 'stopped' | 'cancelled';
  find?: RouteResult;
  entities?: Entity[];
  masked?: Masked;
  write?: RouteResult;
  text?: string;
  message?: string;
}
interface Consent { task: Task; reason: string; resolve: (ok: boolean) => void }
interface Order { order_id?: string; product?: string; issue?: string }

function Ran({ r }: { r: RouteResult }) {
  if (r.blocked) return <span className="ran kept"><IconShield /> Kept on this computer</span>;
  if (r.source === 'on_device') return <span className="ran device"><IconDevice /> On this computer, {r.ms} ms</span>;
  if (r.source === 'in_cloud') return <span className="ran cloud"><IconCloud /> In the cloud, {r.ms} ms</span>;
  return <span className="ran kept">No answer</span>;
}

export function Shopdesk({ report, tasks, onWhy, remote, routesNote }: {
  report: Report | null;
  tasks: Task[];
  onWhy: (taskId: string) => void;
  /** Routes published in Remote Config. */
  remote: PolicyFile | null;
  routesNote: string;
}) {
  const [inbox, setInbox] = useState<Ticket[]>(SAMPLES);
  const [selected, setSelected] = useState(() => {
    const done = readStored(RESOLVED_KEY, [] as string[]);
    return (SAMPLES.find((t) => !done.includes(t.id)) ?? SAMPLES[0]).id;
  });
  const [labels, setLabels] = useState<Record<string, RouteResult | 'working'>>({});
  const [orders, setOrders] = useState<Record<string, { r: RouteResult; order: Order | null } | 'working'>>({});
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [log, setLog] = useState<{ at: Date; r: RouteResult }[]>([]);
  const [hiddenCount, setHiddenCount] = useState(0);
  const [extra, setExtra] = useState('');
  const [adding, setAdding] = useState(false);
  const [pasted, setPasted] = useState('');
  const [nano, setNano] = useState('checking');
  // One decision per visit when this browser has no on-device model: null means not asked yet.
  const [cloudOk, setCloudOk] = useState<boolean | null>(null);
  const cloudOkRef = useRef<boolean | null>(null);
  cloudOkRef.current = cloudOk;
  const [queue, setQueue] = useState<Consent[]>([]);
  const consent = queue[0] ?? null;
  const [preparing, setPreparing] = useState<number | null>(null);
  const [voice, setVoice] = useState<Voice>(() => readStored(VOICE_KEY, DEFAULT_VOICE));
  const [editingVoice, setEditingVoice] = useState(false);
  const [resolved, setResolved] = useState<string[]>(() => readStored(RESOLVED_KEY, [] as string[]));
  const [view, setView] = useState<'open' | 'resolved'>('open');
  const [copied, setCopied] = useState('');
  const replyRef = useRef<HTMLTextAreaElement | null>(null);
  const sorting = useRef(false);

  useEffect(() => {
    nanoAvailability().then(setNano);
  }, []);

  const local = useMemo(() => (report ? toPolicyFile(report, derivePolicy(report)) : null), [report]);
  const policy = remote && (!local || remote.createdAt >= local.createdAt) ? remote : local;
  const origin = policy === remote && remote ? 'the policy published in Remote Config' : local ? 'the latest calibration' : 'the default routes';

  // Shopdesk uses Routewise the way any app would: as a plugin, with its five features and the live routes.
  const routewise = useMemo(
    () =>
      createRoutewise({
        ai,
        policy,
        features: tasks,
        cloudModel: report?.cloudModel ?? 'gemini-3.5-flash-lite',
        askConsent: (task, reason) =>
          cloudOkRef.current !== null
            ? Promise.resolve(cloudOkRef.current)
            : new Promise<boolean>((resolve) => setQueue((q) => [...q, { task, reason, resolve }])),
        onResult: (r) => setLog((l) => [{ at: new Date(), r }, ...l].slice(0, 40)),
      }),
    [policy, tasks, report],
  );
  const router = useMemo(() => ({ generate: routewise.run }), [routewise]);
  const has = (id: string) => tasks.some((t) => t.id === id);
  const deviceReady = nano === 'available';
  // Automatic steps read the raw ticket, so without an on-device model they wait for the visit decision.
  const mayRun = deviceReady || cloudOk === true;

  // New tickets are sorted one at a time as they arrive.
  useEffect(() => {
    if (sorting.current || !has('triage') || !mayRun) return;
    const next = inbox.find((t) => !labels[t.id]);
    if (!next) return;
    sorting.current = true;
    setLabels((l) => ({ ...l, [next.id]: 'working' }));
    router.generate('triage', next.text).then((r) => {
      setLabels((l) => ({ ...l, [next.id]: r }));
      sorting.current = false;
    });
  }, [inbox, labels, router, mayRun]);

  const ticket = inbox.find((t) => t.id === selected) ?? inbox[0];

  // Opening a ticket reads its order details.
  useEffect(() => {
    if (!ticket || orders[ticket.id] || !has('extract') || !mayRun) return;
    setOrders((o) => ({ ...o, [ticket.id]: 'working' }));
    router.generate('extract', ticket.text).then((r) => {
      let order: Order | null = null;
      try { order = r.text ? (JSON.parse(stripFences(r.text)) as Order) : null; } catch { order = null; }
      setOrders((o) => ({ ...o, [ticket.id]: { r, order } }));
    });
  }, [ticket?.id, router, mayRun]);

  const key = (kind: Kind) => `${ticket.id}:${kind}`;
  const setDraft = (k: string, d: Draft) => setDrafts((x) => ({ ...x, [k]: d }));

  const write = async (k: string, d: Draft) => {
    setDraft(k, { ...d, stage: 'writing' });
    const r = await router.generate(d.kind === 'reply' ? 'reply' : 'summary', d.input ?? d.masked!.text);
    if (!r.text) {
      setDraft(k, { ...d, stage: 'stopped', write: r, message: r.error ? `The cloud request failed: ${r.error}` : r.reason });
      return;
    }
    setHiddenCount((n) => n + d.masked!.hidden.length);
    const text = unmask(r.text, d.masked!.map);
    setDraft(k, { ...d, stage: 'done', write: r, text, leftovers: leftoverTokens(text) });
  };

  // Personal details are found by the model, then replaced and restored by plain code.
  const privateCloud = async (kind: Kind) => {
    const k = key(kind);
    setDraft(k, { kind, stage: 'finding' });
    // The plugin finds the details on the device and replaces them. Without an on-device model, or with an
    // answer that is not the expected JSON, only emails and phone numbers are found (by their shape), and the
    // owner adds names and addresses by hand before anything is sent.
    let prepared;
    try {
      prepared = await routewise.prepare(ticket.text);
    } catch (e) {
      setDraft(k, { kind, stage: 'stopped', message: `Personal details could not be checked: ${e instanceof Error ? e.message : String(e)}` });
      return;
    }
    const { find, rulesOnly, entities, masked: m } = prepared;
    // The order is looked up by plain code: the number the order step read, or a pattern match.
    const o = orders[ticket.id];
    const readId = o && o !== 'working' ? o.order?.order_id : '';
    const record = findOrder(readId || orderIdIn(ticket.text));
    const facts = kind === 'reply' && record ? orderFacts(record) : [];
    const input = kind === 'reply' ? composeReplyInput(m.text, facts?.map((f) => maskWith(f, m.map)), voice) : m.text;
    const d: Draft = { kind, stage: 'review', find, rulesOnly, entities, masked: m, facts, input };
    setDraft(k, d);
    // Nothing goes to the cloud until the owner has seen exactly what will be sent: a detail the model
    // missed can only be caught by a person, so every draft stops here.
  };

  const addDetail = (k: string, d: Draft) => {
    const v = extra.trim();
    if (!v) return;
    const entities = mergeEntities(d.entities ?? [], [{ type: guessHiddenType(v), value: v }]);
    const m = mask(ticket.text, entities);
    setDraft(k, { ...d, entities, masked: m, input: d.kind === 'reply' ? composeReplyInput(m.text, d.facts?.map((f) => maskWith(f, m.map)), voice) : m.text });
    setExtra('');
  };

  const addTickets = () => {
    const parts = pasted.split(/\n\s*---\s*\n/).map((p) => p.trim()).filter(Boolean);
    if (!parts.length) return;
    const start = inbox.filter((t) => t.id.startsWith('u')).length;
    const added = parts.map((text, i) => ({ id: `u${start + i}`, who: `Your ticket ${start + i + 1}`, text }));
    setInbox((x) => [...added, ...x]);
    setSelected(added[0].id);
    setPasted('');
    setAdding(false);
  };

  const answer = (ok: boolean, forVisit: boolean) => {
    if (forVisit) {
      setCloudOk(ok);
      queue.forEach((c) => c.resolve(ok));
      setQueue([]);
    } else {
      consent?.resolve(ok);
      setQueue((q) => q.slice(1));
    }
  };

  const prepare = async () => {
    setPreparing(0);
    try {
      await prepareOnDevice(report?.cloudModel ?? 'gemini-3.5-flash-lite', (p) => setPreparing(p));
    } catch { /* the status below shows what happened */ }
    setNano(await nanoAvailability());
    setPreparing(null);
  };

  const onDevice = log.filter((e) => e.r.source === 'on_device').length;
  const inCloud = log.filter((e) => e.r.source === 'in_cloud').length;
  const label = labels[ticket.id];
  const order = orders[ticket.id];

  // The trace of this ticket: each step on the lane where it ran, or where its route will send it.
  const plannedLane = (id: string): Lane => {
    const mode = policy?.tasks[id]?.mode;
    if (mode) return mode === 'PREFER_ON_DEVICE' || mode === 'ONLY_ON_DEVICE' ? 'device' : 'cloud';
    return tasks.find((t) => t.id === id)?.sensitive ? 'device' : 'cloud';
  };
  const station = (id: string, name: string, r: RouteResult | 'working' | undefined): Station => {
    if (r === 'working') return { id, label: name, detail: 'Running', lane: plannedLane(id), state: 'active' };
    if (!r) return { id, label: name, detail: 'Not run yet', lane: plannedLane(id), state: 'planned' };
    if (r.blocked) return { id, label: name, detail: 'Kept here', lane: 'device', state: 'kept' };
    if (r.source === 'in_cloud') return { id, label: name, detail: `${r.ms.toLocaleString()} ms`, lane: 'cloud', state: 'done' };
    if (r.source === 'on_device') return { id, label: name, detail: `${r.ms.toLocaleString()} ms`, lane: 'device', state: 'done' };
    return { id, label: name, detail: 'No answer', lane: plannedLane(id), state: 'planned' };
  };
  const traceDraft = drafts[key('reply')] ?? drafts[key('summary')];
  const writeKind = traceDraft?.kind ?? 'reply';
  // Without Gemini Nano and with tickets kept here, sorting and order reading are off for this visit.
  const off = (st: Station): Station => (!deviceReady && cloudOk === false && st.state === 'planned' ? { ...st, detail: 'Off this visit' } : st);
  const findStation = station('pii', 'Find personal details', traceDraft?.stage === 'finding' ? 'working' : traceDraft?.find);
  const trace: Station[] = [
    off(station('triage', 'Sort', label)),
    off(station('extract', 'Read the order', order === 'working' ? 'working' : order?.r)),
    traceDraft?.rulesOnly ? { ...findStation, lane: 'device', state: 'kept', detail: 'By rules, on this computer' } : findStation,
    traceDraft?.stage === 'cancelled'
      ? { id: writeKind, label: writeKind === 'reply' ? 'Write the reply' : 'Summarise', detail: 'Cancelled, nothing sent', lane: 'device', state: 'kept' }
      : station(writeKind, writeKind === 'reply' ? 'Write the reply' : 'Summarise', traceDraft?.stage === 'writing' ? 'working' : traceDraft?.write),
  ];
  const firstCross = trace.findIndex((t, i) => i > 0 && t.lane === 'cloud' && trace[i - 1].lane === 'device');
  // Only the writing step receives masked text; any other crossing would carry the ticket as written.
  const crossing = firstCross === 3 ? 'Personal details removed' : undefined;
  const total = onDevice + inCloud;
  // Steps that read the ticket as written; if any ran in the cloud, the visit did send personal details there.
  const rawToCloud = log.some((e) => e.r.source === 'in_cloud' && ['triage', 'extract', 'pii'].includes(e.r.taskId));

  const copyReply = async (id: string) => {
    try {
      await navigator.clipboard.writeText(replyRef.current?.value ?? '');
      setCopied(id);
    } catch {
      // Clipboard access refused: select the text so Ctrl+C copies it.
      replyRef.current?.select();
      setCopied(`${id}:select`);
    }
    setTimeout(() => setCopied(''), 3000);
  };
  const toggleResolved = (id: string) => {
    setResolved((r) => { const next = r.includes(id) ? r.filter((x) => x !== id) : [...r, id]; store(RESOLVED_KEY, next); return next; });
  };
  const saveVoice = (v: Voice) => { setVoice(v); store(VOICE_KEY, v); };
  const visible = inbox.filter((t) => (view === 'resolved') === resolved.includes(t.id));
  // The open ticket always belongs to the list on screen: on load, after resolving one, and when switching lists.
  useEffect(() => {
    if (visible.length > 0 && !visible.some((t) => t.id === selected)) setSelected(visible[0].id);
  }, [visible.map((t) => t.id).join(','), selected]);

  const Why = ({ id }: { id: string }) => <button className="btn link why-link" onClick={() => onWhy(id)}>Why?</button>;

  const renderDraft = (kind: Kind) => {
    const k = key(kind);
    const d = drafts[k];
    if (!d || d.stage === 'cancelled') return null;
    const title = kind === 'reply' ? 'Reply' : 'Summary';
    return (
      <article className="answer" key={k}>
        <div className="answer-head"><h3>{title}</h3></div>
        {d.stage === 'finding' && <p className="muted">Finding personal details in the ticket…</p>}
        {d.stage === 'review' && d.masked && (
          <div className="review">
            {d.rulesOnly && (
              <p className="callout">
                Without an on-device model, only emails and phone numbers are found automatically, by their shape. Add the customer's name and
                address below before sending; nothing goes to the cloud until you choose to.
              </p>
            )}
            <p className="note">
              {d.masked.hidden.length
                ? d.masked.hidden.length === 1
                  ? 'This detail will be replaced before anything goes to the cloud, and put back afterwards:'
                  : `These ${d.masked.hidden.length} details will be replaced before anything goes to the cloud, and put back afterwards:`
                : 'No personal details were found. Check the text below before it goes to the cloud.'}
            </p>
            {d.masked.hidden.length > 0 && (
              <ul className="hidden-list">
                {d.masked.hidden.map((e) => <li key={e.value}><span>{TYPE_TEXT[e.type]}</span>{e.value}</li>)}
              </ul>
            )}
            {d.masked.missed.length > 0 && (
              <p className="callout">
                The model also named {d.masked.missed.map((e) => `"${e.value}"`).join(', ')}, but {d.masked.missed.length === 1 ? 'it was' : 'they were'} not
                found in the ticket as written, so nothing was hidden for {d.masked.missed.length === 1 ? 'it' : 'them'}. Check the text below and hide anything that is still there.
              </p>
            )}
            {d.kind === 'reply' && (
              d.facts && d.facts.length > 0 ? (
                <div className="facts">
                  <span className="muted">Order facts from your order system, sent with it so the reply states only what is true:</span>
                  <ul>{d.facts.map((f) => <li key={f}>{f}</li>)}</ul>
                </div>
              ) : (
                <p className="muted">No matching order was found, so the reply will not mention order details.</p>
              )
            )}
            <details>
              <summary>Show exactly what the cloud will receive</summary>
              <pre className="code">{d.input ?? d.masked.text}</pre>
            </details>
            <div className="row">
              <input type="text" placeholder="Hide something else, for example a nickname" value={extra} onChange={(e) => setExtra(e.target.value)} aria-label="Another detail to hide" />
              <button className="btn quiet" onClick={() => addDetail(k, d)}>Hide it</button>
            </div>
            <div className="row">
              <button className="btn" onClick={() => write(k, d)}>{kind === 'reply' ? 'Write the reply in the cloud' : 'Summarise in the cloud'}</button>
              <button className="btn quiet" onClick={() => setDraft(k, { ...d, stage: 'cancelled' })}>Cancel</button>
            </div>
          </div>
        )}
        {d.stage === 'writing' && <p className="muted">{kind === 'reply' ? 'Writing the reply in the cloud…' : 'Summarising in the cloud…'}</p>}
        {d.stage === 'done' && (
          <>
            <textarea rows={kind === 'reply' ? 8 : 4} defaultValue={d.text} aria-label={title} ref={kind === 'reply' ? replyRef : undefined} />
            {kind === 'reply' && (
              <div className="row">
                <button className="btn" onClick={() => copyReply(ticket.id)}>{copied === ticket.id ? 'Copied' : 'Copy reply'}</button>
                {copied === `${ticket.id}:select` && <span className="muted">Text selected. Press Ctrl+C to copy.</span>}
                {!resolved.includes(ticket.id) && <button className="btn quiet" onClick={() => toggleResolved(ticket.id)}>Mark resolved</button>}
                <span className="muted">You send it from your own email; Shopdesk never sends anything to a customer.</span>
              </div>
            )}
            {d.leftovers && d.leftovers.length > 0 && (
              <p className="callout">The answer contains {d.leftovers.join(', ')}, which does not match a hidden detail. Edit it before sending.</p>
            )}
            <p className="note">
              {d.find?.source === 'on_device'
                ? `${d.masked!.hidden.length} personal details were found on this computer and replaced before the cloud saw the ticket, then put back here.`
                : d.rulesOnly
                  ? `${d.masked!.hidden.length} personal details were replaced before the cloud saw the ticket: found by rules and by you, without any model reading the ticket.`
                  : `${d.masked!.hidden.length} personal details were replaced before the ${kind === 'reply' ? 'reply' : 'summary'} was written. Finding them used the cloud, which you agreed to for this visit.`}
            </p>
          </>
        )}
        {d.stage === 'stopped' && <p className="error">{d.message}</p>}
        {(d.find || d.write) && (
          <div className="trail">
            {d.find && <div><span>Personal details</span><Ran r={d.find} /><Why id="pii" /></div>}
            {d.write && <div><span>{title}</span><Ran r={d.write} /><Why id={kind} /></div>}
          </div>
        )}
      </article>
    );
  };

  return (
    <main className="page">
      <section className="head">
      <div className="intro">
        <h1>Shopdesk</h1>
        <p className="lede">
          The example app: the support inbox of a small online shop, following the routes Routewise picked. Tickets are sorted and
          read on this computer. Replies are written in the cloud with the customer's name, email, phone number and address replaced,
          and you see exactly what is sent.
        </p>
        <p className="meta">
          Routes come from {origin}. {routesNote}{' '}
          Replies are written for {voice.shop}. <button className="btn link" onClick={() => setEditingVoice(!editingVoice)}>{editingVoice ? 'Done' : 'Change shop voice'}</button>
        </p>
        {editingVoice && (
          <div className="row voice">
            <label className="field">Shop name<input type="text" value={voice.shop} onChange={(e) => saveVoice({ ...voice, shop: e.target.value })} /></label>
            <label className="field">Sign off as<input type="text" value={voice.signOff} onChange={(e) => saveVoice({ ...voice, signOff: e.target.value })} /></label>
            <label className="field">Tone
              <select value={voice.tone} onChange={(e) => saveVoice({ ...voice, tone: e.target.value as Voice['tone'] })}>
                <option value="warm">Warm</option><option value="formal">Formal</option><option value="brief">Brief</option>
              </select>
            </label>
          </div>
        )}
      </div>
        <aside className="ledger" aria-label="This visit">
          <div className="ledger-keys">
            <span className="device"><b>{onDevice}</b>{onDevice === 1 ? 'step' : 'steps'} on this computer</span>
            <span className="cloud"><b>{inCloud}</b>{inCloud === 1 ? 'step' : 'steps'} in the cloud</span>
          </div>
          <div className="ledger-bar" role="img" aria-label={`${onDevice} of ${total} steps ran on this computer`}>
            <span className="device" style={{ flexGrow: total ? onDevice : 0 }} />
            <span className="cloud" style={{ flexGrow: total ? inCloud : 0 }} />
          </div>
          <p className="ledger-note">
            <IconShield />
            {rawToCloud
              ? `${hiddenCount} personal ${hiddenCount === 1 ? 'detail' : 'details'} masked before writing; tickets went to the cloud as written for other steps, as you agreed`
              : `${hiddenCount} personal ${hiddenCount === 1 ? 'detail' : 'details'} kept out of the cloud this visit`}
          </p>
        </aside>
      </section>

      {!deviceReady && nano !== 'checking' && cloudOk === null && (
        <section className="panel decision">
          <h2>{nano === 'downloadable' || nano === 'downloading' ? 'Gemini Nano is not ready in this browser yet' : 'This browser has no on-device model'}</h2>
          <p className="note">
            Sorting tickets and reading order details normally happen on this computer. Without Gemini Nano, they need the cloud, which means
            sending the tickets as written. Replies are always written from text with personal details removed.
          </p>
          <div className="row">
            {(nano === 'downloadable' || nano === 'downloading') && (
              <button className="btn" onClick={prepare} disabled={preparing !== null}>
                {preparing !== null ? `Preparing Gemini Nano, ${Math.round(preparing * 100)}%` : 'Prepare Gemini Nano'}
              </button>
            )}
            <button className="btn quiet" onClick={() => answer(true, true)}>Use the cloud for this visit</button>
            <button className="btn quiet" onClick={() => answer(false, true)}>Keep tickets on this computer</button>
          </div>
        </section>
      )}
      {!deviceReady && cloudOk === false && (
        <p className="callout info">Tickets stay on this computer for this visit. Sorting and order details are off; replies still work, with personal details hidden before sending.</p>
      )}


      {adding && (
        <section className="panel">
          <h2>Add your own tickets</h2>
          <p className="note">Paste one or more tickets, with a line containing only --- between them. They are kept only in this browser tab and are gone when you close it; drafting a reply sends them to the cloud with personal details replaced, as for any ticket.</p>
          <textarea rows={6} value={pasted} onChange={(e) => setPasted(e.target.value)} aria-label="Tickets to add" />
          <div className="row">
            <button className="btn" onClick={addTickets}>Add to inbox</button>
            <label className="btn quiet file"><IconUpload /> Open a text file
              <input type="file" accept=".txt,text/plain" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setPasted(await f.text()); }} />
            </label>
            <button className="btn quiet" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </section>
      )}

      <div className="desk">
        <nav className="inbox" aria-label="Inbox">
          <div className="inbox-head">
            <div className="tabs small" role="tablist" aria-label="Tickets">
              <button role="tab" aria-selected={view === 'open'} onClick={() => setView('open')}>Open {inbox.filter((t) => !resolved.includes(t.id)).length}</button>
              <button role="tab" aria-selected={view === 'resolved'} onClick={() => setView('resolved')}>Resolved {inbox.filter((t) => resolved.includes(t.id)).length}</button>
            </div>
            <button className="btn link" onClick={() => setAdding(true)}>Add tickets</button>
          </div>
          {visible.length === 0 && <p className="muted inbox-empty">{view === 'open' ? 'Nothing open. Every ticket is resolved.' : 'No resolved tickets yet.'}</p>}
          {visible.map((t) => {
            const l = labels[t.id];
            const value = l && l !== 'working' ? normalizeLabel(l.text) : '';
            return (
              <button key={t.id} className="ticket" aria-current={selected === t.id} onClick={() => setSelected(t.id)}>
                <span className="ticket-top">
                  <span className="who">{t.who}</span>
                  {l === 'working' && <span className="tag pending">Sorting</span>}
                  {value && <span className={`tag ${l && l !== 'working' && l.source === 'on_device' ? 'device' : 'cloud'}`}>{LABELS[value] ?? value}</span>}
                </span>
                <span className="what">{t.text}</span>
              </button>
            );
          })}
        </nav>

        <section className="thread" aria-label="Ticket">
          <header className="ticket-head">
            <h2>{ticket.who}</h2>
            <span className="trail-inline">
              {label && label !== 'working' && label.text && (
                <>Sorted as <b className="sorted-as">{LABELS[normalizeLabel(label.text)] ?? normalizeLabel(label.text)}</b> <Why id="triage" /></>
              )}
              {resolved.includes(ticket.id) && <button className="btn quiet small" onClick={() => toggleResolved(ticket.id)}>Reopen ticket</button>}
            </span>
          </header>
          <div className="trace">
            <div className="trace-head"><strong>Where this ticket's AI steps run</strong><span>Filled in as each step runs</span></div>
            <Lanes stations={trace} crossing={crossing} onPick={(id) => onWhy(id)} label="Where this ticket's AI steps run" />
          </div>
          <div className="message">{ticket.text}</div>
          <p className="muted">{words(ticket.text).toLocaleString()} words</p>

          {!order && cloudOk === false && !deviceReady && (
            <div className="order"><span className="muted">Order details are read on this computer, which needs Gemini Nano.</span></div>
          )}
          {order && (
            <div className="order">
              {order === 'working' ? (
                <span className="muted">Reading order details…</span>
              ) : order.order ? (
                <>
                  <dl>
                    <div><dt>Order</dt><dd>{order.order.order_id || 'None given'}</dd></div>
                    <div><dt>Product</dt><dd>{order.order.product || 'None given'}</dd></div>
                    <div><dt>Issue</dt><dd>{order.order.issue || 'Not stated'}</dd></div>
                  </dl>
                  <span className="trail-inline"><Ran r={order.r} /> <Why id="extract" /></span>
                </>
              ) : (
                <span className="muted">The order details could not be read from this ticket. {order.r.error ?? ''}</span>
              )}
            </div>
          )}

          <div className="toolbar" role="toolbar" aria-label="Actions">
            {has('reply') && has('pii') && <button className="btn" onClick={() => privateCloud('reply')} disabled={['finding', 'writing'].includes(drafts[key('reply')]?.stage ?? '')}>Draft a reply</button>}
            {has('summary') && has('pii') && words(ticket.text) > LONG && (
              <button className="btn quiet" onClick={() => privateCloud('summary')} disabled={['finding', 'writing'].includes(drafts[key('summary')]?.stage ?? '')}>Summarise the conversation</button>
            )}
          </div>

          {consent && (
            <div className="consent" role="alertdialog" aria-labelledby="consent-title">
              <strong id="consent-title">Send this ticket to the cloud?</strong>
              <p className="note">{consent.reason} {consent.task.name} would send the ticket, including the customer's personal details, to Gemini in the cloud.</p>
              <div className="row">
                <button className="btn quiet" onClick={() => answer(false, false)}>Keep it on this computer</button>
                <button className="btn" onClick={() => answer(true, false)}>Send this one</button>
                <button className="btn quiet" onClick={() => answer(true, true)}>Send for the rest of this visit</button>
              </div>
            </div>
          )}

          {renderDraft('summary')}
          {renderDraft('reply')}
        </section>
      </div>

      <details className="panel log-panel">
        <summary><h2>Routing log</h2><span className="muted">{log.length} steps this visit</span></summary>
        {log.length === 0 ? <p className="muted">Each AI step is listed here with where it ran and why.</p> : (
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
      </details>
    </main>
  );
}
