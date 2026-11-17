import { describe, expect, it } from 'vitest';
import { goldScore, validate } from '../src/scoring';
import { fromAndroidReport } from '../src/devices';
import { tryParseEntities } from '../src/mask';
import { defineFeature, prepareFromAnswer } from '../src/plugin';
import { detectWithRules, firstName, guessHiddenType, leaked, leftoverTokens, mask, maskWith, mergeEntities, parseEntities, unmask } from '../src/mask';
import { mergeReports } from '../src/report';
import { percentile, wilsonLower } from '../src/stats';
import { deriveEntry, parsePolicyFile } from '../src/policy';
import { defaultTasks, buildThread, tickets, orders, findOrder, orderIdIn, orderFacts, composeReplyInput } from '../src/tasks';
import type { Pair, Sample, Task } from '../src/types';

const s = (ok: boolean, valid: boolean, ms = 500, text = 'x'): Sample => ({ ok, valid, ms, text });
const task = (id: string) => defaultTasks.find((t) => t.id === id)!;
const pair = (p: Partial<Pair>): Pair => ({
  input: 0, words: 50, onDevice: s(true, true), cloud: s(true, true), deviceScore: 5, cloudScore: 5, status: 'scored', ...p,
});

describe('validation', () => {
  it('checks JSON against the schema, not just keys', () => {
    const v = task('extract').validator;
    expect(validate('{"order_id":"A1","product":"lamp","issue":"broken"}', v)).toBe(true);
    expect(validate('{"order_id":"","product":"","issue":"login"}', v)).toBe(true);
    expect(validate('{"order_id":"A1","product":"lamp","issue":5}', v)).toBe(false);
    expect(validate('{"order_id":"A1"}', v)).toBe(false);
    expect(validate('```json\n{"order_id":"A1","product":"x","issue":"y"}\n```', v)).toBe(true);
  });
  it('rejects refusals and over-long text', () => {
    const v = { kind: 'text' as const, maxWords: 5 };
    expect(validate("I'm sorry, but I can't help", v)).toBe(false);
    expect(validate('one two three four five six', v)).toBe(false);
    expect(validate('short answer', v)).toBe(true);
    expect(validate("I can't log in. My name is [NAME].", { kind: 'text', maxWords: 50 })).toBe(true);
    expect(validate('I cannot help with that request.', { kind: 'text', maxWords: 50 })).toBe(false);
  });
  it('accepts enum labels case-insensitively', () => {
    expect(validate(' Refund. ', task('triage').validator)).toBe(true);
    expect(validate('billing', task('triage').validator)).toBe(false);
  });
});

describe('gold scoring', () => {
  it('scores labels', () => {
    expect(goldScore('shipping', { label: 'shipping' }, 'gold-label')).toBe(5);
    expect(goldScore('refund', { label: 'shipping' }, 'gold-label')).toBe(1);
  });
  it('scores extracted fields, including expected nulls', () => {
    const gold = { fields: { order_id: 'B2210', product: 'walnut desk organizer' } };
    expect(goldScore('{"order_id":"B2210","product":"Walnut desk organizer","issue":"late"}', gold, 'gold-fields')).toBe(5);
    expect(goldScore('{"order_id":"#B2210","product":"lamp","issue":"late"}', gold, 'gold-fields')).toBe(3);
    expect(goldScore('{"order_id":null,"product":null,"issue":"x"}', { fields: { order_id: null, product: null } }, 'gold-fields')).toBe(5);
    expect(goldScore('{"order_id":"","product":"","issue":"x"}', { fields: { order_id: null, product: null } }, 'gold-fields')).toBe(5);
    expect(goldScore('{"order_id":"null","product":"null","issue":"x"}', { fields: { order_id: null, product: null } }, 'gold-fields')).toBe(1);
  });
  it('fails a redaction that leaks any personal detail', () => {
    const gold = { mustNotContain: ['Priya Nair', '214-555-0147'] };
    expect(goldScore('Hi, [NAME] here. Phone [PHONE].', gold, 'gold-redaction')).toBe(5);
    expect(goldScore('Hi, [NAME] here. Phone 214-555-0147.', gold, 'gold-redaction')).toBe(1);
  });
});

describe('statistics', () => {
  it('computes a conservative lower bound', () => {
    expect(wilsonLower(8, 8)).toBeGreaterThan(0.7);
    expect(wilsonLower(6, 6)).toBeLessThan(0.7);
    expect(wilsonLower(0, 0)).toBe(0);
  });
  it('computes percentiles', () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)).toBe(9);
    expect(percentile([], 50)).toBe(0);
  });
});

describe('policy', () => {
  // A step without personal data, so device-first and the latency budget apply.
  const t = { ...task('triage'), sensitive: false };
  it('treats steps that read the raw ticket as personal data', () => {
    expect(task('triage').sensitive && task('extract').sensitive && task('pii').sensitive).toBe(true);
    expect(task('reply').sensitive).toBe(false);
  });
  it('goes device first with strong evidence', () => {
    const e = deriveEntry(t, { taskId: t.id, pairs: Array.from({ length: 8 }, () => pair({})) });
    expect(e.mode).toBe('PREFER_ON_DEVICE');
  });
  it('does not blame the device for cloud or judge failures', () => {
    const judged = task('reply');
    const pairs = [...Array.from({ length: 8 }, () => pair({})), ...Array.from({ length: 4 }, () => pair({ status: 'reference-missing', deviceScore: null, cloudScore: null }))];
    const e = deriveEntry(judged, { taskId: judged.id, pairs });
    expect(e.metrics.n).toBe(8);
    expect(e.metrics.excluded).toBe(4);
    expect(e.mode).toBe('PREFER_ON_DEVICE');
  });
  it('stays in the cloud when evidence is thin', () => {
    const e = deriveEntry(t, { taskId: t.id, pairs: [pair({}), pair({})] });
    expect(e.inconclusive).toBe(true);
    expect(e.mode).toBe('PREFER_IN_CLOUD');
  });
  it('explains a high rate with too few samples', () => {
    const e = deriveEntry(t, { taskId: t.id, pairs: Array.from({ length: 6 }, () => pair({})) });
    expect(e.mode).toBe('PREFER_IN_CLOUD');
    expect(e.reasons[0]).toContain('too few');
  });
  it('keeps personal data on the device when the evidence is good but thin', () => {
    const r = task('pii');
    const pairs = [...Array.from({ length: 7 }, () => pair({})), pair({ deviceScore: 1 })];
    const e = deriveEntry(r, { taskId: r.id, pairs });
    expect(e.mode).toBe('ONLY_ON_DEVICE');
    expect(e.warnings.join(' ')).toContain('too few');
  });
  it('treats unscored length tiers as not measured, not failed', () => {
    const sum = task('summary');
    const pairs = [150, 800].flatMap((tier) => [0, 1].map(() => pair({ tier, status: 'reference-missing', deviceScore: null, cloudScore: null, note: 'Judge failed: quota' })));
    const e = deriveEntry(sum, { taskId: sum.id, pairs });
    expect(e.reasons.join(' ')).not.toContain('no longer good enough');
    expect(e.warnings.join(' ')).toContain('not measured');
    expect(e.warnings.join(' ')).toContain('Judge failed: quota');
  });
  it('lets the latency budget veto device first', () => {
    const slow: Task = { ...t, latencyBudgetMs: 1000 };
    const e = deriveEntry(slow, { taskId: t.id, pairs: Array.from({ length: 8 }, () => pair({ onDevice: s(true, true, 4000) })) });
    expect(e.mode).toBe('PREFER_IN_CLOUD');
  });
  it('pins personal data to the device', () => {
    const r = task('pii');
    const e = deriveEntry(r, { taskId: r.id, pairs: Array.from({ length: 8 }, () => pair({})) });
    expect(e.mode).toBe('ONLY_ON_DEVICE');
  });
  it('finds the length limit', () => {
    const sum = task('summary');
    const pairs = [150, 800, 2000, 4000, 6000].flatMap((tier) =>
      [0, 1, 2].map(() => pair({ tier, deviceScore: tier <= 2000 ? 5 : 2 })),
    );
    const e = deriveEntry(sum, { taskId: sum.id, pairs });
    expect(e.maxWords).toBe(2000);
    expect(e.metrics.n).toBe(9);
    expect(e.mode).toBe('PREFER_ON_DEVICE');
  });
  it('rejects malformed policy files', () => {
    expect(parsePolicyFile('{"version":1,"tasks":{"a":{"mode":"SOMETIMES"}}}')).toBeNull();
    expect(parsePolicyFile('not json')).toBeNull();
  });
});

describe('dataset', () => {
  it('builds threads of the requested size', () => {
    const n = buildThread(tickets[0], 2000).split(/\s+/).length;
    expect(n).toBeGreaterThanOrEqual(2000);
    expect(n).toBeLessThan(2100);
  });
});

describe('masking', () => {
  it('labels hand-hidden text as a detail unless it looks like a name', () => {
    expect(guessHiddenType('linen throw blanket')).toBe('detail');
    expect(guessHiddenType('Raj')).toBe('name');
    expect(guessHiddenType('Mary Ann Lee')).toBe('name');
    expect(guessHiddenType('raj@example.com')).toBe('email');
  });

  it('hides a detail in the order facts too, once it is hidden in the ticket', () => {
    const m = mask('I returned the linen throw blanket.', [{ type: 'detail', value: 'linen throw blanket' }]);
    expect(m.text).toBe('I returned the [DETAIL 1].');
    expect(maskWith('Order A1043: Linen throw blanket, $72.00', m.map)).toBe('Order A1043: [DETAIL 1], $72.00');
    expect(unmask('Your [DETAIL 1] refund is on its way.', m.map)).toBe('Your linen throw blanket refund is on its way.');
  });

  const text = 'Hi, Priya Nair here. Call 214-555-0147 or priya@example.com. Thanks, Priya Nair';
  it('masks every occurrence and restores the exact text', () => {
    const m = mask(text, [{ type: 'name', value: 'priya nair' }, ...detectWithRules(text)]);
    expect(m.text).toBe('Hi, [NAME 1] here. Call [PHONE 1] or [EMAIL 1]. Thanks, [NAME 1]');
    expect(leaked(m.text, ['Priya Nair', '214-555-0147', 'priya@example.com'])).toEqual([]);
    expect(unmask('Dear [NAME 1], we will call [PHONE 1].', m.map)).toBe('Dear Priya, we will call 214-555-0147.');
  });
  it('finds emails and phone numbers by rule, even if the model misses them', () => {
    expect(detectWithRules(text).map((e) => e.type).sort()).toEqual(['email', 'phone']);
  });
  it('matches whole words only', () => {
    const m = mask('Ben asked about the benefit. Thanks, Ben', [{ type: 'name', value: 'Ben' }]);
    expect(m.text).toBe('[NAME 1] asked about the benefit. Thanks, [NAME 1]');
  });
  it('restores placeholders the model reformatted and reports invented ones', () => {
    const map = { '[NAME 1]': 'Priya Nair' };
    expect(unmask('Hi [name 1] and [ NAME 1 ], see [NAME 2]', map)).toBe('Hi Priya and Priya Nair, see [NAME 2]');
    expect(leftoverTokens('Hi Priya, see [NAME 2]')).toEqual(['[NAME 2]']);
    expect(leftoverTokens('A refund by [DATE 1] is possible')).toEqual(['[DATE 1]']);
  });
  it('replaces longer details before shorter ones', () => {
    const m = mask('Marcus Bell wrote; Marcus says hi', [{ type: 'name', value: 'Marcus' }, { type: 'name', value: 'Marcus Bell' }]);
    expect(m.text).toBe('[NAME 1] wrote; [NAME 2] says hi');
  });
  it('reads the model list tolerantly and drops duplicates', () => {
    const e = parseEntities('```json\n{"items":[{"type":"name","value":"Sam"},{"value":"sam@example.com"},{"type":"x","value":" "}]}\n```');
    expect(e).toEqual([{ type: 'name', value: 'Sam' }, { type: 'email', value: 'sam@example.com' }]);
    expect(mergeEntities(e, [{ type: 'name', value: 'sam' }])).toHaveLength(2);
  });
  it('scores masking by whether anything would leak', () => {
    const input = tickets[1].text;
    const gold = { mustNotContain: tickets[1].pii };
    expect(goldScore('{"items":[{"type":"name","value":"Priya Nair"}]}', gold, 'gold-masking', input)).toBe(5);
    expect(goldScore('{"items":[]}', gold, 'gold-masking', input)).toBe(1);
  });
  it('calibrates replies on masked tickets', () => {
    const reply = task('reply');
    expect(reply.inputs.every((i) => !/@example\.com/.test(i.text))).toBe(true);
    expect(reply.inputs[0].text).toContain('[NAME 1]');
  });
});

describe('reports', () => {
  it('replaces re-run features and drops retired ones', () => {
    const base = { version: 2, tasks: [{ id: 'a' }, { id: 'b' }, { id: 'old' }], results: [{ taskId: 'a', pairs: [] }, { taskId: 'b', pairs: [] }, { taskId: 'old', pairs: [] }] } as any;
    const fresh = { version: 2, tasks: [{ id: 'b' }], results: [{ taskId: 'b', pairs: [1] }] } as any;
    const m = mergeReports(base, fresh, ['a', 'b']);
    expect(m.tasks.map((t: any) => t.id)).toEqual(['a', 'b']);
    expect(m.results.find((r: any) => r.taskId === 'b')!.pairs).toEqual([1]);
  });
});

describe('ticket data', () => {
  it('has the harder set with every category', () => {
    expect(tickets.length).toBe(54);
    for (const c of ['shipping', 'refund', 'product', 'account', 'other']) expect(tickets.some((t) => t.category === c)).toBe(true);
  });
  it('lists only personal details that appear in the ticket', () => {
    for (const t of tickets) for (const v of t.pii) expect(t.text.toLowerCase()).toContain(v.toLowerCase());
  });
  it('has an order record for every order a ticket mentions, and orders hold no personal details', () => {
    for (const t of tickets) if (t.orderId) expect(findOrder(t.orderId)).not.toBeNull();
    const all = tickets.flatMap((t) => t.pii);
    const whole = (v: string) => new RegExp(`(?<![\\p{L}\\p{N}])${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'iu');
    for (const o of orders) expect(all.filter((v) => whole(v).test(JSON.stringify(o)))).toEqual([]);
  });
  it('finds orders whatever the formatting', () => {
    expect(findOrder('#b2210')?.product).toBe('walnut desk organizer');
    expect(findOrder('H2291')?.id).toBe('H-2291');
    expect(findOrder('nope')).toBeNull();
  });
});

describe('order facts', () => {
  it('finds order numbers by pattern', () => {
    expect(orderIdIn('My order #B2210 is late')).toBe('B2210');
    expect(orderIdIn('order H-2291?? not sure')).toBe('H-2291');
    expect(orderIdIn('where is my order')).toBeNull();
  });
  it('states the facts plainly', () => {
    const f = orderFacts(findOrder('B2210')!).join(' ');
    expect(f).toContain('walnut desk organizer');
    expect(f).toContain('Status: delayed');
    expect(f).toContain('Refund: eligible if not delivered by Nov 20');
  });
  it('builds the reply input from masked text, facts and voice', () => {
    const input = composeReplyInput('Hi, [NAME 1] here.', ['Status: delayed.'], { shop: 'Hearth & Grain', signOff: 'Ana at Hearth & Grain', tone: 'brief' });
    expect(input).toContain('ORDER FACTS');
    expect(input).toContain('- Status: delayed.');
    expect(input).toContain('sign off as "Ana at Hearth & Grain"');
  });
  it('tests replies with the facts Shopdesk sends', () => {
    const reply = task('reply');
    expect(reply.inputs[0].text).toContain('ORDER FACTS');
    expect(reply.inputs.every((i) => !/@example\.com/.test(i.text))).toBe(true);
  });
  it('greets by first name only when the name has a clear first name', () => {
    expect(firstName('Marcus Bell')).toBe('Marcus');
    expect(firstName('M. Johnson')).toBeNull();
    expect(firstName('SAM WHITAKER')).toBeNull();
    expect(firstName('Priya')).toBeNull();
    const map = { '[NAME 1]': 'Marcus Bell', '[NAME 2]': 'M. Johnson' };
    expect(unmask('Hello [NAME 1],\nThanks, [NAME 1].', map)).toBe('Hello Marcus,\nThanks, Marcus Bell.');
    expect(unmask('Good morning [name 1]!', map)).toBe('Good morning Marcus!');
    expect(unmask('Dear [NAME 2],', map)).toBe('Dear M. Johnson,');
  });
  it('hides a word of a name that stands alone, with its capital letter only', () => {
    const m = mask("This is Marcus Bell. Mr. Bell's doorbell rang. Thanks, Marcus", [{ type: 'name', value: 'Marcus Bell' }]);
    expect(m.text).toBe("This is [NAME 1]. Mr. [NAME 3]'s doorbell rang. Thanks, [NAME 2]");
    expect(unmask(m.text, m.map)).toBe("This is Marcus Bell. Mr. Bell's doorbell rang. Thanks, Marcus");
  });
  it('finds a phone number the model wrote differently, and reports details it could not find', () => {
    const m = mask('Call me on (512) 555-0176 please.', [{ type: 'phone', value: '5125550176' }, { type: 'name', value: 'Theo Grant' }]);
    expect(m.text).toBe('Call me on [PHONE 1] please.');
    expect(m.missed).toEqual([{ type: 'name', value: 'Theo Grant' }]);
  });
  it('finds international and national phone numbers by rule', () => {
    const found = detectWithRules('Ring +44 20 7946 0321 or 07700 900482 or 0491 570 156. Order #C3307, ZIP 75034, tracking 1Z84A2210.').map((e) => e.value);
    expect(found).toEqual(['+44 20 7946 0321', '07700 900482', '0491 570 156']);
  });
  it('counts a name as leaked when a word of it survives masking', () => {
    const input = 'Hi, this is Hannah Ortiz. Thanks, Hannah';
    expect(goldScore('{"items":[{"type":"name","value":"Hannah Ortiz"}]}', { mustNotContain: ['Hannah Ortiz'] }, 'gold-masking', input)).toBe(5);
    expect(goldScore('{"items":[]}', { mustNotContain: ['Hannah Ortiz'] }, 'gold-masking', input)).toBe(1);
  });
  it('summarises an Android report, leaving failed cloud calls out of the cloud figures', () => {
    const a = (ms: number, good: boolean, error: string | null = null) => ({ ms, good, error });
    const run = fromAndroidReport({
      createdAt: '2026-11-14T15:35:37Z', device: 'Pixel', onDeviceModelName: 'Gemini Nano 4 Full',
      tasks: [{ id: 'triage', mode: 'ONLY_ON_DEVICE', trials: [
        { device: a(100, true), cloud: a(50, true) },
        { device: a(300, true), cloud: a(0, false, 'quota') },
        { device: a(200, false), cloud: a(70, false) },
      ] }],
    });
    expect(run.model).toBe('Gemini Nano 4 Full');
    expect(run.steps[0]).toMatchObject({ n: 3, good: 2, deviceP50: 200, cloudGood: 1, cloudErrors: 1, mode: 'ONLY_ON_DEVICE' });
  });
  it('treats an answer that is not the JSON asked for as no answer', () => {
    expect(tryParseEntities('Sure! The name is Marcus Bell.')).toBeNull();
    expect(tryParseEntities('{"items":[]}')).toEqual([]);
    expect(tryParseEntities('```json\n{"items":[{"type":"name","value":"Ivy Chen"}]}\n```')).toEqual([{ type: 'name', value: 'Ivy Chen' }]);
  });
  it('hides a lowercase first name too, and restores each spelling as written', () => {
    const m = mask('Customer: Marcus Bell. thanks, marcus. MARCUS again', [{ type: 'name', value: 'Marcus Bell' }]);
    expect(m.text).not.toMatch(/marcus/i);
    expect(unmask(m.text, m.map)).toBe('Customer: Marcus Bell. thanks, marcus. MARCUS again');
  });
  it('matches an order number exactly, not as part of a longer one', () => {
    expect(goldScore('{"order_id":"2210","product":"desk organizer"}', { fields: { order_id: 'B2210', product: 'walnut desk organizer' } }, 'gold-fields')).toBeLessThan(5);
    expect(goldScore('{"order_id":"#b2210","product":"desk organizer"}', { fields: { order_id: 'B2210', product: 'walnut desk organizer' } }, 'gold-fields')).toBe(5);
  });
  it('turns a feature description into a calibration task', () => {
    const t = defineFeature({ id: 'sort', name: 'Sort', instruction: 'Sort it.', output: { label: ['a', 'b'] }, examples: [{ input: 'x', expect: 'a' }], personalData: true });
    expect(t).toMatchObject({ scoring: 'gold-label', sensitive: true, validator: { kind: 'enum', values: ['a', 'b'] }, inputs: [{ text: 'x', gold: { label: 'a' } }] });
    const f = defineFeature({ id: 'read', name: 'Read', instruction: 'Read it.', output: { fields: ['order_id'] }, examples: [{ input: 'y', expect: { order_id: 'B1' } }] });
    expect(f.scoring).toBe('gold-fields');
    const w = defineFeature({ id: 'write', name: 'Write', instruction: 'Write.', output: { text: { maxWords: 50 } }, examples: [{ input: 'z' }] });
    expect(w).toMatchObject({ scoring: 'judge', validator: { kind: 'text', maxWords: 50 } });
  });
  it('only calls masking complete when the finder answered and every detail was hidden', () => {
    const text = 'Hi, Ivy Chen here, call 214-555-0147.';
    const ok = prepareFromAnswer(text, '{"items":[{"type":"name","value":"Ivy Chen"}]}');
    expect(ok.complete).toBe(true);
    expect(ok.masked.text).toBe('Hi, [NAME 1] here, call [PHONE 1].');
    expect(prepareFromAnswer(text, 'I could not do that.')).toMatchObject({ rulesOnly: true, complete: false });
    expect(prepareFromAnswer(text, '{"items":[{"type":"name","value":"Ivy Chan"}]}').complete).toBe(false);
  });
});
