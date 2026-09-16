import { z } from "zod";

// Server-only env. Import only from server code (route handlers, server
// actions, jobs). Validated lazily so builds without secrets still succeed.
// Nothing here is min(1): a missing key must degrade the one feature that
// needs it (with a plain-language error at the point of use, via requireEnv),
// never crash whole pages at parse time.
const serverSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional().default(""),
  TOKEN_ENCRYPTION_KEY: z.string().optional().default(""),
  JOBS_SECRET: z.string().optional().default(""),
  OPENROUTER_API_KEY: z.string().optional().default(""),
  OPENAI_API_KEY: z.string().optional().default(""), // optional Whisper fallback only
  GOOGLE_CLIENT_ID: z.string().optional().default(""),
  GOOGLE_CLIENT_SECRET: z.string().optional().default(""),
  NOTION_TOKEN: z.string().optional().default(""),
  GRANOLA_API_KEY: z.string().optional().default(""),
  VAPID_PUBLIC_KEY: z.string().optional().default(""),
  VAPID_PRIVATE_KEY: z.string().optional().default(""),
  VAPID_SUBJECT: z.string().optional().default("mailto:app@localhost"),
  PUSHOVER_USER_KEY: z.string().optional().default(""),
  PUSHOVER_APP_TOKEN: z.string().optional().default(""),
  APP_URL: z.string().optional().default("http://localhost:3000"),
  APP_TIMEZONE: z.string().optional().default("America/New_York"),
});

let cached: z.infer<typeof serverSchema> | null = null;

export function serverEnv() {
  if (!cached) cached = serverSchema.parse(process.env);
  return cached;
}

/** The value, or a clear error naming the Vercel env var to set. */
export function requireEnv(key: keyof z.infer<typeof serverSchema>): string {
  const value = serverEnv()[key];
  if (typeof value !== "string" || !value) {
    throw new Error(`${key} is not set. Add it in Vercel → Settings → Environment Variables and redeploy.`);
  }
  return value;
}

/** Which required/optional server env vars are present — names only, for the
 * Settings health panel. Never returns values. */
export function envHealth(): Array<{ key: string; set: boolean; neededFor: string }> {
  const e = process.env;
  const has = (k: string) => Boolean(e[k] && e[k]!.length > 0);
  return [
    { key: "NEXT_PUBLIC_SUPABASE_URL", set: has("NEXT_PUBLIC_SUPABASE_URL") || has("SUPABASE_URL"), neededFor: "everything — database and sign-in" },
    { key: "NEXT_PUBLIC_SUPABASE_ANON_KEY", set: has("NEXT_PUBLIC_SUPABASE_ANON_KEY") || has("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") || has("SUPABASE_ANON_KEY"), neededFor: "everything — database and sign-in" },
    { key: "SUPABASE_SERVICE_ROLE_KEY", set: has("SUPABASE_SERVICE_ROLE_KEY"), neededFor: "background jobs, capture processing, push" },
    { key: "OPENROUTER_API_KEY", set: has("OPENROUTER_API_KEY"), neededFor: "AI: transcription, filing, extraction, coach" },
    { key: "TOKEN_ENCRYPTION_KEY", set: has("TOKEN_ENCRYPTION_KEY"), neededFor: "connecting Google and Granola accounts" },
    { key: "JOBS_SECRET", set: has("JOBS_SECRET"), neededFor: "scheduled jobs (sync, notifications, briefs)" },
    { key: "VAPID_PUBLIC_KEY", set: has("VAPID_PUBLIC_KEY"), neededFor: "push notifications" },
    { key: "VAPID_PRIVATE_KEY", set: has("VAPID_PRIVATE_KEY"), neededFor: "push notifications" },
    { key: "APP_URL", set: has("APP_URL"), neededFor: "instant capture processing, OAuth redirects" },
    { key: "GOOGLE_CLIENT_ID", set: has("GOOGLE_CLIENT_ID"), neededFor: "Gmail and Calendar (Phase 3, optional for now)" },
    { key: "NOTION_TOKEN", set: has("NOTION_TOKEN"), neededFor: "Notion mirror (Phase 4, optional for now)" },
  ];
}

export function publicEnv() {
  // The Supabase↔Vercel integration has used several names over time.
  // Every candidate is referenced literally so Next can inline the
  // NEXT_PUBLIC_* ones into client bundles.
  return {
    supabaseUrl:
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "",
    supabaseAnonKey:
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ??
      process.env.SUPABASE_ANON_KEY ??
      "",
  };
}
