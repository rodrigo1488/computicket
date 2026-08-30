import { cn } from "@/lib/cn";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-lg bg-[#eef0f3] motion-reduce:animate-none", className)}
      {...props}
    />
  );
}

export { Skeleton };
