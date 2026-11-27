import { useState, type FormEvent } from 'react';
import { Eye, EyeOff, Lock, LogIn, UserPlus } from 'lucide-react';
import { api } from '../lib/api';
import { formatWhatsappInput } from '../lib/format';
import type { User } from '../types';
import { BrandLogoSVG } from './BrandMark';

interface AuthGateProps {
  adminClaimed: boolean;
  adminEmail: string;
  onAuthenticated: (user: User, token: string) => void;
}

export function AuthGate({ adminClaimed, adminEmail, onAuthenticated }: AuthGateProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (mode === 'login') {
        const res = await api.login({ email, password });
        onAuthenticated(res.user, res.token);
      } else {
        const res = await api.register({ name, email, whatsapp, password });
        onAuthenticated(res.user, res.token);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível autenticar.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-black text-white flex flex-col lg:flex-row">
      {/* Left Brand Typography Showcase (Sem foto, apenas logo e frases) */}
      <div className="lg:w-1/2 bg-[#080808] border-b lg:border-b-0 lg:border-r border-white/10 p-6 sm:p-10 lg:p-14 flex flex-col justify-between">
        <div className="flex items-center gap-3">
          <BrandLogoSVG size={44} />
          <span className="text-lg font-extrabold tracking-wide whitespace-nowrap">R&amp;P TABACARIA</span>
        </div>

        <div className="my-8 lg:my-0 space-y-5 max-w-xl">
          <p className="text-xs font-medium tracking-[0.2em] text-[#9E9E9E]">
            QUALIDADE · VARIEDADE · SEMPRE COM VOCÊ
          </p>
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold leading-tight tracking-tight [text-wrap:balance]">
            Mais que tabacaria, é estilo de vida.
          </h1>
          <p className="text-sm sm:text-base text-[#9E9E9E] leading-relaxed">
            Entre na sua conta ou cadastre-se em segundos para acessar o catálogo completo, montar seu carrinho e
            acompanhar seus pedidos.
          </p>
        </div>

        <p className="text-xs text-[#9E9E9E]">R&amp;P Tabacaria · Catálogo e Pedidos Online</p>
      </div>

      {/* Right Auth Form */}
      <div className="lg:w-1/2 flex items-center justify-center p-6 sm:p-10 lg:p-14">
        <div className="w-full max-w-md bg-[#0E0E0E] border border-white/15 rounded-3xl p-6 sm:p-8 shadow-2xl">
          <div className="flex items-center gap-1 p-1 bg-black border border-white/10 rounded-xl mb-6">
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setError('');
              }}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-sm font-semibold transition-colors whitespace-nowrap ${
                mode === 'login' ? 'bg-white text-black' : 'text-[#9E9E9E] hover:text-white'
              }`}
            >
              <LogIn className="w-4 h-4" />
              Entrar
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('register');
                setError('');
              }}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-sm font-semibold transition-colors whitespace-nowrap ${
                mode === 'register' ? 'bg-white text-black' : 'text-[#9E9E9E] hover:text-white'
              }`}
            >
              <UserPlus className="w-4 h-4" />
              Criar Conta
            </button>
          </div>

          <div className="mb-6">
            <h2 className="text-xl font-bold text-white">
              {mode === 'login' ? 'Acesse sua conta' : 'Crie sua conta'}
            </h2>
            <p className="text-sm text-[#9E9E9E] mt-1">
              {mode === 'login'
                ? 'Use seu e-mail e senha para entrar na loja.'
                : 'Se ainda não possui conta, preencha os dados abaixo.'}
            </p>
          </div>

          {!adminClaimed && mode === 'register' && (
            <div className="mb-5 p-3.5 rounded-2xl bg-white/5 border border-white/15 text-xs text-[#E5E5E5] leading-relaxed">
              <div className="flex items-center gap-2 font-semibold text-white mb-1">
                <Lock className="w-3.5 h-3.5" />
                Primeiro acesso administrativo
              </div>
              Para cadastrar o administrador da loja, crie a conta usando o e-mail{' '}
              <span className="font-semibold text-white">{adminEmail}</span> e defina sua senha.
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="mb-5 p-3.5 rounded-xl bg-red-950/60 border border-red-500/40 text-xs sm:text-sm text-red-200"
            >
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'register' && (
              <div>
                <label className="block text-xs font-semibold text-[#E5E5E5] mb-1.5" htmlFor="auth-name">
                  Nome completo *
                </label>
                <input
                  id="auth-name"
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Seu nome completo"
                  className="w-full h-11 px-4 rounded-xl bg-black border border-white/15 text-white placeholder-[#9E9E9E]/60 text-sm focus:outline-none focus:border-white transition-colors"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-[#E5E5E5] mb-1.5" htmlFor="auth-email">
                E-mail *
              </label>
              <input
                id="auth-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="seuemail@exemplo.com"
                className="w-full h-11 px-4 rounded-xl bg-black border border-white/15 text-white placeholder-[#9E9E9E]/60 text-sm focus:outline-none focus:border-white transition-colors"
              />
            </div>

            {mode === 'register' && (
              <div>
                <label className="block text-xs font-semibold text-[#E5E5E5] mb-1.5" htmlFor="auth-whatsapp">
                  WhatsApp com DDD
                </label>
                <input
                  id="auth-whatsapp"
                  type="tel"
                  value={whatsapp}
                  onChange={(e) => setWhatsapp(formatWhatsappInput(e.target.value))}
                  placeholder="(11) 99999-9999"
                  className="w-full h-11 px-4 rounded-xl bg-black border border-white/15 text-white placeholder-[#9E9E9E]/60 text-sm focus:outline-none focus:border-white transition-colors"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-[#E5E5E5] mb-1.5" htmlFor="auth-password">
                Senha *
              </label>
              <div className="relative">
                <input
                  id="auth-password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Mínimo 6 caracteres"
                  className="w-full h-11 pl-4 pr-11 rounded-xl bg-black border border-white/15 text-white placeholder-[#9E9E9E]/60 text-sm focus:outline-none focus:border-white transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'Ocultar senha' : 'Ver senha'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#9E9E9E] hover:text-white p-1"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full h-12 mt-2 rounded-xl bg-white text-black font-bold text-sm hover:bg-neutral-200 active:scale-[0.99] transition-all disabled:opacity-50"
            >
              {loading
                ? 'Processando...'
                : mode === 'login'
                  ? 'Entrar na R&P Tabacaria'
                  : 'Cadastrar e Entrar'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
