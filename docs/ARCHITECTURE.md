# Architecture

```
 Browser (desktop Chrome)                                  Firebase (backend)
 ┌──────────────────────────────────────────────┐          ┌───────────────────────────┐
 │ apps/web  (React: four pages, see README)     │          │ App Check (enforced)      │
 │      │ uses                                   │  cloud   │ AI Logic ── Gemini API    │
 │ packages/core (@routewise/core)               │ ───────► │ Remote Config (policy)    │
 │   calibrate → policy → router                 │          │ Performance (traces)      │
 │      │ on-device                              │          └───────────────────────────┘
 │ Gemini Nano via Chrome Prompt API             │
 └──────────────────────────────────────────────┘
```

## Folders

| Folder | Layer | Contents |
| --- | --- | --- |
| `packages/core` | Engine (framework-free TypeScript) | Calibration, scoring, statistics, masking, policy, runtime router, exporters, ticket dataset, unit tests |
| `apps/web` | Frontend (React + Vite) | Firebase initialisation and App Check, the four pages (Shopdesk, Routes, Calibrate, Runs), saved runs, test-only stand-in for UI checks |
| `backend/firebase` | Backend configuration | Remote Config template and the AI Logic, App Check and Performance settings |
| `infra` | Infrastructure | Firebase Hosting config, deploy script; CI lives in `.github/workflows` |
| `docs` | Documentation | Architecture and measurement method |

## Boundaries

- `packages/core` never initialises Firebase and never reads credentials. The host app calls `configureRoutewise({ ai, performance })` once. Any web app can use the engine this way.
- `apps/web` owns configuration (`.env.local`), App Check and UI state. It holds no routing or scoring logic.
- All model calls go through Firebase AI Logic. No other model API is called anywhere.
- Policies move between layers as a versioned JSON file (`PolicyFile`), validated by `parsePolicyFile` before use.

## Runtime flow

1. **Calibrate.** For each feature and input, `core` calls the model with `ONLY_ON_DEVICE` and then `ONLY_IN_CLOUD`, scores both answers and stores a `Report`.
   Each finished feature is saved as it completes, and every run is kept in the browser (newest ten) so runs can be compared.
2. **Decide.** `derivePolicy` turns the report into a route, a length limit and the reasons for each feature.
3. **Publish.** The web app exports the policy as a Remote Config value. Clients fetch it at startup and follow its updates. The plugin always follows Remote Config; Shopdesk also keeps a calibration run in the same browser and uses it while it is newer than the published one.
4. **Route.** `createRouter().generate(taskId, input)` applies the route and the length limit, validates on-device output and escalates to the cloud when needed, asks before personal data leaves the device, and records a Performance trace. A step that has not answered within 30 seconds counts as failed, so the normal fallback applies instead of the user waiting.

## Private cloud steps in Shopdesk

1. `router.generate('pii', ticket)` finds personal details, on the device by policy.
2. `mergeEntities` adds emails and phone numbers found by `detectWithRules`.
3. `mask` replaces every occurrence with a placeholder; the owner reviews the list and the exact text.
4. `router.generate('reply' | 'summary', maskedText)` runs in the cloud.
5. `unmask` restores the details in the answer, on the device.
