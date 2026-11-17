import { useEffect, useState } from 'react';
import { activate, fetchAndActivate, getValue, onConfigUpdate } from 'firebase/remote-config';
import { parsePolicyFile } from '@routewise/core';
import type { PolicyFile } from '@routewise/core';
import { remoteConfig } from './firebase';

/** The routes published in Remote Config, kept current while the app is open. */
export function useLivePolicy(): { policy: PolicyFile | null; note: string } {
  const [policy, setPolicy] = useState<PolicyFile | null>(null);
  const [note, setNote] = useState('');

  useEffect(() => {
    const read = () => setPolicy(parsePolicyFile(getValue(remoteConfig, 'routewise_policy').asString()));
    fetchAndActivate(remoteConfig).then(read).catch(() => undefined);
    // A route changed in Remote Config reaches the open app without a reload.
    let unsubscribe = () => {};
    try {
      unsubscribe = onConfigUpdate(remoteConfig, {
        next: () => activate(remoteConfig).then(() => { read(); setNote(`Routes updated from Remote Config at ${new Date().toLocaleTimeString()}.`); }),
        error: () => undefined,
        complete: () => undefined,
      });
    } catch { /* real-time updates unavailable; the routes from start-up still apply */ }
    return () => unsubscribe();
  }, []);

  return { policy, note };
}
