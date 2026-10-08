import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { TEAM_LABEL, type TeamColor } from "@/lib/types";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

// Buttons: Core Blue is reserved for actions, so every clickable thing is blue.

const buttonBase =
  "inline-flex items-center justify-center gap-2 rounded-lg font-display text-xl leading-none px-5 h-12 transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-core";
const buttonKinds = {
  primary: "bg-core text-white hover:bg-core-dark",
  outline: "bg-white text-core border-2 border-core hover:bg-columbia-50",
  danger: "bg-kickoff text-white hover:brightness-95",
  ghost: "text-core hover:bg-columbia-50",
};
export type ButtonKind = keyof typeof buttonKinds;

export function buttonClass(kind: ButtonKind = "primary", extra = "") {
  return cx(buttonBase, buttonKinds[kind], extra);
}

export function Button({ kind = "primary", className = "", ...props }: ComponentProps<"button"> & { kind?: ButtonKind }) {
  return <button className={buttonClass(kind, className)} {...props} />;
}

export function ButtonLink({ kind = "primary", className = "", ...props }: ComponentProps<typeof Link> & { kind?: ButtonKind }) {
  return <Link className={buttonClass(kind, className)} {...props} />;
}

export function TextLink({ className = "", ...props }: ComponentProps<typeof Link>) {
  return <Link className={cx("text-core font-semibold underline-offset-2 hover:underline", className)} {...props} />;
}

// Chips: small all-caps status labels.

const chipKinds = {
  neutral: "bg-white text-ink border border-line",
  blue: "bg-columbia text-ink",
  core: "bg-core text-white",
  gold: "bg-gold text-ink",
  red: "bg-kickoff text-white",
  dark: "bg-ink text-white",
};

export function Chip({ kind = "neutral", children, className = "" }: { kind?: keyof typeof chipKinds; children: ReactNode; className?: string }) {
  return (
    <span className={cx("inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] leading-none whitespace-nowrap", chipKinds[kind], className)}>
      {children}
    </span>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={cx("rounded-2xl bg-white p-5 shadow-[0_1px_2px_rgb(17_20_24/0.06)]", className)}>{children}</div>;
}

export function Label({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={cx("text-[11px] font-bold uppercase tracking-[0.15em] text-muted", className)}>{children}</p>;
}

export function Check() {
  return (
    <svg viewBox="0 0 20 20" className="size-5 shrink-0" aria-label="Confirmed">
      <circle cx="10" cy="10" r="9" fill="#E3B43C" />
      <path d="M6 10.2l2.6 2.6L14 7.4" stroke="#111418" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function WaitRing() {
  return (
    <svg viewBox="0 0 20 20" className="size-5 shrink-0" aria-label="Waitlist">
      <circle cx="10" cy="10" r="7.5" fill="none" stroke="#E3B43C" strokeWidth="2" strokeDasharray="3.5 2.5" />
    </svg>
  );
}

const TEAM_STYLE: Record<TeamColor, string> = {
  black: "bg-ink",
  white: "bg-white",
  red: "bg-kickoff",
  light_blue: "bg-columbia",
};

export function TeamDot({ team, className = "size-5" }: { team: TeamColor; className?: string }) {
  return <span className={cx("inline-block rounded-full border-2 border-ink shrink-0", TEAM_STYLE[team], className)} aria-label={TEAM_LABEL[team]} />;
}

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-semibold">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-muted">{hint}</span>}
      {error && <span className="mt-1 block text-xs font-semibold text-kickoff">{error}</span>}
    </label>
  );
}

export const inputClass =
  "block w-full rounded-lg border border-line bg-white px-3 h-11 text-base outline-none focus:border-core focus:ring-2 focus:ring-core/20 placeholder:text-muted/60";

export { cx };
