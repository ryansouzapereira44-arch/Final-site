import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { getUserById, hasAdminUser } from './db.ts';
import type { User } from '../src/types.ts';

const EPHEMERAL_FALLBACK_KEY = crypto.randomBytes(32).toString('hex');
export const SESSION_COOKIE_NAME = 'rp_session';

function getSessionSecret(): string {
  return process.env.SESSION_SECRET || EPHEMERAL_FALLBACK_KEY;
}

export function getAdminEmail(): string {
  return (process.env.ADMIN_EMAIL || 'rptabacaria3@gmail.com').trim().toLowerCase();
}

export function getConfiguredAdminPassword(): string {
  return process.env.ADMIN_PASSWORD || '';
}

export function isAdminClaimed(): boolean {
  return Boolean(getConfiguredAdminPassword()) || hasAdminUser();
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, expectedHex] = parts;
  if (!salt || !expectedHex) return false;
  const expected = Buffer.from(expectedHex, 'hex');
  const actual = crypto.scryptSync(password, salt, 64);
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

export function verifyEnvAdminPassword(candidate: string): boolean {
  const configured = getConfiguredAdminPassword();
  if (!configured) return false;
  const a = crypto.createHash('sha256').update(candidate).digest();
  const b = crypto.createHash('sha256').update(configured).digest();
  return crypto.timingSafeEqual(a, b);
}

interface TokenPayload {
  userId: number;
  role: 'admin' | 'customer';
  exp: number;
}

export function signSessionToken(user: User): string {
  const payload: TokenPayload = {
    userId: user.id,
    role: user.role,
    exp: Date.now() + 30 * 24 * 60 * 60 * 1000,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', getSessionSecret()).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifySessionToken(token: string): TokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, providedSig] = parts;
  if (!encoded || !providedSig) return null;
  const expectedSig = crypto.createHmac('sha256', getSessionSecret()).update(encoded).digest('base64url');
  const a = Buffer.from(providedSig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as TokenPayload;
    if (!parsed || typeof parsed.userId !== 'number' || typeof parsed.exp !== 'number') return null;
    if (Date.now() > parsed.exp) return null;
    return parsed;
  } catch {
    return null;
  }
}

function parseCookieHeader(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  const pairs = cookieHeader.split(';');
  for (const pair of pairs) {
    const idx = pair.indexOf('=');
    if (idx === -1) continue;
    const key = pair.slice(0, idx).trim();
    if (key === name) {
      return decodeURIComponent(pair.slice(idx + 1).trim());
    }
  }
  return null;
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    partitioned: true,
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    partitioned: true,
    path: '/',
  });
}

function isSameOriginOrCustomHeader(req: Request): boolean {
  if (req.headers['x-requested-with'] === 'XMLHttpRequest') {
    return true;
  }
  const origin = req.headers.origin;
  const host = (req.headers['x-forwarded-host'] as string | undefined) || req.headers.host;
  if (origin && host) {
    try {
      const parsedOrigin = new URL(origin);
      return parsedOrigin.host === host;
    } catch {
      return false;
    }
  }
  return false;
}

export interface AuthenticatedRequest extends Request {
  authUser?: User;
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  const cookieToken = parseCookieHeader(req.headers.cookie, SESSION_COOKIE_NAME);
  const token = bearerToken || cookieToken;

  if (!token) {
    res.status(401).json({ error: 'Faça login para acessar esta área.' });
    return;
  }

  // CSRF check for cookie-authenticated mutating requests
  if (!bearerToken && cookieToken && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    if (!isSameOriginOrCustomHeader(req)) {
      res.status(403).json({ error: 'Origem da requisição não autorizada.' });
      return;
    }
  }

  const payload = verifySessionToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Sessão expirada ou inválida. Entre novamente.' });
    return;
  }
  const user = getUserById(payload.userId);
  if (!user) {
    res.status(401).json({ error: 'Usuário não encontrado.' });
    return;
  }
  req.authUser = user;
  next();
}

export function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!req.authUser || req.authUser.role !== 'admin') {
    res.status(403).json({ error: 'Acesso restrito ao administrador da loja.' });
    return;
  }
  next();
}
