import { Request, Response, NextFunction } from 'express';
import { AppError } from './envelope';
import { logger } from '../utils/logger';

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<any> | any;

/** Envolve handlers async para que erros cheguem ao error handler global. */
export function handler(fn: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/** 404 para rotas de API não mapeadas. */
export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({
    success: false,
    data: null,
    error: { code: 'ROUTE_NOT_FOUND', message: `Rota não encontrada: ${req.method} ${req.originalUrl}` },
  });
}

/** Error handler global - sempre responde no envelope padrão. */
export function errorHandler(err: any, req: Request, res: Response, next: NextFunction) {
  // Headers já enviados (SSE / sendFile / stream parcial): NÃO dá pra responder
  // de novo. A express documenta que é preciso DELEGAR ao handler padrão
  // (next(err)) — o `return` silencioso que existia aqui deixava o request
  // pendurado até o timeout do cliente (60s no axios), sem resposta e sem log.
  if (res.headersSent) return next(err);

  if (err instanceof AppError) {
    return res.status(err.status).json({
      success: false,
      data: null,
      error: { code: err.code, message: err.message, fields: err.fields ?? null },
    });
  }

  // Erros do Prisma mapeados para mensagens amigáveis
  if (err?.code?.startsWith?.('P')) {
    const map: Record<string, { status: number; code: string; message: string }> = {
      P2002: { status: 409, code: 'DUPLICATE', message: 'Registro duplicado (valor único já existe).' },
      P2025: { status: 404, code: 'NOT_FOUND', message: 'Registro não encontrado.' },
      P2003: { status: 400, code: 'FOREIGN_KEY', message: 'Relacionamento inválido: registro referenciado inexistente.' },
      P2021: { status: 500, code: 'TABLE_NOT_FOUND', message: 'Tabela inexistente. Rode as migrações (prisma migrate deploy).' },
      // budgets.routes.ts e purchases.routes.ts rodam com isolationLevel:
      // Serializable. Conflito de serialização é CONDICIONAL/retentável e
      // virava 500 "Erro interno do servidor" numa situação normal.
      P2034: { status: 409, code: 'CONFLICT_RETRY', message: 'Alteração concorrente detectada. Tente novamente.' },
      // Transação expirada / deadlock interrompido (maxWait/timeout do Prisma)
      P2028: { status: 409, code: 'TRANSACTION_TIMEOUT', message: 'A operação demorou demais e foi cancelada. Tente novamente.' },
      // Erro de conexão/consulta (banco caiu no meio do request)
      P2010: { status: 503, code: 'DB_ERROR', message: 'Falha temporária no banco de dados. Tente novamente.' },
      // Pool esgotado / processo do banco reiniciando
      P1017: { status: 503, code: 'DB_UNAVAILABLE', message: 'Banco de dados indisponível no momento.' },
    };
    const mapped = map[err.code];
    if (mapped) {
      return res.status(mapped.status).json({
        success: false,
        data: null,
        error: { code: mapped.code, message: mapped.message },
      });
    }
    logger.error('Erro Prisma não mapeado', { code: err.code, message: err.message, path: req.originalUrl });
  }

  // Pool/ conexão do driver sem código P*
  if (err?.name === 'PrismaClientInitializationError' || err?.code === 'ECONNREFUSED') {
    return res.status(503).json({
      success: false,
      data: null,
      error: { code: 'DB_UNAVAILABLE', message: 'Banco de dados indisponível no momento.' },
    });
  }

  // JSON malformado no corpo da requisição (express.json falhou ao parsear).
  // Precisa vir ANTES do caso genérico de SyntaxError abaixo, senão a mensagem
  // troca (o body-parser também lança SyntaxError).
  if (err?.type === 'entity.parse.failed' || (err instanceof SyntaxError && 'body' in err)) {
    return res.status(400).json({
      success: false,
      data: null,
      error: { code: 'INVALID_JSON', message: 'Corpo da requisição não é um JSON válido.' },
    });
  }

  // JSON.parse feito DENTRO do handler (multipart com campo `data` quebrado).
  // Sem este ramo, um SyntaxError bruto caía no 500 genérico e o cliente via
  // "Erro interno do servidor" para um problema de payload.
  if (err instanceof SyntaxError && typeof err?.message === 'string') {
    logger.warn('JSON.parse falhou dentro do handler', { path: req.originalUrl, message: err.message });
    return res.status(400).json({
      success: false,
      data: null,
      error: { code: 'INVALID_JSON', message: 'Payload "data" não é um JSON válido.' },
    });
  }

  // Multer / body parse
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({
      success: false,
      data: null,
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'Corpo da requisição muito grande.' },
    });
  }

  if (err?.name === 'MulterError') {
    return res.status(400).json({
      success: false,
      data: null,
      error: { code: 'UPLOAD_ERROR', message: `Erro no upload: ${err.message}` },
    });
  }

  logger.error('Erro não tratado', {
    message: err?.message,
    stack: err?.stack,
    path: req.originalUrl,
  });

  res.status(500).json({
    success: false,
    data: null,
    error: { code: 'INTERNAL_ERROR', message: 'Erro interno do servidor' },
  });
}
