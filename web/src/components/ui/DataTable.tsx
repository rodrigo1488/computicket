"use client";

import {
  ChevronsUpDown,
  ChevronDown,
  Columns3,
  Filter,
  Search,
  ArrowDown,
  ArrowUp,
} from "lucide-react";
import {
  isValidElement,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { cn } from "@/lib/cn";
import { FloatingMenu } from "@/components/ui/FloatingMenu";
import { TableLoadingOverlay, TableLoadingRows } from "@/components/ui/table-loading";
import type { ColFilter } from "@/lib/api";

export type KpiTone = "default" | "open" | "progress" | "done" | "brand";

export type ColumnFilterOp = "contains" | "equals";

export type ColumnFilter = {
  op: ColumnFilterOp;
  value: string;
};

export type DataTableColumnMeta = {
  /**
   * Tipo do funil.
   * - `select`: só lista de valores (op = equals); opções explícitas ou valores únicos das `rows`.
   * - `text`: operadores Contém/Igual a + select de valores únicos (fallback para input se vazio).
   * Valores sempre vêm das `rows` passadas à tabela (conjunto atual / página carregada), não do banco inteiro.
   */
  filter?: "text" | "select" | false;
  options?: { value: string; label: string }[];
  /** Não ordenável / sem funil. */
  sortable?: boolean;
  /** Campo enviado à API (col_filters). */
  field?: string;
};

/** Acima deste tamanho, o funil de valor ganha campo de busca. */
const FILTER_VALUE_SEARCH_THRESHOLD = 12;

export type DataTableProps = {
  /** Chave de persistência das colunas no localStorage (`datatable:{id}:cols`). */
  id?: string;
  columns: string[];
  rows: ReactNode[][];
  empty?: string;
  searchPlaceholder?: string;
  /** Busca no servidor: disparada ao clicar em Buscar (ou Enter). */
  onSearch?: (q: string) => void;
  /** Valor aplicado (controlado) — sincroniza o input após busca no servidor. */
  searchValue?: string;
  /** Metadados por nome de coluna (funil select, desligar sort, etc.). */
  columnMeta?: Record<string, DataTableColumnMeta>;
  /** Filtros de coluna no servidor. Se definido, o funil não filtra só a página atual. */
  onFiltersChange?: (filters: ColFilter[]) => void;
  hideSearch?: boolean;
  hideColumnPicker?: boolean;
  selectable?: boolean;
  loading?: boolean;
  refreshing?: boolean;
  skeletonRows?: number;
};

const STORAGE_PREFIX = "datatable:";

function isActionsColumn(name: string) {
  const n = name.trim().toLowerCase();
  return !n || n === "ações" || n === "acoes";
}

function isStatusColumn(name: string) {
  return /status|situa[cç][aã]o|estado/i.test(name);
}

function fieldName(col: string, meta?: DataTableColumnMeta) {
  if (meta?.field) return meta.field;
  const n = col
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
  const map: Record<string, string> = {
    nome: "name",
    titulo: "title",
    cliente: "client_name",
    documento: "document",
    telefone: "phone",
    "e-mail": "email",
    email: "email",
    contrato: "contract_type",
    servico: "category",
    situacao: "status",
    status: "status",
    valor: "value",
    tecnico: "technician_name",
    codigo: "codigo",
    horas: "hours",
    maquina: "machine_name",
    descricao: "description",
    categoria: "category",
    vendedor: "seller_name",
    equipe: "team",
    perfil: "role",
    "#": "id",
    sistema: "name",
    item: "title",
    serial: "serial_number",
    uuid: "public_uuid",
    anydesk: "anydesk_code",
    senhas: "passwords_count",
    origem: "origin",
    conclusao: "completion_date",
    tipo: "type",
    planos: "plans_count",
    visualizacoes: "views_count",
    valor_hora: "hourly_rate",
    "valor hora": "hourly_rate",
    ultima_localizacao: "address",
    solicitante: "solicitante",
    criado: "created_at",
    "criado em": "created_at",
  };
  return map[n] || n.replace(/\s+/g, "_");
}

export function cellText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(cellText).join(" ");
  if (isValidElement(node)) {
    const props = node.props as { children?: ReactNode };
    return cellText(props.children);
  }
  return "";
}

function sortKey(text: string): string | number {
  const raw = text.trim();
  const money = raw.replace(/R\$\s*/i, "").replace(/\./g, "").replace(",", ".").trim();
  if (money && /^-?\d+(\.\d+)?$/.test(money)) return Number(money);
  const plain = raw.replace(",", ".");
  if (/^-?\d+(\.\d+)?$/.test(plain)) return Number(plain);
  return raw.toLocaleLowerCase("pt-BR");
}

function matchesFilter(text: string, filter: ColumnFilter) {
  const hay = text.toLocaleLowerCase("pt-BR").trim();
  const needle = filter.value.toLocaleLowerCase("pt-BR").trim();
  if (!needle) return true;
  if (filter.op === "equals") return hay === needle;
  return hay.includes(needle);
}

function StatusLike({ text }: { text: string }) {
  const t = text.trim();
  const lower = t.toLocaleLowerCase("pt-BR");
  if (["ativo", "ativa", "online", "disponível", "disponivel", "aprovado"].includes(lower)) {
    return <span className="font-medium text-done">{t}</span>;
  }
  if (["inativo", "inativa", "offline", "cancelada", "cancelado", "rejeitado"].includes(lower)) {
    return <span className="text-muted">{t}</span>;
  }
  return <>{t}</>;
}

function renderCell(node: ReactNode): ReactNode {
  if (typeof node === "string" || typeof node === "number") {
    return <StatusLike text={String(node)} />;
  }
  return node;
}

function loadHidden(id: string | undefined, columns: string[]): Set<string> {
  if (!id || typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${id}:cols`);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as string[];
    const allowed = new Set(columns.filter((c) => !isActionsColumn(c)));
    return new Set(parsed.filter((c) => allowed.has(c)));
  } catch {
    return new Set();
  }
}

export function DataTable({
  id,
  columns,
  rows,
  empty = "Nenhum registro",
  searchPlaceholder = "Buscar por nome, código…",
  onSearch,
  searchValue,
  columnMeta,
  onFiltersChange,
  hideSearch = false,
  hideColumnPicker = false,
  selectable = true,
  loading = false,
  refreshing = false,
  skeletonRows = 7,
}: DataTableProps) {
  const [draft, setDraft] = useState(searchValue || "");
  const [appliedQ, setAppliedQ] = useState(searchValue || "");
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<{ col: number; dir: "asc" | "desc" } | null>(null);
  const [filters, setFilters] = useState<Record<number, ColumnFilter>>({});
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [open, setOpen] = useState<{ kind: "cols" | "filter"; col?: number; el: HTMLElement } | null>(
    null,
  );
  const [filterDraft, setFilterDraft] = useState<ColumnFilter>({ op: "contains", value: "" });

  useEffect(() => {
    if (searchValue !== undefined) {
      setDraft(searchValue);
      setAppliedQ(searchValue);
    }
  }, [searchValue]);

  const colKey = columns.join("\0");

  useEffect(() => {
    setHidden(loadHidden(id, columns));
    // columns is represented by colKey
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, colKey]);

  const persistHidden = useCallback(
    (next: Set<string>) => {
      setHidden(next);
      if (!id || typeof window === "undefined") return;
      localStorage.setItem(`${STORAGE_PREFIX}${id}:cols`, JSON.stringify([...next]));
    },
    [id],
  );

  const visibleIdx = useMemo(
    () => columns.map((_, i) => i).filter((i) => !hidden.has(columns[i])),
    [columns, hidden],
  );

  const dataColIdx = useMemo(
    () => columns.map((_, i) => i).filter((i) => !isActionsColumn(columns[i])),
    [columns],
  );

  const processed = useMemo(() => {
    const q = onSearch || onFiltersChange ? "" : appliedQ.trim().toLocaleLowerCase("pt-BR");
    let indexed = rows.map((row, index) => ({ row, index }));
    if (q) {
      indexed = indexed.filter(({ row }) =>
        dataColIdx.some((i) => cellText(row[i]).toLocaleLowerCase("pt-BR").includes(q)),
      );
    }
    if (!onFiltersChange) {
      for (const [col, filter] of Object.entries(filters)) {
        const ci = Number(col);
        if (!filter?.value) continue;
        indexed = indexed.filter(({ row }) => matchesFilter(cellText(row[ci]), filter));
      }
    }
    if (sort) {
      const { col, dir } = sort;
      indexed = [...indexed].sort((a, b) => {
        const ka = sortKey(cellText(a.row[col]));
        const kb = sortKey(cellText(b.row[col]));
        let cmp = 0;
        if (typeof ka === "number" && typeof kb === "number") cmp = ka - kb;
        else cmp = String(ka).localeCompare(String(kb), "pt-BR", { numeric: true });
        return dir === "asc" ? cmp : -cmp;
      });
    }
    return indexed;
  }, [rows, appliedQ, filters, sort, dataColIdx, onSearch, onFiltersChange]);

  const emitFilters = (next: Record<number, ColumnFilter>) => {
    if (!onFiltersChange) return;
    const list: ColFilter[] = [];
    for (const [col, filter] of Object.entries(next)) {
      if (!filter?.value) continue;
      const i = Number(col);
      list.push({
        field: fieldName(columns[i], columnMeta?.[columns[i]]),
        op: filter.op,
        value: filter.value,
      });
    }
    onFiltersChange(list);
  };

  const allSelected = processed.length > 0 && processed.every(({ index }) => selected.has(index));
  const someSelected = processed.some(({ index }) => selected.has(index));
  const initialLoading = loading && rows.length === 0;
  const updating = refreshing && !initialLoading;

  const runSearch = () => {
    const next = draft.trim();
    setAppliedQ(next);
    onSearch?.(next);
  };

  const toggleSort = (col: number) => {
    setSort((prev) => {
      if (!prev || prev.col !== col) return { col, dir: "asc" };
      if (prev.dir === "asc") return { col, dir: "desc" };
      return null;
    });
  };

  const uniqueValues = (col: number) => {
    const set = new Set<string>();
    for (const row of rows) {
      const t = cellText(row[col]).trim();
      // Ignora vazios e traço tipográfico usado como placeholder
      if (!t || t === "—" || t === "-") continue;
      set.add(t);
    }
    return [...set].sort((a, b) => {
      const ka = sortKey(a);
      const kb = sortKey(b);
      if (typeof ka === "number" && typeof kb === "number") return ka - kb;
      return String(ka).localeCompare(String(kb), "pt-BR", { numeric: true });
    });
  };

  const filterKind = (col: number): "text" | "select" | false => {
    const name = columns[col];
    const meta = columnMeta?.[name];
    if (meta?.filter === false) return false;
    if (meta?.filter) return meta.filter;
    if (isStatusColumn(name)) return "select";
    return "text";
  };

  return (
    <div>
      {hideSearch && hideColumnPicker ? null : (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          {hideSearch ? (
            <div />
          ) : (
            <form
              className="flex min-w-0 flex-1 items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                runSearch();
              }}
            >
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={searchPlaceholder}
                disabled={loading || refreshing}
                className="h-10 min-w-[220px] max-w-md flex-1 rounded-lg border border-line bg-surface px-3 text-sm text-ink placeholder:text-muted"
              />
              <button
                type="submit"
                disabled={loading || refreshing}
                className="inline-flex h-10 shrink-0 items-center gap-2 rounded-lg bg-brand px-4 text-sm font-medium text-white hover:bg-brand/90 disabled:cursor-wait disabled:opacity-60"
              >
                <Search className="h-4 w-4" />
                Buscar
              </button>
            </form>
          )}
          {hideColumnPicker ? null : (
            <button
              type="button"
              disabled={loading || refreshing}
              onClick={(e) =>
                setOpen((cur) =>
                  cur?.kind === "cols" ? null : { kind: "cols", el: e.currentTarget },
                )
              }
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm text-ink hover:bg-wash disabled:cursor-wait disabled:opacity-60"
            >
              <Columns3 className="h-4 w-4 text-muted" />
              Personalizar Colunas
              <ChevronDown className="h-4 w-4 text-muted" />
            </button>
          )}
        </div>
      )}

      {open?.kind === "cols" ? (
        <FloatingMenu
          anchor={open.el}
          align="right"
          width={260}
          onClose={() => setOpen(null)}
          className="max-h-[min(70vh,420px)] overflow-y-auto p-2"
        >
          <p className="px-2 py-1 text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
            Colunas visíveis
          </p>
          {columns.map((c, i) => {
            const locked = isActionsColumn(c);
            const checked = locked || !hidden.has(c);
            return (
              <label
                key={`${i}-${c || "acoes"}`}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm",
                  locked ? "cursor-default text-muted" : "cursor-pointer hover:bg-wash",
                )}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={locked}
                  onChange={() => {
                    if (locked) return;
                    const next = new Set(hidden);
                    if (next.has(c)) next.delete(c);
                    else next.add(c);
                    persistHidden(next);
                  }}
                  className="accent-brand"
                />
                {c || "Ações"}
              </label>
            );
          })}
        </FloatingMenu>
      ) : null}

      {open?.kind === "filter" && open.col != null ? (
        <FilterPopover
          col={open.col}
          name={columns[open.col]}
          kind={filterKind(open.col)}
          options={columnMeta?.[columns[open.col]]?.options}
          unique={uniqueValues(open.col)}
          draft={filterDraft}
          setDraft={setFilterDraft}
          anchor={open.el}
          onClose={() => setOpen(null)}
          onApply={() => {
            setFilters((prev) => {
              const next = { ...prev };
              if (!filterDraft.value.trim()) delete next[open.col!];
              else next[open.col!] = { ...filterDraft, value: filterDraft.value.trim() };
              emitFilters(next);
              return next;
            });
            setOpen(null);
          }}
          onClear={() => {
            setFilters((prev) => {
              const next = { ...prev };
              delete next[open.col!];
              emitFilters(next);
              return next;
            });
            setFilterDraft({ op: "contains", value: "" });
            setOpen(null);
          }}
        />
      ) : null}

      <div className="relative overflow-x-auto rounded-2xl border border-line">
        <table className="w-full text-left text-sm" aria-busy={loading || refreshing}>
          <thead>
            <tr className="border-b border-line bg-wash text-ink">
              {selectable ? (
                <th className="w-10 px-3 py-2.5">
                  <input
                    type="checkbox"
                    className="accent-brand"
                    disabled={loading || refreshing}
                    checked={allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = !allSelected && someSelected;
                    }}
                    onChange={() => {
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (allSelected) processed.forEach(({ index }) => next.delete(index));
                        else processed.forEach(({ index }) => next.add(index));
                        return next;
                      });
                    }}
                    aria-label="Selecionar todos"
                  />
                </th>
              ) : null}
              {visibleIdx.map((i) => {
                const name = columns[i];
                const actions = isActionsColumn(name);
                const activeSort = sort?.col === i;
                const activeFilter = Boolean(filters[i]?.value);
                const canFilter = !actions && filterKind(i) !== false;
                return (
                  <th
                    key={`${name}-${i}`}
                    className={cn(
                      "px-3 py-2.5 font-medium",
                      actions && "text-right",
                    )}
                  >
                    {actions ? (
                      <span>{name || "Ações"}</span>
                    ) : (
                      <span className="inline-flex items-center gap-1">
                        <span>{name}</span>
                        <button
                          type="button"
                          disabled={loading || refreshing}
                          onClick={() => toggleSort(i)}
                          className={cn(
                            "rounded p-0.5 hover:bg-line",
                            activeSort ? "text-brand" : "text-muted",
                          )}
                          aria-label={`Ordenar por ${name}`}
                        >
                          {activeSort && sort?.dir === "asc" ? (
                            <ArrowUp className="h-3.5 w-3.5" />
                          ) : activeSort && sort?.dir === "desc" ? (
                            <ArrowDown className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronsUpDown className="h-3.5 w-3.5" />
                          )}
                        </button>
                        {canFilter ? (
                          <button
                            type="button"
                            disabled={loading || refreshing}
                            onClick={(e) => {
                              setFilterDraft(filters[i] || { op: "contains", value: "" });
                              setOpen({ kind: "filter", col: i, el: e.currentTarget });
                            }}
                            className={cn(
                              "rounded p-0.5 hover:bg-line",
                              activeFilter ? "text-brand" : "text-muted",
                            )}
                            aria-label={`Filtrar ${name}`}
                          >
                            <Filter className="h-3.5 w-3.5" />
                          </button>
                        ) : null}
                      </span>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {initialLoading ? (
              <TableLoadingRows
                columns={visibleIdx.length + (selectable ? 1 : 0)}
                rows={skeletonRows}
              />
            ) : processed.length === 0 ? (
              <tr>
                <td
                  className="px-4 py-6 text-sm text-muted"
                  colSpan={visibleIdx.length + (selectable ? 1 : 0)}
                >
                  {empty}
                </td>
              </tr>
            ) : (
              processed.map(({ row, index }) => (
                <tr key={index} className="border-t border-line hover:bg-wash">
                  {selectable ? (
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        className="accent-brand"
                        checked={selected.has(index)}
                        onChange={() => {
                          setSelected((prev) => {
                            const next = new Set(prev);
                            if (next.has(index)) next.delete(index);
                            else next.add(index);
                            return next;
                          });
                        }}
                        aria-label={`Selecionar linha ${index + 1}`}
                      />
                    </td>
                  ) : null}
                  {visibleIdx.map((i) => (
                    <td
                      key={i}
                      className={cn(
                        "px-3 py-3 text-ink",
                        isActionsColumn(columns[i]) && "text-right",
                      )}
                    >
                      {renderCell(row[i])}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
        {updating ? <TableLoadingOverlay /> : null}
      </div>
    </div>
  );
}

function FilterValueSelect({
  value,
  options,
  onChange,
  className,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  className?: string;
}) {
  const [query, setQuery] = useState("");
  const searchable = options.length > FILTER_VALUE_SEARCH_THRESHOLD;
  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("pt-BR");
    if (!q) return options;
    return options.filter((o) => o.label.toLocaleLowerCase("pt-BR").includes(q));
  }, [options, query]);

  const known = options.some((o) => o.value === value);
  const selectValue = known ? value : value ? `__custom__:${value}` : "";
  const visible = useMemo(() => {
    if (!value || !known) return filtered;
    if (filtered.some((o) => o.value === value)) return filtered;
    const selected = options.find((o) => o.value === value);
    return selected ? [selected, ...filtered] : filtered;
  }, [filtered, known, options, value]);

  return (
    <div className={className}>
      {searchable ? (
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar valor…"
          className="mb-2 w-full rounded-lg border border-line bg-surface px-2 py-2 text-sm placeholder:text-muted"
        />
      ) : null}
      <select
        value={selectValue}
        onChange={(e) => {
          const raw = e.target.value;
          const v = raw.startsWith("__custom__:") ? raw.slice("__custom__:".length) : raw;
          onChange(v);
        }}
        className="w-full rounded-lg border border-line bg-surface px-2 py-2 text-sm"
      >
        <option value="">Todos</option>
        {!known && value ? <option value={`__custom__:${value}`}>{value}</option> : null}
        {visible.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function FilterPopover({
  col,
  name,
  kind,
  options,
  unique,
  draft,
  setDraft,
  anchor,
  onClose,
  onApply,
  onClear,
}: {
  col: number;
  name: string;
  kind: "text" | "select" | false;
  options?: { value: string; label: string }[];
  unique: string[];
  draft: ColumnFilter;
  setDraft: (f: ColumnFilter) => void;
  anchor: HTMLElement;
  onClose: () => void;
  onApply: () => void;
  onClear: () => void;
}) {
  void col;
  const selectOpts = options?.length ? options : unique.map((v) => ({ value: v, label: v }));
  const isSelect = kind === "select";
  const hasValueList = selectOpts.length > 0;

  return (
    <FloatingMenu anchor={anchor} width={260} onClose={onClose} className="p-3">
      <p className="mb-2 text-xs font-medium text-ink">Filtrar {name}</p>
      {isSelect ? (
        <FilterValueSelect
          value={draft.value}
          options={selectOpts}
          className="mb-3"
          onChange={(value) => setDraft({ op: "equals", value })}
        />
      ) : (
        <>
          <select
            value={draft.op}
            onChange={(e) => setDraft({ ...draft, op: e.target.value as ColumnFilterOp })}
            className="mb-2 w-full rounded-lg border border-line bg-surface px-2 py-2 text-sm"
          >
            <option value="contains">Contém</option>
            <option value="equals">Igual a</option>
          </select>
          {hasValueList ? (
            <FilterValueSelect
              value={draft.value}
              options={selectOpts}
              className="mb-3"
              onChange={(value) => setDraft({ ...draft, value })}
            />
          ) : (
            <input
              value={draft.value}
              onChange={(e) => setDraft({ ...draft, value: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") onApply();
              }}
              placeholder="Valor…"
              className="mb-3 w-full rounded-lg border border-line px-2 py-2 text-sm"
            />
          )}
        </>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClear} className="rounded-lg px-3 py-1.5 text-sm text-muted hover:bg-wash">
          Limpar
        </button>
        <button
          type="button"
          onClick={onApply}
          className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white"
        >
          Aplicar
        </button>
      </div>
    </FloatingMenu>
  );
}

export const FilterableTable = DataTable;

const KPI_TONE: Record<KpiTone, { box: string; value: string; bar?: string }> = {
  default: { box: "border-line bg-surface", value: "text-navy" },
  open: { box: "border-open/15 bg-open-bg", value: "text-open", bar: "bg-open" },
  progress: { box: "border-progress/15 bg-progress-bg", value: "text-progress", bar: "bg-progress" },
  done: { box: "border-done/15 bg-done-bg", value: "text-done", bar: "bg-done" },
  brand: { box: "border-brand/15 bg-progress-bg", value: "text-brand", bar: "bg-brand" },
};

export function Kpi({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: KpiTone;
}) {
  const cfg = KPI_TONE[tone] || KPI_TONE.default;
  return (
    <div className={cn("rounded-2xl border p-5", cfg.box)}>
      {cfg.bar ? <span className={cn("mb-3 block h-1 w-10 rounded-full", cfg.bar)} /> : null}
      <p className="text-sm text-muted">{label}</p>
      <p className={cn("mt-2 text-2xl font-semibold", cfg.value)}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}
