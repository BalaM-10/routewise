import type { Mode } from '@routewise/core';

/**
 * The route of one feature, drawn as a junction: the input line splits towards the device
 * (upper branch) and the cloud (lower branch). The chosen branch is strong, a fallback is thin,
 * and a branch the policy never uses is dashed and stopped.
 */
export function Junction({ mode, width = 132 }: { mode: Mode; width?: number }) {
  const device = mode === 'PREFER_ON_DEVICE' || mode === 'ONLY_ON_DEVICE' ? 'main' : mode === 'PREFER_IN_CLOUD' ? 'fallback' : 'blocked';
  const cloud = mode === 'PREFER_IN_CLOUD' || mode === 'ONLY_IN_CLOUD' ? 'main' : mode === 'PREFER_ON_DEVICE' ? 'fallback' : 'blocked';
  const stroke = (kind: string) => (kind === 'main' ? 3 : kind === 'fallback' ? 1.4 : 1.4);
  const dash = (kind: string) => (kind === 'blocked' ? '3 4' : undefined);
  const label =
    mode === 'PREFER_ON_DEVICE' ? 'Device first, cloud as fallback'
    : mode === 'ONLY_ON_DEVICE' ? 'Device only, cloud never used without consent'
    : mode === 'PREFER_IN_CLOUD' ? 'Cloud first, device as offline fallback'
    : 'Cloud only';
  return (
    <svg viewBox="0 0 132 40" width={width} height={(width * 40) / 132} role="img" aria-label={label} className="junction">
      <path d="M2 20h38" stroke="var(--ink)" strokeWidth="3" strokeLinecap="round" fill="none" />
      <circle cx="40" cy="20" r="3.2" fill="var(--ink)" />
      <path
        d="M40 20c14 0 16-12 32-12h40"
        fill="none"
        stroke="var(--device)"
        strokeWidth={stroke(device)}
        strokeDasharray={dash(device)}
        strokeLinecap="round"
        opacity={device === 'main' ? 1 : 0.55}
      />
      <path
        d="M40 20c14 0 16 12 32 12h40"
        fill="none"
        stroke="var(--cloud)"
        strokeWidth={stroke(cloud)}
        strokeDasharray={dash(cloud)}
        strokeLinecap="round"
        opacity={cloud === 'main' ? 1 : 0.55}
      />
      {device === 'blocked' && <path d="M114 3.5v9" stroke="var(--device)" strokeWidth="1.6" strokeLinecap="round" opacity="0.7" />}
      {cloud === 'blocked' && <path d="M114 27.5v9" stroke="var(--cloud)" strokeWidth="1.6" strokeLinecap="round" opacity="0.7" />}
      {device !== 'blocked' && <circle cx="120" cy="8" r={device === 'main' ? 5 : 3.2} fill={device === 'main' ? 'var(--device)' : 'var(--surface)'} stroke="var(--device)" strokeWidth="1.6" />}
      {cloud !== 'blocked' && <circle cx="120" cy="32" r={cloud === 'main' ? 5 : 3.2} fill={cloud === 'main' ? 'var(--cloud)' : 'var(--surface)'} stroke="var(--cloud)" strokeWidth="1.6" />}
    </svg>
  );
}

export const ROUTE_TEXT: Record<Mode, string> = {
  PREFER_ON_DEVICE: 'Device first',
  ONLY_ON_DEVICE: 'Device only',
  PREFER_IN_CLOUD: 'Cloud first',
  ONLY_IN_CLOUD: 'Cloud only',
};

export const isDeviceRoute = (m: Mode) => m === 'PREFER_ON_DEVICE' || m === 'ONLY_ON_DEVICE';
