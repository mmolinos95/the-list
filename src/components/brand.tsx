// The crest: a shield that is also a list. Two gold checks are confirmed
// spots; the dashed ring is the waitlist. Drawn from the Figma brand file.

export function Crest({ onBlue = false, className = "" }: { onBlue?: boolean; className?: string }) {
  const shield = onBlue ? "#FFFFFF" : "#B9D9EB";
  const bar = onBlue ? "#B9D9EB" : "#FFFFFF";
  return (
    <svg viewBox="0 0 120 140" className={className} aria-hidden="true">
      <path
        d="M60 4L112 18V70C112 104 88 126 60 136C32 126 8 104 8 70V18L60 4Z"
        fill={shield}
        stroke={onBlue ? "none" : "#1D4F91"}
        strokeWidth="5"
        strokeLinejoin="round"
      />
      <circle cx="36" cy="46" r="8" fill="#E3B43C" />
      <path d="M32 46L35 49L40 43" stroke="#111418" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <rect x="52" y="41" width="38" height="10" rx="5" fill={bar} />
      <circle cx="36" cy="72" r="8" fill="#E3B43C" />
      <path d="M32 72L35 75L40 69" stroke="#111418" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <rect x="52" y="67" width="38" height="10" rx="5" fill={bar} />
      <circle cx="36" cy="98" r="7" fill="none" stroke="#E3B43C" strokeWidth="2.5" strokeDasharray="4 3" />
      <rect x="52" y="93" width="26" height="10" rx="5" fill={bar} opacity="0.45" />
    </svg>
  );
}

/** Crest + "CBS FC / THE LIST" wordmark. */
export function Lockup({ onBlue = true, size = "md" }: { onBlue?: boolean; size?: "sm" | "md" }) {
  const sm = size === "sm";
  return (
    <span className="inline-flex items-center gap-2">
      <Crest onBlue={onBlue} className={sm ? "h-8 w-auto" : "h-11 w-auto"} />
      <span className="flex flex-col leading-none">
        <span className={`font-bold tracking-[0.2em] ${sm ? "text-[8px]" : "text-[9px]"} ${onBlue ? "text-ink" : "text-core"}`}>CBS FC</span>
        <span className={`font-display ${sm ? "text-2xl" : "text-[34px]"} ${onBlue ? "text-white" : "text-core"} [text-shadow:0_1px_0_rgb(17_20_24/0.08)]`}>
          THE LIST
        </span>
      </span>
    </span>
  );
}
