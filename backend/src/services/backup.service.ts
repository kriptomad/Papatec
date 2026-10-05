import cron from 'node-cron';
import { createWriteStream, createReadStream, existsSync, mkdirSync, readdirSync, statSync, unlinkSync, copyFileSync, readFileSync, writeFileSync, rmSync, mkdtempSync } from 'fs';
import { join, basename, resolve, dirname, sep } from 'path';
import { tmpdir } from 'os';
import { randomBytes, timingSafeEqual } from 'crypto';
import archiver from 'archiver';
import unzipper from 'unzipper';
import { Client, ClientConfig } from 'pg';
import { prisma } from '../db/prisma';
import { settingsService } from './settings.service';
import { AppError } from '../http/envelope';
import { logger } from '../utils/logger';

const BACKUP_FILE_PREFIX = 'backup_papatec_';
const BACKUP_FILE_EXT = '.bkp';
const SNAPSHOT_FILE_PREFIX = 'snapshot_papatec_';
const SNAPSHOT_FILE_EXT = '.tmp';

/** Aceita os formatos atuais (.bkp) e os legados (.zip). */
function isBackupFileName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith('.bkp') || lower.endsWith('.zip');
}

function isSnapshotFileName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith('.tmp');
}

export interface BackupFile {
  name: string;
  size: number;
  createdAt: string;
}

export interface BackupResult {
  file: string;
  path: string;
  size: number;
  tables: number;
  rows: number;
  durationMs: number;
}

/**
 * ---------------------------------------------------------------------------
 * Backup Service
 * ---------------------------------------------------------------------------
 * - Dump lógico do PostgreSQL 100% em Node (sem depender de binários como
 *   pg_dump/psql => funciona até em imagem Distroless).
 * - ZIP com nível de compressão 9 (database.json + pasta uploads).
 * - Destino configurável pela UI (settings.backup_path) ou por env.
 * - Todos os streams possuem tratamento de erro (nenhum handler "solto").
 * ---------------------------------------------------------------------------
 */
export class BackupService {
  private task: cron.ScheduledTask | null = null;
  private running = false;
  // On-time: alterações pendentes aguardando o próximo dump
  private dirty = false;
  private dirtySince = 0;
  private realtimeTimer: ReturnType<typeof setTimeout> | null = null;
  private lastRun: { at: string; file: string; size: number } | null = null;

  // Snapshot on-time (.tmp) - estado 1:1 da máquina a cada minuto
  private snapshotDir: string | null = null;
  private snapshotTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSnapshot: { at: string; file: string; size: number } | null = null;
  private readonly snapshotIntervalMs = 60_000; // 1 minuto
  private snapshotQueue: Array<{ machineId: string; data: any; timestamp: number }> = [];
  private snapshotProcessor: ReturnType<typeof setTimeout> | null = null;

  // -----------------------------------------------------------------------
  // Agendamento
  // -----------------------------------------------------------------------
  async start(): Promise<void> {
    await this.reschedule();
    // On-time: o primeiro dump sai logo após o boot (1:1 com o estado atual)
    this.markDirty();
    // Inicia sistema de snapshots on-time (.tmp)
    await this.initSnapshotSystem();
  }

  private async initSnapshotSystem(): Promise<void> {
    try {
      const targetDir = await this.resolveTargetDir();
      this.snapshotDir = join(targetDir, 'snapshots');
      if (!existsSync(this.snapshotDir)) mkdirSync(this.snapshotDir, { recursive: true });
      
      // Inicia timer de snapshots a cada 1 minuto
      this.snapshotTimer = setInterval(() => {
        this.processSnapshotQueue().catch((err) => logger.error('[Backup] Falha no processamento de snapshots', { error: err.message }));
      }, this.snapshotIntervalMs);
      
      logger.info('[Backup] Sistema de snapshots on-time (.tmp) iniciado', { intervalMs: this.snapshotIntervalMs, dir: this.snapshotDir });
    } catch (error: any) {
      logger.error('[Backup] Falha ao inicializar sistema de snapshots', { error: error.message });
    }
  }

  private async processSnapshotQueue(): Promise<void> {
    if (this.snapshotQueue.length === 0) return;
    
    // Se não há snapshotDir inicializado, pula
    if (!this.snapshotDir) return;
    
    try {
      // Pega o último snapshot da fila (estado mais recente)
      const latest = this.snapshotQueue.pop();
      this.snapshotQueue = []; // Limpa a fila - só o último estado importa
      
      if (!latest) return;
      
      const timestamp = new Date(latest.timestamp).toISOString().replace(/[:.]/g, '-').substring(0, 19);
      const fileName = `${SNAPSHOT_FILE_PREFIX}${timestamp}${SNAPSHOT_FILE_EXT}`;
      const filePath = join(this.snapshotDir!, fileName);
      
      const payload = Buffer.from(JSON.stringify({
        version: 1,
        generatedAt: new Date(latest.timestamp).toISOString(),
        machineId: latest.machineId,
        data: latest.data
      }), 'utf8');
      
      await new Promise<void>((resolve, reject) => {
        const output = createWriteStream(filePath);
        const archive = archiver('zip', { zlib: { level: 9 } });
        let failed = false;
        
        const failWith = (err: Error) => {
          if (failed) return;
          failed = true;
          archive.abort();
          output.destroy();
          reject(err);
        };
        
        output.on('close', () => {
          if (failed) return;
          resolve();
        });
        output.on('error', failWith);
        archive.on('error', failWith);
        archive.on('warning', (err: any) => {
          if (err?.code !== 'ENOENT') failWith(err);
        });
        
        archive.pipe(output);
        archive.append(payload, { name: 'snapshot.json' });
        archive.finalize().catch((err) => failWith(err));
      });
      
      const stats = statSync(filePath);
      this.lastSnapshot = { at: new Date().toISOString(), file: fileName, size: stats.size };
      
      // Limpa snapshots antigos (mantém últimos 60 = 1 hora)
      await this.cleanupSnapshots(60);
      
      logger.debug('[Backup] Snapshot on-time criado', { fileName, size: stats.size });
    } catch (error: any) {
      logger.error('[Backup] Falha ao criar snapshot on-time', { error: error.message });
    }
  }

  private async cleanupSnapshots(keepCount: number): Promise<void> {
    if (!this.snapshotDir) return;
    
    try {
      const files = readdirSync(this.snapshotDir)
        .filter(f => isSnapshotFileName(f))
        .map(f => ({ name: f, path: join(this.snapshotDir!, f), mtime: statSync(join(this.snapshotDir!, f)).mtime }))
        .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
      
      for (const file of files.slice(keepCount)) {
        unlinkSync(file.path);
        logger.debug('[Backup] Snapshot antigo removido', { file: file.name });
      }
    } catch (error: any) {
      logger.warn('[Backup] Falha na limpeza de snapshots', { error: error.message });
    }
  }

  /**
   * Retorna o diretório de snapshots
   */
  getSnapshotDir(): string | null {
    return this.snapshotDir;
  }

  /**
   * Recebe snapshot de uma máquina cliente (máquina de usuário/vendedor/técnico)
   * Salva na fila para ser processado no próximo ciclo (1 min)
   */
  receiveSnapshot(machineId: string, data: any): void {
    this.snapshotQueue.push({
      machineId,
      data,
      timestamp: Date.now()
    });
  }

  // Expor status dos snapshots
  async snapshotStatus(): Promise<{
    enabled: boolean;
    dir: string | null;
    lastSnapshot: { at: string; file: string; size: number } | null;
    queueSize: number;
  }> {
    return {
      enabled: !!this.snapshotTimer,
      dir: this.snapshotDir,
      lastSnapshot: this.lastSnapshot,
      queueSize: this.snapshotQueue.length
    };
  }

  async reschedule(): Promise<void> {
    if (this.task) {
      this.task.stop();
      this.task = null;
    }
    const schedule = await settingsService.getBackupSchedule();
    if (!cron.validate(schedule)) {
      logger.error('[Backup] Expressão cron inválida, usando padrão 0 12,18 * * *', { schedule });
    }
    const expr = cron.validate(schedule) ? schedule : '0 12,18 * * *';

    this.task = cron.schedule(expr, () => {
      this.runBackup().catch((err) => logger.error('[Backup] Falha no backup agendado', { error: err.message }));
    }, { scheduled: true, timezone: process.env.TZ || 'America/Sao_Paulo' });

    logger.info(`[Backup] Agendado: "${expr}"`);
  }

  stop(): void {
    this.task?.stop();
    this.task = null;
    if (this.realtimeTimer) clearTimeout(this.realtimeTimer);
    this.realtimeTimer = null;
    if (this.snapshotTimer) clearInterval(this.snapshotTimer);
    this.snapshotTimer = null;
  }

  // -----------------------------------------------------------------------
  // Tempo real ("on-time"): QUALQUER alteração mínima dispara um novo dump
  // -----------------------------------------------------------------------
  /** Chamado pelo middleware da API a cada gravação bem-sucedida. */
  markDirty(): void {
    this.dirty = true;
    if (!this.dirtySince) this.dirtySince = Date.now();
    this.scheduleRealtime();
  }

  private scheduleRealtime(): void {
    if (this.realtimeTimer) clearTimeout(this.realtimeTimer);
    const debounceMs = 1500;  // deixa a "menor alteração" assentar antes do dump
    const maxWaitMs = 30_000; // mas nunca passa de 30s sem backup
    const waited = Date.now() - this.dirtySince;
    const delay = Math.max(0, Math.min(debounceMs, maxWaitMs - waited));
    this.realtimeTimer = setTimeout(() => {
      this.realtimeTimer = null;
      void this.flushRealtime();
    }, delay);
  }

  private async flushRealtime(): Promise<void> {
    try {
      const enabled = await settingsService.get<boolean>('backup_realtime');
      if (enabled === false || !this.dirty) return;

      if (this.running) {
        // Dump manual/cron em andamento — tenta de novo em 3s
        this.realtimeTimer = setTimeout(() => { this.realtimeTimer = null; void this.flushRealtime(); }, 3000);
        return;
      }

      this.dirty = false;
      this.dirtySince = 0;
      await this.runBackup();
    } catch (error: any) {
      logger.error('[Backup] Falha no backup em tempo real', { error: error.message });
      // Reagenda a retentativa em ~3s (sem entrar em loop apertado)
      this.dirty = true;
      this.dirtySince = Date.now() - 27_000;
      this.scheduleRealtime();
    }
  }

  async status(): Promise<{
    schedule: string;
    path: string;
    realtime: boolean;
    dirty: boolean;
    lastRunAt: string | null;
    lastFile: string | null;
    lastSize: number | null;
  }> {
    const [schedule, path, realtime] = await Promise.all([
      settingsService.getBackupSchedule(),
      settingsService.getBackupPath(),
      settingsService.get<boolean>('backup_realtime'),
    ]);
    return {
      schedule,
      path,
      realtime: realtime !== false,
      dirty: this.dirty,
      lastRunAt: this.lastRun?.at ?? null,
      lastFile: this.lastRun?.file ?? null,
      lastSize: this.lastRun?.size ?? null,
    };
  }

  // -----------------------------------------------------------------------
  // Caminho de destino
  // -----------------------------------------------------------------------
  private async resolveTargetDir(): Promise<string> {
    const dir = await settingsService.getBackupPath();
    const absolute = resolve(dir);
    try {
      if (!existsSync(absolute)) mkdirSync(absolute, { recursive: true });
    } catch (error: any) {
      logger.error('[Backup] Não foi possível criar o diretório de destino', { dir: absolute, error: error.message });
      throw new AppError(500, 'BACKUP_PATH_ERROR', `Não foi possível criar o diretório de backup: ${absolute}`);
    }
    return absolute;
  }

  // -----------------------------------------------------------------------
  // Dump do banco (Node puro)
  // -----------------------------------------------------------------------
  private pgConfig(): ClientConfig {
    const url = process.env.DATABASE_URL;
    if (!url) throw new AppError(500, 'DATABASE_URL_MISSING', 'DATABASE_URL não configurada.');
    return {
      connectionString: url,
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
      // C3: sem estes limites o dump/restore podia pendurar para SEMPRE.
      // connectionTimeoutMillis cobre TCP que aceita conexão mas o Postgres não
      // responde; statement_timeout cobre query parada (replicação parada,
      // lock de DDL segurado por outra transação). Com `this.running` travado
      // em true, TODOS os backups seguintes ficavam bloqueados silenciosamente
      // — o cron continuava acendendo e falhando por BACKUP_ALREADY_RUNNING.
      connectionTimeoutMillis: 30_000,
      query_timeout: 10 * 60_000,
      statement_timeout: 10 * 60_000,
      application_name: 'papatec-backup',
    };
  }

  private async dumpDatabase(): Promise<{ tables: { name: string; rows: any[] }[]; totalRows: number }> {
    const client = new Client(this.pgConfig());
    // O connect() ficava FORA do try: se falhasse, client.end() nunca rodava.
    try {
      await client.connect();
      return await this.readAllTables(client);
    } finally {
      await client.end().catch((e) => logger.warn('[Backup] Falha ao fechar conexão de dump', { error: e.message }));
    }
  }

  private async readAllTables(client: Client): Promise<{ tables: { name: string; rows: any[] }[]; totalRows: number }> {
    const tablesResult = await client.query(
      `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
         ORDER BY table_name`
    );

    const tables: { name: string; rows: any[] }[] = [];
    let totalRows = 0;

    for (const { table_name } of tablesResult.rows) {
      const data = await client.query(`SELECT * FROM "${table_name}"`);
      tables.push({ name: table_name, rows: data.rows });
      totalRows += data.rows.length;
    }

    return { tables, totalRows };
  }

  // -----------------------------------------------------------------------
  // Criação do ZIP
  // -----------------------------------------------------------------------
  async runBackup(): Promise<BackupResult> {
    if (this.running) throw new AppError(409, 'BACKUP_ALREADY_RUNNING', 'Já existe um backup em andamento.');
    this.running = true;
    const startedAt = Date.now();

    try {
      const targetDir = await this.resolveTargetDir();
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
      const fileName = `${BACKUP_FILE_PREFIX}${timestamp}${BACKUP_FILE_EXT}`;
      const filePath = join(targetDir, fileName);

      logger.info('[Backup] Iniciando...', { targetDir, fileName });

      const dump = await this.dumpDatabase();
      const payload = Buffer.from(JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), tables: dump.tables }), 'utf8');

      const includeUploads = await settingsService.get<boolean>('backup_include_uploads');
      const uploadsPath = process.env.UPLOADS_PATH || '/app/uploads';
      const uploadsAvailable = includeUploads && existsSync(uploadsPath);

      const size = await new Promise<number>((resolvePromise, rejectPromise) => {
        const output = createWriteStream(filePath);
        const archive = archiver('zip', { zlib: { level: 9 } });
        let failed = false;

        const failWith = (err: Error) => {
          if (failed) return;
          failed = true;
          logger.error('[Backup] Erro no stream do arquivo', { error: err.message });
          archive.abort();
          output.destroy();
          rejectPromise(err);
        };

        output.on('close', () => {
          if (failed) return;
          resolvePromise(archive.pointer());
        });
        output.on('error', failWith);
        archive.on('error', failWith);
        archive.on('warning', (err: any) => {
          if (err?.code !== 'ENOENT') failWith(err);
          else logger.warn('[Backup] Arquivo ignorado (não encontrado)', { file: err.path });
        });

        archive.pipe(output);
        archive.append(payload, { name: 'database.json' });

        if (uploadsAvailable) {
          archive.directory(uploadsPath, 'uploads');
        } else {
          logger.warn('[Backup] Pasta de uploads não incluída', { uploadsPath, includeUploads });
        }

        archive.finalize().catch(failWith);
      });

      if (size === 0) throw new AppError(500, 'BACKUP_EMPTY', 'Backup gerado vazio (falha na compressão).');

      const durationMs = Date.now() - startedAt;
      logger.info('[Backup] Concluído', { fileName, sizeMB: (size / 1024 / 1024).toFixed(2), durationMs });
      this.lastRun = { at: new Date().toISOString(), file: fileName, size };

      const retention = Number(await settingsService.get<number>('backup_retention_days')) || 30;
      this.cleanup(retention).catch((e) => logger.error('[Backup] Falha na limpeza', { error: e.message }));

      return { file: fileName, path: filePath, size, tables: dump.tables.length, rows: dump.totalRows, durationMs };
    } finally {
      this.running = false;
    }
  }

  async runManual(): Promise<BackupResult> {
    logger.info('[Backup] Executado manualmente via API');
    return this.runBackup();
  }

  // -----------------------------------------------------------------------
  // Listagem / remoção / limpeza
  // -----------------------------------------------------------------------
  async list(): Promise<BackupFile[]> {
    const dir = await this.resolveTargetDir();
    return readdirSync(dir)
      .filter((f) => f.startsWith(BACKUP_FILE_PREFIX) && isBackupFileName(f))
      .map((f) => {
        const stats = statSync(join(dir, f));
        return { name: f, size: stats.size, createdAt: stats.mtime.toISOString() };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** Impede path traversal: só aceita o basename de um backup conhecido. */
  private async safePath(fileName: string): Promise<string> {
    const dir = await this.resolveTargetDir();
    const clean = basename(fileName);
    if (!clean.startsWith(BACKUP_FILE_PREFIX) || !isBackupFileName(clean)) {
      throw new AppError(400, 'INVALID_BACKUP_NAME', 'Nome de backup inválido.');
    }
    const full = resolve(join(dir, clean));
    if (!full.startsWith(dir + sep) && full !== dir) {
      throw new AppError(400, 'PATH_TRAVERSAL_DENIED', 'Caminho inválido.');
    }
    if (!existsSync(full)) throw new AppError(404, 'BACKUP_NOT_FOUND', 'Backup não encontrado.');
    return full;
  }

  async delete(fileName: string): Promise<void> {
    const full = await this.safePath(fileName);
    unlinkSync(full);
    logger.info('[Backup] Removido', { file: basename(full) });
  }

  async cleanup(retentionDays?: number): Promise<{ removed: number }> {
    const days = retentionDays ?? Number(await settingsService.get<number>('backup_retention_days')) ?? 30;
    const dir = await this.resolveTargetDir();
    const cutoff = Date.now() - days * 86_400_000;
    let removed = 0;

    for (const file of readdirSync(dir)) {
      if (!file.startsWith(BACKUP_FILE_PREFIX) || !isBackupFileName(file)) continue;
      const full = join(dir, file);
      if (statSync(full).mtimeMs < cutoff) {
        unlinkSync(full);
        removed++;
      }
    }
    logger.info('[Backup] Limpeza executada', { removed, retentionDays: days });
    return { removed };
  }

  /** Copia o backup selecionado para o compartilhamento de rede (env). */
  async sync(fileName: string): Promise<{ syncedTo: string }> {
    const full = await this.safePath(fileName);
    const networkPath = process.env.BACKUP_NETWORK_PATH;
    if (!networkPath) {
      throw new AppError(400, 'SYNC_NOT_CONFIGURED', 'BACKUP_NETWORK_PATH não está configurada no servidor.');
    }
    const dir = resolve(networkPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const target = join(dir, basename(full));
    if (resolve(dirname(full)) === dir) {
      return { syncedTo: target };
    }
    copyFileSync(full, target);
    logger.info('[Backup] Sincronizado para a rede', { target });
    return { syncedTo: target };
  }

  // -----------------------------------------------------------------------
  // Restauração (transacional)
  // -----------------------------------------------------------------------
  async restore(fileName: string): Promise<{ restoredTables: number; restoredRows: number }> {
    const full = await this.safePath(fileName);

    try {
      const dump = await this.readDatabaseJson(full);

      const client = new Client(this.pgConfig());
      try {
        await client.connect();
        await client.query('BEGIN');
        try {
          const existing = await client.query(
            `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`
          );
          const existingNames: string[] = existing.rows.map((r: any) => r.table_name);

          if (existingNames.length) {
            await client.query(`TRUNCATE TABLE ${existingNames.map((t) => `"${t}"`).join(', ')} CASCADE`);
          }

          const order = await this.dependencyOrder(client, dump.tables.map((t) => t.name));
          let restoredRows = 0;

          for (const tableName of order) {
            const table = dump.tables.find((t) => t.name === tableName);
            if (!table) continue;
            if (!existingNames.includes(tableName)) {
              logger.warn('[Backup] Tabela do backup não existe no schema atual - ignorada', { tableName });
              continue;
            }
            restoredRows += await this.insertRows(client, tableName, table.rows);
          }

          await client.query('COMMIT');
          await this.resetSequences(client);

          logger.info('[Backup] Restauração concluída', { tables: order.length, rows: restoredRows });
          return { restoredTables: order.length, restoredRows };
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      } finally {
        await client.end().catch((e) => logger.warn('[Backup] Falha ao fechar conexão de restore', { error: e.message }));
      }
    } catch (error: any) {
      logger.error('[Backup] Restauração falhou', { error: error.message });
      if (error instanceof AppError) throw error;
      throw new AppError(500, 'RESTORE_FAILED', `Falha ao restaurar: ${error.message}`);
    }
  }

  /** Extrai e valida o database.json de um .bkp (zip) — usado por restore/inspect. */
  private async readDatabaseJson(fullPath: string): Promise<{
    generatedAt?: string;
    tables: { name: string; rows: any[] }[];
  }> {
    const tempDir = mkdtempSync(join(tmpdir(), 'papatec-unzip-'));
    try {
      await new Promise<void>((res, rej) => {
        // Sem forceStream: com essa opção o unzipper NÃO emite o evento 'entry'
        // (empurra as entries pelo lado legível) e o listenner nunca dispara.
        const stream = createReadStream(fullPath).pipe(unzipper.Parse());
        let found = false;

        stream.on('entry', (entry: any) => {
          if (entry.path === 'database.json') {
            found = true;
            const chunks: Buffer[] = [];
            entry.on('data', (c: Buffer) => chunks.push(c));
            entry.on('error', rej);
            entry.on('end', () => {
              writeFileSync(join(tempDir, 'database.json'), Buffer.concat(chunks));
              res();
            });
          } else {
            entry.autodrain();
          }
        });
        stream.on('error', rej);
        stream.on('close', () => { if (!found) rej(new Error('database.json não encontrado no backup')); });
      });

      return JSON.parse(readFileSync(join(tempDir, 'database.json'), 'utf8'));
    } finally {
      try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }

  // -----------------------------------------------------------------------
  // Status / download / upload — tela "Recuperação do Sistema"
  // -----------------------------------------------------------------------
  /** Backup mais recente do servidor (servidor principal = fonte da verdade). */
  async latest(): Promise<{ name: string; path: string; size: number; createdAt: string } | null> {
    const files = await this.list();
    if (!files.length) return null;
    const newest = files[0];
    return { ...newest, path: join(await this.resolveTargetDir(), newest.name) };
  }

  /** Caminho validado de um .bkp (anti path-traversal) — usado no download. */
  async resolveFile(fileName: string): Promise<{ name: string; path: string; size: number }> {
    const full = await this.safePath(fileName);
    const stats = statSync(full);
    return { name: basename(full), path: full, size: stats.size };
  }

  /** Resumo de um .bkp (valida integridade + mostra de quando é o arquivo). */
  async inspect(fileName: string): Promise<{
    name: string;
    generatedAt: string | null;
    tables: number;
    rows: number;
    size: number;
  }> {
    const full = await this.safePath(fileName);
    const dump = await this.readDatabaseJson(full);
    const rows = (dump.tables || []).reduce((s, t) => s + (t.rows?.length || 0), 0);
    return {
      name: basename(full),
      generatedAt: dump.generatedAt || null,
      tables: (dump.tables || []).length,
      rows,
      size: statSync(full).size,
    };
  }

  /** Aceita um .bkp enviado pelo painel (ex.: de outra máquina) e valida. */
  async saveUpload(buffer: Buffer, originalName: string): Promise<{
    file: string;
    name: string;
    generatedAt: string | null;
    tables: number;
    rows: number;
    size: number;
  }> {
    if (!buffer?.length) throw new AppError(400, 'BACKUP_FILE_EMPTY', 'Arquivo vazio.');
    const dir = await this.resolveTargetDir();
    const base = basename(String(originalName || ''));
    if (!/\.(bkp|zip)$/i.test(base)) {
      throw new AppError(400, 'INVALID_BACKUP_FILE', 'Envie um arquivo .bkp gerado pelo sistema.');
    }
    const clean = base.startsWith(BACKUP_FILE_PREFIX) ? base : `${BACKUP_FILE_PREFIX}importado_${Date.now()}${BACKUP_FILE_EXT}`;
    const target = join(dir, clean);
    writeFileSync(target, buffer);
    try {
      const info = await this.inspect(clean);
      logger.info('[Backup] .bkp importado pelo painel', { file: clean, rows: info.rows });
      return { file: clean, ...info };
    } catch (error: any) {
      try { unlinkSync(target); } catch { /* ignore */ }
      if (error instanceof AppError) throw error;
      throw new AppError(400, 'INVALID_BACKUP_FILE', 'Arquivo corrompido: database.json não encontrado.');
    }
  }

  // -----------------------------------------------------------------------
  // Token das máquinas internas (script de cópia local .bkp)
  // -----------------------------------------------------------------------
  async getMachineToken(): Promise<string> {
    const existing = (await settingsService.get<string>('backup_machine_token')) || '';
    if (existing) return existing;
    return this.regenerateMachineToken();
  }

  async regenerateMachineToken(): Promise<string> {
    const token = randomBytes(24).toString('hex');
    await settingsService.set('backup_machine_token', token);
    logger.info('[Backup] Token das máquinas internas regenerado');
    return token;
  }

  async assertMachineToken(token: string): Promise<void> {
    const expected = (await settingsService.get<string>('backup_machine_token')) || '';
    const a = Buffer.from(String(token || ''));
    const b = Buffer.from(expected);
    if (!expected.length || a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new AppError(401, 'INVALID_MACHINE_TOKEN', 'Token de backup inválido.');
    }
  }

  private async insertRows(client: Client, table: string, rows: any[]): Promise<number> {
    if (!rows.length) return 0;
    const columns = Object.keys(rows[0]);

    // Colunas json/jsonb precisam de JSON.stringify explícito: sem isso o driver
    // do pg serializa arrays como literal de array do Postgres ("{...}") e o
    // banco acusa "invalid input syntax for type json".
    const colsInfo = await client.query(
      `SELECT column_name, udt_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`,
      [table]
    );
    const jsonCols = new Set<string>(
      colsInfo.rows
        .filter((r: any) => r.udt_name === 'json' || r.udt_name === 'jsonb')
        .map((r: any) => r.column_name)
    );

    const sql = `INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(', ')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')})`;

    for (const row of rows) {
      const values = columns.map((c) => {
        const v = row[c];
        if (jsonCols.has(c)) return v === undefined || v === null ? null : JSON.stringify(v);
        return this.normalizeValue(v);
      });
      await client.query(sql, values);
    }
    return rows.length;
  }

  private normalizeValue(value: any): any {
    if (value === undefined) return null;
    if (value instanceof Date) return value;
    if (Buffer.isBuffer(value)) return value;
    if (Array.isArray(value)) return value;
    if (typeof value === 'object' && value !== null) return JSON.stringify(value);
    return value;
  }

  /** Ordena tabelas por dependência (pai antes do filho). */
  private async dependencyOrder(client: Client, requested: string[]): Promise<string[]> {
    const result = await client.query(`
      SELECT tc.table_name AS child, ccu.table_name AS parent
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
    `);

    const set = new Set(requested);
    const inDegree = new Map<string, number>();
    const children = new Map<string, string[]>();

    for (const name of requested) inDegree.set(name, 0);
    for (const { child, parent } of result.rows) {
      if (!set.has(child) || !set.has(parent)) continue;
      if (child === parent) continue;
      children.set(parent, [...(children.get(parent) || []), child]);
      inDegree.set(child, (inDegree.get(child) || 0) + 1);
    }

    const queue = requested.filter((n) => (inDegree.get(n) || 0) === 0);
    const ordered: string[] = [];

    while (queue.length) {
      const node = queue.shift()!;
      ordered.push(node);
      for (const child of children.get(node) || []) {
        const deg = (inDegree.get(child) || 0) - 1;
        inDegree.set(child, deg);
        if (deg === 0) queue.push(child);
      }
    }

    // Ciclos (raro): adiciona o restante na ordem original
    for (const name of requested) if (!ordered.includes(name)) ordered.push(name);
    return ordered;
  }

  private async resetSequences(client: Client): Promise<void> {
    try {
      const result = await client.query(`
        SELECT c.relname AS "table", a.attname AS "column"
        FROM pg_class c
        JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'
          AND pg_get_serial_sequence(quote_ident(c.relname), a.attname) IS NOT NULL
      `).catch(() => ({ rows: [] as any[] }));

      for (const { table, column } of result.rows) {
        await client.query(
          `SELECT setval(pg_get_serial_sequence('"${table}"', '${column}'), COALESCE(MAX("${column}"), 1), true) FROM "${table}"`
        ).catch(() => undefined);
      }
    } catch {
      /* sequências não são críticas */
    }
  }

  /** Uso interno: garante que o diretório de uploads exista. */
  ensureUploadsDir(): string {
    const dir = process.env.UPLOADS_PATH || '/app/uploads';
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return dir;
  }
}

export const backupService = new BackupService();
