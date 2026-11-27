import { useMemo, useState } from 'react';
import { Check, Plus, Search } from 'lucide-react';
import { formatBRL } from '../lib/format';
import type { Product } from '../types';
import { SafeProductImage } from './BrandMark';

interface CatalogSectionProps {
  products: Product[];
  categories: string[];
  selectedCategory: string;
  onSelectCategory: (category: string) => void;
  onAddToCart: (product: Product, variation: string) => void;
}

export function CatalogSection({
  products,
  categories,
  selectedCategory,
  onSelectCategory,
  onAddToCart,
}: CatalogSectionProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedVariations, setSelectedVariations] = useState<Record<number, string>>({});
  const [addedProductId, setAddedProductId] = useState<number | null>(null);

  const filteredProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return products.filter((p) => {
      const matchesCat = selectedCategory === 'Todos' || p.category === selectedCategory;
      const matchesQuery =
        !q ||
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q) ||
        p.variations.some((v) => v.toLowerCase().includes(q));
      return matchesCat && matchesQuery;
    });
  }, [products, selectedCategory, searchQuery]);

  function getActiveVariation(product: Product): string {
    if (selectedVariations[product.id]) return selectedVariations[product.id];
    return product.variations[0] || 'Padrão';
  }

  function handleAdd(product: Product) {
    const variation = getActiveVariation(product);
    onAddToCart(product, variation);
    setAddedProductId(product.id);
    window.setTimeout(() => {
      setAddedProductId((current) => (current === product.id ? null : current));
    }, 1200);
  }

  return (
    <section id="catalogo-section" className="space-y-4 sm:space-y-5">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-3 sm:gap-4">
        <div>
          <h2 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight">Catálogo de Produtos</h2>
          <p className="text-xs sm:text-sm text-[#9E9E9E] mt-0.5">
            Escolha o sabor ou variação desejada e adicione ao carrinho.
          </p>
        </div>

        <div className="relative w-full md:w-72">
          <Search className="w-4 h-4 text-[#9E9E9E] absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar produto ou sabor..."
            className="w-full h-10 pl-10 pr-4 rounded-xl bg-[#0D0D0D] border border-white/15 text-xs sm:text-sm text-white placeholder-[#9E9E9E] focus:outline-none focus:border-white transition-colors"
          />
        </div>
      </div>

      {/* Category Filter Tabs */}
      <div className="flex items-center gap-1.5 sm:gap-2 overflow-x-auto pb-1">
        {categories.map((category) => {
          const isActive = selectedCategory === category;
          return (
            <button
              key={category}
              type="button"
              onClick={() => onSelectCategory(category)}
              className={`px-3 sm:px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 border ${
                isActive
                  ? 'bg-white text-black border-white'
                  : 'bg-[#0D0D0D] text-[#9E9E9E] border-white/10 hover:text-white hover:border-white/30'
              }`}
            >
              {category}
            </button>
          );
        })}
      </div>

      {/* Product Grid */}
      {filteredProducts.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-[#0A0A0A] p-10 text-center">
          <p className="text-sm sm:text-base font-semibold text-white">Nenhum produto encontrado</p>
          <p className="text-xs sm:text-sm text-[#9E9E9E] mt-1">Tente limpar a busca ou selecionar outra categoria.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5 sm:gap-3.5 lg:gap-4 items-stretch">
          {filteredProducts.map((product) => {
            const activeVariation = getActiveVariation(product);
            const isAdded = addedProductId === product.id;

            return (
              <article
                key={product.id}
                className="group flex flex-col h-full rounded-xl sm:rounded-2xl border border-white/12 bg-[#0C0C0C] overflow-hidden hover:border-white/30 transition-all duration-200 hover:-translate-y-0.5"
              >
                <div className="aspect-[4/3] w-full bg-[#141414] overflow-hidden shrink-0">
                  <SafeProductImage
                    src={product.imageUrl}
                    alt={product.name}
                    className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                  />
                </div>

                <div className="p-2.5 sm:p-3.5 flex flex-col flex-1 gap-1.5 sm:gap-2">
                  <div>
                    <p className="text-[10px] sm:text-[11px] font-medium uppercase tracking-wider text-[#8E8E8E] truncate">
                      {product.category}
                    </p>
                    <h3 className="text-[13px] sm:text-sm font-bold text-white mt-0.5 leading-snug line-clamp-2">
                      {product.name}
                    </h3>
                  </div>

                  {product.description && (
                    <p className="text-[11px] sm:text-xs text-[#9E9E9E] leading-snug line-clamp-2">
                      {product.description}
                    </p>
                  )}

                  {product.variations.length > 0 && (
                    <div className="pt-0.5">
                      <p className="text-[10px] sm:text-[11px] font-medium text-[#BDBDBD] mb-1 truncate">
                        Sabor / Variação
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {product.variations.map((variation) => {
                          const selected = activeVariation === variation;
                          return (
                            <button
                              key={variation}
                              type="button"
                              onClick={() =>
                                setSelectedVariations((prev) => ({ ...prev, [product.id]: variation }))
                              }
                              title={variation}
                              className={`px-1.5 sm:px-2 py-0.5 rounded-md text-[10px] sm:text-[11px] leading-tight transition-colors border max-w-full truncate ${
                                selected
                                  ? 'bg-white text-black border-white font-semibold'
                                  : 'bg-black text-[#A3A3A3] border-white/15 hover:text-white hover:border-white/30'
                              }`}
                            >
                              {variation}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div className="mt-auto pt-2 border-t border-white/10 flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                    <span className="text-sm sm:text-[15px] font-extrabold text-white tabular-nums whitespace-nowrap">
                      {formatBRL(product.price)}
                    </span>

                    <button
                      type="button"
                      onClick={() => handleAdd(product)}
                      className={`h-8 md:h-9 px-2.5 md:px-3 rounded-lg text-[11px] sm:text-xs font-bold inline-flex items-center justify-center gap-1 transition-all whitespace-nowrap shrink-0 w-full md:w-auto ${
                        isAdded
                          ? 'bg-emerald-500 text-black'
                          : 'bg-white text-black hover:bg-neutral-200 active:scale-[0.98]'
                      }`}
                    >
                      {isAdded ? (
                        <>
                          <Check className="w-3.5 h-3.5 shrink-0" />
                          Adicionado
                        </>
                      ) : (
                        <>
                          <Plus className="w-3.5 h-3.5 shrink-0" />
                          Adicionar
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
