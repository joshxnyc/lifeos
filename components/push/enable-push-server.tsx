import { serverEnv } from "@/lib/env";
import { EnablePush } from "./enable-push";

/**
 * The VAPID public key lives in server env (SPEC §3), not NEXT_PUBLIC_*, so a
 * server component reads it and hands it to the client component as a prop.
 * Import this one from Settings and anywhere else the opt-in belongs.
 */
export function EnablePushSection() {
  const key = serverEnv().VAPID_PUBLIC_KEY;
  if (!key) {
    return (
      <p className="text-[13px] text-ink-2">
        VAPID_PUBLIC_KEY is not set, so this deployment cannot send push. Add the key pair to the
        environment and redeploy.
      </p>
    );
  }
  return <EnablePush vapidPublicKey={key} />;
}
