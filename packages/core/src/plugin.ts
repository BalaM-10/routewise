import type { AI } from 'firebase/ai';
import type { FirebasePerformance } from 'firebase/performance';
import type { RemoteConfig } from 'firebase/remote-config';
import { activate, fetchAndActivate, getValue, onConfigUpdate } from 'firebase/remote-config';
import { calibrate } from './calibrate';
import type { Progress } from './calibrate';
import type { Mode } from './types';
import { configureRoutewise, getPerformanceOrNull } from './context';
import { detectWithRules, mask, mergeEntities, tryParseEntities, unmask } from './mask';
import type { Entity, Masked } from './mask';
import { derivePolicy, parsePolicyFile, toPolicyFile } from './policy';
import { createRouter } from './router';
import type { RouteResult } from './router';
import { defaultTasks } from './tasks';
import type { JsonSchema, PolicyFile, Report, Task } from './types';

/**
 * One AI feature of the host app, described the way an app developer thinks about it.
 * Routewise turns it into a calibration task and a route.
 */
export interface FeatureSpec {
  id: string;
  /** Shown on the calibration and routes pages, e.g. "Sort tickets". */
  name: string;
  /** What the model should do with the input. */
  instruction: string;
  /**
   * The answer's shape: free text (up to a number of words), one label from a list, or named text fields.
   * Labels and fields are checked against the examples' expected answers; free text is reviewed by a cloud model.
   */
  output: { text: { maxWords: number } } | { label: string[] } | { fields: string[] };
  /** Examples to calibrate on. Give `expect` for labels and fields; leave it out for free text. */
  examples: { input: string; expect?: string | Record<string, string | null> }[];
  /** The input can contain personal data: never sent to the cloud as written without the user's consent. */
  personalData?: boolean;
  /**
   * Replace names, emails, phone numbers and addresses before the input reaches the cloud, and put them
   * back in the answer. The details are found on the device; the app's reviewBeforeCloud is shown the
   * exact text before it is sent. Use this or personalData for a feature, not both.
   */
  hideDetailsFromCloud?: boolean;
  /** Slowest acceptable on-device answer for 9 in 10 inputs, in ms (default 4000). */
  latencyBudgetMs?: number;
}

/** Turns a feature description into a calibration task. */
export function defineFeature(f: FeatureSpec): Task {
  const base = {
    id: f.id,
    name: f.name,
    instruction: f.instruction,
    sensitive: !!f.personalData,
    latencyBudgetMs: f.latencyBudgetMs ?? 4000,
  };
  if ('label' in f.output) {
    return {
      ...base,
      validator: { kind: 'enum', values: f.output.label },
      scoring: 'gold-label',
      inputs: f.examples.map((e) => ({ text: e.input, gold: typeof e.expect === 'string' ? { label: e.expect } : undefined })),
    };
  }
  if ('fields' in f.output) {
    const properties: Record<string, JsonSchema> = Object.fromEntries(f.output.fields.map((k) => [k, { type: 'string' }]));
    return {
      ...base,
      validator: { kind: 'json', schema: { type: 'object', properties, required: f.output.fields } },
      scoring: 'gold-fields',
      inputs: f.examples.map((e) => ({ text: e.input, gold: e.expect && typeof e.expect === 'object' ? { fields: e.expect } : undefined })),
    };
  }
  return {
    ...base,
    validator: { kind: 'text', maxWords: f.output.text.maxWords },
    scoring: 'judge',
    inputs: f.examples.map((e) => ({ text: e.input })),
  };
}

/** The built-in finder of personal details, the same one Shopdesk is calibrated with. */
export const PERSONAL_DETAILS_ID = 'pii';
const personalDetailsTask = (): Task => {
  const t = defaultTasks.find((x) => x.id === PERSONAL_DETAILS_ID)!;
  return { ...t, instruction: t.instruction.replace('this support ticket', 'this text') };
};

/** What the cloud would receive for an input, and whether anything may have been missed. */
export interface Prepared {
  masked: Masked;
  /** Every detail found, by the model or by the fixed-shape rules. */
  entities: Entity[];
  /** The on-device finder gave no usable answer, so only emails and phone numbers were found (by their shape). */
  rulesOnly: boolean;
  /** True when every detail found was hidden and the finder answered properly. Anything else needs a person to look. */
  complete: boolean;
  find: RouteResult;
}

/** Combines the finder's answer with the fixed-shape rules and masks the text. Pure, so it can be tested. */
export function prepareFromAnswer(text: string, finderAnswer: string | null): Omit<Prepared, 'find'> {
  const parsed = finderAnswer ? tryParseEntities(finderAnswer) : null;
  const entities: Entity[] = mergeEntities(parsed ?? [], detectWithRules(text));
  const masked = mask(text, entities);
  const rulesOnly = parsed === null;
  return { masked, entities, rulesOnly, complete: !rulesOnly && masked.missed.length === 0 };
}

export interface RunResult extends RouteResult {
  /** The details that were hidden from the cloud for this answer, if any. */
  hidden: Entity[];
}

export interface RoutewiseOptions {
  /** Firebase AI Logic instance from getAI(app, ...), created by the app with App Check set up. */
  ai: AI;
  /** Performance Monitoring, for one trace per call. Leave it out to keep whatever was set before. */
  performance?: FirebasePerformance;
  /** Where live routes come from, after ready(). Without it, routes come from `policy` or the safe defaults. */
  remoteConfig?: RemoteConfig;
  /** Remote Config parameter holding the routes (default "routewise_policy"). */
  policyKey?: string;
  /** Routes to start with, e.g. a calibration shipped with the app. */
  policy?: PolicyFile | null;
  /** The app's AI features. Ids must be unique; "pii" is the built-in personal-details finder. */
  features: (FeatureSpec | Task)[];
  cloudModel: string;
  /**
   * Asked before personal data leaves the device as written. Without it the answer is always no,
   * so nothing personal is ever sent without a decision by the app.
   */
  askConsent?: (feature: Task, reason: string) => Promise<boolean>;
  /**
   * Shown the exact text the cloud would receive for a feature with hideDetailsFromCloud, before it is sent.
   * Required when any feature hides details: a detail the finder missed can only be caught by a person.
   */
  reviewBeforeCloud?: (featureName: string, prepared: Prepared) => Promise<boolean>;
  onResult?: (r: RouteResult) => void;
}

const isTask = (x: FeatureSpec | Task): x is Task => 'validator' in x;
const DEVICE_ONLY: Mode = 'ONLY_ON_DEVICE';

/**
 * Routewise as a drop-in: describe the app's AI features, calibrate them, publish the routes,
 * and call `run` wherever the app used to call the model.
 */
export function createRoutewise(opts: RoutewiseOptions) {
  configureRoutewise({ ai: opts.ai, performance: opts.performance ?? getPerformanceOrNull() ?? undefined });
  const ids = opts.features.map((f) => f.id);
  const dup = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dup) throw new Error(`Two features share the id "${dup}".`);
  const specs = new Map(opts.features.filter((f): f is FeatureSpec => !isTask(f)).map((f) => [f.id, f]));
  const hides = [...specs.values()].some((f) => f.hideDetailsFromCloud);
  if (hides && !opts.reviewBeforeCloud) throw new Error('A feature hides details from the cloud, so pass reviewBeforeCloud to show the user what will be sent.');
  const tasks: Task[] = opts.features.map((f) => (isTask(f) ? f : defineFeature(f)));
  if (hides && !tasks.some((t) => t.id === PERSONAL_DETAILS_ID)) tasks.push(personalDetailsTask());
  const key = opts.policyKey ?? 'routewise_policy';
  let policy: PolicyFile | null = opts.policy ?? null;
  const listeners = new Set<(p: PolicyFile) => void>();
  const setPolicy = (p: PolicyFile | null) => {
    if (!p) return;
    policy = p;
    listeners.forEach((l) => l(p));
  };
  const router = (consent = true) =>
    createRouter({
      policy,
      tasks,
      cloudModel: opts.cloudModel,
      // The finder of personal details never asks: it reads the text as written, so it stays on the device.
      askConsent: (task, reason) => (consent && opts.askConsent ? opts.askConsent(task, reason) : Promise.resolve(false)),
      onResult: opts.onResult,
    });

  // For features that hide details: the raw text is treated as personal data and the cloud is never asked,
  // so any fallback is refused and run() moves on to the hidden, reviewed path instead.
  const hiddenIds = new Set([...specs.values()].filter((f) => f.hideDetailsFromCloud).map((f) => f.id));
  const rawOnDevice = {
    generate: (featureId: string, input: string) =>
      createRouter({
        policy,
        tasks: tasks.map((t) => (hiddenIds.has(t.id) ? { ...t, sensitive: true } : t)),
        cloudModel: opts.cloudModel,
        askConsent: () => Promise.resolve(false),
      }).generate(featureId, input),
  };

  let following: Promise<PolicyFile | null> | null = null;
  /** Loads the live routes and follows changes made in Remote Config while the app is open. Safe to call more than once. */
  function ready(): Promise<PolicyFile | null> {
    const rc = opts.remoteConfig;
    if (!rc) return Promise.resolve(policy);
    following ??= (async () => {
      const read = () => setPolicy(parsePolicyFile(getValue(rc, key).asString()));
      try {
        await fetchAndActivate(rc);
        read();
        onConfigUpdate(rc, { next: () => { activate(rc).then(read).catch(() => undefined); }, error: () => undefined, complete: () => undefined });
      } catch {
        /* offline or real-time updates unavailable: the routes already loaded still apply */
      }
      return policy;
    })();
    return following;
  }

  /** Finds personal details on the device and shows what the cloud would receive, without sending anything. */
  async function prepare(input: string): Promise<Prepared> {
    if (!tasks.some((t) => t.id === PERSONAL_DETAILS_ID)) throw new Error('No feature hides details from the cloud, so there is no finder of personal details.');
    const find = await router(false).generate(PERSONAL_DETAILS_ID, input);
    return { ...prepareFromAnswer(input, find.blocked ? null : find.text || null), find };
  }

  /**
   * Runs a feature where its route says. A feature with hideDetailsFromCloud whose route can reach the cloud
   * has its details found on the device and replaced, the user is shown the exact text, and only then is it sent.
   */
  async function run(featureId: string, input: string): Promise<RunResult> {
    const spec = specs.get(featureId);
    const mode = policy?.tasks[featureId]?.mode;
    if (!spec?.hideDetailsFromCloud) return { ...(await router().generate(featureId, input)), hidden: [] };
    if (mode === DEVICE_ONLY) {
      // The text as written may only be answered on the device. If the device cannot answer (no model,
      // too long, a failed or malformed answer), nothing is sent: the details are hidden and reviewed below.
      const local = await rawOnDevice.generate(featureId, input);
      if (!local.blocked) {
        opts.onResult?.(local);
        return { ...local, hidden: [] };
      }
    }
    const p = await prepare(input);
    if (!(await opts.reviewBeforeCloud!(spec.name, p))) {
      const declined: RunResult = { ...p.find, taskId: featureId, text: '', source: 'none', blocked: true, escalated: false,
        hidden: p.masked.hidden, reason: 'The user did not approve the text for the cloud, so nothing was sent.' };
      opts.onResult?.(declined);
      return declined;
    }
    return runPrepared(featureId, p);
  }

  /** Sends text the app has already prepared and shown to the user, and puts the hidden details back in the answer. */
  async function runPrepared(featureId: string, p: Prepared): Promise<RunResult> {
    const r = await router().generate(featureId, p.masked.text);
    return { ...r, text: r.text ? unmask(r.text, p.masked.map) : r.text, hidden: p.masked.hidden };
  }

  return {
    tasks,
    ready,
    run,
    prepare,
    runPrepared,
    /** The routes in use now. */
    policy: () => policy,
    /** Use routes from elsewhere, e.g. a calibration the user just ran. */
    setPolicy,
    /** Called when new routes arrive from Remote Config or setPolicy. Returns a function that stops it. */
    onPolicyChange: (l: (p: PolicyFile) => void) => { listeners.add(l); return () => { listeners.delete(l); }; },
    /** Measures every feature on the device and in the cloud. Every example is sent to the cloud once. Keep the page open. */
    calibrate: (o: Omit<Parameters<typeof calibrate>[1], 'cloudModel'>): Promise<Report> => calibrate(tasks, { cloudModel: opts.cloudModel, ...o }),
    /** The routes for a calibration, as the value to paste into Remote Config. */
    routesFor: (report: Report): PolicyFile => toPolicyFile(report, derivePolicy(report)),
  };
}

export type Routewise = ReturnType<typeof createRoutewise>;
