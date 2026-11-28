import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Check, ExternalLink, Plus, RotateCcw, Send, Star, X } from 'lucide-react';
import { api } from '../lib/api';
import { formatBRL } from '../lib/format';
import type { Product, RzinChatMessage, RzinRecommendation } from '../types';
import { SafeProductImage } from './BrandMark';

const RZIN_MASCOT_IMAGE = '/assets/aistudio/IMG_3605_dc04d8e0.jpeg';

const INITIAL_MESSAGE: RzinChatMessage = {
  id: 'rzin-welcome',
  role: 'model',
  text: 'Salve! Eu sou o RZIN, seu parceiro na escolha de essências! 🦝 Me conta: quais sabores você curte?',
};

const QUICK_STARTERS = [
  'Curto sabores doces e frutados',
  'Prefiro sabores bem gelados (Ice/Mint)',
  'Quero algo cítrico e refrescante',
  'Parecido com morango e uva, mas sem mentol',
];

function RzinAvatar({ size = 40 }: { size?: number }) {
  const [errored, setErrored] = useState(false);

  if (errored) {
    return (
      <div
        style={{ width: size, height: size }}
        className="rounded-full border border-white/25 bg-[#141414] flex items-center justify-center text-white font-extrabold text-xs shrink-0"
      >
        RZIN
      </div>
    );
  }

  return (
    <img
      src={RZIN_MASCOT_IMAGE}
      alt="RZIN — Mascote R&P Tabacaria"
      width={size}
      height={size}
      referrerPolicy="no-referrer"
      onError={() => setErrored(true)}
      style={{ width: size, height: size }}
      className="rounded-full object-cover object-top border border-white/25 bg-black shrink-0"
    />
  );
}

interface RzinAssistantProps {
  token: string | null;
  products: Product[];
  isOpen: boolean;
  hideFloatingTrigger?: boolean;
  onOpen: () => void;
  onClose: () => void;
  onAddToCart: (product: Product, variation: string) => void;
}

export function RzinAssistant({
  token,
  products,
  isOpen,
  hideFloatingTrigger = false,
  onOpen,
  onClose,
  onAddToCart,
}: RzinAssistantProps) {
  const [messages, setMessages] = useState<RzinChatMessage[]>([INITIAL_MESSAGE]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [addedKey, setAddedKey] = useState<string | null>(null);

  const scrollEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      scrollEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      window.setTimeout(() => inputRef.current?.focus(), 120);
    }
  }, [isOpen, messages.length, loading]);

  async function sendMessage(rawText: string) {
    const trimmed = rawText.trim();
    if (!trimmed || loading) return;

    const userMsg: RzinChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      text: trimmed,
    };

    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput('');
    setError('');
    setLoading(true);

    try {
      // Send conversation history excluding the static welcome prompt or keeping it as model turn
      const payloadMessages = nextMessages.map((m) => ({
        role: m.role,
        text: m.text,
      }));
      const res = await api.chatWithRzin(token, payloadMessages);
      const replyMsg: RzinChatMessage = {
        id: `rzin-${Date.now()}`,
        role: 'model',
        text: res.reply,
        recommendations: res.recommendations,
      };
      setMessages((prev) => [...prev, replyMsg]);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Não consegui falar com o RZIN agora. Tente novamente em instantes.'
      );
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    void sendMessage(input);
  }

  function handleReset() {
    setMessages([INITIAL_MESSAGE]);
    setError('');
    setInput('');
  }

  function handleAddRecommended(rec: RzinRecommendation) {
    const realProduct = products.find((p) => p.id === rec.productId);
    if (!realProduct) return;
    onAddToCart(realProduct, rec.variation);
    const key = `${rec.productId}-${rec.variation}`;
    setAddedKey(key);
    window.setTimeout(() => {
      setAddedKey((prev) => (prev === key ? null : prev));
    }, 1500);
  }

  const hasUserMessages = messages.some((m) => m.role === 'user');

  return (
    <>
      {/* Compact floating trigger when chat is closed */}
      {!isOpen && !hideFloatingTrigger && (
        <button
          type="button"
          onClick={onOpen}
          aria-label="Abrir consultor de essências RZIN"
          className="fixed bottom-5 right-4 sm:right-6 z-40 h-12 pl-2 pr-4 rounded-full bg-white text-black shadow-2xl border border-black/15 flex items-center gap-2.5 hover:bg-neutral-200 active:scale-[0.98] transition-all duration-150"
        >
          <RzinAvatar size={34} />
          <span className="text-xs sm:text-sm font-extrabold tracking-tight whitespace-nowrap">
            Falar com RZIN
          </span>
        </button>
      )}

      {/* Slide-over RZIN Consultant Drawer */}
      {isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="RZIN — Consultor de Essências R&P Tabacaria"
          className="fixed inset-0 z-50 flex justify-end bg-black/75 backdrop-blur-sm"
        >
          {/* Backdrop click to close */}
          <div className="flex-1 hidden sm:block" onClick={onClose} />

          <section className="w-full sm:max-w-[460px] h-full bg-[#090909] border-l border-white/12 flex flex-col shadow-2xl">
            {/* Drawer Header */}
            <header className="px-4 sm:px-5 py-3.5 border-b border-white/10 bg-black flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <RzinAvatar size={44} />
                <div className="min-w-0">
                  <h2 className="text-sm sm:text-base font-extrabold text-white tracking-tight truncate">
                    RZIN · Consultor de Essências
                  </h2>
                  <p className="text-[11px] text-[#9E9E9E] truncate">
                    R&amp;P Tabacaria · Catálogo real (+18)
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={handleReset}
                  title="Nova conversa"
                  aria-label="Reiniciar conversa com RZIN"
                  className="h-9 px-2.5 rounded-xl border border-white/15 text-xs font-semibold text-[#BDBDBD] hover:text-white hover:border-white/35 transition-colors inline-flex items-center gap-1.5 whitespace-nowrap"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Nova</span>
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Fechar chat do RZIN"
                  className="h-9 w-9 rounded-xl border border-white/15 text-[#BDBDBD] hover:text-white hover:border-white/35 transition-colors flex items-center justify-center"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </header>

            {/* Messages Thread */}
            <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-4 space-y-4">
              {messages.map((msg) => {
                const isUser = msg.role === 'user';
                return (
                  <div
                    key={msg.id}
                    className={`flex gap-2.5 ${isUser ? 'justify-end' : 'justify-start items-start'}`}
                  >
                    {!isUser && <RzinAvatar size={30} />}

                    <div className={`max-w-[85%] space-y-2.5 ${isUser ? 'items-end' : 'items-start'}`}>
                      <div
                        className={`rounded-2xl px-4 py-3 text-xs sm:text-sm leading-relaxed whitespace-pre-line ${
                          isUser
                            ? 'bg-white text-black font-semibold rounded-tr-sm'
                            : 'bg-[#141414] border border-white/12 text-[#F2F2F2] rounded-tl-sm'
                        }`}
                      >
                        {msg.text}
                      </div>

                      {/* Real catalog product recommendations */}
                      {!isUser && msg.recommendations && msg.recommendations.length > 0 && (
                        <div className="space-y-2.5 pt-0.5">
                          {msg.recommendations.map((rec) => {
                            const key = `${rec.productId}-${rec.variation}`;
                            const isAdded = addedKey === key;
                            const realExists = products.some((p) => p.id === rec.productId);

                            return (
                              <article
                                key={key}
                                className="rounded-2xl border border-white/15 bg-[#0F0F0F] overflow-hidden"
                              >
                                <div className="flex gap-3 p-3">
                                  <div className="w-20 h-20 rounded-xl overflow-hidden bg-[#181818] shrink-0">
                                    <SafeProductImage
                                      src={rec.imageUrl}
                                      alt={`${rec.name} - ${rec.variation}`}
                                      className="w-full h-full object-cover"
                                    />
                                  </div>

                                  <div className="flex-1 min-w-0">
                                    <p className="text-[11px] text-[#9E9E9E] truncate">
                                      {rec.brandOrLine} · {rec.available ? 'Disponível' : 'Indisponível'}
                                    </p>
                                    <h3 className="text-sm font-extrabold text-white leading-snug mt-0.5">
                                      {rec.name}
                                    </h3>
                                    <p className="text-xs font-bold text-[#E5E5E5] mt-0.5">
                                      Sabor: {rec.variation}
                                    </p>
                                    <p className="text-xs text-[#9E9E9E] mt-1 leading-snug">
                                      {rec.flavorDescription}
                                    </p>
                                  </div>
                                </div>

                                <div className="px-3 pb-3 pt-2 border-t border-white/10 space-y-2.5">
                                  <p className="text-xs text-[#D4D4D4] leading-snug">
                                    <strong className="text-white">Por que combina:</strong> {rec.matchReason}
                                  </p>

                                  <div className="flex items-center justify-between gap-3">
                                    <span className="text-sm font-extrabold text-white tabular-nums">
                                      {formatBRL(rec.price)}
                                    </span>

                                    {realExists && rec.available && (
                                      <button
                                        type="button"
                                        onClick={() => handleAddRecommended(rec)}
                                        className={`h-9 px-3.5 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
                                          isAdded
                                            ? 'bg-emerald-500 text-black'
                                            : 'bg-white text-black hover:bg-neutral-200'
                                        }`}
                                      >
                                        {isAdded ? (
                                          <>
                                            <Check className="w-3.5 h-3.5" />
                                            Adicionado
                                          </>
                                        ) : (
                                          <>
                                            <Plus className="w-3.5 h-3.5" />
                                            Adicionar ao carrinho
                                          </>
                                        )}
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </article>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Quick starters at beginning of chat */}
              {!hasUserMessages && !loading && (
                <div className="pl-10 space-y-2 pt-1">
                  <p className="text-[11px] font-medium text-[#9E9E9E]">Sugestões para começar:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {QUICK_STARTERS.map((starter) => (
                      <button
                        key={starter}
                        type="button"
                        onClick={() => void sendMessage(starter)}
                        className="text-left px-3 py-2 rounded-xl border border-white/15 bg-[#121212] text-xs font-medium text-[#E5E5E5] hover:bg-white hover:text-black hover:border-white transition-colors"
                      >
                        {starter}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {loading && (
                <div className="flex items-center gap-2.5">
                  <RzinAvatar size={30} />
                  <div className="rounded-2xl rounded-tl-sm px-4 py-2.5 bg-[#141414] border border-white/12 text-xs text-[#9E9E9E]">
                    RZIN está conferindo o catálogo...
                  </div>
                </div>
              )}

              {error && (
                <div
                  role="alert"
                  className="p-3 rounded-xl bg-red-950/60 border border-red-500/40 text-xs text-red-200"
                >
                  {error}
                </div>
              )}

              <div ref={scrollEndRef} />
            </div>

            {/* Input Footer */}
            <footer className="p-3.5 sm:p-4 border-t border-white/10 bg-black space-y-2 shrink-0">
              <form onSubmit={handleSubmit} className="flex items-center gap-2">
                <input
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  disabled={loading}
                  placeholder="Conta os sabores que você curte..."
                  className="flex-1 h-11 px-4 rounded-xl bg-[#111111] border border-white/15 text-sm text-white placeholder-[#7A7A7A] focus:outline-none focus:border-white disabled:opacity-50"
                />
                <button
                  type="submit"
                  disabled={loading || !input.trim()}
                  aria-label="Enviar mensagem para o RZIN"
                  className="h-11 px-4 rounded-xl bg-white text-black font-bold text-xs sm:text-sm inline-flex items-center justify-center gap-1.5 hover:bg-neutral-200 transition-colors disabled:opacity-40 shrink-0"
                >
                  <Send className="w-4 h-4" />
                  <span className="hidden sm:inline">Enviar</span>
                </button>
              </form>
              <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                <p className="text-[11px] text-[#7A7A7A]">
                  Exclusivo para adultos (+18) · Estoque real
                </p>
                <a
                  href="https://share.google/Wvlt5sHGVC4AsvTdz"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/20 bg-[#121212] text-[11px] font-bold text-white hover:bg-white hover:text-black transition-colors shrink-0"
                >
                  <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
                  <span>Avaliar no Google</span>
                  <ExternalLink className="w-3 h-3 opacity-70" />
                </a>
              </div>
            </footer>
          </section>
        </div>
      )}
    </>
  );
}
