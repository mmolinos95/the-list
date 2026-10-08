"use client";

import { Field, inputClass, cx } from "./ui";

// The usual reasons, one tap each. The text stays editable, and it's what
// members see on the practice page and in the "Practice is off" email.
const QUICK = ["Low attendance", "Bad weather", "Field unavailable"];

export function CancelReason({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Field label="Why? (optional)" hint="Shown on the practice page and in the email to everyone on the list.">
      <div className="mb-2 flex flex-wrap gap-2">
        {QUICK.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => onChange(q)}
            className={cx(
              "rounded-full border px-3 py-1 text-sm font-semibold transition-colors",
              value === q ? "border-core bg-core text-white" : "border-line bg-white text-ink hover:border-core",
            )}
          >
            {q}
          </button>
        ))}
      </div>
      <input name="reason" value={value} onChange={(e) => onChange(e.target.value)} className={inputClass} placeholder="Or write your own" maxLength={300} />
    </Field>
  );
}
