import { prisma } from '../db/prisma';
import { AppError } from '../http/envelope';
import { logger } from '../utils/logger';

export type SettingCategory = 'GENERAL' | 'COMPANY' | 'FINANCIAL' | 'LABOR' | 'BACKUP' | 'SYSTEM' | 'SCHEDULE';

export interface SettingDefinition {
  key: string;
  value: any;
  category: SettingCategory;
  label: string;
  type: 'string' | 'number' | 'boolean';
}

/**
 * Catálogo de configurações do sistema.
 * Qualquer chave fora desta lista é rejeitada (evita poluição do banco).
 */
export const SETTING_DEFINITIONS: SettingDefinition[] = [
  // COMPANY
  // Valores tirados dos modelos de PDF que o cliente forneceu (abertura,
  // fechamento e orcamento). Antes estes dados so existiam DENTRO dos PDFs:
  // a impressao da O.S. saia com cabecalho generico, sem contato nenhum.
  { key: 'company_name', value: 'PAPATEC INFORMÁTICA E TECNOLOGIA LTDA', category: 'COMPANY', label: 'Nome da empresa', type: 'string' },
  { key: 'company_phone', value: '(19) 3426-8000', category: 'COMPANY', label: 'Telefone', type: 'string' },
  { key: 'company_whatsapp', value: '(19) 9 9994-1818', category: 'COMPANY', label: 'WhatsApp', type: 'string' },
  { key: 'company_email', value: 'comercial@papatec.com.br', category: 'COMPANY', label: 'E-mail principal', type: 'string' },
  { key: 'company_emails_extra', value: 'contato@papatec.com.br / financeiro@papatec.com.br', category: 'COMPANY', label: 'Outros e-mails (rodapé)', type: 'string' },
  { key: 'company_site', value: 'WWW.PAPATEC.COM.BR', category: 'COMPANY', label: 'Site', type: 'string' },
  { key: 'company_address', value: 'Rua Ipiranga, 2190 - Bairro Centro - Piracicaba', category: 'COMPANY', label: 'Endereço', type: 'string' },
  { key: 'company_document', value: '04.041.097/0001-31', category: 'COMPANY', label: 'CNPJ', type: 'string' },
  { key: 'receipt_footer', value: 'Obrigado pela preferência!', category: 'COMPANY', label: 'Rodapé de recibo', type: 'string' },
  // Textos fixos que aparecem nas vias impressas ( vindos dos modelos )
  { key: 'os_declaration_text', value: 'Declaro assumir qualquer responsabilidade, Fiscal, Software e Propriedade sobre o equipamento nas condições acima descrito. Orçamento aprovado ou reprovado deverá ser retirado no prazo máximo de 90 dias ou será vendido para cobrir os devidos custos.', category: 'COMPANY', label: 'Texto da declaração (via de abertura)', type: 'string' },
  { key: 'os_pickup_note', value: 'OBSERVAÇÃO: O Equipamento deverá ser retirado no prazo máximo de 90 dias, caso contrário o mesmo será vendido p/ cobrir as despesas.', category: 'COMPANY', label: 'Observação da retirada (via de equipamento)', type: 'string' },
  { key: 'os_pickup_terms', value: 'Declaro que o meu equipamento foi testado em minha presença e que o retirei com os mesmos Acessórios e Conservação acima descrito.', category: 'COMPANY', label: 'Declaração de retirada (via de fechamento)', type: 'string' },

  // FINANCIAL
  { key: 'default_labor_rate', value: 80, category: 'FINANCIAL', label: 'Valor/hora de mão de obra (R$)', type: 'number' },
  { key: 'default_warranty_days', value: 90, category: 'FINANCIAL', label: 'Garantia padrão (dias)', type: 'number' },
  { key: 'budget_validity_days', value: 30, category: 'FINANCIAL', label: 'Validade do orçamento (dias)', type: 'number' },
  { key: 'low_stock_threshold', value: 1, category: 'FINANCIAL', label: 'Alerta de estoque mínimo (un)', type: 'number' },
  { key: 'profit_margin_pct', value: 30, category: 'FINANCIAL', label: 'Margem de lucro padrão (%)', type: 'number' },
  // Briefing B3: teto global de desconto por item (% do valor do item)
  // 100 = sem restrição global (o limite por peça continua valendo)
  { key: 'max_discount_pct', value: 100, category: 'FINANCIAL', label: 'Desconto máximo global por item (%)', type: 'number' },

  // LABOR
  { key: 'default_labor_hours', value: 1, category: 'LABOR', label: 'Horas de mão de obra padrão', type: 'number' },

  // SCHEDULE — horário comercial da agenda de visitas (configurável)
  { key: 'business_hour_start', value: '08:00', category: 'SCHEDULE', label: 'Início do horário comercial (HH:MM)', type: 'string' },
  { key: 'business_hour_end', value: '18:00', category: 'SCHEDULE', label: 'Fim do horário comercial (HH:MM)', type: 'string' },
  { key: 'schedule_slot_minutes', value: 30, category: 'SCHEDULE', label: 'Intervalo entre horários (min)', type: 'number' },
  { key: 'schedule_default_duration_minutes', value: 60, category: 'SCHEDULE', label: 'Duração padrão da visita (min)', type: 'number' },

  // BACKUP
  { key: 'backup_path', value: '', category: 'BACKUP', label: 'Caminho de destino dos backups', type: 'string' },
  { key: 'backup_schedule', value: '0 12,18 * * *', category: 'BACKUP', label: 'Agendamento (cron)', type: 'string' },
  { key: 'backup_retention_days', value: 30, category: 'BACKUP', label: 'Retenção de backups (dias)', type: 'number' },
  { key: 'backup_include_uploads', value: true, category: 'BACKUP', label: 'Incluir pasta de uploads', type: 'boolean' },
  // On-time: qualquer alteração mínima no sistema já deixa o .bkp 1:1
  { key: 'backup_realtime', value: true, category: 'BACKUP', label: 'Backup em tempo real (a cada alteração)', type: 'boolean' },
  // Token das máquinas internas — o script local puxa o .bkp com ele
  { key: 'backup_machine_token', value: '', category: 'BACKUP', label: 'Token das máquinas internas (cópia local)', type: 'string' },

  // SYSTEM
  { key: 'allow_self_registration', value: false, category: 'SYSTEM', label: 'Permitir auto-cadastro', type: 'boolean' },
  { key: 'session_days', value: 7, category: 'SYSTEM', label: 'Dias de validade da sessão', type: 'number' },
];

const DEFINITIONS_MAP = new Map(SETTING_DEFINITIONS.map((d) => [d.key, d]));

export class SettingsService {
  /** Retorna todas as configurações (default + sobrescritas no banco). */
  async getAll(): Promise<Record<string, any>> {
    const rows = await prisma.setting.findMany();
    const stored = new Map(rows.map((r) => [r.key, r.value]));
    const result: Record<string, any> = {};
    for (const def of SETTING_DEFINITIONS) {
      const override = stored.get(def.key);
      result[def.key] = override === undefined || override === null ? def.value : override;
    }
    return result;
  }

  async getByCategory(category: string): Promise<Record<string, any>> {
    const all = await this.getAll();
    const result: Record<string, any> = {};
    for (const def of SETTING_DEFINITIONS) {
      if (def.category === category) result[def.key] = all[def.key];
    }
    return result;
  }

  /** Retorna o catálogo (labels/categorias) para a UI montar o painel. */
  getCatalog(): SettingDefinition[] {
    return SETTING_DEFINITIONS;
  }

  async get<T = any>(key: string): Promise<T> {
    const def = DEFINITIONS_MAP.get(key);
    if (!def) throw new AppError(400, 'UNKNOWN_SETTING', `Configuração desconhecida: ${key}`);
    const row = await prisma.setting.findUnique({ where: { key } });
    return (row?.value ?? def.value) as T;
  }

  async set(key: string, value: any): Promise<{ key: string; value: any }> {
    const def = DEFINITIONS_MAP.get(key);
    if (!def) throw new AppError(400, 'UNKNOWN_SETTING', `Configuração desconhecida: ${key}`);

    const coerced = this.coerce(def, value);

    await prisma.setting.upsert({
      where: { key },
      create: { key, value: coerced, category: def.category },
      update: { value: coerced, category: def.category, updatedAt: new Date() },
    });

    logger.info('Configuração atualizada', { key, value: coerced });

    // Reconfigura o cron de backup caso a agenda tenha mudado
    if (key === 'backup_schedule') {
      const { backupService } = await import('./backup.service');
      backupService.reschedule();
    }

    return { key, value: coerced };
  }

  async setMany(settings: Record<string, any>): Promise<{ key: string; value: any }[]> {
    const results: { key: string; value: any }[] = [];
    for (const [key, value] of Object.entries(settings)) {
      if (DEFINITIONS_MAP.has(key)) {
        results.push(await this.set(key, value));
      } else {
        logger.warn('Configuração ignorada (desconhecida)', { key });
      }
    }
    return results;
  }

  /** Garante que todas as chaves existam no banco (usado no boot). */
  async ensureDefaults(): Promise<void> {
    for (const def of SETTING_DEFINITIONS) {
      await prisma.setting.upsert({
        where: { key: def.key },
        create: { key: def.key, value: def.value, category: def.category },
        update: {},
      });
    }
    logger.info('Configurações padrão inicializadas');
  }

  /** Caminho absoluto de destino dos backups (UI > env > padrão). */
  async getBackupPath(): Promise<string> {
    const configured = await this.get<string>('backup_path');
    if (configured && configured.trim()) return configured.trim();
    return process.env.BACKUP_NETWORK_PATH || '/backups';
  }

  async getBackupSchedule(): Promise<string> {
    const configured = await this.get<string>('backup_schedule');
    return configured?.trim() || process.env.BACKUP_SCHEDULE || '0 12,18 * * *';
  }

  async getDefaultLaborRate(): Promise<number> {
    return Number(await this.get<number>('default_labor_rate')) || 80;
  }

  /**
   * Horário comercial da agenda de visitas.
   * Valores vêm de Configurações; aqui há saneamento para que um valor
   * digitado errado (ex.: "25:99" ou passo de 1 minuto) nunca consiga
   * travar o agendamento.
   */
  async getSchedule(): Promise<{
    start: string;
    end: string;
    slotMinutes: number;
    defaultDurationMinutes: number;
  }> {
    const [rawStart, rawEnd, rawSlot, rawDuration] = await Promise.all([
      this.get<string>('business_hour_start'),
      this.get<string>('business_hour_end'),
      this.get<number>('schedule_slot_minutes'),
      this.get<number>('schedule_default_duration_minutes'),
    ]);

    const hhmm = (value: any, fallback: string): string => {
      const s = String(value ?? '').trim();
      const m = /^(\d{1,2}):(\d{2})$/.exec(s);
      if (!m) return fallback;
      const h = Number(m[1]);
      const min = Number(m[2]);
      if (h > 23 || min > 59) return fallback;
      return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
    };

    const start = hhmm(rawStart, '08:00');
    const end = hhmm(rawEnd, '18:00');

    return {
      start,
      // Garante pelo menos 30 min de janela para não gerar lista vazia
      end: end <= start ? '18:00' : end,
      slotMinutes: Math.max(5, Math.min(480, Number(rawSlot) || 30)),
      defaultDurationMinutes: Math.max(5, Math.min(24 * 60, Number(rawDuration) || 60)),
    };
  }

  private coerce(def: SettingDefinition, value: any): any {
    if (value === null || value === undefined) return def.value;
    switch (def.type) {
      case 'number': {
        const n = Number(value);
        if (Number.isNaN(n)) {
          throw new AppError(400, 'INVALID_SETTING', `${def.label}: valor numérico inválido.`);
        }
        return n;
      }
      case 'boolean':
        if (typeof value === 'boolean') return value;
        if (value === 'true' || value === '1' || value === 1) return true;
        if (value === 'false' || value === '0' || value === 0) return false;
        throw new AppError(400, 'INVALID_SETTING', `${def.label}: valor booleano inválido.`);
      default: {
        if (typeof value === 'object') return JSON.stringify(value);
        return String(value);
      }
    }
  }
}

export const settingsService = new SettingsService();
