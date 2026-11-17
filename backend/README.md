# Backend

Routewise has no server of its own, by design. Every model call goes from the browser through **Firebase AI Logic**, which is the backend: it holds the Gemini API key, enforces App Check and forwards requests to Gemini. This folder keeps that backend's configuration as code, so a new project can be set up the same way.

## Firebase services

| Service | Setting | Why |
| --- | --- | --- |
| AI Logic | Provider: Gemini Developer API | No-cost start, no billing needed |
| AI Logic | App Check: enforced | Blocks requests that do not come from the registered app |
| AI Logic | Template-only mode: unenforced | Calibration needs free-form prompts |
| App Check | Web app provider: reCAPTCHA Enterprise (hosted), debug tokens (local) | Required by AI Logic |
| Remote Config | `firebase/remoteconfig.template.json` | Ships the routing policy without an app update |
| Performance Monitoring | Custom trace `routewise_generate` (attributes: task, source, mode, escalated) | Shows real routing decisions in production |

## Setting up a new project

1. Create a Firebase project and register a web app. Put its config in `apps/web/.env.local`.
2. AI Logic: choose the Gemini Developer API. App Check enforcement is switched on as part of this.
3. App Check: add a debug token for local work (Apps > routewise-web > Manage debug tokens). For hosting, register reCAPTCHA Enterprise and set `VITE_RECAPTCHA_SITE_KEY`.
4. Remote Config: create the parameters from `firebase/remoteconfig.template.json` in the console (the template documents them). Publish routes from the app's Routes page; deploys never overwrite them.
5. Performance Monitoring: open it once in the console so traces are collected.

Never commit `.env.local`, debug tokens or service-account keys.
