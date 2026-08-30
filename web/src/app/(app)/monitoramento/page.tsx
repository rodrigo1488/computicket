"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MapPin } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";
import { PageTitle } from "@/components/layout/AppShell";
import { DataTable, Kpi } from "@/components/ui/DataTable";
import { Modal } from "@/components/ui/Modal";
import { Pagination } from "@/components/ui/Pagination";
import { IconAction, RowActions } from "@/components/ui/RowActions";
import { flask } from "@/lib/api";
import { applyColFilters, applyTextSearch } from "@/lib/col-filters";
import { flaskSocketOptions, getFlaskSocketConfig } from "@/lib/flask-socket";
import { cn } from "@/lib/cn";
import { useColFilters } from "@/lib/use-col-filters";

type Tech = {
  user_id?: number;
  user_name?: string;
  name?: string;
  user_role?: string;
  latitude?: number | null;
  longitude?: number | null;
  address?: string | null;
  accuracy?: number | null;
  is_online?: boolean;
  last_seen?: string | null;
  last_update?: string | null;
  last_seen_label?: string | null;
};

const flaskOrigin =
  typeof window === "undefined"
    ? "http://127.0.0.1:5000"
    : getFlaskSocketConfig().url;

function parseTechnicians(data: unknown): Tech[] {
  if (Array.isArray(data)) return data as Tech[];
  if (data && typeof data === "object") {
    const obj = data as { technicians?: Tech[]; items?: Tech[] };
    if (Array.isArray(obj.technicians)) return obj.technicians;
    if (Array.isArray(obj.items)) return obj.items;
  }
  return [];
}

function hasCoords(t: Tech) {
  return t.latitude != null && t.longitude != null && !(t.latitude === 0 && t.longitude === 0);
}

function formatLastSeen(t: Tech) {
  if (t.last_seen_label) return t.last_seen_label;
  const raw = t.last_seen || t.last_update;
  if (!raw) return "Nunca";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function locationLabel(t: Tech) {
  if (!hasCoords(t)) return "Nenhuma localização registrada";
  if (t.address) return t.address;
  return `${Number(t.latitude).toFixed(5)}, ${Number(t.longitude).toFixed(5)}`;
}

export default function MonitoramentoPage() {
  const qc = useQueryClient();
  const { data, error, dataUpdatedAt, isLoading, isFetching } = useQuery({
    queryKey: ["monitoring"],
    queryFn: () => flask.get<{ technicians?: Tech[] } | Tech[]>("/monitoring/api/technicians"),
    retry: false,
    refetchInterval: 15000,
  });
  const techs = parseTechnicians(data);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [mapTech, setMapTech] = useState<Tech | null>(null);
  const { colFilters, onFiltersChange } = useColFilters();
  const perPage = 25;

  const filtered = useMemo(() => {
    const mapped = techs.map((t) => ({
      ...t,
      technician_name: t.user_name || t.name || String(t.user_id || ""),
      status: t.is_online ? "Online" : "Offline",
      address: locationLabel(t),
      updated_at: formatLastSeen(t),
    }));
    const searched = applyTextSearch(mapped, q, (t) => [
      t.technician_name,
      t.status,
      t.address,
      t.updated_at,
      t.user_role,
    ]);
    return applyColFilters(searched, colFilters);
  }, [techs, q, colFilters]);

  useEffect(() => setPage(1), [q, colFilters]);
  const start = (page - 1) * perPage;
  const paged = filtered.slice(start, start + perPage);
  const withLocation = techs.filter(hasCoords).length;
  const online = techs.filter((t) => t.is_online).length;

  useEffect(() => {
    const socket = io(flaskOrigin, flaskSocketOptions());
    socket.emit("join_monitoring_room");
    const refresh = () => qc.invalidateQueries({ queryKey: ["monitoring"] });
    socket.on("active_technicians", refresh);
    socket.on("technician_location_update", refresh);
    return () => {
      socket.emit("leave_monitoring_room");
      socket.close();
    };
  }, [qc]);

  return (
    <div>
      <PageTitle>Monitoramento</PageTitle>
      <p className="mb-6 text-sm text-muted">Última localização registrada de cada técnico</p>
      {error ? <p className="mb-4 text-sm text-open">{(error as Error).message}</p> : null}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi label="Usuários" value={techs.length} />
        <Kpi label="Com localização" value={withLocation} />
        <Kpi label="Online agora" value={online} />
        <Kpi
          label="Última atualização"
          value={dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "—"}
        />
      </div>
      <DataTable
        id="monitoramento"
        loading={isLoading}
        refreshing={isFetching}
        searchPlaceholder="Buscar por técnico, status…"
        searchValue={q}
        onSearch={setQ}
        onFiltersChange={onFiltersChange}
        columnMeta={{
          Status: { filter: "select", options: [{ value: "Online", label: "Online" }, { value: "Offline", label: "Offline" }] },
          Ações: { sortable: false, filter: false },
        }}
        columns={["Técnico", "Status", "Última localização", "Atualizado", "Ações"]}
        rows={paged.map((t) => {
          const name = t.user_name || t.name || String(t.user_id || "—");
          return [
            <div key={`${t.user_id}-name`}>
              <p className="font-medium">{name}</p>
              {t.user_role ? <p className="text-xs capitalize text-muted">{t.user_role}</p> : null}
            </div>,
            <span
              key={`${t.user_id}-st`}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
                t.is_online ? "bg-done-bg text-done" : "bg-[#f3f4f6] text-muted",
              )}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", t.is_online ? "bg-done" : "bg-muted")} />
              {t.is_online ? "Online" : "Offline"}
            </span>,
            <span key={`${t.user_id}-loc`} className="inline-flex items-start gap-2">
              <MapPin className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", hasCoords(t) ? "text-brand" : "text-muted")} />
              <span>
                {locationLabel(t)}
                {hasCoords(t) && t.accuracy ? (
                  <span className="mt-0.5 block text-xs text-muted">Precisão: {Math.round(t.accuracy)} m</span>
                ) : null}
              </span>
            </span>,
            formatLastSeen(t),
            <RowActions key={`${t.user_id}-act`}>
              {hasCoords(t) ? (
                <IconAction label="Abrir mapa" icon={MapPin} onClick={() => setMapTech(t)} />
              ) : null}
            </RowActions>,
          ];
        })}
        empty="Nenhum técnico com localização registrada"
      />
      <Pagination page={page} perPage={perPage} total={filtered.length} onPage={setPage} />
      <LocationModal tech={mapTech} onClose={() => setMapTech(null)} />
    </div>
  );
}

function LocationModal({ tech, onClose }: { tech: Tech | null; onClose: () => void }) {
  if (!tech || !hasCoords(tech)) return null;
  const lat = Number(tech.latitude);
  const lng = Number(tech.longitude);
  const name = tech.user_name || tech.name || "Técnico";
  const embed = `https://maps.google.com/maps?q=${lat},${lng}&z=16&output=embed`;
  const external = `https://www.google.com/maps?q=${lat},${lng}`;
  return (
    <Modal open onClose={onClose} title={name} wide>
      {tech.address ? <p className="mb-3 text-sm text-muted">{tech.address}</p> : null}
      <p className="mb-3 text-xs text-muted">
        {lat.toFixed(6)}, {lng.toFixed(6)}
        {tech.accuracy ? ` · precisão ${Math.round(tech.accuracy)} m` : ""}
      </p>
      <iframe
        title={`Mapa de ${name}`}
        src={embed}
        className="h-[360px] w-full rounded-xl border border-line"
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
      />
      <a
        href={external}
        target="_blank"
        rel="noreferrer"
        className="mt-4 inline-block text-sm font-medium text-brand hover:underline"
      >
        Abrir no Google Maps
      </a>
    </Modal>
  );
}
