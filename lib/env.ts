import { z } from "zod";

// Server-only env. Import only from server code (route handlers, server
// actions, jobs). Validated lazily so builds without secrets still succeed.
const serverSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  TOKEN_ENCRYPTION_KEY: z.string().min(1),
  JOBS_SECRET: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
  OPENAI_API_KEY: z.string().optional().default(""),
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

export function publicEnv() {
  return {
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  };
}
