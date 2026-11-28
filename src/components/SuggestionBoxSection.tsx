import { useState, type FormEvent } from 'react';
import { CheckCircle2, Send } from 'lucide-react';
import { api } from '../lib/api';

interface SuggestionBoxSectionProps {
  token: string | null;
  userName: string;
  userEmail: string;
}

const MAX_SUGGESTION_LENGTH = 500;

export function SuggestionBoxSection({
  token,
  userName,
  userEmail,
}: SuggestionBoxSectionProps) {
  const [suggestion, setSuggestion] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [submittedSuccess, setSubmittedSuccess] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = suggestion.trim();
    if (trimmed.length < 3) {
      setError('Escreva pelo menos 3 caracteres informando qual produto você gostaria de ver na loja.');
      return;
    }

    setSubmitting(true);
    setError('');
    setSubmittedSuccess(false);
    try {
      await api.submitSuggestion(token, trimmed);
      setSuggestion('');
      setSubmittedSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao enviar sugestão. Tente novamente.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section
      aria-labelledby="suggestion-box-title"
      className="rounded-2xl border border-white/12 bg-[#0C0C0C] p-5 sm:p-8"
    >
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-10 items-start">
        <div className="lg:col-span-5 space-y-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#9E9E9E]">
            Caixa de Sugestões
          </p>
          <h2
            id="suggestion-box-title"
            className="text-xl sm:text-2xl font-extrabold text-white tracking-tight text-balance"
          >
            Faltou algum produto que você procura?
          </h2>
          <p className="text-xs sm:text-sm text-[#A3A3A3] leading-relaxed">
            Conte para a equipe da R&amp;P Tabacaria quais essências, sabores, carvões, roshs ou
            bebidas você gostaria de encontrar aqui. Nossa equipe analisa cada pedido enviado.
          </p>
          <p className="text-xs text-[#8E8E8E] pt-1">
            Enviando como <span className="text-white font-semibold">{userName}</span> ·{' '}
            <span className="text-[#BDBDBD]">{userEmail}</span>
          </p>
        </div>

        <form onSubmit={handleSubmit} className="lg:col-span-7 space-y-3.5">
          <div>
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <label
                htmlFor="product-suggestion-input"
                className="text-xs font-semibold text-[#E5E5E5]"
              >
                Quais produtos você gostaria que tivesse na loja?
              </label>
              <span className="text-[11px] text-[#8E8E8E] tabular-nums">
                {suggestion.length}/{MAX_SUGGESTION_LENGTH}
              </span>
            </div>
            <textarea
              id="product-suggestion-input"
              rows={3}
              maxLength={MAX_SUGGESTION_LENGTH}
              value={suggestion}
              onChange={(e) => {
                setSuggestion(e.target.value);
                if (error) setError('');
                if (submittedSuccess) setSubmittedSuccess(false);
              }}
              placeholder="Ex: Essência Ziggy Banana Tropical, Copão Gin Intencion Melancia, Carvão Coco King..."
              className="w-full p-3.5 rounded-xl bg-black border border-white/15 text-sm text-white placeholder-[#737373] focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus:border-white resize-y min-h-[96px]"
            />
          </div>

          {error && (
            <div
              role="alert"
              className="p-3 rounded-xl bg-red-950/60 border border-red-500/40 text-xs sm:text-sm text-red-200"
            >
              {error}
            </div>
          )}

          {submittedSuccess && (
            <div
              role="status"
              className="p-3 rounded-xl bg-emerald-950/50 border border-emerald-500/35 text-xs sm:text-sm text-emerald-200 flex items-center gap-2"
            >
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
              <span>Sugestão enviada com sucesso! Obrigado por ajudar a montar o catálogo da R&amp;P.</span>
            </div>
          )}

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <span className="text-[11px] text-[#737373]">
              Sua resposta vai direto para a nossa central administrativa.
            </span>
            <button
              type="submit"
              disabled={submitting || suggestion.trim().length < 3}
              className="inline-flex items-center justify-center gap-2 h-11 px-6 rounded-xl bg-white text-black text-xs sm:text-sm font-extrabold hover:bg-neutral-200 active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <Send className="w-4 h-4" />
              <span>{submitting ? 'Enviando...' : 'Enviar sugestão'}</span>
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
