import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { sendPushToAllDevices } from "@/lib/push";

// "Send test notification" button in Settings (SPEC §10 Phase 0).
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const service = createServiceClient();
    const delivered = await sendPushToAllDevices(service, user.id, {
      title: "LifeOS test",
      body: "Push notifications are working on this device.",
      url: "/settings",
      tag: "test",
    });
    return NextResponse.json({ ok: true, delivered });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "failed" },
      { status: 500 },
    );
  }
}
