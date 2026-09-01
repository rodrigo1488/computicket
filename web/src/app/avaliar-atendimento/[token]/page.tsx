"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Star } from "lucide-react";
import { flask } from "@/lib/api";
import { cn } from "@/lib/cn";

type RatingState = {
  answered: boolean;
  score?: number | null;
  customer_name?: string | null;
};

export default function ServiceRatingPage({ params }: { params: Promise<{ token: string }> }) {
  const [token, setToken] = useState("");
  const [data, setData] = useState<RatingState | null>(null);
  const [score, setScore] = useState(0);
  const [hovered, setHovered] = useState(0);
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    params.then(({ token: value }) => setToken(value));
  }, [params]);

  useEffect(() => {
    if (!token) return;
    flask
      .get<RatingState>(`/helpdesk/api/ratings/public/${encodeURIComponent(token)}`)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Avaliação não encontrada."))
      .finally(() => setLoading(false));
  }, [token]);

  async function submit() {
    if (!score) {
      setError("Escolha uma nota de 1 a 5 estrelas.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await flask.post(`/helpdesk/api/ratings/public/${encodeURIComponent(token)}`, { score, comment });
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível enviar sua avaliação.");
    } finally {
      setSaving(false);
    }
  }

  const completed = sent || data?.answered;
  const selectedScore = sent ? score : data?.score;

  return (
    <main className="flex h-full min-h-0 items-start justify-center overflow-y-auto bg-canvas px-4 py-10">
      <section className="w-full max-w-lg rounded-3xl bg-surface p-7 shadow-[0_20px_70px_rgba(15,23,42,0.12)] sm:p-10">
        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand text-lg font-bold text-white">
            C
          </div>
          <div>
            <p className="font-semibold text-navy">Computicket</p>
            <p className="text-xs text-muted">Pesquisa de satisfação</p>
          </div>
        </div>

        {loading ? <p className="text-sm text-muted">Carregando avaliação…</p> : null}

        {!loading && error && !data ? (
          <div className="rounded-2xl bg-open-bg p-4 text-sm text-open">{error}</div>
        ) : null}

        {!loading && data && completed ? (
          <div className="py-5 text-center">
            <CheckCircle2 className="mx-auto h-14 w-14 text-done" />
            <h1 className="mt-5 text-2xl font-semibold text-navy">Obrigado pela sua avaliação!</h1>
            <p className="mt-2 text-sm text-muted">Sua opinião foi registrada e vai nos ajudar a melhorar.</p>
            {selectedScore ? (
              <div className="mt-5 flex justify-center gap-1" aria-label={`Nota ${selectedScore} de 5`}>
                {[1, 2, 3, 4, 5].map((value) => (
                  <Star
                    key={value}
                    className={cn(
                      "h-7 w-7",
                      value <= selectedScore ? "fill-[#f6b91a] text-[#f6b91a]" : "text-[#d9dde5]",
                    )}
                  />
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {!loading && data && !completed ? (
          <div>
            <p className="text-sm font-medium text-brand">Atendimento concluído</p>
            <h1 className="mt-2 text-2xl font-semibold text-navy">
              {data.customer_name ? `${data.customer_name}, como` : "Como"} foi o seu atendimento?
            </h1>
            <p className="mt-2 text-sm leading-6 text-muted">
              Selecione uma nota. Leva menos de um minuto.
            </p>

            <div className="mt-7 flex justify-center gap-2" onMouseLeave={() => setHovered(0)}>
              {[1, 2, 3, 4, 5].map((value) => {
                const active = value <= (hovered || score);
                return (
                  <button
                    key={value}
                    type="button"
                    onMouseEnter={() => setHovered(value)}
                    onFocus={() => setHovered(value)}
                    onClick={() => setScore(value)}
                    className="rounded-xl p-1.5 transition hover:scale-110 focus:outline-none focus:ring-2 focus:ring-brand/30"
                    aria-label={`${value} estrela${value > 1 ? "s" : ""}`}
                  >
                    <Star className={cn("h-10 w-10", active ? "fill-[#f6b91a] text-[#f6b91a]" : "text-[#d9dde5]")} />
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-center text-xs text-muted">
              {score ? `${score} de 5 estrelas` : "Clique em uma estrela"}
            </p>

            <label className="mt-7 block text-sm font-medium text-ink" htmlFor="rating-comment">
              Conte mais sobre sua experiência <span className="font-normal text-muted">(opcional)</span>
            </label>
            <textarea
              id="rating-comment"
              value={comment}
              onChange={(event) => setComment(event.target.value.slice(0, 1000))}
              rows={4}
              className="mt-2 w-full resize-none rounded-2xl border border-line px-4 py-3 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/10"
              placeholder="Escreva um comentário…"
            />
            <div className="mt-1 text-right text-[11px] text-muted">{comment.length}/1000</div>

            {error ? <p className="mt-3 text-sm text-open">{error}</p> : null}
            <button
              type="button"
              onClick={() => void submit()}
              disabled={saving || !score}
              className="mt-5 w-full rounded-xl bg-brand px-5 py-3 text-sm font-semibold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "Enviando…" : "Enviar avaliação"}
            </button>
          </div>
        ) : null}
      </section>
    </main>
  );
}
