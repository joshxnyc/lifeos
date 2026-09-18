import Link from "next/link";

// Public legal pages (/privacy, /terms): outside the (app) group so they get
// no shell and no auth, and whitelisted in middleware.ts. Google's OAuth
// consent screen links here, so they must render signed out.
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-[680px] px-5 pb-16 pt-safe">
      <div className="pt-10 pb-2">
        <Link href="/" className="font-display text-[17px] font-semibold text-ink">
          LifeOS
        </Link>
      </div>
      {children}
      <footer className="mt-12 flex gap-5 border-t border-line pt-4 text-[13px] text-ink-2">
        <Link href="/privacy" className="hover:text-ink">
          Privacy
        </Link>
        <Link href="/terms" className="hover:text-ink">
          Terms
        </Link>
        <Link href="/login" className="hover:text-ink">
          Sign in
        </Link>
      </footer>
    </main>
  );
}
