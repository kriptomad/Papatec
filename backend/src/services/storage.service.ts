import multer from 'multer';
import { existsSync, mkdirSync, unlinkSync } from 'fs';
import { join, resolve, sep } from 'path';
import { randomUUID } from 'crypto';
import { AppError } from '../http/envelope';

export const UPLOADS_ROOT = process.env.UPLOADS_PATH || '/app/uploads';

export const PUBLIC_STATICS = {
  budgets: 'budgets',
  os: 'os',
} as const;

export const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
]);

export const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

/** Garante que a pasta de uploads exista. */
export function ensureUploadsDir(subdir?: string): string {
  const base = subdir ? join(UPLOADS_ROOT, subdir) : UPLOADS_ROOT;
  if (!existsSync(base)) mkdirSync(base, { recursive: true });
  return base;
}

/** Resolve um caminho relativo salvo no banco para o caminho absoluto real. */
export function resolveUploadPath(relativePath: string): string {
  const clean = String(relativePath || '').replace(/^\/+/, '').replace(/\.\./g, '');
  const full = resolve(join(UPLOADS_ROOT, clean));
  const root = resolve(UPLOADS_ROOT);
  if (!full.startsWith(root + sep) && full !== root) {
    throw new AppError(400, 'PATH_TRAVERSAL_DENIED', 'Caminho de arquivo inválido.');
  }
  return full;
}

/** Remove um arquivo da pasta de uploads (ignora erros). */
export function removeUploadedFile(relativePath: string): void {
  try {
    const full = resolveUploadPath(relativePath);
    if (existsSync(full)) unlinkSync(full);
  } catch {
    /* arquivo já inexistente */
  }
}

function storageFor(subdir: string) {
  return multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, ensureUploadsDir(subdir)),
    filename: (_req, file, cb) => {
      const ext = (file.originalname.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
      cb(null, `${randomUUID()}.${ext}`);
    },
  });
}

function fileFilter(_req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) {
  if (!ALLOWED_MIME.has(file.mimetype)) {
    return cb(new AppError(400, 'INVALID_FILE_TYPE', `Tipo de arquivo não permitido: ${file.mimetype}`));
  }
  cb(null, true);
}

export const uploadBudgetPhotos = multer({
  storage: storageFor(PUBLIC_STATICS.budgets),
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE, files: 10 },
});

export const uploadOsPhotos = multer({
  storage: storageFor(PUBLIC_STATICS.os),
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE, files: 20 },
});
