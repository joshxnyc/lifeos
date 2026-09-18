"use client";

import { createBrowserClient } from "@supabase/ssr";
import { publicEnv } from "@/lib/env";

export function createClient() {
  const { supabaseUrl, supabaseAnonKey } = publicEnv();
  return createBrowserClient(supabaseUrl, supabaseAnonKey);
}
