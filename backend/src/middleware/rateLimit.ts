import { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';

/**
 * express-rate-limit envia `message` direto para res.send().
 * Passar uma instância de AppError serializa como {"status":429,"code":"..."}
 * porque `message`/`name` de Error são NÃO-enumeráveis => o cliente recebia
 * um 429 fora do envelope, sem `error.message`, e a UI mostrava texto vazio.
 * Por isso devolvemos uma FUNÇÃO que monta o envelope completo.
 */
const envelopeMessage =
  (text: string) =>
  (_req: Request, res: Response): void => {
    res.status(429).json({
      success: false,
      data: null,
      error: { code: 'RATE_LIMITED', message: text, fields: null },
    });
  };

/**
 * Chave de rate limit limitada em tamanho: o e-mail vem do corpo do atacante,
 * e sem limite a MemoryStore cresce sem teto (vazamento de memória).
 */
const boundedKey = (value: unknown, max = 120): string => {
  const s = typeof value === 'string' ? value : '';
  return s.slice(0, max);
};

/**
 * Rate limiter global (todas as rotas /api)
 */
export const globalRateLimiter = rateLimit({
  windowMs: 60_000, // 1 minuto
  max: 300, // máx 300 req/min por IP
  standardHeaders: true,
  legacyHeaders: false,
  message: envelopeMessage('Muitas requisições, tente novamente em um minuto'),
  keyGenerator: (req: Request) => boundedKey(req.ip || 'unknown'),
  // Montado em app.use('/api', ...) => req.path JÁ é '/health', nunca
  // '/api/health'. A comparacao antiga nunca casava e o healthcheck era
  // contabilizado contra o limite global.
  skip: (req: Request) => req.path === '/health',
});

/**
 * Rate limiter estrito para login (anti brute-force)
 */
export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60_000, // 15 minutos
  max: 5, // máx 5 tentativas por IP/email
  standardHeaders: true,
  legacyHeaders: false,
  message: envelopeMessage('Muitas tentativas de login. Tente novamente em 15 minutos.'),
  keyGenerator: (req: Request) => {
    const email = boundedKey(req.body?.email || 'no-email', 254).toLowerCase();
    return `${boundedKey(req.ip)}:${email}`;
  },
  skipSuccessfulRequests: true, // não conta logins bem-sucedidos
});

/**
 * Rate limiter para registro de usuários
 */
export const registerRateLimiter = rateLimit({
  windowMs: 60 * 60_000, // 1 hora
  max: 10, // máx 10 registros por IP/hora
  standardHeaders: true,
  legacyHeaders: false,
  message: envelopeMessage('Muitos registros. Tente novamente em uma hora.'),
  keyGenerator: (req: Request) => boundedKey(req.ip || 'unknown'),
});

/**
 * Rate limiter para upload de arquivos
 */
export const uploadRateLimiter = rateLimit({
  windowMs: 60_000, // 1 minuto
  max: 20, // máx 20 uploads/min
  standardHeaders: true,
  legacyHeaders: false,
  message: envelopeMessage('Muitos uploads. Tente novamente em um minuto.'),
  keyGenerator: (req: Request) => boundedKey(req.ip || 'unknown'),
});