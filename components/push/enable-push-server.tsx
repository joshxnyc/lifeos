import { createClient } from "@/lib/supabase/server";
import { serverEnv } from "@/lib/env";
import { EnablePush, type PushDevice } from "./enable-push";

/**
 * The VAPID public key lives in server env (SPEC §3), not NEXT_PUBLIC_*, so a
 * server component reads it and hands it to the client component as a prop.
 * It also reads the push_subscriptions rows: the server's view is the truth
 * about which devices actually receive push (lib/push.ts deletes a row after
 * repeated 410s), so the panel renders those rows rather than trusting the
 * browser's local getSubscription(). Import this one from Settings and
 * anywhere else the opt-in belongs.
 */
export async function EnablePushSection() {
  const key = serverEnv().VAPID_PUBLIC_KEY;
  if (!key) {
    return (
      <p className="text-[13px] text-ink-2">
        VAPID_PUBLIC_KEY is not set, so this deployment cannot send push. Add the key pair to the
        environment and redeploy.
      </p>
    );
  }
  const supabase = await createClient();
  const { data } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, device_label, last_used_at, failed_count")
    .order("created_at", { ascending: true });
  return <EnablePush vapidPublicKey={key} devices={(data ?? []) as PushDevice[]} />;
}
