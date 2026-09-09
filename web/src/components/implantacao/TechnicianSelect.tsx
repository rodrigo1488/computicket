"use client";

import { useQuery } from "@tanstack/react-query";
import { flask, type PageRes, asItems } from "@/lib/api";

type UserRow = { id: number; name: string };

export function TechnicianSelect({
  label,
  value,
  onChange,
  inheritLabel,
  emptyLabel,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  inheritLabel?: string;
  emptyLabel?: string;
}) {
  const users = useQuery({
    queryKey: ["users", "active"],
    queryFn: () => flask.get<PageRes<UserRow> | UserRow[]>("/api/web/users?status=1&per_page=200"),
  });

  return (
    <label className="block">
      <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full border-0 border-b border-line bg-transparent py-2 text-[15px] text-ink"
      >
        {inheritLabel ? <option value="inherit">{inheritLabel}</option> : null}
        {emptyLabel && !inheritLabel ? <option value="">{emptyLabel}</option> : null}
        {asItems(users.data).map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
          </option>
        ))}
      </select>
    </label>
  );
}
