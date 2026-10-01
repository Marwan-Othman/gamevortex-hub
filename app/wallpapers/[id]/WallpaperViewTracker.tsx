"use client";

import { useEffect, useRef } from "react";

type Props = {
  wallpaperId: string;
};

export default function WallpaperViewTracker({
  wallpaperId,
}: Props) {
  const trackedRef = useRef(false);

  useEffect(() => {
    if (!wallpaperId || trackedRef.current) {
      return;
    }

    trackedRef.current = true;

    fetch(`/api/wallpapers/${encodeURIComponent(wallpaperId)}/view`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "same-origin",
      keepalive: true,
    }).catch(() => {
      // لا نُظهر خطأ للمستخدم إذا فشل تسجيل المشاهدة.
    });
  }, [wallpaperId]);

  return null;
}
