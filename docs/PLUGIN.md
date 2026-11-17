# Add Routewise to your app

Routewise works as a plugin. Your app keeps its own Firebase setup and its own screens; Routewise decides, for each AI feature, whether it runs on the on-device model or in the cloud, and keeps open copies of the app following the routes you publish. Shopdesk, the example app in `apps/web`, sends every AI step through `createRoutewise` and uses its finder of personal details; its review screen and live-routes hook are its own.

## 1. Set up Firebase as usual

Your app creates the Firebase app, App Check and the AI Logic instance. Routewise never reads credentials.

```ts
import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { getAI, GoogleAIBackend } from 'firebase/ai';
import { getRemoteConfig } from 'firebase/remote-config';

const app = initializeApp(firebaseConfig);
initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(siteKey), isTokenAutoRefreshEnabled: true });
const ai = getAI(app, { backend: new GoogleAIBackend() });
const remoteConfig = getRemoteConfig(app);
```

## 2. Describe your AI features

Each feature has an instruction, the shape of its answer and examples to measure it on. Give expected answers for labels and fields; free text is reviewed by a cloud model during calibration. Routes need evidence: with few examples the 95% confidence bound stays low, so calibration usually routes the feature cloud first (fewer than 4 usable examples is always inconclusive). Give each feature ten or more (the snippet below is shortened).

```ts
import { createRoutewise } from '@routewise/core';

const routewise = createRoutewise({
  ai,
  remoteConfig,
  cloudModel: 'gemini-3.5-flash-lite',
  features: [
    {
      id: 'sort',
      name: 'Sort messages',
      instruction: 'Classify this message as one of: billing, bug, question.',
      output: { label: ['billing', 'bug', 'question'] },
      examples: [
        { input: 'I was charged twice this month.', expect: 'billing' },
        { input: 'The export button does nothing.', expect: 'bug' },
      ],
      personalData: true,
    },
    {
      id: 'reply',
      name: 'Draft a reply',
      instruction: 'Write a short, friendly reply to this message. Keep placeholders such as [NAME 1] exactly as written.',
      output: { text: { maxWords: 120 } },
      // Calibrate on text as the cloud will see it, with details already replaced.
      examples: [{ input: 'Hi, [NAME 1] here. The export button does nothing.' }],
      hideDetailsFromCloud: true,
    },
  ],
  // Asked before personal data leaves the device as written. Leave it out and the answer is always no.
  askConsent: async (feature, reason) => window.confirm(`${feature.name}: ${reason} Send the text to the cloud?`),
  // Required with hideDetailsFromCloud: shown the exact text the cloud would receive, before it is sent.
  reviewBeforeCloud: async (_name, prepared) => window.confirm(`The cloud would receive:\n\n${prepared.masked.text}`),
});

await routewise.ready(); // loads the live routes and follows changes while the app is open
```

## 3. Call `run` where you used to call the model

```ts
const sorted = await routewise.run('sort', message);
console.log(sorted.text, sorted.source); // "billing", "on_device"

const reply = await routewise.run('reply', message);
// If the reply's route can reach the cloud, the user approved "Hi, [NAME 1] here…" and the answer
// comes back with the name restored.
console.log(reply.text, reply.hidden);
```

Every result says where it ran (`on_device`, `in_cloud`, or `none` when nothing was sent), how long it took and why.

## 4. Calibrate and publish

Calibrate on the devices your users have, in a page of your app or with the Calibrate page in `apps/web`:

```ts
// Every example is sent to the cloud once, so use made-up or consented data.
const report = await routewise.calibrate({ judgeModel: 'gemini-3.8-flash', onProgress: console.log, signal: new AbortController().signal });
const routes = routewise.routesFor(report);
// Paste JSON.stringify(routes) into the Remote Config parameter "routewise_policy" and publish.
```

Copies of the app that called `ready()` pick up the new routes while they are open, through Remote Config's real-time updates, without a release. A feature that hides details also calibrates the built-in finder of personal details, on the fictional Shopdesk tickets that ship with Routewise.

## What it does for you

- Routes each feature to the device or the cloud by its measured route, with the safe default (device only for personal data) until routes are published.
- Falls back to the cloud when the on-device answer fails its format check, and asks first when the input holds personal data.
- Finds names, emails, phone numbers and addresses with the on-device model (never asking to send the raw text to the cloud for this), replaces them with placeholders, and puts them back in the answer. Nothing is sent until `reviewBeforeCloud` has shown the user the exact text and they approve, because a detail the finder missed can only be caught by a person.
- For a feature that hides details, the text as written never goes to the cloud. Even on a device-only route, if the device cannot answer (no model, too long, a failed answer), the details are hidden and reviewed first, or nothing is sent.
- `runPrepared` sends text you have already shown the user; call it only after they have approved it (Shopdesk calls it from its own review screen).
- Records a Performance Monitoring trace per call, when you pass `performance`.

## Limits

On the web, on-device answers need desktop Chrome with its built-in model. Elsewhere the routes fall back to the cloud, with consent for personal data. The Android app in `apps/android` applies the same routes and rules in Kotlin; it is an app, not yet a library you can add to another Android project.
