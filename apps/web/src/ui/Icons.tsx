import type { SVGProps } from 'react';

/** A small line-icon set drawn for Routewise: 20px grid, 1.6 stroke, round joins. */
function Icon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 20 20"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    />
  );
}

export const IconDevice = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <rect x="3.5" y="4" width="13" height="9" rx="1.2" />
    <path d="M2 15.5h16" />
  </Icon>
);

export const IconCloud = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M6 15h8.2a3.3 3.3 0 0 0 .4-6.6A4.6 4.6 0 0 0 5.8 9.2 3 3 0 0 0 6 15Z" />
  </Icon>
);

export const IconShield = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M10 2.8 4.5 5v4.3c0 3.6 2.4 6.3 5.5 7.9 3.1-1.6 5.5-4.3 5.5-7.9V5L10 2.8Z" />
    <path d="m7.6 10 1.7 1.7 3.2-3.4" />
  </Icon>
);

export const IconClock = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <circle cx="10" cy="10" r="6.8" />
    <path d="M10 6.2V10l2.6 1.6" />
  </Icon>
);

export const IconAlert = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M10 3.2 2.8 16h14.4L10 3.2Z" />
    <path d="M10 8.2v3.4M10 13.8v.1" />
  </Icon>
);

export const IconInfo = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <circle cx="10" cy="10" r="6.8" />
    <path d="M10 9.2v4.2M10 6.6v.1" />
  </Icon>
);

export const IconChevron = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="m7.5 5 5 5-5 5" />
  </Icon>
);

export const IconDownload = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M10 3.5v9M6.3 9 10 12.6 13.7 9M4 16.2h12" />
  </Icon>
);

export const IconUpload = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M10 13V4M6.3 7.5 10 3.9l3.7 3.6M4 16.2h12" />
  </Icon>
);

/** The Routewise mark: one line that forks in two. */
export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="var(--ink)" />
      <path d="M5 16h8c4 0 5-7 9-7h5" fill="none" stroke="var(--device-on-ink)" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M13 16c4 0 5 7 9 7h5" fill="none" stroke="var(--cloud-on-ink)" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}
