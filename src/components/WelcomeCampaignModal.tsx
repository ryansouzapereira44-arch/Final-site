import { useEffect, useState } from 'react';
import { ArrowRight, Check, Copy, Gift, X } from 'lucide-react';

const PROMO_COUPON_CODE = 'PRIMEIRACOMPRA';
const PROMO_BANNER_IMAGE = '/src/assets/images/welcome_promo_banner_1795824095352.jpg';

interface WelcomeCampaignModalProps {
  isOpen: boolean;
  customerName?: string;
  onClose: () => void;
  onStartShopping: () => void;
}

export function WelcomeCampaignModal({
  isOpen,
  customerName,
  onClose,
  onStartShopping,
}: WelcomeCampaignModalProps) {
  const [copied, setCopied] = useState(false);
  const [imageError, setImageError] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setCopied(false);

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  async function handleCopyCoupon() {
    let success = false;
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(PROMO_COUPON_CODE);
        success = true;
      } catch {
        success = false;
      }
    }

    if (!success && typeof document !== 'undefined') {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = PROMO_COUPON_CODE;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        success = document.execCommand('copy');
        document.body.removeChild(textarea);
      } catch {
        success = false;
      }
    }

    if (success) {
      setCopied(true);
      window.setTimeout(() => {
        setCopied(false);
      }, 2500);
    }
  }

  const firstName = customerName?.trim().split(/\s+/)[0];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-campaign-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-sm overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-[540px] rounded-3xl border border-white/15 bg-[#0C0C0C] text-white shadow-2xl overflow-hidden my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar pop-up de boas-vindas"
          className="absolute top-3 right-3 z-10 w-10 h-10 rounded-full bg-black/75 border border-white/25 text-white hover:bg-white hover:text-black transition-colors flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Promotional Visual */}
        <div className="relative aspect-[16/9] w-full bg-[#141414] overflow-hidden">
          {!imageError ? (
            <img
              src={PROMO_BANNER_IMAGE}
              alt="Campanha de boas-vindas R&P Tabacaria — Cupom PRIMEIRACOMPRA"
              referrerPolicy="no-referrer"
              onError={() => setImageError(true)}
              className="w-full h-full object-cover object-center"
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-[#191919] via-[#0C0C0C] to-black flex flex-col items-center justify-center gap-2 p-6 text-center">
              <Gift className="w-9 h-9 text-white/80" />
              <span className="text-sm font-extrabold tracking-widest text-white">
                R&amp;P TABACARIA
              </span>
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-[#0C0C0C] via-black/25 to-transparent pointer-events-none" />
        </div>

        {/* Campaign Copy & Actions */}
        <div className="px-5 pb-6 pt-2 sm:px-7 sm:pb-7 sm:pt-3 space-y-5">
          <div className="space-y-2">
            <p className="text-xs font-semibold text-[#BDBDBD]">
              {firstName ? `Bem-vindo, ${firstName}` : 'Boas-vindas'} · Oferta de primeira compra
            </p>
            <h2
              id="welcome-campaign-title"
              className="text-xl sm:text-2xl font-extrabold text-white tracking-tight leading-snug text-balance"
            >
              Sua primeira compra merece um presente!
            </h2>
            <p className="text-xs sm:text-sm text-[#A8A8A8] leading-relaxed">
              Use nosso cupom exclusivo e aproveite uma condição especial na sua primeira compra.
            </p>
          </div>

          {/* Highlighted Coupon Block */}
          <div className="rounded-2xl border border-dashed border-white/30 bg-black p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-medium text-[#9E9E9E]">
                Cupom exclusivo para copiar
              </p>
              <p className="font-mono text-lg sm:text-xl font-extrabold tracking-[0.14em] text-white mt-0.5 select-all truncate">
                {PROMO_COUPON_CODE}
              </p>
            </div>

            <button
              type="button"
              onClick={() => void handleCopyCoupon()}
              className={`h-10 px-4 rounded-xl text-xs font-bold inline-flex items-center justify-center gap-2 whitespace-nowrap shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${
                copied
                  ? 'bg-emerald-500 text-black'
                  : 'bg-[#181818] border border-white/25 text-white hover:bg-white hover:text-black'
              }`}
            >
              {copied ? (
                <>
                  <Check className="w-4 h-4" />
                  <span>Cupom copiado!</span>
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" />
                  <span>Copiar cupom</span>
                </>
              )}
            </button>
          </div>

          {/* Primary CTA */}
          <button
            type="button"
            onClick={onStartShopping}
            className="w-full h-12 px-5 rounded-xl bg-white text-black font-extrabold text-sm tracking-wide inline-flex items-center justify-center gap-2 hover:bg-neutral-200 active:scale-[0.99] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white whitespace-nowrap"
          >
            <span>COMEÇAR A COMPRAR</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
