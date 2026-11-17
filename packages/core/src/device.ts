import type { DeviceProfile } from './types';

/** Same text-only options the app passes to the SDK, so the answer matches what inference will see. */
export const TEXT_ONLY = {
  expectedInputs: [{ type: 'text' as const, languages: ['en'] }],
  expectedOutputs: [{ type: 'text' as const, languages: ['en'] }],
};

export async function nanoAvailability(): Promise<string> {
  try {
    const lm = (globalThis as any).LanguageModel;
    if (!lm || typeof lm.availability !== 'function') return 'unsupported';
    return String(await lm.availability(TEXT_ONLY));
  } catch {
    return 'unknown';
  }
}

export async function deviceProfile(): Promise<DeviceProfile> {
  const m = /Chrome\/(\d+)/.exec(navigator.userAgent);
  const nav = navigator as Navigator & { deviceMemory?: number; userAgentData?: { platform?: string } };
  return {
    chrome: m ? m[1] : 'not Chrome',
    platform: nav.userAgentData?.platform ?? navigator.platform ?? 'unknown',
    memoryGb: nav.deviceMemory ?? null,
    cores: navigator.hardwareConcurrency ?? null,
    nano: await nanoAvailability(),
  };
}

export function describeDevice(d: DeviceProfile): string {
  const base = `Chrome ${d.chrome} on ${d.platform}, ${d.memoryGb ?? '?'} GB memory reported, ${d.cores ?? '?'} cores`;
  return d.model ? `${base}, ${d.model}` : base;
}
