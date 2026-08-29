"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { PrimaryButton, UnderlineField } from "@/components/ui/UnderlineField";
import { flask } from "@/lib/api";
import { cn } from "@/lib/cn";

type UniplusConfig = {
  enabled: boolean;
  device_id: string;
  token_configured: boolean;
  connected_agents: number;
  connected_devices?: string[];
  pending: number;
  running: number;
  pg?: {
    host: string;
    port: number;
    database: string;
    user: string;
    password_configured: boolean;
    connect_timeout: number;
  };
  source?: {
    enabled: string;
    device_id: string;
    token: string;
  };
};

function sourceLabel(src?: string) {
  if (src === "system_config") return "Configurações";
  if (src === "env") return ".env";
  return "padrão";
}

export function UniplusSettings() {
  const qc = useQueryClient();
  const { data, error, isFetching, refetch } = useQuery({
    queryKey: ["uniplus-config"],
    queryFn: () => flask.get<UniplusConfig>("/api/uniplus/config"),
    refetchInterval: 10_000,
  });

  const [enabled, setEnabled] = useState(false);
  const [deviceId, setDeviceId] = useState("");
  const [token, setToken] = useState("");
  const [pgHost, setPgHost] = useState("");
  const [pgPort, setPgPort] = useState("5432");
  const [pgDatabase, setPgDatabase] = useState("unico");
  const [pgUser, setPgUser] = useState("");
  const [pgPassword, setPgPassword] = useState("");
  const [pgTimeout, setPgTimeout] = useState("5");
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    setEnabled(!!data.enabled);
    setDeviceId(data.device_id || "");
    setToken("");
    setPgHost(data.pg?.host || "");
    setPgPort(String(data.pg?.port ?? 5432));
    setPgDatabase(data.pg?.database || "unico");
    setPgUser(data.pg?.user || "");
    setPgPassword("");
    setPgTimeout(String(data.pg?.connect_timeout ?? 5));
  }, [data]);

  const save = useMutation({
    mutationFn: () =>
      flask.put<UniplusConfig>("/api/uniplus/config", {
        enabled,
        device_id: deviceId,
        ...(token.trim() ? { token: token.trim() } : {}),
        pg: {
          host: pgHost.trim(),
          port: Number(pgPort) || 5432,
          database: pgDatabase.trim() || "unico",
          user: pgUser.trim(),
          ...(pgPassword.trim() ? { password: pgPassword.trim() } : {}),
          connect_timeout: Number(pgTimeout) || 5,
        },
      }),
    onSuccess: () => {
      setToken("");
      setPgPassword("");
      setMsg("Salvo.");
      qc.invalidateQueries({ queryKey: ["uniplus-config"] });
    },
    onError: (e: Error) => setMsg(e.message),
  });

  function generateToken() {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    const t = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    setToken(t);
    setMsg("Novo token gerado — salve para aplicar.");
  }

  const connected = (data?.connected_agents || 0) > 0;

  return (
    <div className="max-w-xl space-y-8">
      <div>
        <p className="text-sm text-muted">
          Escritas no ERP Unico passam pelo agente local no servidor Uniplus (Socket.IO). Leituras
          (lista de clientes, faturamento, OS) e o fallback legado usam o Postgres configurado abaixo —
          a máquina da API precisa alcançar esse host.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[#eee] px-4 py-3">
        <span
          className={cn(
            "rounded-full px-2.5 py-0.5 text-xs font-semibold",
            connected ? "bg-done-bg text-done" : "bg-[#f3f4f6] text-muted",
          )}
        >
          {connected ? `${data?.connected_agents} agente(s) online` : "Nenhum agente conectado"}
        </span>
        {connected && data?.connected_devices?.length ? (
          <span className="text-xs text-muted">Devices: {data.connected_devices.join(", ")}</span>
        ) : null}
        <span className="text-xs text-muted">
          Fila: {data?.pending ?? 0} pendente(s) · {data?.running ?? 0} em execução
        </span>
        <button
          type="button"
          onClick={() => refetch()}
          className="ml-auto inline-flex items-center gap-1.5 text-xs font-medium text-muted hover:text-ink"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
          Atualizar
        </button>
      </div>

      {!connected && data?.token_configured ? (
        <p className="text-sm text-open">
          Agente offline: confira se o Device ID e o token no agente são iguais aos salvos aqui, e se
          a URL do Computicket no agente aponta para este servidor. No agente, o status só fica
          &quot;autenticado&quot; após o evento ready (token aceito).
        </p>
      ) : null}

      {error ? <p className="text-sm text-open">{(error as Error).message}</p> : null}

      <form
        className="space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          setMsg(null);
          save.mutate();
        }}
      >
        <label className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-[#eee] px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-ink">Agente habilitado</p>
            <p className="mt-0.5 text-xs text-muted">
              Fonte atual: {sourceLabel(data?.source?.enabled)}. Com desligado, escritas usam
              Postgres direto (legado).
            </p>
          </div>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="h-5 w-5 accent-[#2c2c2c]"
          />
        </label>

        <UnderlineField
          label="Device ID"
          value={deviceId}
          onChange={setDeviceId}
          placeholder="uniplus-server-1"
          hint={`Mesmo valor no agente. Fonte: ${sourceLabel(data?.source?.device_id)}.`}
        />

        <div className="space-y-2">
          <UnderlineField
            label="Token"
            type="password"
            value={token}
            onChange={setToken}
            placeholder={
              data?.token_configured ? "••••••••  (deixe em branco para manter)" : "Defina um token"
            }
            hint={`Fonte: ${sourceLabel(data?.source?.token)}. O token nunca é exibido após salvar.`}
          />
          <button
            type="button"
            onClick={generateToken}
            className="text-xs font-semibold text-brand hover:underline"
          >
            Gerar token aleatório
          </button>
        </div>

        <div className="space-y-4 border-t border-[#eee] pt-6">
          <div>
            <p className="text-sm font-semibold text-ink">Postgres Unico (API)</p>
            <p className="mt-0.5 text-xs text-muted">
              Usado pela API para leituras e escritas legado. Não use .env — configure aqui. O Postgres
              local do agente continua só na UI do agente.
            </p>
          </div>
          <UnderlineField
            label="Host"
            value={pgHost}
            onChange={setPgHost}
            placeholder="192.168.2.98"
            hint="IP ou hostname alcançável pela máquina da API."
          />
          <div className="grid grid-cols-2 gap-4">
            <UnderlineField
              label="Porta"
              value={pgPort}
              onChange={setPgPort}
              placeholder="5432"
            />
            <UnderlineField
              label="Database"
              value={pgDatabase}
              onChange={setPgDatabase}
              placeholder="unico"
            />
          </div>
          <UnderlineField
            label="Usuário"
            value={pgUser}
            onChange={setPgUser}
            placeholder="postgres"
          />
          <UnderlineField
            label="Senha"
            type="password"
            value={pgPassword}
            onChange={setPgPassword}
            placeholder={
              data?.pg?.password_configured
                ? "••••••••  (deixe em branco para manter)"
                : "Senha do Postgres Unico"
            }
            hint="A senha nunca é exibida após salvar."
          />
          <UnderlineField
            label="Timeout de conexão (s)"
            value={pgTimeout}
            onChange={setPgTimeout}
            placeholder="5"
          />
        </div>

        {msg ? <p className="text-sm text-muted">{msg}</p> : null}

        <PrimaryButton type="submit" disabled={save.isPending}>
          {save.isPending ? "Salvando…" : "Salvar"}
        </PrimaryButton>
      </form>
    </div>
  );
}
