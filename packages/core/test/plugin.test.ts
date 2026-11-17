import { beforeEach, describe, expect, it, vi } from 'vitest';

// Every model call is recorded here instead of reaching Firebase.
const calls: { mode: string; prompt: string }[] = [];
let deviceState = 'available';
const FOUND = '{"items":[{"type":"name","value":"Marcus Bell"},{"type":"email","value":"marcus.bell@example.com"}]}';
let deviceAnswer: { ok: boolean; text: string } = { ok: true, text: 'Thanks [NAME 1], we are on it.' };

vi.mock('firebase/performance', () => ({ trace: () => ({ putAttribute() {}, record() {} }) }));
vi.mock('firebase/remote-config', () => ({ activate: vi.fn(), fetchAndActivate: vi.fn(), getValue: vi.fn(), onConfigUpdate: vi.fn() }));
vi.mock('../src/device', () => ({ nanoAvailability: async () => deviceState, deviceProfile: async () => ({}), describeDevice: () => '' }));
vi.mock('../src/runner', () => ({
  buildPrompt: (t: { id: string }, input: string) => `${t.id}\n${input}`,
  modelFor: (mode: string) => ({ mode }),
  prepareOnDevice: async () => undefined,
  timedGenerate: async (model: { mode: string }, prompt: string) => {
    calls.push({ mode: model.mode, prompt });
    if (model.mode === 'ONLY_ON_DEVICE') {
      return deviceAnswer.ok
        ? { ok: true, text: prompt.startsWith('pii\n') ? FOUND : deviceAnswer.text, ms: 5, source: 'on_device' }
        : { ok: false, text: '', ms: 5, error: 'device failed' };
    }
    return { ok: true, text: 'Hello [NAME 1], your order is on its way.', ms: 5, source: 'in_cloud' };
  },
}));

import type { FeatureSpec } from '../src/plugin';
const { createRoutewise } = await import('../src/plugin');

const TICKET = 'Hi, Marcus Bell here. Email marcus.bell@example.com about order B2210.';
const ai = {} as never;
const reply: FeatureSpec = {
  id: 'reply',
  name: 'Draft a reply',
  instruction: 'Write a short reply.',
  output: { text: { maxWords: 120 } },
  examples: [{ input: 'Hi, [NAME 1] here.' }],
  hideDetailsFromCloud: true,
};

/** True when a call to the cloud carried any personal detail from the ticket as written. */
const rawReachedCloud = () =>
  calls.some((c) => c.mode !== 'ONLY_ON_DEVICE' && (c.prompt.includes('marcus.bell@example.com') || c.prompt.includes('Marcus')));

function routes(mode: string, maxWords: number | null = null) {
  return { version: 1, createdAt: '2026-11-15T00:00:00Z', measuredOn: 'test', cloudModel: 'test', tasks: { reply: { mode, maxWords, sensitive: false } } } as never;
}

describe('a feature that hides details never sends the text as written to the cloud', () => {
  beforeEach(() => {
    calls.length = 0;
    deviceState = 'available';
    deviceAnswer = { ok: true, text: 'Thanks Marcus, we are on it.' };
  });

  const make = (policy: unknown, approve = true) =>
    createRoutewise({ ai, cloudModel: 'test', features: [reply], policy: policy as never, reviewBeforeCloud: async () => approve, askConsent: async () => true });

  it('answers on the device when the route is device only and the device answers', async () => {
    const r = await make(routes('ONLY_ON_DEVICE')).run('reply', TICKET);
    expect(r.source).toBe('on_device');
    expect(rawReachedCloud()).toBe(false);
  });

  // Without a working on-device model the finder cannot look for names either: emails and phone numbers
  // are hidden by rules, the owner is told only rules ran, and nothing goes until they approve.
  it('hides what the rules find and tells the owner when there is no on-device model', async () => {
    deviceState = 'unavailable';
    const seen: boolean[] = [];
    const rw = createRoutewise({ ai, cloudModel: 'test', features: [reply], policy: routes('ONLY_ON_DEVICE'),
      reviewBeforeCloud: async (_n, p) => { seen.push(p.rulesOnly); return true; }, askConsent: async () => true });
    const r = await rw.run('reply', TICKET);
    expect(seen).toEqual([true]);
    expect(calls.some((c) => c.mode !== 'ONLY_ON_DEVICE' && c.prompt.includes('marcus.bell@example.com'))).toBe(false);
    expect(r.source).toBe('in_cloud');
  });

  it('never sends the text as written when the device answer fails', async () => {
    deviceAnswer = { ok: false, text: '' };
    const r = await make(routes('ONLY_ON_DEVICE')).run('reply', TICKET);
    expect(calls.some((c) => c.mode !== 'ONLY_ON_DEVICE' && c.prompt.includes('marcus.bell@example.com'))).toBe(false);
    expect(r.source).toBe('in_cloud');
  });

  it('hides the details when the text is over the on-device length limit', async () => {
    const r = await make(routes('ONLY_ON_DEVICE', 3)).run('reply', TICKET);
    expect(rawReachedCloud()).toBe(false);
    expect(r.source).toBe('in_cloud');
  });

  it('sends nothing when the owner does not approve the hidden text', async () => {
    deviceState = 'unavailable';
    const r = await make(routes('ONLY_ON_DEVICE'), false).run('reply', TICKET);
    expect(r.source).toBe('none');
    expect(calls.filter((c) => c.mode !== 'ONLY_ON_DEVICE')).toHaveLength(0);
  });

  it('hides the details on a cloud route', async () => {
    const r = await make(routes('ONLY_IN_CLOUD')).run('reply', TICKET);
    expect(rawReachedCloud()).toBe(false);
    expect(r.hidden.length).toBeGreaterThan(0);
  });
});
