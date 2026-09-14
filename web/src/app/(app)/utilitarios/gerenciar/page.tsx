"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Download, ExternalLink, FolderPlus, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { PageTitle } from "@/components/layout/AppShell";
import { Modal } from "@/components/ui/Modal";
import { PrimaryButton, UnderlineField } from "@/components/ui/UnderlineField";
import { flask } from "@/lib/api";
import { cn } from "@/lib/cn";
import {
  formatUtilityDate,
  groupUtilityFiles,
  uploadUtilityFile,
  utilityDownloadHref,
  UTILITY_MAX_FILE_BYTES,
  type UtilityCategory,
  type UtilityFile,
} from "@/lib/utilitarios";

type Res = { items: UtilityFile[]; total: number; categories?: UtilityCategory[] };
type Filter = "all" | "none" | number;

const emptyForm = { title: "", description: "", category_id: "" };

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
  const [filter, setFilter] = useState<Filter>("all");
  const [catsOpen, setCatsOpen] = useState(false);
  const [catName, setCatName] = useState("");
  const [catError, setCatError] = useState("");
  const [editingCat, setEditingCat] = useState<UtilityCategory | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["utilitarios-admin"],
    queryFn: () => flask.get<Res>("/utilitarios/api"),
  });

  const items = data?.items || [];
  const categories = data?.categories || [];
  const groups = useMemo(() => groupUtilityFiles(items, categories), [items, categories]);
  const visibleGroups = useMemo(() => {
    if (filter === "all") return groups;
    if (filter === "none") return groups.filter((group) => group.id === "none");
    return groups.filter((group) => group.id === filter);
  }, [filter, groups]);
  const uncategorizedCount = items.filter((file) => !file.category_id).length;
  const publicUrl = typeof window === "undefined" ? "/utilitarios" : `${window.location.origin}/utilitarios`;

  const invalidate = () => qc.invalidateQueries({ queryKey: ["utilitarios-admin"] });

  const save = useMutation({
    mutationFn: async () => {
      const categoryId = form.category_id ? Number(form.category_id) : null;
      if (creating) {
        if (!pendingFiles.length) throw new Error("Selecione ao menos um arquivo.");
        const tooBig = pendingFiles.find((file) => file.size > UTILITY_MAX_FILE_BYTES);
        if (tooBig) throw new Error(`"${tooBig.name}" passa de 1 GB. Envie um arquivo menor.`);
        const created: UtilityFile[] = [];
        for (let i = 0; i < pendingFiles.length; i += 1) {
          const file = pendingFiles[i];
          const prefix = pendingFiles.length > 1 ? `${i + 1}/${pendingFiles.length} · ` : "";
          setProgress(`${prefix}Enviando ${file.name}…`);
          created.push(
            await uploadUtilityFile(
              file,
              {
                title: form.title.trim(),
                description: form.description.trim(),
                category_id: categoryId,
              },
              (percent) => setProgress(`${prefix}${file.name} · ${percent}%`),
            ),
          );
        }
        return { items: created };
      }
      if (!edit) throw new Error("Nenhum arquivo");
      if (!form.title.trim()) throw new Error("Título é obrigatório");
      return flask.patch(`/utilitarios/api/${edit.id}`, {
        title: form.title.trim(),
        description: form.description.trim(),
        category_id: categoryId,
      });
    },
    onSuccess: () => {
      invalidate();
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
    onSuccess: invalidate,
  });

  const saveCategory = useMutation({
    mutationFn: async () => {
      const name = catName.trim();
      if (!name) throw new Error("Nome da categoria é obrigatório");
      if (editingCat) return flask.patch(`/utilitarios/api/categorias/${editingCat.id}`, { name });
      return flask.post("/utilitarios/api/categorias", { name });
    },
    onSuccess: () => {
      invalidate();
      setCatName("");
      setEditingCat(null);
      setCatError("");
    },
    onError: (e) => setCatError(e instanceof Error ? e.message : "Erro ao salvar categoria"),
  });

  const removeCategory = useMutation({
    mutationFn: (id: number) => flask.delete(`/utilitarios/api/categorias/${id}`),
    onSuccess: invalidate,
    onError: (e) => setCatError(e instanceof Error ? e.message : "Erro ao excluir categoria"),
  });

  function openCreate() {
    setForm(emptyForm);
    setPendingFiles([]);
    setFormError("");
    setEdit(null);
    setCreating(true);
  }

  function openEdit(file: UtilityFile) {
    setForm({
      title: file.title,
      description: file.description || "",
      category_id: file.category_id ? String(file.category_id) : "",
    });
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
            onClick={() => {
              setCatName("");
              setEditingCat(null);
              setCatError("");
              setCatsOpen(true);
            }}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-wash px-4 text-sm font-medium text-ink"
          >
            <FolderPlus className="h-4 w-4" />
            Categorias
          </button>
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

      {categories.length || uncategorizedCount ? (
        <div className="mb-6 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setFilter("all")}
            className={cn(
              "h-9 rounded-full border px-3 text-sm",
              filter === "all" ? "border-ink bg-inverse text-on-inverse" : "border-line text-ink",
            )}
          >
            Todos
          </button>
          {categories.map((category) => (
            <button
              key={category.id}
              type="button"
              onClick={() => setFilter(category.id)}
              className={cn(
                "h-9 rounded-full border px-3 text-sm",
                filter === category.id ? "border-ink bg-inverse text-on-inverse" : "border-line text-ink",
              )}
            >
              {category.name}
              {typeof category.files_count === "number" ? ` (${category.files_count})` : ""}
            </button>
          ))}
          {uncategorizedCount ? (
            <button
              type="button"
              onClick={() => setFilter("none")}
              className={cn(
                "h-9 rounded-full border px-3 text-sm",
                filter === "none" ? "border-ink bg-inverse text-on-inverse" : "border-line text-ink",
              )}
            >
              Sem categoria ({uncategorizedCount})
            </button>
          ) : null}
        </div>
      ) : null}

      {isLoading ? <p className="mb-4 text-sm text-muted">Carregando arquivos…</p> : null}
      {error ? <p className="mb-4 text-sm text-open">{(error as Error).message}</p> : null}

      {items.length === 0 && !isLoading ? (
        <div className="rounded-2xl border border-line px-6 py-12 text-center text-sm text-muted">
          Nenhum arquivo enviado. Publique o primeiro para disponibilizar o download em /utilitarios.
        </div>
      ) : (
        <div className="space-y-8">
          {visibleGroups.map((group) => (
            <section key={String(group.id)}>
              {filter === "all" && (categories.length > 0 || uncategorizedCount) ? (
                <h2 className="mb-3 text-sm font-semibold tracking-[0.04em] text-navy uppercase">{group.name}</h2>
              ) : null}
              <ul className="space-y-3">
                {group.files.map((file) => (
                  <li key={file.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-line p-4">
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold text-navy">{file.title}</h3>
                      <p className="truncate text-sm text-muted">{file.original_filename}</p>
                      {file.description ? <p className="mt-1 text-sm text-ink">{file.description}</p> : null}
                      <p className="mt-1 text-xs text-muted">
                        {file.category_name ? `${file.category_name} · ` : ""}
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
            </section>
          ))}
        </div>
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
          <label className="block">
            <span className="text-[11px] font-medium tracking-[0.08em] text-muted uppercase">Categoria</span>
            <select
              value={form.category_id}
              onChange={(e) => setForm((f) => ({ ...f, category_id: e.target.value }))}
              className="mt-1 w-full border-0 border-b border-line bg-transparent py-2 text-[15px] text-ink"
            >
              <option value="">Sem categoria</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
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

      <Modal
        open={catsOpen}
        onClose={() => {
          setCatsOpen(false);
          setEditingCat(null);
        }}
        title="Categorias"
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            saveCategory.mutate();
          }}
        >
          <UnderlineField
            label={editingCat ? "Renomear categoria" : "Nova categoria"}
            value={catName}
            onChange={setCatName}
            placeholder="Ex.: Instaladores"
          />
          <div className="flex gap-2">
            <PrimaryButton type="submit" disabled={saveCategory.isPending}>
              {saveCategory.isPending ? "Salvando…" : editingCat ? "Salvar nome" : "Adicionar"}
            </PrimaryButton>
            {editingCat ? (
              <button
                type="button"
                onClick={() => {
                  setEditingCat(null);
                  setCatName("");
                }}
                className="rounded-xl border border-line px-4 text-sm font-medium text-ink"
              >
                Cancelar
              </button>
            ) : null}
          </div>
          {catError ? <p className="text-sm text-open">{catError}</p> : null}
        </form>
        <ul className="mt-6 space-y-2">
          {categories.length === 0 ? (
            <li className="rounded-xl border border-line px-4 py-6 text-center text-sm text-muted">
              Nenhuma categoria ainda. Crie a primeira para organizar os arquivos.
            </li>
          ) : (
            categories.map((category) => (
              <li key={category.id} className="flex items-center gap-2 rounded-xl border border-line px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{category.name}</p>
                  <p className="text-xs text-muted">
                    {category.files_count || 0} arquivo{(category.files_count || 0) === 1 ? "" : "s"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setEditingCat(category);
                    setCatName(category.name);
                    setCatError("");
                  }}
                  className="inline-flex h-8 w-9 items-center justify-center rounded-lg bg-wash text-muted"
                  aria-label="Renomear categoria"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm(`Excluir a categoria ${category.name}? Os arquivos ficam sem categoria.`)) {
                      removeCategory.mutate(category.id);
                    }
                  }}
                  className="inline-flex h-8 w-9 items-center justify-center rounded-lg bg-wash text-open"
                  aria-label="Excluir categoria"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))
          )}
        </ul>
      </Modal>
    </div>
  );
}
