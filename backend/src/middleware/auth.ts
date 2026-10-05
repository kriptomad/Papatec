import { Request, Response, NextFunction } from 'express';
import { verify } from 'jsonwebtoken';
import { prisma } from '../db/prisma';
import { unauthorized, forbidden } from '../http/envelope';
import { loadPublicKey, assertKeys } from '../utils/jwtKeys';

export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
  role: 'ADMIN' | 'TECHNICIAN' | 'RECEPTIONIST';
  active: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      license?: { id: string | null; payload: any };
    }
  }
}

function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header) {
    const [scheme, token] = header.split(' ');
    if (scheme?.toLowerCase() === 'bearer' && token) return token;
  }
  // Fallback: EventSource (SSE) NÃO consegue definir cabeçalhos, então o
  // frontend envia o JWT na query string (?token=...). Sem este ramo, TODA
  // conexão de tempo real da O.S. recebia 401 "Token de acesso ausente" e o
  // navegador tentava reconectar a cada 3s para sempre — estourando o rate
  // limit global (300 req/min) e deixando o recurso totalmente inutilizável.
  const queryToken = req.query?.token;
  if (typeof queryToken === 'string' && queryToken.trim()) return queryToken.trim();
  return null;
}

/** Exige um JWT de sessão válido e usuário ativo no banco. */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = extractToken(req);
    if (!token) throw unauthorized('Token de acesso ausente');

    const { publicKey } = assertKeys();

    const payload = verify(token, publicKey, { algorithms: ['RS256'] }) as { sub: string };
    // select explícito: a lookup acontece em CADA request, e o findUnique
    // padrão puxava também o hash bcrypt + bloco de endereço inteiro.
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, name: true, email: true, role: true, active: true },
    });

    if (!user) throw unauthorized('Usuário não encontrado');
    if (!user.active) throw forbidden('Usuário desativado', 'USER_DISABLED');

    req.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      active: user.active,
    };

    next();
  } catch (error: any) {
    if (error.name === 'TokenExpiredError') {
      return next(unauthorized('Sessão expirada', 'TOKEN_EXPIRED'));
    }
    if (error.name === 'JsonWebTokenError') {
      return next(unauthorized('Token inválido'));
    }
    next(error);
  }
}

/** Restringe a rota a papéis específicos (ex.: apenas ADMIN). */
export function requireRole(...roles: AuthenticatedUser['role'][]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) {
      return next(forbidden('Acesso restrito ao administrador do sistema', 'ADMIN_ONLY'));
    }
    next();
  };
}

/** Encurta o usuário para a resposta (nunca vaza hash de senha). */
export function sanitizeUser(user: {
  id: string;
  code?: string | null;
  name: string;
  email: string;
  role: string;
  active: boolean;
  avatar?: string | null;
  // Cadastro de funcionário/parceiro (PDF p.4)
  phone?: string | null;
  ramal?: string | null;
  cpf?: string | null;
  rg?: string | null;
  cnpj?: string | null;
  ie?: string | null;
  im?: string | null;
  street?: string | null;
  number?: string | null;
  complement?: string | null;
  district?: string | null;
  zip?: string | null;
  city?: string | null;
  state?: string | null;
  site?: string | null;
  notes?: string | null;
  commissionPercent?: number | null;
  createdAt?: Date;
  updatedAt?: Date;
}) {
  return {
    id: user.id,
    code: user.code ?? null,
    name: user.name,
    email: user.email,
    role: user.role,
    active: user.active,
    avatar: user.avatar ?? null,
    phone: user.phone ?? null,
    ramal: user.ramal ?? null,
    cpf: user.cpf ?? null,
    rg: user.rg ?? null,
    cnpj: user.cnpj ?? null,
    ie: user.ie ?? null,
    im: user.im ?? null,
    street: user.street ?? null,
    number: user.number ?? null,
    complement: user.complement ?? null,
    district: user.district ?? null,
    zip: user.zip ?? null,
    city: user.city ?? null,
    state: user.state ?? null,
    site: user.site ?? null,
    notes: user.notes ?? null,
    commissionPercent: user.commissionPercent ?? null,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
