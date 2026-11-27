import { Bike, LogOut, ShoppingBag } from 'lucide-react';
import { formatBRL } from '../lib/format';
import type { User } from '../types';
import { BrandLogoSVG } from './BrandMark';

export type AppView = 'store' | 'cart' | 'checkout' | 'orders' | 'account' | 'tracking' | 'courier' | 'admin';

interface HeaderProps {
  user: User;
  activeView: AppView;
  cartCount: number;
  cartSubtotal: number;
  rouletteAvailableCount: number;
  onNavigate: (view: AppView) => void;
  onLogout: () => void;
}

export function Header({
  user,
  activeView,
  cartCount,
  cartSubtotal,
  rouletteAvailableCount,
  onNavigate,
  onLogout,
}: HeaderProps) {
  const isCourier = user.role === 'courier';

  return (
    <header className="sticky top-0 z-30 bg-black/95 backdrop-blur-md border-b border-white/10">
      <div className="max-w-[1400px] mx-auto px-3 sm:px-6 h-16 flex items-center justify-between gap-4 sm:gap-8">
        {/* Zone 1: Single-line Brand wordmark */}
        <button
          type="button"
          onClick={() => onNavigate(isCourier ? 'courier' : 'store')}
          className="flex items-center gap-2.5 text-white whitespace-nowrap shrink-0 hover:opacity-90 transition-opacity"
        >
          <BrandLogoSVG size={34} />
          <span className="text-base sm:text-lg font-extrabold tracking-tight whitespace-nowrap shrink-0">
            R&amp;P TABACARIA
          </span>
        </button>

        {/* Zone 2: Concise single-line nav links */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium">
          {isCourier ? (
            <button
              type="button"
              onClick={() => onNavigate('courier')}
              className={`inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 pb-0.5 transition-colors ${
                activeView === 'courier'
                  ? 'text-white border-b-2 border-white font-semibold'
                  : 'text-[#9E9E9E] hover:text-white'
              }`}
            >
              <Bike className="w-4 h-4" />
              Entregas do Motoboy
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => onNavigate('store')}
                className={`whitespace-nowrap shrink-0 pb-0.5 transition-colors ${
                  activeView === 'store'
                    ? 'text-white border-b-2 border-white font-semibold'
                    : 'text-[#9E9E9E] hover:text-white'
                }`}
              >
                Catálogo
              </button>
              <button
                type="button"
                onClick={() => onNavigate('orders')}
                className={`whitespace-nowrap shrink-0 pb-0.5 transition-colors ${
                  activeView === 'orders'
                    ? 'text-white border-b-2 border-white font-semibold'
                    : 'text-[#9E9E9E] hover:text-white'
                }`}
              >
                Meus Pedidos
              </button>
              <button
                type="button"
                onClick={() => onNavigate('account')}
                className={`whitespace-nowrap shrink-0 pb-0.5 transition-colors ${
                  activeView === 'account' || activeView === 'tracking'
                    ? 'text-white border-b-2 border-white font-semibold'
                    : 'text-[#9E9E9E] hover:text-white'
                }`}
              >
                Minha Conta{rouletteAvailableCount > 0 ? ` (${rouletteAvailableCount})` : ''}
              </button>
              {user.role === 'admin' && (
                <button
                  type="button"
                  onClick={() => onNavigate('admin')}
                  className={`whitespace-nowrap shrink-0 pb-0.5 transition-colors ${
                    activeView === 'admin'
                      ? 'text-white border-b-2 border-white font-semibold'
                      : 'text-[#9E9E9E] hover:text-white'
                  }`}
                >
                  Painel Admin
                </button>
              )}
            </>
          )}
        </nav>

        {/* Zone 3: Primary action (Cart) + Sign Out */}
        <div className="flex items-center gap-2.5 shrink-0">
          {!isCourier && (
            <button
              type="button"
              onClick={() => onNavigate('cart')}
              className="flex items-center gap-2 h-10 px-4 rounded-xl bg-white text-black font-bold text-xs sm:text-sm hover:bg-neutral-200 transition-colors whitespace-nowrap shrink-0 tabular-nums"
            >
              <ShoppingBag className="w-4 h-4 shrink-0" />
              <span>Carrinho ({cartCount})</span>
              {cartSubtotal > 0 && (
                <span className="hidden sm:inline text-black/75 font-semibold">· {formatBRL(cartSubtotal)}</span>
              )}
            </button>
          )}

          <button
            type="button"
            onClick={onLogout}
            title={`Sair (${user.name})`}
            aria-label="Sair da conta"
            className="h-10 w-10 flex items-center justify-center rounded-xl border border-white/15 text-[#9E9E9E] hover:text-white hover:border-white/40 transition-colors shrink-0"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Mobile compact nav row */}
      <div className="md:hidden border-t border-white/10 px-4 py-2 flex items-center justify-center gap-4 text-xs font-semibold overflow-x-auto">
        {isCourier ? (
          <button
            type="button"
            onClick={() => onNavigate('courier')}
            className={`whitespace-nowrap py-1 ${activeView === 'courier' ? 'text-white underline underline-offset-4' : 'text-[#9E9E9E]'}`}
          >
            Entregas do Motoboy
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={() => onNavigate('store')}
              className={`whitespace-nowrap py-1 ${activeView === 'store' ? 'text-white underline underline-offset-4' : 'text-[#9E9E9E]'}`}
            >
              Catálogo
            </button>
            <button
              type="button"
              onClick={() => onNavigate('orders')}
              className={`whitespace-nowrap py-1 ${activeView === 'orders' ? 'text-white underline underline-offset-4' : 'text-[#9E9E9E]'}`}
            >
              Pedidos
            </button>
            <button
              type="button"
              onClick={() => onNavigate('account')}
              className={`whitespace-nowrap py-1 ${
                activeView === 'account' || activeView === 'tracking'
                  ? 'text-white underline underline-offset-4'
                  : 'text-[#9E9E9E]'
              }`}
            >
              Minha Conta{rouletteAvailableCount > 0 ? ` (${rouletteAvailableCount})` : ''}
            </button>
            {user.role === 'admin' && (
              <button
                type="button"
                onClick={() => onNavigate('admin')}
                className={`whitespace-nowrap py-1 ${activeView === 'admin' ? 'text-white underline underline-offset-4' : 'text-[#9E9E9E]'}`}
              >
                Admin
              </button>
            )}
          </>
        )}
      </div>
    </header>
  );
}
