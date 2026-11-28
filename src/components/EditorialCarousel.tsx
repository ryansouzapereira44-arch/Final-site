import { useEffect, useState } from 'react';
import { ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react';
import type { CarouselSlide } from '../types';

interface EditorialCarouselProps {
  slides: CarouselSlide[];
  onSelectCategory: (category: string) => void;
}

export function EditorialCarousel({ slides, onSelectCategory }: EditorialCarouselProps) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  const safeSlides = slides.length > 0 ? slides : [];

  useEffect(() => {
    if (index >= safeSlides.length) {
      setIndex(0);
    }
  }, [index, safeSlides.length]);

  useEffect(() => {
    if (safeSlides.length <= 1 || paused) return;
    const timer = window.setInterval(() => {
      setIndex((prev) => (prev + 1) % safeSlides.length);
    }, 6000);
    return () => window.clearInterval(timer);
  }, [safeSlides.length, paused]);

  if (safeSlides.length === 0) return null;

  const current = safeSlides[index] || safeSlides[0];

  function prevSlide() {
    setIndex((prev) => (prev - 1 + safeSlides.length) % safeSlides.length);
  }

  function nextSlide() {
    setIndex((prev) => (prev + 1) % safeSlides.length);
  }

  return (
    <section
      aria-label="Destaques R&P Tabacaria"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className="relative overflow-hidden rounded-3xl border border-white/15 bg-[#0A0A0A] px-6 py-10 sm:px-12 sm:py-14"
    >
      {current.imageUrl && (
        <>
          <img
            src={current.imageUrl}
            alt={current.title}
            referrerPolicy="no-referrer"
            className="absolute inset-0 w-full h-full object-cover opacity-35"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-black via-black/80 to-black/40" />
        </>
      )}

      <div className="relative z-10 max-w-3xl">
        {current.tag && (
          <p className="text-xs font-semibold tracking-[0.18em] text-[#9E9E9E] mb-3">{current.tag}</p>
        )}
        <h1 className="text-2xl sm:text-4xl lg:text-5xl font-extrabold text-white leading-tight tracking-tight [text-wrap:balance]">
          {current.title}
        </h1>
        {current.subtitle && (
          <p className="mt-4 text-sm sm:text-base text-[#9E9E9E] max-w-2xl leading-relaxed">
            {current.subtitle}
          </p>
        )}

        <div className="mt-7 flex flex-wrap items-center gap-4">
          {current.linkUrl && current.linkUrl.trim() ? (
            <a
              href={current.linkUrl.trim()}
              target={/^https?:\/\//i.test(current.linkUrl.trim()) ? '_blank' : undefined}
              rel={/^https?:\/\//i.test(current.linkUrl.trim()) ? 'noopener noreferrer' : undefined}
              className="inline-flex items-center gap-2 h-11 px-6 rounded-xl bg-white text-black font-bold text-sm hover:bg-neutral-200 transition-colors whitespace-nowrap"
            >
              <span>{current.ctaText || 'Ver destaque'}</span>
              <ArrowRight className="w-4 h-4" />
            </a>
          ) : (
            <button
              type="button"
              onClick={() => onSelectCategory(current.targetCategory || 'Todos')}
              className="inline-flex items-center gap-2 h-11 px-6 rounded-xl bg-white text-black font-bold text-sm hover:bg-neutral-200 transition-colors whitespace-nowrap"
            >
              <span>{current.ctaText || 'Ver catálogo'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {safeSlides.length > 1 && (
        <div className="relative z-10 mt-8 pt-6 border-t border-white/10 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            {safeSlides.map((slide, i) => (
              <button
                key={slide.id}
                type="button"
                aria-label={`Ir para slide ${i + 1}`}
                onClick={() => setIndex(i)}
                className={`h-2 rounded-full transition-all ${
                  i === index ? 'w-7 bg-white' : 'w-2 bg-white/30 hover:bg-white/60'
                }`}
              />
            ))}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={prevSlide}
              aria-label="Slide anterior"
              className="h-9 w-9 flex items-center justify-center rounded-xl border border-white/15 text-white hover:bg-white hover:text-black transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={nextSlide}
              aria-label="Próximo slide"
              className="h-9 w-9 flex items-center justify-center rounded-xl border border-white/15 text-white hover:bg-white hover:text-black transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
