"use client";

// A single quiet toast line. `ToastHost` is mounted once by the command
// palette (which lives in the app shell), so any client component can call
// `toast()` without extra wiring.
import { useEffect, useState } from "react";

const EVENT = "lifeos:toast";

export function toast(message: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<string>(EVENT, { detail: message }));
}

export function ToastHost() {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onToast = (e: Event) => {
      setMessage((e as CustomEvent<string>).detail);
      clearTimeout(timer);
      timer = setTimeout(() => setMessage(null), 3200);
    };
    window.addEventListener(EVENT, onToast);
    return () => {
      window.removeEventListener(EVENT, onToast);
      clearTimeout(timer);
    };
  }, []);

  if (!message) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex justify-center px-4 md:bottom-8"
    >
      <p className="rounded-card border border-line bg-paper px-4 py-2 text-[13px] text-ink shadow-whisper">
        {message}
      </p>
    </div>
  );
}
