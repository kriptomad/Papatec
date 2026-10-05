import { Response } from 'express';

/**
 * Envelope padrão de respostas da API PapaTec:
 * { success: boolean, data: any, error: { code, message } | null }
 */
export interface ApiError {
  code: string;
  message: string;
  /** Campos específicos com erro (validação) */
  fields?: Record<string, string> | null;
}

export function ok<T>(res: Response, data: T, status = 200): Response {
  return res.status(status).json({ success: true, data, error: null });
}

export function created<T>(res: Response, data: T): Response {
  return ok(res, data, 201);
}

export function fail(res: Response, status: number, code: string, message: string): Response {
  return res.status(status).json({ success: false, data: null, error: { code, message } });
}

/** Erro de aplicação controlado (serializado pelo error handler global). */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    // Briefing: indicar ao usuário QUAIS campos estão faltando/inválidos
    public readonly fields?: Record<string, string>
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function badRequest(
  message: string,
  code = 'VALIDATION_ERROR',
  fields?: Record<string, string>
): AppError {
  return new AppError(400, code, message, fields);
}

export function unauthorized(message = 'Não autenticado', code = 'UNAUTHORIZED'): AppError {
  return new AppError(401, code, message);
}

export function forbidden(message = 'Acesso negado', code = 'FORBIDDEN'): AppError {
  return new AppError(403, code, message);
}

export function notFound(message = 'Recurso não encontrado', code = 'NOT_FOUND'): AppError {
  return new AppError(404, code, message);
}

export function conflict(message: string, code = 'CONFLICT'): AppError {
  return new AppError(409, code, message);
}

export function tooManyRequests(message = 'Muitas requisições'): AppError {
  return new AppError(429, 'RATE_LIMITED', message);
}
