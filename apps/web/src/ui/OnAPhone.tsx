import { useEffect, useState } from 'react';
import { nanoAvailability } from '@routewise/core';

type Go = 'desk' | 'routes' | 'calibrate' | 'runs';

/**
 * The phone result, shown as it was recorded: screen captures from a Pixel 11 Pro, not a mock-up.
 * Most visitors' browsers have no on-device model, so this is what they can check without one,
 * followed by what their own browser can do.
 */
export function OnAPhone({ go }: { go: (t: Go) => void }) {
  const [nano, setNano] = useState<string>('checking');
  useEffect(() => { nanoAvailability().then(setNano).catch(() => setNano('unavailable')); }, []);

  return (
    <section className="panel phone-proof" aria-labelledby="phone-title">
      <h2 id="phone-title">The same ticket, before and after a route change</h2>
      <p className="note">
        Recorded on a Google Pixel 11 Pro on 15 Nov 2026. Measured on 54 tickets, Gemini Nano 4 Fast sorted every one correctly, typically in 171 ms,
        but left out a customer's name 5 times; Gemini Nano 4 Full found every name. Routewise gave each step its own model and published
        the routes through Remote Config. The open app followed them, without a release.
      </p>

      <div className="proof-pair">
        <figure>
          <figcaption><b>Before:</b> every step on Gemini Nano 4 Fast. The text bound for the cloud still carries the name.</figcaption>
          <img src="/evidence/tomas-fast.webp" alt="Text bound for the cloud: 'Is this a known defect? Tomás Rivera, [EMAIL 1]'" width={912} height={160} />
        </figure>
        <figure>
          <figcaption><b>After:</b> sorting on Fast, finding names on Gemini Nano 4 Full. The name is replaced before anything leaves the phone.</figcaption>
          <img src="/evidence/tomas-per-step.webp" alt="Text bound for the cloud: 'Is this a known defect? [NAME 1], [EMAIL 1]'" width={912} height={160} />
          <img src="/evidence/tomas-finder.webp" alt="Personal details: on this phone, Nano 4 Full, 2,747 ms" width={811} height={70} className="proof-pill" />
        </figure>
      </div>

      <details className="proof-more">
        <summary>How the phone chose a model for each step</summary>
        <img src="/evidence/model-per-step.webp" alt="Calibrate tab: Triage and order details on Nano 4 Fast as the quickest that clears 70%; finding personal details on Nano 4 Full, the only one that clears 90% (Fast: 49 of 54)" width={996} height={1367} loading="lazy" />
      </details>

      <p className="proof-you">
        {nano === 'checking' && 'Checking whether this browser has an on-device model…'}
        {nano === 'available' && 'This browser has an on-device model, so Shopdesk runs live here: sorting and reading order details on this computer.'}
        {(nano === 'downloadable' || nano === 'downloading') && 'This browser can download an on-device model. Shopdesk offers to prepare it, or to use the cloud with your agreement.'}
        {(nano === 'unavailable' || nano === 'unsupported' || nano === 'unknown') && 'This browser has no on-device model (desktop Chrome has one). Shopdesk still works: it asks before sending a ticket to the cloud, and replies are always written from text with personal details removed.'}
        {' '}
        <button className="btn link" onClick={() => go('desk')}>Open Shopdesk</button>
      </p>
    </section>
  );
}
