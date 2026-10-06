// Shared class strings for the kit (Tailwind scans .ts files too).
export const ring = "outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-1 focus-visible:ring-offset-bg";

export type Variant = "primary" | "secondary" | "ghost" | "danger";
export const variants: Record<Variant, string> = {
  primary: "bg-accent text-white hover:brightness-110",
  secondary: "bg-fill text-ink-2 hover:bg-line-strong hover:text-ink",
  ghost: "text-sub hover:bg-hover hover:text-ink",
  danger: "bg-bad/12 text-bad hover:bg-bad/20",
};

export type Tone = "neutral" | "accent" | "good" | "warn" | "bad";
export const tones: Record<Tone, string> = {
  neutral: "bg-fill text-ink-2",
  accent: "bg-accent/14 text-accent-ink",
  good: "bg-good/14 text-good",
  warn: "bg-warn/14 text-warn",
  bad: "bg-bad/14 text-bad",
};
