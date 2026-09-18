import { envHealth } from "@/lib/env";
import { cn } from "@/lib/utils";

/**
 * Names-only view of which server env vars the deployment can see, so a
 * misconfigured Vercel project is diagnosable from the app itself. Values
 * are never read or shown.
 */
export function EnvHealth() {
  const rows = envHealth();
  const missing = rows.filter((r) => !r.set);
  if (missing.length === 0) return null;

  return (
    <section className="mb-6 rounded-card border border-warn/40 bg-paper-2 p-4">
      <h2 className="section-label mb-2">Configuration incomplete</h2>
      <p className="mb-3 text-[14px] text-ink-2">
        These environment variables are not set in Vercel. Each one disables the
        feature listed next to it. Add them under Settings → Environment
        Variables, then redeploy.
      </p>
      <ul className="flex flex-col gap-1.5">
        {rows.map((r) => (
          <li key={r.key} className="flex items-baseline gap-2 text-[13px]">
            <span
              className={cn("relative top-[-1px] size-[7px] shrink-0 rounded-full", r.set ? "bg-ok" : "bg-danger")}
              aria-hidden
            />
            <code className="font-mono text-[12px] text-ink">{r.key}</code>
            <span className="text-ink-2">— {r.set ? "set" : `missing · ${r.neededFor}`}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
