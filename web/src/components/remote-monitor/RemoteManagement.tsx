"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowUp,
  ChevronRight,
  Copy,
  Download,
  File,
  Folder,
  FolderPlus,
  History,
  LoaderCircle,
  Pencil,
  Power,
  RefreshCw,
  RotateCcw,
  Trash2,
  Upload,
} from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Modal } from "@/components/ui/Modal";
import { PrimaryButton, UnderlineField } from "@/components/ui/UnderlineField";
import { TableLoadingOverlay, TableLoadingRows } from "@/components/ui/table-loading";
import { flask } from "@/lib/api";
import { cn } from "@/lib/cn";
import {
  formatBytes,
  formatDate,
  statusLabel,
  type RemoteAgent,
  type RemoteCommand,
  type RemoteDirectoryResult,
  type RemoteFileEntry,
  type RemoteTransferResponse,
} from "@/lib/remote-monitor";

const TERMINAL = new Set(["done", "error", "cancelled"]);
const POLL_TIMEOUT_MS = 60_000;
const INVALID_NAME = /[<>:"/\\|?*\u0000-\u001f]/;
const RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

type FileOperation = "mkdir" | "rename" | "move" | "copy" | "delete";

export function RemoteManagement({ agent }: { agent: RemoteAgent }) {
  const queryClient = useQueryClient();
  const available = statusLabel(agent) === "Online";
  const [action, setAction] = useState<"reboot" | "shutdown" | null>(null);
  const [actionCommand, setActionCommand] = useState<RemoteCommand | null>(null);
  const [actionError, setActionError] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [currentPath, setCurrentPath] = useState("");
  const [directory, setDirectory] = useState<RemoteDirectoryResult | null>(null);
  const [selected, setSelected] = useState<RemoteFileEntry | null>(null);
  const [filesBusy, setFilesBusy] = useState(false);
  const [filesError, setFilesError] = useState("");
  const [filesNotice, setFilesNotice] = useState("");
  const [operation, setOperation] = useState<FileOperation | null>(null);
  const [operationValue, setOperationValue] = useState("");
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const uploadRef = useRef<HTMLInputElement>(null);
  const loadedRef = useRef(false);

  const commands = useQuery({
    queryKey: ["remote-agent-commands", agent.id],
    queryFn: () => flask.get<{ items: RemoteCommand[] }>(`/api/remote-monitor/agents/${agent.id}/commands?limit=100`),
    refetchInterval: (query) =>
      query.state.data?.items.some((item) => !TERMINAL.has(item.status)) ? 5000 : false,
  });

  async function pollCommand(initial: RemoteCommand, onProgress?: (command: RemoteCommand) => void) {
    let command = initial;
    const started = Date.now();
    onProgress?.(command);
    while (!TERMINAL.has(command.status)) {
      if (Date.now() - started >= POLL_TIMEOUT_MS) {
        throw new Error("Tempo de espera esgotado. O comando continua no servidor; acompanhe pelo histórico.");
      }
      await new Promise((resolve) => window.setTimeout(resolve, 1000));
      command = await flask.get<RemoteCommand>(`/api/remote-monitor/commands/${command.id}`);
      onProgress?.(command);
    }
    queryClient.invalidateQueries({ queryKey: ["remote-agent-commands", agent.id] });
    if (command.status !== "done") {
      throw new Error(command.error || (command.status === "cancelled" ? "Comando cancelado." : "O comando falhou."));
    }
    return command;
  }

  async function loadDirectory(path = currentPath) {
    if (!available) return;
    setFilesBusy(true);
    setFilesError("");
    setFilesNotice(path ? `Carregando ${path}…` : "Carregando unidades…");
    setSelected(null);
    try {
      const created = await flask.post<RemoteCommand>(`/api/remote-monitor/agents/${agent.id}/files/list`, { path });
      const done = await pollCommand(created, (command) =>
        setFilesNotice(command.status === "running" ? "Lendo diretório…" : `Comando: ${commandStatusLabel(command.status)}`),
      );
      const result = done.result as RemoteDirectoryResult | null;
      if (!result || !Array.isArray(result.entries)) throw new Error("O agente retornou uma listagem inválida.");
      const sorted = [...result.entries].sort((a, b) =>
        Number(b.is_directory) - Number(a.is_directory) || a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }),
      );
      setDirectory({ ...result, entries: sorted });
      setCurrentPath(result.path ?? path);
      setFilesNotice(result.truncated ? "Listagem truncada pelo agente." : "");
    } catch (error) {
      setFilesError(errorMessage(error));
      setFilesNotice("");
    } finally {
      setFilesBusy(false);
    }
  }

  useEffect(() => {
    if (available && !loadedRef.current) {
      loadedRef.current = true;
      void loadDirectory("");
    }
    // A primeira listagem é intencionalmente disparada apenas quando o agente fica disponível.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [available]);

  async function runAction() {
    if (!action || !available) return;
    setActionBusy(true);
    setActionError("");
    try {
      const command = await flask.post<RemoteCommand>(`/api/remote-monitor/agents/${agent.id}/actions`, {
        action,
        confirm: true,
      });
      await pollCommand(command, setActionCommand);
      setAction(null);
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setActionBusy(false);
    }
  }

  function openOperation(kind: FileOperation) {
    setFilesError("");
    setOperationValue(kind === "rename" && selected ? selected.name : "");
    setDeleteConfirmation("");
    setOperation(kind);
  }

  async function submitOperation(event: FormEvent) {
    event.preventDefault();
    if (!operation) return;
    const validation = validateOperation(operation, operationValue, selected);
    if (validation) {
      setFilesError(validation);
      return;
    }
    if (operation === "delete" && deleteConfirmation !== "EXCLUIR") {
      setFilesError('Digite "EXCLUIR" para confirmar.');
      return;
    }
    setFilesBusy(true);
    setFilesError("");
    try {
      const payload: Record<string, unknown> = { operation };
      if (operation === "mkdir") payload.path = joinWindowsPath(currentPath, operationValue.trim());
      if (operation === "delete") {
        payload.path = selected?.path;
        payload.confirm = true;
      }
      if (operation === "rename") {
        payload.source_path = selected?.path;
        payload.destination_path = joinWindowsPath(parentWindowsPath(selected?.path || currentPath), operationValue.trim());
      }
      if (operation === "move" || operation === "copy") {
        payload.source_path = selected?.path;
        payload.destination_path = normalizeWindowsPath(operationValue);
      }
      const command = await flask.post<RemoteCommand>(
        `/api/remote-monitor/agents/${agent.id}/files/operation`,
        payload,
      );
      setOperation(null);
      setFilesNotice(`Comando ${command.id}: ${commandStatusLabel(command.status)}`);
      await pollCommand(command, (next) => setFilesNotice(`Comando ${next.id}: ${commandStatusLabel(next.status)}`));
      await loadDirectory(currentPath);
    } catch (error) {
      setFilesError(errorMessage(error));
      setFilesNotice("");
    } finally {
      setFilesBusy(false);
    }
  }

  async function uploadFile(file: File) {
    if (!available) return;
    if (invalidWindowsName(file.name)) {
      setFilesError("O nome do arquivo contém caracteres inválidos para o Windows.");
      return;
    }
    setFilesBusy(true);
    setFilesError("");
    setFilesNotice(`Enviando ${file.name}…`);
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("remote_path", joinWindowsPath(currentPath, file.name));
      const response = await flask.post<RemoteTransferResponse>(
        `/api/remote-monitor/agents/${agent.id}/files/upload`,
        body,
      );
      await pollCommand(response.command, (command) =>
        setFilesNotice(`Upload: ${commandStatusLabel(command.status)}`),
      );
      await loadDirectory(currentPath);
    } catch (error) {
      setFilesError(errorMessage(error));
      setFilesNotice("");
    } finally {
      if (uploadRef.current) uploadRef.current.value = "";
      setFilesBusy(false);
    }
  }

  async function downloadFile() {
    if (!selected?.is_file || !available) return;
    setFilesBusy(true);
    setFilesError("");
    setFilesNotice(`Preparando ${selected.name}…`);
    try {
      const response = await flask.post<RemoteTransferResponse>(
        `/api/remote-monitor/agents/${agent.id}/files/download`,
        { remote_path: selected.path },
      );
      await pollCommand(response.command, (command) =>
        setFilesNotice(`Download: ${commandStatusLabel(command.status)}`),
      );
      await flask.download(`/api/remote-monitor/transfers/${response.transfer.uuid}/download`);
      setFilesNotice("Download iniciado.");
    } catch (error) {
      setFilesError(errorMessage(error));
      setFilesNotice("");
    } finally {
      setFilesBusy(false);
    }
  }

  const breadcrumbs = windowsBreadcrumbs(currentPath);

  return (
    <>
      <section className="mt-8" aria-labelledby="remote-actions-title">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 id="remote-actions-title" className="text-lg font-semibold text-navy">Ações remotas</h2>
            <p className="mt-1 text-sm text-muted">A execução é confirmada pelo agente; o envio não significa sucesso.</p>
          </div>
          <div className="flex gap-2">
            <ActionButton icon={<RotateCcw />} disabled={!available || actionBusy} onClick={() => setAction("reboot")}>
              Reiniciar
            </ActionButton>
            <ActionButton danger icon={<Power />} disabled={!available || actionBusy} onClick={() => setAction("shutdown")}>
              Desligar
            </ActionButton>
          </div>
        </div>
        {!available ? (
          <InlineAlert>As ações estão bloqueadas porque o agente está {statusLabel(agent).toLowerCase()}.</InlineAlert>
        ) : null}
        {actionCommand ? (
          <p className="mt-2 text-sm text-muted">
            Comando #{actionCommand.id}: <strong className="text-ink">{commandStatusLabel(actionCommand.status)}</strong>
          </p>
        ) : null}
        {actionError ? <InlineAlert>{actionError}</InlineAlert> : null}
      </section>

      <section className="mt-8 rounded-2xl border border-line bg-white" aria-labelledby="files-title">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4 sm:p-5">
          <div>
            <h2 id="files-title" className="text-lg font-semibold text-navy">Arquivos</h2>
            <p className="text-sm text-muted">Gerencie arquivos sem acesso a shell ou scripts.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <ActionButton icon={<ArrowUp />} disabled={!available || filesBusy || !currentPath} onClick={() => void loadDirectory(parentWindowsPath(currentPath))}>
              Subir
            </ActionButton>
            <ActionButton icon={<RefreshCw />} disabled={!available || filesBusy} onClick={() => void loadDirectory(currentPath)}>
              Atualizar
            </ActionButton>
          </div>
        </div>

        <nav aria-label="Caminho atual" className="flex min-h-12 flex-wrap items-center gap-1 border-b border-line px-4 py-2 text-sm sm:px-5">
          <button type="button" className="font-medium text-brand hover:underline" onClick={() => void loadDirectory("")} disabled={filesBusy}>
            Unidades
          </button>
          {breadcrumbs.map((crumb) => (
            <span key={crumb.path} className="inline-flex items-center gap-1">
              <ChevronRight className="h-3.5 w-3.5 text-muted" />
              <button type="button" className="max-w-48 truncate text-ink hover:text-brand hover:underline" onClick={() => void loadDirectory(crumb.path)} disabled={filesBusy}>
                {crumb.label}
              </button>
            </span>
          ))}
        </nav>

        <div className="flex flex-wrap gap-2 border-b border-line p-3 sm:px-5">
          <ActionButton icon={<FolderPlus />} disabled={!available || filesBusy || !currentPath} onClick={() => openOperation("mkdir")}>Nova pasta</ActionButton>
          <ActionButton icon={<Pencil />} disabled={!available || filesBusy || !selected} onClick={() => openOperation("rename")}>Renomear</ActionButton>
          <ActionButton icon={<Folder />} disabled={!available || filesBusy || !selected} onClick={() => openOperation("move")}>Mover</ActionButton>
          <ActionButton icon={<Copy />} disabled={!available || filesBusy || !selected} onClick={() => openOperation("copy")}>Copiar</ActionButton>
          <ActionButton danger icon={<Trash2 />} disabled={!available || filesBusy || !selected} onClick={() => openOperation("delete")}>Excluir</ActionButton>
          <label className={buttonClasses(!available || filesBusy || !currentPath)}>
            <Upload className="h-4 w-4" /> Upload
            <input
              ref={uploadRef}
              type="file"
              className="sr-only"
              disabled={!available || filesBusy || !currentPath}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void uploadFile(file);
              }}
            />
          </label>
          <ActionButton icon={<Download />} disabled={!available || filesBusy || !selected?.is_file} onClick={() => void downloadFile()}>Download</ActionButton>
        </div>

        {filesNotice ? <p role="status" className="flex items-center gap-2 px-4 pt-3 text-sm text-progress sm:px-5">{filesBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}{filesNotice}</p> : null}
        {filesError ? <InlineAlert>{filesError}</InlineAlert> : null}
        {!available ? <InlineAlert>O gerenciador fica disponível somente quando o agente está online.</InlineAlert> : null}

        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm" aria-busy={filesBusy}>
            <thead className="bg-[#f7f7f8] text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-3 sm:px-5">Nome</th>
                <th className="px-3 py-3">Tipo</th>
                <th className="px-3 py-3 text-right">Tamanho</th>
                <th className="px-3 py-3">Modificado</th>
                <th className="px-3 py-3">Oculto</th>
              </tr>
            </thead>
            <tbody>
              {filesBusy && !directory ? <TableLoadingRows columns={5} rows={6} /> : null}
              {directory?.entries.map((entry) => (
                <tr
                  key={entry.path}
                  className={cn("cursor-pointer border-t border-line hover:bg-[#fafafa]", selected?.path === entry.path && "bg-progress-bg")}
                  tabIndex={0}
                  aria-selected={selected?.path === entry.path}
                  onClick={() => setSelected(entry)}
                  onDoubleClick={() => entry.is_directory && void loadDirectory(entry.path)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      if (entry.is_directory) void loadDirectory(entry.path);
                      else setSelected(entry);
                    }
                  }}
                >
                  <td className="px-4 py-3 sm:px-5">
                    <span className="flex items-center gap-2 font-medium text-ink">
                      {entry.is_directory ? <Folder className="h-4 w-4 shrink-0 text-brand" /> : <File className="h-4 w-4 shrink-0 text-muted" />}
                      <span className="max-w-[340px] truncate">{entry.name}</span>
                    </span>
                  </td>
                  <td className="px-3 py-3 text-muted">{entry.is_directory ? "Pasta" : "Arquivo"}</td>
                  <td className="px-3 py-3 text-right text-muted">{entry.is_file ? formatBytes(entry.size) : "—"}</td>
                  <td className="px-3 py-3 text-muted">{formatDate(entry.modified_at, "—")}</td>
                  <td className="px-3 py-3 text-muted">{entry.hidden ? "Sim" : "Não"}</td>
                </tr>
              ))}
              {!filesBusy && directory && !directory.entries.length ? (
                <tr><td colSpan={5} className="px-5 py-10 text-center text-muted">Esta pasta está vazia.</td></tr>
              ) : null}
              {!directory && !filesBusy ? (
                <tr><td colSpan={5} className="px-5 py-10 text-center text-muted">Nenhuma listagem carregada.</td></tr>
              ) : null}
            </tbody>
          </table>
          {filesBusy && directory ? <TableLoadingOverlay label="Atualizando arquivos" /> : null}
        </div>
        <p className="border-t border-line px-4 py-3 text-xs text-muted sm:px-5">
          {selected ? `Selecionado: ${selected.path}` : "Selecione um item; pressione Enter ou dê duplo clique para abrir uma pasta."}
        </p>
      </section>

      <CommandHistory commands={commands.data?.items || []} loading={commands.isLoading} error={commands.error} />

      <Modal open={!!action} onClose={() => !actionBusy && setAction(null)} title={action === "reboot" ? "Reiniciar máquina" : "Desligar máquina"}>
        <div className="rounded-xl bg-open-bg p-4 text-sm text-open">
          <p className="font-semibold">{agent.name}</p>
          <p className="mt-1">
            {action === "reboot"
              ? "A máquina será reiniciada e trabalhos não salvos poderão ser perdidos."
              : "A máquina será desligada e ficará inacessível até ser ligada fisicamente."}
          </p>
        </div>
        {actionError ? <p role="alert" className="mt-3 text-sm text-open">{actionError}</p> : null}
        <div className="mt-5 flex gap-3">
          <button type="button" className="flex-1 rounded-xl border border-line py-3 text-sm font-medium" disabled={actionBusy} onClick={() => setAction(null)}>Cancelar</button>
          <button type="button" className="flex-1 rounded-xl bg-open py-3 text-sm font-semibold text-white disabled:opacity-50" disabled={actionBusy} onClick={() => void runAction()}>
            {actionBusy ? "Aguardando agente…" : action === "reboot" ? "Confirmar reinício" : "Confirmar desligamento"}
          </button>
        </div>
      </Modal>

      <Modal open={!!operation} onClose={() => !filesBusy && setOperation(null)} title={operationTitle(operation)}>
        <form onSubmit={(event) => void submitOperation(event)}>
          {operation === "delete" ? (
            <>
              <div className="rounded-xl bg-open-bg p-4 text-sm text-open">
                <p className="font-semibold">Exclusão permanente</p>
                <p className="mt-1 break-all">{selected?.path}</p>
                <p className="mt-2">Esta ação não pode ser desfeita.</p>
              </div>
              <div className="mt-4">
                <UnderlineField label='Digite "EXCLUIR" para confirmar' value={deleteConfirmation} onChange={setDeleteConfirmation} />
              </div>
            </>
          ) : (
            <>
              {selected ? <p className="mb-4 break-all rounded-xl bg-[#f7f7f8] p-3 text-xs text-muted">Origem: {selected.path}</p> : null}
              <UnderlineField
                label={operation === "mkdir" ? "Nome da pasta" : operation === "rename" ? "Novo nome" : "Caminho completo de destino"}
                value={operationValue}
                onChange={setOperationValue}
                placeholder={operation === "move" || operation === "copy" ? "C:\\Destino\\nome-do-item" : ""}
                hint={operation === "move" || operation === "copy" ? "Informe o caminho completo incluindo o nome final. Destinos existentes não serão sobrescritos." : "Nomes inválidos ou destinos existentes são recusados."}
              />
            </>
          )}
          {filesError ? <p role="alert" className="mt-3 text-sm text-open">{filesError}</p> : null}
          <PrimaryButton type="submit" className={cn("mt-5", operation === "delete" && "bg-open")} disabled={filesBusy || (operation === "delete" && deleteConfirmation !== "EXCLUIR")}>
            {filesBusy ? "Aguardando agente…" : operation === "delete" ? "Excluir permanentemente" : "Confirmar"}
          </PrimaryButton>
        </form>
      </Modal>
    </>
  );
}

function CommandHistory({ commands, loading, error }: { commands: RemoteCommand[]; loading: boolean; error: Error | null }) {
  return (
    <section className="mt-8" aria-labelledby="commands-title">
      <div className="mb-3 flex items-center gap-2">
        <History className="h-5 w-5 text-brand" />
        <h2 id="commands-title" className="text-lg font-semibold text-navy">Histórico de comandos</h2>
      </div>
      <div className="relative overflow-x-auto rounded-2xl border border-line bg-white">
        <table className="w-full min-w-[760px] text-left text-sm" aria-busy={loading}>
          <thead className="bg-[#f7f7f8] text-xs uppercase tracking-wide text-muted">
            <tr><th className="px-4 py-3">Tipo</th><th className="px-3 py-3">Solicitante</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Solicitado</th><th className="px-3 py-3">Finalizado / erro</th></tr>
          </thead>
          <tbody>
            {loading && !commands.length ? <TableLoadingRows columns={5} rows={5} /> : null}
            {commands.map((command) => (
              <tr key={command.id} className="border-t border-line">
                <td className="px-4 py-3 font-medium text-ink">{commandTypeLabel(command.command_type)} <span className="text-xs text-muted">#{command.id}</span></td>
                <td className="px-3 py-3 text-muted">{command.requested_by || `Usuário #${command.requested_by_id ?? "—"}`}</td>
                <td className="px-3 py-3"><CommandBadge status={command.status} /></td>
                <td className="px-3 py-3 text-muted">{formatDate(command.created_at, "—")}</td>
                <td className="max-w-xs px-3 py-3 text-muted">{command.error ? <span className="text-open">{command.error}</span> : formatDate(command.finished_at, "—")}</td>
              </tr>
            ))}
            {!loading && !commands.length ? <tr><td colSpan={5} className="px-4 py-8 text-center text-muted">Nenhum comando auditado.</td></tr> : null}
          </tbody>
        </table>
        {loading && commands.length ? <TableLoadingOverlay label="Atualizando histórico" /> : null}
        {error ? <p role="alert" className="p-4 text-sm text-open">{error.message}</p> : null}
      </div>
    </section>
  );
}

function CommandBadge({ status }: { status: RemoteCommand["status"] }) {
  return <span className={cn("rounded-full px-2 py-1 text-xs font-medium", status === "done" ? "bg-done-bg text-done" : status === "error" || status === "cancelled" ? "bg-open-bg text-open" : "bg-progress-bg text-progress")}>{commandStatusLabel(status)}</span>;
}

function ActionButton({ icon, children, danger, disabled, onClick }: { icon: React.ReactNode; children: React.ReactNode; danger?: boolean; disabled?: boolean; onClick: () => void }) {
  return <button type="button" onClick={onClick} disabled={disabled} className={buttonClasses(disabled, danger)}><span className="[&_svg]:h-4 [&_svg]:w-4">{icon}</span>{children}</button>;
}

function buttonClasses(disabled?: boolean, danger?: boolean) {
  return cn(
    "inline-flex h-9 cursor-pointer items-center gap-2 rounded-xl border px-3 text-sm font-medium",
    danger ? "border-open/20 text-open hover:bg-open-bg" : "border-line text-ink hover:bg-[#f7f7f8]",
    disabled && "pointer-events-none cursor-not-allowed opacity-50",
  );
}

function InlineAlert({ children }: { children: React.ReactNode }) {
  return <p role="alert" className="mx-4 mt-3 flex items-start gap-2 rounded-xl bg-open-bg p-3 text-sm text-open sm:mx-5"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{children}</p>;
}

function commandStatusLabel(status: string) {
  return ({ pending: "Pendente", running: "Em execução", done: "Concluído", error: "Erro", cancelled: "Cancelado" } as Record<string, string>)[status] || status;
}

function commandTypeLabel(type: string) {
  return ({
    reboot: "Reiniciar", shutdown: "Desligar", list_directory: "Listar arquivos", mkdir: "Criar pasta",
    rename: "Renomear", move: "Mover", copy: "Copiar", delete: "Excluir", upload_file: "Upload", download_file: "Download",
  } as Record<string, string>)[type] || type;
}

function operationTitle(operation: FileOperation | null) {
  return ({ mkdir: "Criar pasta", rename: "Renomear item", move: "Mover item", copy: "Copiar item", delete: "Excluir item" } as Record<string, string>)[operation || ""] || "Operação";
}

function validateOperation(operation: FileOperation, value: string, selected: RemoteFileEntry | null) {
  if (operation !== "mkdir" && !selected) return "Selecione um arquivo ou pasta.";
  if (operation === "delete") return "";
  const trimmed = value.trim();
  if (!trimmed) return "Preencha o campo obrigatório.";
  if (operation === "mkdir" || operation === "rename") {
    if (invalidWindowsName(trimmed)) return "Use um nome válido do Windows, sem caracteres reservados ou ponto/espaço no final.";
    if (operation === "rename" && trimmed.toLocaleLowerCase("pt-BR") === selected?.name.toLocaleLowerCase("pt-BR")) return "Informe um nome diferente do atual.";
  } else {
    const destination = normalizeWindowsPath(trimmed);
    if (!/^[a-zA-Z]:\\/.test(destination)) return "Informe um caminho absoluto de uma unidade local do Windows.";
    if (destination.toLocaleLowerCase("pt-BR") === normalizeWindowsPath(selected?.path || "").toLocaleLowerCase("pt-BR")) return "Origem e destino devem ser diferentes.";
  }
  return "";
}

function invalidWindowsName(value: string) {
  const name = value.trim();
  return !name || name === "." || name === ".." || INVALID_NAME.test(name) || RESERVED_NAME.test(name) || /[. ]$/.test(name);
}

function normalizeWindowsPath(value: string) {
  if (!value) return "";
  const normalized = value.replace(/\//g, "\\");
  if (/^[a-zA-Z]:\\?$/.test(normalized)) return `${normalized.slice(0, 2)}\\`;
  if (normalized.startsWith("\\\\")) return `\\\\${normalized.slice(2).replace(/\\+/g, "\\").replace(/\\$/, "")}`;
  return normalized.replace(/\\+/g, "\\").replace(/\\$/, "");
}

function joinWindowsPath(directory: string, name: string) {
  const base = normalizeWindowsPath(directory);
  if (!base) return name;
  return `${base}${base.endsWith("\\") ? "" : "\\"}${name}`;
}

function parentWindowsPath(path: string) {
  const normalized = normalizeWindowsPath(path);
  if (!normalized) return "";
  if (/^[a-zA-Z]:\\$/.test(normalized)) return "";
  if (normalized.startsWith("\\\\")) {
    const parts = normalized.slice(2).split("\\");
    if (parts.length <= 2) return "";
    return `\\\\${parts.slice(0, -1).join("\\")}`;
  }
  const index = normalized.lastIndexOf("\\");
  return index <= 2 ? `${normalized.slice(0, 2)}\\` : normalized.slice(0, index);
}

function windowsBreadcrumbs(path: string) {
  const normalized = normalizeWindowsPath(path);
  if (!normalized) return [];
  if (normalized.startsWith("\\\\")) {
    const parts = normalized.slice(2).split("\\").filter(Boolean);
    return parts.map((label, index) => ({ label, path: `\\\\${parts.slice(0, index + 1).join("\\")}` }));
  }
  const drive = normalized.slice(0, 2);
  const parts = normalized.slice(2).split("\\").filter(Boolean);
  return [
    { label: drive, path: `${drive}\\` },
    ...parts.map((label, index) => ({ label, path: `${drive}\\${parts.slice(0, index + 1).join("\\")}` })),
  ];
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Não foi possível concluir a operação.";
}
