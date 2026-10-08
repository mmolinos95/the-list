"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import type { ActionResult } from "@/app/admin/actions";
import { Button, cx, type ButtonKind } from "./ui";

// Building blocks for the board screens: sheets, confirmations, and a
// one-line status message after each action.

/** Runs a server action and keeps its outcome for <Flash>. */
export function useAction() {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  function run(action: () => Promise<ActionResult>, onOk?: (r: ActionResult) => void) {
    setResult(null);
    start(async () => {
      const r = await action();
      setResult(r);
      if (r.ok) onOk?.(r);
    });
  }
  return { pending, result, run, clear: () => setResult(null) };
}

/** The outcome of the last action, as a dismissable banner. */
export function Flash({ result, onClose }: { result: ActionResult | null; onClose?: () => void }) {
  if (!result || (result.ok && !result.message)) return null;
  return (
    <div
      role="status"
      className={cx(
        "flex items-start justify-between gap-3 rounded-xl px-4 py-3 text-sm",
        result.ok ? "bg-ink text-white" : "bg-kickoff/10 font-semibold text-kickoff",
      )}
    >
      <span>{result.ok ? result.message : result.error}</span>
      {onClose && (
        <button onClick={onClose} className="shrink-0 opacity-70 hover:opacity-100" aria-label="Dismiss">
          ✕
        </button>
      )}
    </div>
  );
}

/** Bottom sheet on phones, centered dialog on desktop. */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="m-0 mt-auto max-h-[90dvh] w-full max-w-none rounded-t-2xl bg-white p-0 text-ink backdrop:bg-ink/50 sm:m-auto sm:max-w-md sm:rounded-2xl"
    >
      {open && (
        <div className="p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          <div className="mb-4 flex items-start justify-between gap-3">
            <h2 className="font-display text-3xl leading-none">{title}</h2>
            <button onClick={onClose} className="-mr-1 -mt-1 rounded-full p-2 text-muted hover:bg-page" aria-label="Close">
              ✕
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}

/**
 * A button that asks first. The sheet says exactly what will happen
 * ("Email 34 players"), per the design rules in SCREENS.md.
 */
export function ConfirmButton({
  label,
  title,
  body,
  confirm,
  kind = "primary",
  confirmKind,
  className = "",
  action,
  onDone,
  disabled,
}: {
  label: ReactNode;
  title: string;
  body: ReactNode;
  confirm: string;
  kind?: ButtonKind;
  confirmKind?: ButtonKind;
  className?: string;
  action: () => Promise<ActionResult>;
  onDone?: (r: ActionResult) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { pending, result, run } = useAction();
  return (
    <>
      <Button kind={kind} className={className} onClick={() => setOpen(true)} disabled={disabled} type="button">
        {label}
      </Button>
      <Sheet open={open} onClose={() => setOpen(false)} title={title}>
        <div className="space-y-4">
          <div className="text-[15px] leading-relaxed">{body}</div>
          {result && !result.ok && <Flash result={result} />}
          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <Button
              kind={confirmKind ?? (kind === "danger" ? "danger" : "primary")}
              disabled={pending}
              className="flex-1"
              onClick={() =>
                run(action, (r) => {
                  setOpen(false);
                  onDone?.(r);
                })
              }
            >
              {pending ? "Working…" : confirm}
            </Button>
            <Button kind="ghost" className="flex-1" onClick={() => setOpen(false)} type="button">
              Never mind
            </Button>
          </div>
        </div>
      </Sheet>
    </>
  );
}

/** The "⋯" menu for secondary actions. */
export function MoreMenu({ items }: { items: { label: string; onClick: () => void; danger?: boolean }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex size-12 items-center justify-center rounded-lg border-2 border-core bg-white text-2xl leading-none text-core hover:bg-columbia-50"
        aria-label="More actions"
        aria-expanded={open}
      >
        ⋯
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 w-56 overflow-hidden rounded-xl bg-white py-1 shadow-lg ring-1 ring-line">
          {items.map((it) => (
            <button
              key={it.label}
              onClick={() => {
                setOpen(false);
                it.onClick();
              }}
              className={cx("block w-full px-4 py-3 text-left text-[15px] hover:bg-page", it.danger ? "text-kickoff" : "text-ink")}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
