"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { Route } from "next";

type Props = {
  message: string;
  tone?: "success" | "warning" | "danger";
};

export function ActionToast({ message, tone = "success" }: Props) {
  const [visible, setVisible] = useState(Boolean(message));
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!message) return;
    setVisible(true);
    const timer = setTimeout(() => {
      setVisible(false);
      router.replace(pathname as Route);
    }, 2800);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message]);

  if (!message || !visible) return null;

  return (
    <div className={`action-toast ${tone}`} role="status">
      {message}
    </div>
  );
}
