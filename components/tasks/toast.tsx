"use client";

// A single quiet toast line. `ToastHost` is mounted once by AppLifecycle in
// the app shell (eagerly — never inside a code-split component, or toasts
// fired before that chunk loads are lost), so any client component can call
// `toast()` without extra wiring.
//
// A toast may carry one action ("Undo", "Review"): a same-tab callback or an
// href. An action toast lingers longer, and firing the action dismisses it.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";

const EVENT = "lifeos:toast";
const PLAIN_MS = 3200;
const ACTION_MS = 6000;

export interface ToastAction {
  label: string;
  /** Same-tab callback (e.g. undo). Wins over href when both are set. */
  onPress?: () => void;
  /** Navigation action (e.g. review a filed capture). */
  href?: string;
}

interface ToastDetail {
  message: string;
  action?: ToastAction;
}

export function toast(message: string, action?: ToastAction) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<ToastDetail>(EVENT, { detail: { message, action } }));
}

export function ToastHost() {
  const [current, setCurrent] = useState<ToastDetail | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const onToast = (e: Event) => {
      const detail = (e as CustomEvent<ToastDetail>).detail;
      setCurrent(detail);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(
        () => setCurrent(null),
        detail.action ? ACTION_MS : PLAIN_MS,
      );
    };
    window.addEventListener(EVENT, onToast);
    return () => {
      window.removeEventListener(EVENT, onToast);
      clearTimeout(timerRef.current);
    };
  }, []);

  if (!current) return null;
  const { message, action } = current;

  const dismiss = () => {
    clearTimeout(timerRef.current);
    setCurrent(null);
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex justify-center px-4 md:bottom-8"
    >
      <p className="pointer-events-auto flex items-center gap-3 rounded-card border border-line bg-paper px-4 py-2 text-[13px] text-ink shadow-whisper supports-[backdrop-filter]:bg-paper/90 supports-[backdrop-filter]:backdrop-blur-xl">
        {message}
        {action?.onPress ? (
          <button
            type="button"
            onClick={() => {
              action.onPress?.();
              dismiss();
            }}
            className="-my-1 h-8 shrink-0 px-1 font-medium text-accent"
          >
            {action.label}
          </button>
        ) : action?.href ? (
          <Link
            href={action.href}
            onClick={dismiss}
            className="-my-1 flex h-8 shrink-0 items-center px-1 font-medium text-accent"
          >
            {action.label}
          </Link>
        ) : null}
      </p>
    </div>
  );
}
