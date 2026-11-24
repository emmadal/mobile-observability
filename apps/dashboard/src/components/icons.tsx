import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

/** 16px stroke icons drawn for this dashboard; decorative unless labelled. */
function Icon({ children, ...props }: IconProps) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

/** Product mark: a handset outline carrying a heartbeat trace. */
export function MarkIcon(props: IconProps) {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true" {...props}>
      <rect
        x="7"
        y="2.75"
        width="14"
        height="22.5"
        rx="3.25"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M3 14.5h6.2l1.8-4.2 2.6 8.4 2.4-6.2 1.4 2h7.6"
        className="stroke-series"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function OverviewIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2.5 11.5a5.5 5.5 0 1 1 11 0" />
      <path d="M8 11.5 10.5 7" />
      <path d="M2.5 13.5h11" />
    </Icon>
  );
}

export function IssuesIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 2.2 14.2 13H1.8Z" />
      <path d="M8 6.5v3" />
      <path d="M8 11.4v.1" />
    </Icon>
  );
}

export function SessionsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="4.25" y="1.75" width="7.5" height="12.5" rx="1.75" />
      <path d="M7 11.75h2" />
    </Icon>
  );
}

export function PerformanceIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="8" cy="9" r="5.25" />
      <path d="M8 9V6.25" />
      <path d="M6.5 1.75h3" />
    </Icon>
  );
}

export function ReleasesIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2 2.75h5.25L14 9.5 9.5 14 2.75 7.25V2.75Z" />
      <circle cx="5.25" cy="5.25" r=".9" />
    </Icon>
  );
}

export function SettingsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2.5 4.5h11M2.5 11.5h11" />
      <circle cx="6" cy="4.5" r="1.75" className="fill-panel" />
      <circle cx="10.5" cy="11.5" r="1.75" className="fill-panel" />
    </Icon>
  );
}

export function AccountIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="8" cy="5.5" r="2.75" />
      <path d="M2.75 14a5.25 5.25 0 0 1 10.5 0" />
    </Icon>
  );
}

export function SignOutIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6.5 2.5h-3a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h3" />
      <path d="M10.5 5 13.5 8l-3 3M13.5 8H6.5" />
    </Icon>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m3.5 8.5 3 3 6-7" />
    </Icon>
  );
}

export function WarningIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 2.2 14.2 13H1.8Z" />
      <path d="M8 6.5v3M8 11.4v.1" />
    </Icon>
  );
}

export function CrashIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="8" cy="8" r="6" />
      <path d="m5.75 5.75 4.5 4.5M10.25 5.75l-4.5 4.5" />
    </Icon>
  );
}

export function CopyIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="5.25" y="5.25" width="8" height="8" rx="1.5" />
      <path d="M10.75 5.25V3.5a1 1 0 0 0-1-1H3.5a1 1 0 0 0-1 1v6.25a1 1 0 0 0 1 1h1.75" />
    </Icon>
  );
}
