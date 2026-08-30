import { LoaderCircle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export function TableLoadingRows({
  columns,
  rows = 7,
}: {
  columns: number;
  rows?: number;
}) {
  return Array.from({ length: rows }, (_, row) => (
    <tr key={`loading-row-${row}`} className="border-t border-[#f1f1f1]" aria-hidden="true">
      {Array.from({ length: columns }, (_, column) => (
        <td key={column} className="px-3 py-3">
          <Skeleton
            className={
              column === 0
                ? "h-4 w-8"
                : column === columns - 1
                  ? "ml-auto h-8 w-8 rounded-lg"
                  : `h-4 ${column % 3 === 0 ? "w-24" : column % 2 === 0 ? "w-32" : "w-40"} max-w-full`
            }
          />
        </td>
      ))}
    </tr>
  ));
}

export function TableLoadingOverlay({ label = "Atualizando dados" }: { label?: string }) {
  return (
    <div
      className="absolute inset-0 z-10 flex items-start justify-center bg-white/55 pt-14 backdrop-blur-[1px]"
      role="status"
      aria-live="polite"
    >
      <span className="inline-flex items-center gap-2 rounded-full border border-[#e5e7eb] bg-white px-3 py-1.5 text-xs font-medium text-muted shadow-sm">
        <LoaderCircle className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
        {label}
      </span>
    </div>
  );
}
