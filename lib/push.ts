import "server-only";
import webpush from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/env";
import type { PushSubscriptionRow } from "@/lib/types";

let configured = false;
function configure() {
  if (configured) return;
  const env = serverEnv();
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) throw new Error("VAPID keys not set");
  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
  configured = true;
}

export interface PushMessage {
  title: string;
  body: string;
  url: string;
  tag?: string;
}

/**
 * Send to every registered device. Deletes subscriptions after 3 consecutive
 * 410/404 failures (SPEC §4.5). Falls back to Pushover when enabled.
 * Returns the number of devices that accepted the push.
 */
export async function sendPushToAllDevices(
  supabase: SupabaseClient,
  userId: string,
  message: PushMessage,
  opts?: { pushoverEnabled?: boolean },
): Promise<number> {
  configure();
  const { data: subs } = await supabase
    .from("push_subscriptions")
    .select("*")
    .eq("user_id", userId);

  let delivered = 0;
  for (const sub of (subs ?? []) as PushSubscriptionRow[]) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(message),
        { TTL: 3600, urgency: "high" },
      );
      delivered += 1;
      await supabase
        .from("push_subscriptions")
        .update({ last_used_at: new Date().toISOString(), failed_count: 0 })
        .eq("id", sub.id);
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        const failures = sub.failed_count + 1;
        if (failures >= 3) await supabase.from("push_subscriptions").delete().eq("id", sub.id);
        else await supabase.from("push_subscriptions").update({ failed_count: failures }).eq("id", sub.id);
      }
    }
  }

  if (opts?.pushoverEnabled) {
    await sendPushover(message).catch(() => {});
  }
  return delivered;
}

async function sendPushover(message: PushMessage): Promise<void> {
  const env = serverEnv();
  if (!env.PUSHOVER_USER_KEY || !env.PUSHOVER_APP_TOKEN) return;
  await fetch("https://api.pushover.net/1/messages.json", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      token: env.PUSHOVER_APP_TOKEN,
      user: env.PUSHOVER_USER_KEY,
      title: message.title,
      message: message.body,
      url: `${env.APP_URL}${message.url}`,
    }),
  });
}
