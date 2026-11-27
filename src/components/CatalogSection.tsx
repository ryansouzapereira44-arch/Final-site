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
    <section id="catalogo-section" className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">Catálogo de Produtos</h2>
          <p className="text-sm text-[#9E9E9E] mt-1">
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
            className="w-full h-11 pl-10 pr-4 rounded-xl bg-[#0D0D0D] border border-white/15 text-sm text-white placeholder-[#9E9E9E] focus:outline-none focus:border-white transition-colors"
          />
        </div>
      </div>

      {/* Category Filter Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {categories.map((category) => {
          const isActive = selectedCategory === category;
          return (
            <button
              key={category}
              type="button"
              onClick={() => onSelectCategory(category)}
              className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap shrink-0 border ${
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
        <div className="rounded-3xl border border-white/10 bg-[#0A0A0A] p-12 text-center">
          <p className="text-base font-semibold text-white">Nenhum produto encontrado</p>
          <p className="text-sm text-[#9E9E9E] mt-1">Tente limpar a busca ou selecionar outra categoria.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredProducts.map((product) => {
            const activeVariation = getActiveVariation(product);
            const isAdded = addedProductId === product.id;

            return (
              <article
                key={product.id}
                className="flex flex-col rounded-2xl border border-white/12 bg-[#0C0C0C] overflow-hidden hover:border-white/30 transition-colors"
              >
                <div className="aspect-[4/3] w-full bg-[#141414] overflow-hidden">
                  <SafeProductImage
                    src={product.imageUrl}
                    alt={product.name}
                    className="w-full h-full object-cover"
                  />
                </div>

                <div className="p-5 flex flex-col flex-1">
                  <p className="text-xs font-medium text-[#9E9E9E]">{product.category}</p>
                  <h3 className="text-base sm:text-lg font-bold text-white mt-1 leading-snug">{product.name}</h3>
                  {product.description && (
                    <p className="text-xs sm:text-sm text-[#9E9E9E] mt-2 line-clamp-2 leading-relaxed">
                      {product.description}
                    </p>
                  )}

                  {product.variations.length > 0 && (
                    <div className="mt-4">
                      <p className="text-xs font-semibold text-[#E5E5E5] mb-2">Sabor / Variação:</p>
                      <div className="flex flex-wrap gap-1.5">
                        {product.variations.map((variation) => {
                          const selected = activeVariation === variation;
                          return (
                            <button
                              key={variation}
                              type="button"
                              onClick={() =>
                                setSelectedVariations((prev) => ({ ...prev, [product.id]: variation }))
                              }
                              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                                selected
                                  ? 'bg-white text-black border-white font-semibold'
                                  : 'bg-black text-[#9E9E9E] border-white/15 hover:text-white'
                              }`}
                            >
                              {variation}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div className="mt-auto pt-5 flex items-center justify-between gap-3 border-t border-white/10">
                    <div>
                      <span className="text-lg font-extrabold text-white tabular-nums">
                        {formatBRL(product.price)}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleAdd(product)}
                      className={`h-11 px-4 rounded-xl text-xs sm:text-sm font-bold inline-flex items-center gap-1.5 transition-all whitespace-nowrap shrink-0 ${
                        isAdded
                          ? 'bg-emerald-500 text-black'
                          : 'bg-white text-black hover:bg-neutral-200 active:scale-[0.98]'
                      }`}
                    >
                      {isAdded ? (
                        <>
                          <Check className="w-4 h-4" />
                          Adicionado
                        </>
                      ) : (
                        <>
                          <Plus className="w-4 h-4" />
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
