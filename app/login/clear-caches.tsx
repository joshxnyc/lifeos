"use client";

import { useEffect } from "react";

// Reaching the login screen means no session: clear the service worker's
// runtime caches so archived pages/API bodies don't outlive sign-out on a
// shared or lost device.
export function ClearCaches() {
  useEffect(() => {
    if (typeof caches === "undefined") return;
    caches
      .keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .catch(() => {});
  }, []);
  return null;
}
