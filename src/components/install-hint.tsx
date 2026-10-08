"use client";

import { useEffect, useState } from "react";
import { Button } from "./ui";

// A one-time tip on phones: put the board on the home screen. Android/Chrome
// offers a real Install button; iPhone needs Share → Add to Home Screen.
// Hidden once installed, on computers, or after "Not now".

const DISMISSED = "thelist:install-hint";
type InstallEvent = Event & { prompt: () => Promise<void> };

export function InstallHint() {
  const [mode, setMode] = useState<"ios" | "android" | null>(null);
  const [install, setInstall] = useState<InstallEvent | null>(null);

  useEffect(() => {
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(DISMISSED) === "1";
    } catch {}
    const standalone = matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone;
    if (dismissed || standalone) return;
    // iPhone Safari (iPads report as Mac, but have touch).
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (/macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
    // Browser storage and the install prompt only exist after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (ios) setMode("ios");
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstall(e as InstallEvent);
      setMode("android");
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (!mode) return null;
  const dismiss = () => {
    try {
      localStorage.setItem(DISMISSED, "1");
    } catch {}
    setMode(null);
  };

  return (
    <div className="mb-4 rounded-xl bg-columbia-50 p-4 text-sm">
      <p className="font-semibold">Put The List on your home screen</p>
      <p className="mt-1">
        {mode === "ios" ? (
          <>
            Tap <b>Share</b> <span aria-hidden="true">(the square with the arrow)</span>, then <b>Add to Home Screen</b>. You&apos;ll log in once in the app with the code from
            the login email.
          </>
        ) : (
          "It opens straight to your practices, like an app."
        )}
      </p>
      <div className="mt-3 flex gap-2">
        {mode === "android" && install && (
          <Button
            onClick={async () => {
              await install.prompt();
              dismiss();
            }}
          >
            Install
          </Button>
        )}
        <Button kind="ghost" onClick={dismiss}>
          Not now
        </Button>
      </div>
    </div>
  );
}
