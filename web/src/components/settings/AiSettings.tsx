"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { PrimaryButton, UnderlineField } from "@/components/ui/UnderlineField";
import { flask } from "@/lib/api";

type AiConfig = {
  success?: boolean;
  api_key_configured: boolean;
  source: "settings" | "env" | "none";
  model: string;
  embedding_model: string;
  message?: string;
  error?: string;
};

function sourceLabel(source?: AiConfig["source"]) {
  if (source === "settings") return "salva nas configurações";
  if (source === "env") return "variável de ambiente";
  return "não configurada";
}

export function AiSettings() {
  const qc = useQueryClient();
  const { data, error, isFetching, refetch } = useQuery({
    queryKey: ["ai-config"],
    queryFn: () => flask.get<AiConfig>("/configuracoes/ai"),
  });
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [embeddingModel, setEmbeddingModel] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    setApiKey("");
    setModel(data.model || "gemini-3.6-flash");
    setEmbeddingModel(data.embedding_model || "gemini-embedding-001");
  }, [data]);

  const save = useMutation({
    mutationFn: () =>
      flask.put<AiConfig>("/configuracoes/ai", {
        ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
        model: model.trim(),
        embedding_model: embeddingModel.trim(),
      }),
    onSuccess: () => {
      setApiKey("");
      setMessage("Configurações de IA salvas.");
      qc.invalidateQueries({ queryKey: ["ai-config"] });
    },
    onError: (e: Error) => setMessage(e.message),
  });

  const test = useMutation({
    mutationFn: () => flask.post<{ success: boolean; message?: string; error?: string }>("/configuracoes/ai/test"),
    onSuccess: (result) => setMessage(result.message || "Conexão validada."),
    onError: (e: Error) => setMessage(e.message),
  });

  const clear = useMutation({
    mutationFn: () => flask.put<AiConfig>("/configuracoes/ai", { clear_api_key: true }),
    onSuccess: (result) => {
      setApiKey("");
      setMessage(
        result.source === "env"
          ? "Chave salva removida; a variável de ambiente continua ativa."
          : "Chave da API removida.",
      );
      qc.invalidateQueries({ queryKey: ["ai-config"] });
    },
    onError: (e: Error) => setMessage(e.message),
  });

  return (
    <div className="max-w-xl space-y-7">
      <div className="rounded-xl border border-[#eee] p-4">
        <div className="flex items-start gap-3">
          <Bot className="mt-0.5 h-5 w-5 text-brand" />
          <div>
            <p className="text-sm font-semibold text-ink">Gemini para o Copiloto RAG</p>
            <p className="mt-1 text-sm text-muted">
              A chave salva é criptografada e nunca é devolvida ao navegador. Ela também é usada
              pela geração de orçamentos.
            </p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3 text-xs">
          <span
            className={
              data?.api_key_configured
                ? "rounded-full bg-done-bg px-2.5 py-1 font-semibold text-done"
                : "rounded-full bg-open-bg px-2.5 py-1 font-semibold text-open"
            }
          >
            {data?.api_key_configured ? "Chave configurada" : "Chave ausente"}
          </span>
          <span className="text-muted">Fonte: {sourceLabel(data?.source)}</span>
          <button
            type="button"
            onClick={() => refetch()}
            className="ml-auto inline-flex items-center gap-1.5 font-medium text-muted hover:text-ink"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
            Atualizar
          </button>
        </div>
      </div>

      {error ? <p className="text-sm text-open">{(error as Error).message}</p> : null}

      <form
        className="space-y-6"
        onSubmit={(event) => {
          event.preventDefault();
          setMessage(null);
          save.mutate();
        }}
      >
        <UnderlineField
          label="Chave da API Gemini"
          type="password"
          value={apiKey}
          onChange={setApiKey}
          placeholder={data?.api_key_configured ? "••••••••  (deixe em branco para manter)" : "AIza..."}
          hint="Obtenha a chave no Google AI Studio. O valor não será exibido novamente."
        />
        <UnderlineField
          label="Modelo de geração"
          value={model}
          onChange={setModel}
          placeholder="gemini-3.6-flash"
        />
        <UnderlineField
          label="Modelo de embeddings"
          value={embeddingModel}
          onChange={setEmbeddingModel}
          placeholder="gemini-embedding-001"
          hint="Alterar este modelo exige executar novamente a indexação do RAG."
        />
        <PrimaryButton type="submit" disabled={save.isPending || !model.trim() || !embeddingModel.trim()}>
          {save.isPending ? "Salvando…" : "Salvar configurações de IA"}
        </PrimaryButton>
      </form>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={test.isPending || !data?.api_key_configured}
          onClick={() => {
            setMessage(null);
            test.mutate();
          }}
          className="rounded-xl border border-line px-4 py-2.5 text-sm font-semibold text-ink disabled:opacity-40"
        >
          {test.isPending ? "Testando…" : "Testar geração e embeddings"}
        </button>
        {data?.source === "settings" ? (
          <button
            type="button"
            disabled={clear.isPending}
            onClick={() => {
              if (window.confirm("Remover a chave Gemini salva nas configurações?")) clear.mutate();
            }}
            className="rounded-xl px-4 py-2.5 text-sm font-semibold text-open disabled:opacity-40"
          >
            Remover chave salva
          </button>
        ) : null}
      </div>

      {message ? <p className="text-sm text-muted">{message}</p> : null}
    </div>
  );
}
