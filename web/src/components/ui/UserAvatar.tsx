"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { initials } from "@/lib/format";

export function UserAvatar({
  name,
  src,
  size = "md",
}: {
  name?: string | null;
  src?: string | null;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  const dim =
    size === "sm"
      ? "h-8 w-8 text-[11px]"
      : size === "lg"
        ? "h-14 w-14 text-lg"
        : size === "xl"
          ? "h-24 w-24 text-2xl"
          : "h-10 w-10 text-xs";

  const showImage = !!src && !failed;

  if (showImage) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        key={src}
        src={src}
        alt=""
        aria-label={name || "Avatar"}
        onError={() => setFailed(true)}
        className={cn("shrink-0 rounded-full object-cover ring-1 ring-black/5", dim)}
      />
    );
  }

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-brand font-semibold text-white",
        dim,
      )}
      aria-label={name || "Avatar"}
    >
      {initials(name)}
    </span>
  );
}
