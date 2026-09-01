import * as React from "react";
import { cn } from "@/lib/cn";

function Alert({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      role="alert"
      data-slot="alert"
      className={cn("relative grid grid-cols-[auto_1fr] items-start gap-x-3 rounded-xl border border-line bg-surface p-4", className)}
      {...props}
    />
  );
}

function AlertTitle({ className, ...props }: React.ComponentProps<"h5">) {
  return <h5 data-slot="alert-title" className={cn("col-start-2 font-medium leading-none text-navy", className)} {...props} />;
}

function AlertDescription({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="alert-description" className={cn("col-start-2 mt-1 text-sm text-muted", className)} {...props} />;
}

export { Alert, AlertTitle, AlertDescription };
