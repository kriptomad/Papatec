import multer from 'multer';
import { existsSync, mkdirSync, unlinkSync } from 'fs';
import { join, resolve, sep } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { AppError } from '../http/envelope';
import { logger } from '../utils/logger';

/**
 * Raiz dos uploads.
 *
 * Comeca na pasta configurada (UPLOADS_PATH). Se ela nao puder ser criada,
 * ensureUploadsDir() troca para um diretorio gravavel do sistema - o mesmo
 * remedy que o logger ja usa em resolveLogDir().
 *
 * E `let` de proposito: o importador ve o valor atualizado (live binding), e
 * todos os consumidores leem em runtime, nunca em tempo de import.
 */
export let UPLOADS_ROOT = process.env.UPLOADS_PATH || '/app/uploads';

/** Evita repetir o aviso a cada upload depois que a troca ja aconteceu. */
let avisouFallback = false;

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

/**
 * Garante que a pasta de uploads exista.
 *
 * Antes isto era `if (!existsSync(base)) mkdirSync(base, ...)`, sem protecao.
 * O main.ts chama no boot SEM try/catch, entao num ambiente onde a pasta nao e
 * gravavel o processo morria antes de abrir o servidor:
 *
 *     EACCES: permission denied, mkdir '/app/uploads'
 *
 * Era o que acontecia no Render: a imagem roda como `nonroot` e, sem bind
 * mount (o Render nao monta volume), `/app` pertence ao root. Agora cai no
 * temp do SO, que sempre e gravavel, e o upload volta a funcionar - so ate
 * o proximo deploy, que apaga o conteudo.
 */
export function ensureUploadsDir(subdir?: string): string {
  const base = subdir ? join(UPLOADS_ROOT, subdir) : UPLOADS_ROOT;

  try {
    if (!existsSync(base)) mkdirSync(base, { recursive: true });
    return base;
  } catch (erro: any) {
    const causa = erro?.code || erro?.message || String(erro);

    // So troca a raiz no primeiro erro: se o problema for uma subpasta
    // especifica, reverter a raiz tornaria o efeito pior.
    if (avisouFallback) {
      throw erro;
    }
    avisouFallback = true;

    const alternativa = join(tmpdir(), 'papatec-uploads');
    try {
      if (!existsSync(alternativa)) mkdirSync(alternativa, { recursive: true });
    } catch (erroAlternativo: any) {
      // Nem o temp funcionou: aqui nao ha para onde gravar.
      throw erroAlternativo;
    }

    logger.warn(
      `Uploads: '${base}' nao e gravavel (${causa}). Usando '${alternativa}'. ` +
      'Os arquivos somem no proximo deploy - monte um disco/valor para UPLOADS_PATH.'
    );

    UPLOADS_ROOT = alternativa;
    return subdir ? join(alternativa, subdir) : alternativa;
  }
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
