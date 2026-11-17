import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { getAI, GoogleAIBackend } from 'firebase/ai';
import { getRemoteConfig } from 'firebase/remote-config';
import { getPerformance } from 'firebase/performance';
import { configureRoutewise } from '@routewise/core';

// Each variable is read by name. Reading import.meta.env as a whole object would make the build
// copy every VITE_ variable into the page, including a local debug token.
export const app = initializeApp({
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
});

const siteKey: string | undefined = import.meta.env.VITE_RECAPTCHA_SITE_KEY;

// Debug tokens are only for local development. The DEV check is replaced at build time, so a
// production build drops this branch and the token never reaches the hosted page.
let debug = false;
if (import.meta.env.DEV && import.meta.env.VITE_APPCHECK_DEBUG === 'true') {
  debug = true;
  (self as any).FIREBASE_APPCHECK_DEBUG_TOKEN = import.meta.env.VITE_APPCHECK_DEBUG_TOKEN || true;
}

export const appCheckConfigured = debug || !!siteKey;
if (appCheckConfigured) {
  initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(siteKey || 'debug-only'),
    isTokenAutoRefreshEnabled: true,
  });
}

export const ai = getAI(app, { backend: new GoogleAIBackend() });

export const remoteConfig = getRemoteConfig(app);
remoteConfig.settings.minimumFetchIntervalMillis = 60_000;
remoteConfig.defaultConfig = { routewise_policy: '' };

export const perf = getPerformance(app);

configureRoutewise({ ai, performance: perf });
