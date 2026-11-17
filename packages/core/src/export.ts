import type { PolicyFile } from './types';

/** Android on-device models accept about 4,000 tokens per request. */
const MOBILE_MAX_WORDS = 2500;

/** The exact value to paste into the Remote Config parameter "routewise_policy". */
export function remoteConfigValue(policy: PolicyFile): string {
  return JSON.stringify(policy);
}

export function mobilePolicy(policy: PolicyFile): PolicyFile {
  const tasks = Object.fromEntries(
    Object.entries(policy.tasks).map(([id, t]) => [
      id,
      { ...t, maxWords: Math.min(t.maxWords ?? MOBILE_MAX_WORDS, MOBILE_MAX_WORDS) },
    ]),
  );
  return { ...policy, tasks };
}

export function webSnippet(): string {
  return `import { createRoutewise } from '@routewise/core';

const routewise = createRoutewise({
  ai, remoteConfig, performance,
  cloudModel: 'gemini-3.5-flash-lite',
  features,                       // your AI features and their examples
  askConsent: (feature, reason) => showConsentDialog(feature.name, reason),
  reviewBeforeCloud: (name, prepared) => showWhatTheCloudGets(prepared.masked.text),
});
await routewise.ready();          // the routes above, live from Remote Config

const { text, source } = await routewise.run('triage', ticketText);`;
}

export function kotlinSnippet(policy: PolicyFile): string {
  const mp = mobilePolicy(policy);
  const lines = Object.entries(mp.tasks)
    .map(([id, t]) => `    "${id}" to Route(InferenceMode.${t.mode}, maxWords = ${t.maxWords}),`)
    .join('\n');
  return `// Measured on ${policy.measuredOn}. Re-calibrate on Android before shipping:
// Gemini Nano on Android has a smaller context (about 4,000 tokens), so limits are capped.
data class Route(val mode: InferenceMode, val maxWords: Int)

val routes = mapOf(
${lines}
)

@OptIn(PublicPreviewAPI::class)
fun modelFor(taskId: String, input: String): GenerativeModel {
    val route = routes.getValue(taskId)
    val words = input.trim().split(Regex("\\\\s+")).size
    val mode = if (words > route.maxWords) InferenceMode.ONLY_IN_CLOUD else route.mode
    return Firebase.ai(backend = GenerativeBackend.googleAI()).generativeModel(
        modelName = "${policy.cloudModel}",
        onDeviceConfig = OnDeviceConfig(mode = mode),
    )
}`;
}

export function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
