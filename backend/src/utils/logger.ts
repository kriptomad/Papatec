import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, any>;
  traceId?: string;
}

/**
 * Logger estruturado (JSON por linha) com escrita em arquivo.
 * Falha de escrita em disco nunca derruba a aplicação (fallback: console).
 */
class Logger {
  private logStream: ReturnType<typeof createWriteStream> | null = null;
  private logDir: string;
  private disabled = false;

  constructor() {
    this.logDir = process.env.LOG_DIR || this.resolveLogDir();
    try {
      if (!existsSync(this.logDir)) mkdirSync(this.logDir, { recursive: true });
    } catch {
      // Ambiente sem permissão de escrita (ex.: distroless nonroot) => apenas console
      try {
        this.logDir = join(tmpdir(), 'papatec-logs');
        if (!existsSync(this.logDir)) mkdirSync(this.logDir, { recursive: true });
      } catch {
        this.disabled = true;
      }
    }
    this.initStream();
  }

  private resolveLogDir(): string {
    const candidates = [join(process.cwd(), 'logs'), join(tmpdir(), 'papatec-logs')];
    for (const dir of candidates) {
      try {
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        return dir;
      } catch {
        continue;
      }
    }
    return tmpdir();
  }

  private initStream() {
    if (this.disabled) return;
    try {
      const date = new Date().toISOString().split('T')[0];
      const logFile = join(this.logDir, `app-${date}.log`);
      this.logStream = createWriteStream(logFile, { flags: 'a' });
      this.logStream.on('error', () => {
        this.disabled = true;
        this.logStream = null;
      });
    } catch {
      this.disabled = true;
    }
  }

  private write(level: LogLevel, message: string, context?: Record<string, any>, traceId?: string) {
    const entry: LogEntry = { timestamp: new Date().toISOString(), level, message, context, traceId };
    const jsonLine = JSON.stringify(entry) + '\n';

    if (this.logStream && !this.disabled) {
      try {
        this.logStream.write(jsonLine);
      } catch {
        this.disabled = true;
      }
    }

    // -------------------------------------------------------------------------
    // CRÍTICO (observabilidade): o build de produção roda o javascript-obfuscator
    // com `--disable-console-output true`, que REESCREVE toda chamada `console.*`
    // para `void 0`. Resultado: em produção NENHUM log da aplicação chegava ao
    // `docker logs` (só o entrypoint aparecia), e como a imagem é DISTROLESS
    // (sem shell) não havia como `docker exec` para ler o arquivo de log —
    // os logs eram efetivamente INALCANÇÁVEIS, e perdidos a cada recreate do
    // container porque ./logs não é volume.
    //
    // `process.stdout.write` NÃO é alvo do ofuscador, então restaura a
    // visibilidade no `docker logs` sem afetar a proteção do bundle.
    // -------------------------------------------------------------------------
    const out = level === 'error' || level === 'fatal' ? process.stderr : process.stdout;
    const trace = traceId ? ` traceId=${traceId}` : '';
    const detail = context && Object.keys(context).length ? ` ${JSON.stringify(context)}` : '';
    out.write(`[${level.toUpperCase()}] ${message}${trace}${detail}\n`);
  }

  debug(message: string, context?: Record<string, any>, traceId?: string) {
    this.write('debug', message, context, traceId);
  }

  info(message: string, context?: Record<string, any>, traceId?: string) {
    this.write('info', message, context, traceId);
  }

  warn(message: string, context?: Record<string, any>, traceId?: string) {
    this.write('warn', message, context, traceId);
  }

  error(message: string, context?: Record<string, any>, traceId?: string) {
    this.write('error', message, context, traceId);
  }

  fatal(message: string, context?: Record<string, any>, traceId?: string) {
    this.write('fatal', message, context, traceId);
  }

  child(context: Record<string, any>) {
    const childLogger = Object.create(this);
    childLogger.bindContext = context;
    return childLogger as Logger;
  }
}

export const logger = new Logger();
export default logger;
