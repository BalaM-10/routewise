// Test-only stand-in for 'firebase/ai', used by vite.e2e.config.ts for automated UI checks.
// It never ships: the app build uses the real Firebase AI Logic SDK.
export const InferenceMode = {
  PREFER_ON_DEVICE: 'prefer_on_device',
  ONLY_ON_DEVICE: 'only_on_device',
  PREFER_IN_CLOUD: 'prefer_in_cloud',
  ONLY_IN_CLOUD: 'only_in_cloud',
} as const;
export class GoogleAIBackend {}
export const getAI = () => ({});

function answer(prompt: string): string {
  const body = prompt.split('\n---\n')[1] ?? prompt;
  if (prompt.startsWith('Classify')) return /refund|money back|charged/i.test(body) ? 'refund' : /log in|password|account/i.test(body) ? 'account' : /leak|defect|seasoning/i.test(body) ? 'product' : 'shipping';
  if (prompt.startsWith('Extract the order id')) {
    const id = /#([A-Z]\d{4})/.exec(prompt)?.[1] ?? '';
    return JSON.stringify({ order_id: id, product: id ? 'walnut desk organizer' : '', issue: 'late delivery' });
  }
  if (prompt.startsWith('List every personal detail')) {
    const names = [...prompt.matchAll(/\b(Marcus Bell|Priya Nair|Tomás Rivera|Jennifer Okafor|Sam Whitaker|Aisha Khan)\b/g)].map((m) => m[1]);
    const addr = /\d+ [A-Z][a-z]+ (?:Ridge Dr|Lakeview Ct)/.exec(prompt)?.[0];
    return JSON.stringify({ items: [...new Set(names)].map((value) => ({ type: 'name', value })).concat(addr ? [{ type: 'address', value: addr }] : []) });
  }
  if (prompt.startsWith('Write a short, friendly reply')) return `Hi [NAME 1],\n\nThanks for getting in touch. I have checked your order and will update you today.\n\nBest regards,\nThe support team\n\n(received: ${/\[NAME 1\]/.test(prompt) && !/@example\.com/.test(prompt) ? 'masked' : 'UNMASKED'})`;
  if (prompt.startsWith('Summarize')) return '[NAME 1] reports a late parcel; the agent opened a case and offered a refund if it does not arrive by Friday.';
  return 'ready';
}

export function getGenerativeModel(_ai: unknown, params: { mode: string }) {
  const cloud = params.mode === InferenceMode.ONLY_IN_CLOUD || params.mode === InferenceMode.PREFER_IN_CLOUD;
  return {
    initializeDeviceModel: async (cb?: (p: number) => void) => cb?.(1),
    generateContent: async (prompt: string) => {
      await new Promise((r) => setTimeout(r, 40));
      return { response: { text: () => answer(prompt), inferenceSource: cloud ? 'in_cloud' : 'on_device' } };
    },
  };
}
