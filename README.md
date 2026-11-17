# Routewise

**Measure where each AI feature should run, then ship the answer.**

Try it: [routewise-ba016.web.app](https://routewise-ba016.web.app) (Shopdesk runs on your computer if your Chrome has Gemini Nano, and asks before using the cloud if it does not). The Android app is in Google Play internal testing; see [apps/android](apps/android/README.md).

Firebase AI Logic can run a prompt on the user's device (Gemini Nano in Chrome) and fall back to the cloud. It does not tell you which of your features are good enough on the device, at what input length they break, or whether the device is fast enough. Teams find out in production. One published case shipped Gemini Nano to its users, found that about 41% of them (340 of 836) could run it and that it was about 6x slower than the cloud, and removed it ([source](https://autominer.sendcheckit.com/blog/ai-powered-subject-line-alternatives)).

Routewise answers those questions before you ship, with evidence, and turns the answer into runtime behaviour.

## What it does

Routewise is a plugin for web apps that use Firebase AI Logic (the Android app applies the same routes and rules, and is being split out the same way): describe your AI features, calibrate them on real devices, publish the routes, and call `routewise.run(feature, input)` where you used to call the model. [Add Routewise to your app](docs/PLUGIN.md) shows the whole setup.

**Shopdesk**, a support inbox for a small online shop, is the example app built with it. The web app opens on an overview of the four stages (measure, decide, ship, run), with the same steps compared on a laptop and a phone, then:

1. **Shopdesk.**
   - New tickets are sorted as they arrive, and opening a ticket reads its order details.
   - Replies and summaries are written with the customer's names, emails, phone numbers and addresses replaced before anything leaves the computer: the on-device model finds the details, plain code replaces them with placeholders such as `[NAME 1]`, the cloud writes on the masked text, and code puts the details back.
   - The owner sees exactly what will be sent, and can hide anything the model missed.
   - Every result shows where it ran, and a **Why?** link opens the evidence.
2. **Routes.** One row per AI step: the route, the reasons, the measured quality and speed, quality by input length, and every test answer side by side. The routes are published as one Remote Config value, so every copy of the app follows them without a release.
3. **Calibrate.** Each step runs on Gemini Nano (`ONLY_ON_DEVICE`) and in the cloud (`ONLY_IN_CLOUD`) through Firebase AI Logic, on 54 fictional tickets (the 13 Nov laptop run below used the first 48; the later runs used all 54).
   - Answers are scored against known answers where they exist: labels, order fields, and whether any personal detail would leak after masking.
   - Written answers are reviewed blind by a different cloud model.
   - Each step gets a route from a 95% confidence bound, a latency budget and the longest input it handles well.
4. **Runs.** Every calibration saved in the browser, with the run published in Remote Config marked as live. Two runs can be compared feature by feature, which shows whether a Gemini Nano update, a new Chrome version or a different reviewing model changed the results. A run stopped part-way keeps the features it finished.

**Privacy without Gemini Nano.** Sorting and order details read the ticket as written, so they are treated as personal data: with Gemini Nano they run on the computer; without it, Shopdesk asks once per visit whether to use the cloud or keep tickets on the computer. Replies and summaries are always written from masked text. If no on-device model can look for names and addresses, emails and phone numbers are still found by rules and the owner adds the rest before anything is sent. A "Prepare Gemini Nano" button downloads the model where Chrome supports it.

**Live routes.** Shopdesk listens for Remote Config updates, so a route changed in the console reaches open copies of the app within a minute, without a reload.

## Results from the recorded run

Chrome 157 on Windows, 32 GB memory, 13 Nov 2026, Chrome's default on-device model (Gemini Nano 3). Cloud answers from gemini-3.5-flash-lite; written answers reviewed by gemini-3.6-flash and gemini-3.1-flash-lite.

| Step | Good on device | Route | Slowest typical answer, device vs cloud |
| --- | --- | --- | --- |
| Triage the ticket | 46 of 48 (at least 88% at 95% confidence) | Device only | 1.1 s vs 1.2 s |
| Extract order details | 46 of 48 (at least 88%) | Device only | 2.2 s vs 1.1 s |
| Find personal details | 45 of 48 (at least 85%) | Device only | 3.8 s vs 1.3 s |
| Summarize the thread | 3 of 3 up to 150 words, too few to be sure; worse from 800 words | Cloud first | 4.0 s vs 0.8 s |
| Draft a reply | 9 of 24 | Cloud only | 6.5 s vs 1.4 s |

One of the 48 personal-detail answers ran for about seven minutes on the device before failing with an output limit. It counts as a miss. That run came before calibration had its 90-second limit, and it is why live steps now stop waiting after 30 seconds (Chrome may finish the abandoned answer in the background; the app no longer waits for it).

Nothing on screen is invented: counts in Shopdesk are this visit's real steps, results come from a recorded calibration on real hardware (labelled as such), and the 41% figure is quoted as one published production app's share of users who met Chrome's requirements for Gemini Nano.

### The same laptop on Gemma 4

With Chrome's "Gemma 4 for Built-in AI" flag on, the same laptop answered through Gemma 4 (54 tickets, report saved on 15 Nov):

| Step | Good on device | Median, device vs cloud | Route |
| --- | --- | --- | --- |
| Triage the ticket | 51 of 54 (at least 87%) | 2.1 s vs 1.1 s | Device only |
| Extract order details | 53 of 54 (at least 92%) | 2.4 s vs 1.1 s | Device only |
| Find personal details | 51 of 54 (at least 87%) | 2.4 s vs 869 ms | Device only |

All three personal-detail misses left out a customer's name (one, ticket 24, also missed two street addresses), the same weakness Gemini Nano 4 Fast shows below. The published web routes stay on the Gemini Nano 3 run, the model a visitor's Chrome uses by default.

### On a phone

Google Pixel 11 Pro, Android 17, 15 Nov 2026, Gemini Nano 4 Full (AICore developer preview) against gemini-3.5-flash-lite, 54 fictional tickets per step, checked against known answers. Every phone answer ran on the phone. Published as the Remote Config parameter `routewise_policy_android`.

| Step | Good on the phone | Good in the cloud | Median, phone vs cloud | Route |
| --- | --- | --- | --- | --- |
| Triage the ticket | 54 of 54 (at least 95%) | 52 of 54 | 1,719 ms vs 785 ms | Device only |
| Extract order details | 53 of 54 (at least 92%) | 51 of 54 | 2,025 ms vs 890 ms | Device only |
| Find personal details | 54 of 54 (at least 95%) | 54 of 54 | 1,849 ms vs 847 ms | Device only |

"At least" is the 95% confidence lower bound on 54 tickets of this test set, not a promise for every inbox. The phone's one miss dropped the prefix of order H-2291. Both of the cloud's triage misses were service errors that persisted after retries. On this model the phone takes about two seconds a ticket, roughly twice the cloud, and the ticket never leaves the phone.

The same phone on Gemini Nano 4 Fast, the same day and tickets, trades accuracy at finding people for speed:

| Step | Good on the phone | Good in the cloud | Median, phone vs cloud | Route |
| --- | --- | --- | --- | --- |
| Triage the ticket | 54 of 54 (at least 95%) | 54 of 54 | 171 ms vs 816 ms | Device only |
| Extract order details | 53 of 54 (at least 92%) | 51 of 54 | 535 ms vs 836 ms | Device only |
| Find personal details | 49 of 54 (at least 82%) | 54 of 54 | 602 ms vs 829 ms | Device only |

All five of Fast's misses on personal details left out a customer's name (one, ticket 24, also missed two street addresses). Emails and phone numbers are also caught by fixed rules, names are not, which is why the owner reviews the text before anything reaches the cloud. Full is the model to pick when a step must find people; Fast is the better choice for sorting.

### A model for each step

With complete runs on both models, the phone's Calibrate tab picks, for each step, the quickest model that clears that step's bar: 90% (95% confidence lower bound) for finding names, 70% for the rest. From the two runs above:

| Step | Model | Why |
| --- | --- | --- |
| Triage the ticket | Gemini Nano 4 Fast | Both 54 of 54; Fast's median is 171 ms against 1,719 ms |
| Extract order details | Gemini Nano 4 Fast | Both 53 of 54; Fast's median is 535 ms against 2,025 ms |
| Find personal details | Gemini Nano 4 Full | Full 54 of 54 clears 90%; Fast's 49 of 54 (at least 82%) does not |

The routes are published with the model named per step, and the open app follows them through Remote Config without a release. On 15 Nov, with everything on Fast, Tomás Rivera's ticket would have gone to the cloud as "Tomás Rivera, [EMAIL 1]"; after the per-step routes arrived, the same ticket went as "[NAME 1], [EMAIL 1]", with the names found on Nano 4 Full in 2,747 ms. Sorting stayed on Fast.

Calibration records which model it measured, so the routes say what they were measured on. If a route names a model the phone does not have, the phone's own on-device model answers instead. On Android, as on the web, finding personal details never goes to the cloud: without an on-device answer, fixed rules find emails and phone numbers and the owner adds the rest. Replies and summaries are not calibrated on the phone (they need a reviewing model) and follow the web routes.

## Repository layout

| Folder | What lives there |
| --- | --- |
| `packages/core` | The engine (`@routewise/core`): calibration, scoring, masking, policy, runtime router, exporters, tests |
| `apps/web` | The React web app: Shopdesk, Routes, Calibrate and Runs. `e2e/` holds a stand-in for Firebase AI Logic, used for screenshots without a Firebase project |
| `apps/android` | Shopdesk for Android (Kotlin, Compose): the same flow on a phone, with on-phone calibration of the steps that have known answers and its own routes in Remote Config. See its [README](apps/android/README.md) |
| `backend/firebase` | Firebase backend configuration: Remote Config template and service settings |
| `infra` | Hosting config, deploy script (CI in `.github/workflows`) |
| `docs` | [Architecture](docs/ARCHITECTURE.md) and [measurement method](docs/METHOD.md) |

There is no custom server. Firebase AI Logic is the backend, and every model call goes through it.

## How Firebase AI Logic is used

| What | Where |
| --- | --- |
| `getAI`, `GoogleAIBackend`, `getGenerativeModel` with `InferenceMode` per feature | `packages/core/src/runner.ts` |
| `inCloudParams` (model, temperature 0, `responseSchema`) and `onDeviceParams` (text-only `createOptions`, `responseConstraint`) | `packages/core/src/runner.ts` |
| `initializeDeviceModel` behind a user click | `apps/web/src/ui/Calibrate.tsx` |
| `response.inferenceSource` to report where each answer ran | `packages/core/src/runner.ts`, `packages/core/src/router.ts` |
| App Check (debug token in development only, reCAPTCHA Enterprise when hosted) | `apps/web/src/firebase.ts` |
| Remote Config for the policy, with live updates; Performance Monitoring for routing traces | `apps/web/src/livePolicy.ts`, `packages/core/src/router.ts` |
| Android: `Firebase.ai(...).generativeModel` with `OnDeviceConfig` (mode and Gemini Nano model per step) | `apps/android/.../Ai.kt`, `Router.kt` |
| Android: Remote Config `routewise_policy_android` with live updates | `apps/android/.../Policy.kt` |
| Android: App Check (debug provider in debug builds, Play Integrity in release builds) | `apps/android/.../ShopdeskApp.kt`, `app/build.gradle.kts` |

## Run it

To look around without any setup, use the [live site](https://routewise-ba016.web.app). Running your own copy needs a Firebase project with AI Logic, App Check and Remote Config ([backend/README.md](backend/README.md)) and Node.js 22.12 or newer. Calibration needs desktop Chrome 139 or newer with Gemini Nano available. Shopdesk works in any browser: without an on-device model every step uses the cloud, and personal details are sent only after the user agrees.

```
npm install
cp apps/web/.env.example apps/web/.env.local   # add your Firebase web app config
npm run dev                                    # http://localhost:5173
npm test
```

Firebase setup steps are in [backend/README.md](backend/README.md), and deployment is in [infra/README.md](infra/README.md).

To publish a policy, download the Remote Config value from the Routes tab and paste the file's contents as the value of the `routewise_policy` parameter. To give visitors without Gemini Nano real numbers, save a report from a real run as `apps/web/public/reports/recorded.json`.

The measurement method is described in [docs/METHOD.md](docs/METHOD.md).

## License

Apache-2.0
