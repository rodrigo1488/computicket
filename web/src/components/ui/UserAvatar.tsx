import { cn } from "@/lib/cn";
import { initials } from "@/lib/format";

export function UserAvatar({
  name,
  src,
  size = "md",
}: {
  name?: string | null;
  src?: string | null;
  size?: "sm" | "md" | "lg";
}) {
  const dim = size === "sm" ? "h-8 w-8 text-[11px]" : size === "lg" ? "h-14 w-14 text-lg" : "h-10 w-10 text-xs";
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt={name || ""} className={cn("rounded-full object-cover", dim)} />
    );
  }
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-full bg-brand font-semibold text-white",
        dim,
      )}
    >
      {initials(name)}
    </span>
  );
}
