"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function login(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  let failure: string | null = null;
  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) failure = "Sign-in failed. Check email and password.";
  } catch {
    // createClient throws when the Supabase env vars are absent — say so
    // plainly instead of surfacing Next's server-exception page.
    failure =
      "The app is not connected to its database. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in Vercel, then redeploy.";
  }
  if (failure) redirect(`/login?error=${encodeURIComponent(failure)}`);
  redirect("/today");
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
