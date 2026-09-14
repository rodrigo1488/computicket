"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Download, ExternalLink, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { PageTitle } from "@/components/layout/AppShell";
import { Modal } from "@/components/ui/Modal";
import { PrimaryButton, UnderlineField } from "@/components/ui/UnderlineField";
import { flask } from "@/lib/api";
import {
  formatUtilityDate,
  uploadUtilityFile,
  utilityDownloadHref,
  UTILITY_MAX_FILE_BYTES,
  type UtilityFile,
} from "@/lib/utilitarios";

type Res = { items: UtilityFile[]; total: number };

const emptyForm = { title: "", description: "" };

export default function GerenciarUtilitariosPage() {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [creating, setCreating] = useState(false);
  const [edit, setEdit] = useState<UtilityFile | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [formError, setFormError] = useState("");
  const [copied, setCopied] = useState(false);
  const [progress, setProgress] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["utilitarios-admin"],
    queryFn: () => flask.get<Res>("/utilitarios/api"),
  });

  const items = data?.items || [];
  const publicUrl = typeof window === "undefined" ? "/utilitarios" : `${window.location.origin}/utilitarios`;

  const save = useMutation({
    mutationFn: async () => {
      if (creating) {
        if (!pendingFiles.length) throw new Error("Selecione ao menos um arquivo.");
        const tooBig = pendingFiles.find((file) => file.size > UTILITY_MAX_FILE_BYTES);
        if (tooBig) throw new Error(`"${tooBig.name}" passa de 1 GB. Envie um arquivo menor.`);
        const items: UtilityFile[] = [];
        for (let i = 0; i < pendingFiles.length; i += 1) {
          const file = pendingFiles[i];
          const prefix = pendingFiles.length > 1 ? `${i + 1}/${pendingFiles.length} · ` : "";
          setProgress(`${prefix}Enviando ${file.name}…`);
          items.push(
            await uploadUtilityFile(
              file,
              { title: form.title.trim(), description: form.description.trim() },
              (percent) => setProgress(`${prefix}${file.name} · ${percent}%`),
            ),
          );
        }
        return { items };
      }
      if (!edit) throw new Error("Nenhum arquivo");
      if (!form.title.trim()) throw new Error("Título é obrigatório");
      return flask.patch(`/utilitarios/api/${edit.id}`, {
        title: form.title.trim(),
        description: form.description.trim(),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["utilitarios-admin"] });
      setCreating(false);
      setEdit(null);
      setPendingFiles([]);
      setForm(emptyForm);
      setProgress("");
    },
    onError: (e) => {
      setProgress("");
      setFormError(e instanceof Error ? e.message : "Erro ao salvar");
    },
  });

  const remove = useMutation({
    mutationFn: (id: number) => flask.delete(`/utilitarios/api/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["utilitarios-admin"] }),
  });

  function openCreate() {
    setForm(emptyForm);
    setPendingFiles([]);
    setFormError("");
    setEdit(null);
    setCreating(true);
  }

  function openEdit(file: UtilityFile) {
    setForm({ title: file.title, description: file.description || "" });
    setPendingFiles([]);
    setFormError("");
    setCreating(false);
    setEdit(file);
  }

  async function copyPublicUrl() {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <PageTitle className="mb-1">Utilitários</PageTitle>
          <p className="text-sm text-muted">
            Envie arquivos para a página pública{" "}
            <a href="/utilitarios" target="_blank" rel="noreferrer" className="text-brand hover:underline">
              /utilitarios
            </a>
            , que qualquer pessoa acessa sem login.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void copyPublicUrl()}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-wash px-4 text-sm font-medium text-ink"
          >
            <Copy className="h-4 w-4" />
            {copied ? "Link copiado" : "Copiar link público"}
          </button>
          <a
            href="/utilitarios"
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-wash px-4 text-sm font-medium text-ink"
          >
            <ExternalLink className="h-4 w-4" />
            Abrir página
          </a>
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-inverse px-4 text-sm font-medium text-on-inverse"
          >
            <Plus className="h-4 w-4" />
            Enviar arquivo
          </button>
        </div>
      </div>

      {isLoading ? <p className="mb-4 text-sm text-muted">Carregando arquivos…</p> : null}
      {error ? <p className="mb-4 text-sm text-open">{(error as Error).message}</p> : null}

      {items.length === 0 && !isLoading ? (
        <div className="rounded-2xl border border-line px-6 py-12 text-center text-sm text-muted">
          Nenhum arquivo enviado. Publique o primeiro para disponibilizar o download em /utilitarios.
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((file) => (
            <li key={file.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-line p-4">
              <div className="min-w-0 flex-1">
                <h3 className="font-semibold text-navy">{file.title}</h3>
                <p className="truncate text-sm text-muted">{file.original_filename}</p>
                {file.description ? <p className="mt-1 text-sm text-ink">{file.description}</p> : null}
                <p className="mt-1 text-xs text-muted">
                  {file.file_size_label} · {formatUtilityDate(file.created_at)}
                  {file.created_by_name ? ` · ${file.created_by_name}` : ""} · {file.download_count} download
                  {file.download_count === 1 ? "" : "s"}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <a
                  href={utilityDownloadHref(file)}
                  className="inline-flex h-9 items-center gap-1 rounded-lg bg-wash px-3 text-sm text-ink"
                >
                  <Download className="h-4 w-4" />
                  Baixar
                </a>
                <button
                  type="button"
                  onClick={() => openEdit(file)}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-wash text-muted"
                  aria-label="Editar arquivo"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm(`Excluir ${file.title}? O arquivo sai da página pública.`)) {
                      remove.mutate(file.id);
                    }
                  }}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-wash text-open"
                  aria-label="Excluir arquivo"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={creating || !!edit}
        onClose={() => {
          setCreating(false);
          setEdit(null);
        }}
        title={creating ? "Enviar arquivo" : "Editar arquivo"}
      >
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <UnderlineField
            label="Título"
            value={form.title}
            onChange={(v) => setForm((f) => ({ ...f, title: v }))}
            hint={creating ? "Se ficar vazio, usamos o nome do arquivo." : undefined}
          />
          <UnderlineField
            label="Descrição"
            value={form.description}
            onChange={(v) => setForm((f) => ({ ...f, description: v }))}
          />
          {creating ? (
            <label className="block">
              <span className="text-[11px] font-medium tracking-[0.08em] text-muted uppercase">Arquivos</span>
              <input
                ref={inputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => setPendingFiles(Array.from(e.target.files || []))}
              />
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line px-4 py-8 text-sm text-muted hover:bg-wash"
              >
                <Upload className="h-4 w-4" />
                {pendingFiles.length
                  ? `${pendingFiles.length} arquivo${pendingFiles.length === 1 ? "" : "s"} selecionado${pendingFiles.length === 1 ? "" : "s"}`
                  : "Clique para escolher (até 1 GB cada)"}
              </button>
            </label>
          ) : null}
          {progress ? <p className="text-sm text-muted">{progress}</p> : null}
          {formError ? <p className="text-sm text-open">{formError}</p> : null}
          <PrimaryButton type="submit" disabled={save.isPending}>
            {save.isPending ? progress || "Enviando…" : creating ? "Publicar" : "Salvar"}
          </PrimaryButton>
        </form>
      </Modal>
    </div>
  );
}
