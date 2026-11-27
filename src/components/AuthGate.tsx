import { useEffect, useState, type FormEvent } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  LogIn,
  Mail,
  UserPlus,
} from 'lucide-react';
import { api } from '../lib/api';
import { formatWhatsappInput } from '../lib/format';
import type { User } from '../types';
import { BrandLogoSVG } from './BrandMark';

interface AuthGateProps {
  adminClaimed: boolean;
  adminEmail: string;
  initialResetToken?: string | null;
  onResetTokenFinished?: () => void;
  onAuthenticated: (user: User, token: string) => void;
}

type AuthMode = 'login' | 'register' | 'forgot' | 'reset';

export function AuthGate({
  adminClaimed,
  adminEmail,
  initialResetToken = null,
  onResetTokenFinished,
  onAuthenticated,
}: AuthGateProps) {
  const [mode, setMode] = useState<AuthMode>(initialResetToken ? 'reset' : 'login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [resetToken, setResetToken] = useState<string>(initialResetToken || '');
  const [tokenChecking, setTokenChecking] = useState(Boolean(initialResetToken));
  const [tokenValid, setTokenValid] = useState(false);
  const [emailHint, setEmailHint] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  useEffect(() => {
    if (initialResetToken) {
      setResetToken(initialResetToken);
      setMode('reset');
    }
  }, [initialResetToken]);

  useEffect(() => {
    if (mode !== 'reset' || !resetToken) return;
    let active = true;
    setTokenChecking(true);
    setError('');
    setSuccessMessage('');

    api
      .validateResetToken(resetToken)
      .then((res) => {
        if (!active) return;
        setTokenValid(Boolean(res.valid));
        setEmailHint(res.emailHint || '');
      })
      .catch((err) => {
        if (!active) return;
        setTokenValid(false);
        setError(
          err instanceof Error
            ? err.message
            : 'Link de recuperação inválido ou expirado. Solicite um novo link.'
        );
      })
      .finally(() => {
        if (active) setTokenChecking(false);
      });

    return () => {
      active = false;
    };
  }, [mode, resetToken]);

  function returnToLogin() {
    setMode('login');
    setError('');
    setSuccessMessage('');
    setPassword('');
    setNewPassword('');
    setConfirmNewPassword('');
    setResetToken('');
    setTokenValid(false);
    onResetTokenFinished?.();
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setSuccessMessage('');
    setLoading(true);
    try {
      if (mode === 'login') {
        const res = await api.login({ email, password });
        onAuthenticated(res.user, res.token);
      } else if (mode === 'register') {
        const res = await api.register({ name, email, whatsapp, password });
        onAuthenticated(res.user, res.token);
      } else if (mode === 'forgot') {
        const res = await api.forgotPassword(email);
        setSuccessMessage(res.message);
      } else if (mode === 'reset') {
        if (newPassword.length < 6) {
          setError('A nova senha deve ter pelo menos 6 caracteres.');
          setLoading(false);
          return;
        }
        if (newPassword !== confirmNewPassword) {
          setError('As senhas digitadas não conferem.');
          setLoading(false);
          return;
        }
        const res = await api.resetPassword({
          token: resetToken,
          password: newPassword,
          confirmPassword: confirmNewPassword,
        });
        setSuccessMessage(res.message);
        setNewPassword('');
        setConfirmNewPassword('');
        setTokenValid(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível concluir a solicitação.');
    } finally {
      setLoading(false);
    }
  }

  const isRecoveryFlow = mode === 'forgot' || mode === 'reset';

  return (
    <div className="min-h-screen bg-black text-white flex flex-col lg:flex-row">
      {/* Left Brand Typography Showcase */}
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
          {!isRecoveryFlow ? (
            <div className="flex items-center gap-1 p-1 bg-black border border-white/10 rounded-xl mb-6">
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setError('');
                  setSuccessMessage('');
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
                  setSuccessMessage('');
                }}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-sm font-semibold transition-colors whitespace-nowrap ${
                  mode === 'register' ? 'bg-white text-black' : 'text-[#9E9E9E] hover:text-white'
                }`}
              >
                <UserPlus className="w-4 h-4" />
                Criar Conta
              </button>
            </div>
          ) : (
            <div className="mb-5">
              <button
                type="button"
                onClick={returnToLogin}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#9E9E9E] hover:text-white transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Voltar para o login
              </button>
            </div>
          )}

          <div className="mb-6">
            <h2 className="text-xl font-bold text-white">
              {mode === 'login'
                ? 'Acesse sua conta'
                : mode === 'register'
                  ? 'Crie sua conta'
                  : mode === 'forgot'
                    ? 'Recuperar senha'
                    : 'Cadastrar nova senha'}
            </h2>
            <p className="text-sm text-[#9E9E9E] mt-1">
              {mode === 'login'
                ? 'Use seu e-mail e senha para entrar na loja.'
                : mode === 'register'
                  ? 'Se ainda não possui conta, preencha os dados abaixo.'
                  : mode === 'forgot'
                    ? 'Informe o e-mail cadastrado para receber o link de recuperação de senha.'
                    : emailHint
                      ? `Defina uma nova senha para a conta ${emailHint}.`
                      : 'Digite e confirme sua nova senha de acesso.'}
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

          {successMessage && (
            <div className="mb-5 p-4 rounded-2xl bg-emerald-950/40 border border-emerald-500/40 text-xs sm:text-sm text-emerald-100 space-y-3">
              <div className="flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <p className="leading-relaxed">{successMessage}</p>
              </div>
              <button
                type="button"
                onClick={returnToLogin}
                className="w-full h-10 rounded-xl bg-white text-black font-bold text-xs sm:text-sm hover:bg-neutral-200 transition-colors"
              >
                Voltar à tela de login
              </button>
            </div>
          )}

          {/* FORGOT PASSWORD FORM */}
          {mode === 'forgot' && !successMessage && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#E5E5E5] mb-1.5" htmlFor="forgot-email">
                  E-mail cadastrado *
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-[#9E9E9E] absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    id="forgot-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="seuemail@exemplo.com"
                    className="w-full h-11 pl-10 pr-4 rounded-xl bg-black border border-white/15 text-white placeholder-[#9E9E9E]/60 text-sm focus:outline-none focus:border-white transition-colors"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full h-12 mt-2 rounded-xl bg-white text-black font-bold text-sm hover:bg-neutral-200 active:scale-[0.99] transition-all disabled:opacity-50"
              >
                {loading ? 'Enviando link...' : 'Enviar link de recuperação'}
              </button>
            </form>
          )}

          {/* RESET PASSWORD FLOW */}
          {mode === 'reset' && !successMessage && (
            <>
              {tokenChecking ? (
                <div className="py-8 text-center text-sm text-[#9E9E9E]">
                  Validando link de recuperação...
                </div>
              ) : !tokenValid ? (
                <div className="space-y-3 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setMode('forgot');
                      setError('');
                      setSuccessMessage('');
                    }}
                    className="w-full h-11 rounded-xl bg-white text-black font-bold text-sm hover:bg-neutral-200 transition-colors"
                  >
                    Solicitar novo link de recuperação
                  </button>
                  <button
                    type="button"
                    onClick={returnToLogin}
                    className="w-full h-11 rounded-xl border border-white/15 text-sm font-semibold text-white hover:bg-white/10 transition-colors"
                  >
                    Ir para o login
                  </button>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label
                      className="block text-xs font-semibold text-[#E5E5E5] mb-1.5"
                      htmlFor="reset-new-password"
                    >
                      Nova senha *
                    </label>
                    <div className="relative">
                      <KeyRound className="w-4 h-4 text-[#9E9E9E] absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        id="reset-new-password"
                        type={showNewPassword ? 'text' : 'password'}
                        required
                        minLength={6}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="Mínimo 6 caracteres"
                        className="w-full h-11 pl-10 pr-11 rounded-xl bg-black border border-white/15 text-white placeholder-[#9E9E9E]/60 text-sm focus:outline-none focus:border-white transition-colors"
                      />
                      <button
                        type="button"
                        onClick={() => setShowNewPassword((prev) => !prev)}
                        aria-label={showNewPassword ? 'Ocultar nova senha' : 'Ver nova senha'}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-[#9E9E9E] hover:text-white p-1"
                      >
                        {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label
                      className="block text-xs font-semibold text-[#E5E5E5] mb-1.5"
                      htmlFor="reset-confirm-password"
                    >
                      Confirmar nova senha *
                    </label>
                    <div className="relative">
                      <KeyRound className="w-4 h-4 text-[#9E9E9E] absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        id="reset-confirm-password"
                        type={showConfirmPassword ? 'text' : 'password'}
                        required
                        minLength={6}
                        value={confirmNewPassword}
                        onChange={(e) => setConfirmNewPassword(e.target.value)}
                        placeholder="Repita a nova senha"
                        className="w-full h-11 pl-10 pr-11 rounded-xl bg-black border border-white/15 text-white placeholder-[#9E9E9E]/60 text-sm focus:outline-none focus:border-white transition-colors"
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmPassword((prev) => !prev)}
                        aria-label={showConfirmPassword ? 'Ocultar confirmação' : 'Ver confirmação'}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-[#9E9E9E] hover:text-white p-1"
                      >
                        {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full h-12 mt-2 rounded-xl bg-white text-black font-bold text-sm hover:bg-neutral-200 active:scale-[0.99] transition-all disabled:opacity-50"
                  >
                    {loading ? 'Salvando nova senha...' : 'Salvar nova senha'}
                  </button>
                </form>
              )}
            </>
          )}

          {/* LOGIN / REGISTER FORM */}
          {!isRecoveryFlow && (
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

                {mode === 'login' && (
                  <div className="flex justify-end mt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setMode('forgot');
                        setError('');
                        setSuccessMessage('');
                      }}
                      className="text-xs font-semibold text-[#9E9E9E] hover:text-white underline underline-offset-4 transition-colors"
                    >
                      Esqueci minha senha
                    </button>
                  </div>
                )}
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
          )}
        </div>
      </div>
    </div>
  );
}
