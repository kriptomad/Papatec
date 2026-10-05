import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box, Card, CardContent, Typography, Grid, Alert, CircularProgress, Tabs, Tab, TextField,
  Divider, Switch, FormControlLabel, TableContainer, Table, TableHead, TableBody, TableRow,
  TableCell, IconButton, Tooltip, Chip, MenuItem, Select, InputLabel, FormControl, Dialog,
  DialogTitle, DialogContent, DialogActions, Skeleton, InputAdornment,
} from '@mui/material';
import {
  Add, Delete, Edit, Refresh, CloudUpload, Restore, Sync, ContentCopy, Build, Save,
  People, Inventory2, AttachMoney, PlayArrow, Pause, Search, SwapHoriz,
  Download, FolderOpen, UploadFile,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  settingsApi, backupApi, inventoryApi, reportsApi, servicesApi, expensesApi, usersApi,
} from '../../services/api';
import { PrimaryButton, SecondaryButton, DangerButton } from '../../components/ui/Buttons';
import { formatCurrency, formatDate } from '../../utils/formatters';

const TAB_LABELS = [
  'Empresa', 'Padrões', 'Backup e Recuperação', 'Inventário', 'Serviços', 'Financeiro', 'Usuários',
];

const EXPENSE_CATEGORIES = [
  { value: 'RENT', label: 'Aluguel' },
  { value: 'ENERGY', label: 'Energia' },
  { value: 'SALARIES', label: 'Salários' },
  { value: 'MATERIALS', label: 'Materiais' },
  { value: 'MARKETING', label: 'Marketing' },
  { value: 'TAXES', label: 'Impostos' },
  { value: 'OTHER', label: 'Outros' },
];

const SERVICE_CATEGORIES = [
  'HARDWARE', 'SOFTWARE', 'MAINTENANCE', 'NETWORK', 'DATA_RECOVERY', 'INSTALLATION', 'OTHER',
];

const USER_ROLES = [
  { value: 'ADMIN', label: 'Administrador' },
  { value: 'TECHNICIAN', label: 'Técnico' },
  { value: 'RECEPTIONIST', label: 'Recepção' },
];

type SettingDef = { key: string; label: string; category: string; type: string; value: any };

/** Formulário de item de estoque (adicionar/editar). */
const EMPTY_ITEM_FORM = {
  code: '',
  name: '',
  category: '',
  description: '',
  unit: 'UN',
  quantity: 0,
  minStock: 1,
  costPrice: 0,
  salePrice: 0,
  supplier: '',
  location: '',
  status: 'ACTIVE',
};

export function SettingsPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState(0);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const { data: settings, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: () => settingsApi.getAll(),
  });

  const { data: catalog } = useQuery({
    queryKey: ['settingsCatalog'],
    queryFn: () => settingsApi.getCatalog(),
  });

  const [draft, setDraft] = useState<Record<string, any>>({});

  useEffect(() => {
    if (settings) setDraft((prev) => ({ ...settings, ...prev }));
  }, [settings]);

  const setField = (key: string, value: any) => setDraft((prev) => ({ ...prev, [key]: value }));

  const flash = (msg: string) => { setSuccess(msg); setTimeout(() => setSuccess(''), 4000); };

  const saveMutation = useMutation({
    mutationFn: (payload: Record<string, any>) => settingsApi.updateMany(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      queryClient.invalidateQueries({ queryKey: ['backupConfig'] });
      flash('Configurações salvas com sucesso!');
    },
    onError: (err: any) => setError(err.response?.data?.message || 'Erro ao salvar configurações'),
  });

  /** Monta o payload apenas com as chaves da categoria informada, com o tipo correto. */
  const saveCategory = (categories: string[]) => {
    const defs: SettingDef[] = (catalog || []).filter((d: SettingDef) => categories.includes(d.category));
    const payload: Record<string, any> = {};
    for (const def of defs) {
      const raw = draft[def.key];
      if (raw === undefined || raw === null) continue;
      if (def.type === 'number') payload[def.key] = Number(raw) || 0;
      else if (def.type === 'boolean') payload[def.key] = !!raw;
      else payload[def.key] = String(raw);
    }
    if (Object.keys(payload).length === 0) {
      setError('Nenhum campo para salvar nesta aba.');
      return;
    }
    setError('');
    saveMutation.mutate(payload);
  };

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3, flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography variant="h4" fontWeight={700} sx={{ mb: 0.5 }}>Painel do Administrador</Typography>
          <Typography variant="body1" color="text.secondary">
            Configurações gerais, backup, inventário, serviços, financeiro e usuários
          </Typography>
        </Box>
        <SecondaryButton
          startIcon={<Refresh />}
          onClick={() => queryClient.invalidateQueries({ queryKey: ['settings'] })}
        >
          Recarregar
        </SecondaryButton>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 3 }} onClose={() => setSuccess('')}>{success}</Alert>}

      <Tabs value={activeTab} onChange={(_, v) => setActiveTab(v)} sx={{ mb: 3 }} variant="scrollable" allowScrollButtonsMobile>
        {TAB_LABELS.map((label) => <Tab key={label} label={label} />)}
      </Tabs>

      {/* ---------------------------------------------------------------- Empresa */}
      {activeTab === 0 && (
        <Grid container spacing={3}>
          <Grid item xs={12} md={8}>
            <Card>
              <CardContent>
                <Typography variant="h6" sx={{ mb: 3 }}>Dados da Empresa</Typography>
                <Grid container spacing={3}>
                  <Grid item xs={12} sm={6}>
                    <TextField fullWidth label="Nome da Empresa" value={draft.company_name ?? ''}
                      onChange={(e) => setField('company_name', e.target.value)} />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField fullWidth label="CNPJ" value={draft.company_document ?? ''}
                      onChange={(e) => setField('company_document', e.target.value)} />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField fullWidth label="Telefone" value={draft.company_phone ?? ''}
                      onChange={(e) => setField('company_phone', e.target.value)} />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField fullWidth label="E-mail" type="email" value={draft.company_email ?? ''}
                      onChange={(e) => setField('company_email', e.target.value)} />
                  </Grid>
                  <Grid item xs={12}>
                    <TextField fullWidth label="Endereço" multiline rows={2} value={draft.company_address ?? ''}
                      onChange={(e) => setField('company_address', e.target.value)} />
                  </Grid>
                  <Grid item xs={12}>
                    <TextField fullWidth label="Rodapé de recibo" value={draft.receipt_footer ?? ''}
                      onChange={(e) => setField('receipt_footer', e.target.value)} />
                  </Grid>
                  <Grid item xs={12} sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <PrimaryButton startIcon={<Save />} loading={saveMutation.isPending}
                      onClick={() => saveCategory(['COMPANY'])}>
                      Salvar Dados da Empresa
                    </PrimaryButton>
                  </Grid>
                </Grid>
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={12} md={4}>
            <Card>
              <CardContent>
                <Typography variant="h6" sx={{ mb: 2 }}>Sistema</Typography>
                <InfoRow label="Produto" value="Papatec" />
                <InfoRow label="Versão" value="1.0.0" />
                <InfoRow label="Ambiente" value={import.meta.env.MODE} />
                <InfoRow label="API" value={import.meta.env.VITE_API_URL || '/api'} mono />
                <InfoRow label="Build" value={new Date().toISOString().split('T')[0]} />
                <Divider sx={{ my: 2 }} />
                <SecondaryButton fullWidth color="warning"
                  onClick={() => { if (window.confirm('Limpar cache local (React Query)?')) { queryClient.clear(); flash('Cache limpo.'); } }}>
                  Limpar Cache Local
                </SecondaryButton>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}

      {/* ---------------------------------------------------------------- Padrões */}
      {activeTab === 1 && (
        <Card>
          <CardContent>
            <Typography variant="h6" sx={{ mb: 1 }}>Valores Padrão</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              Usados automaticamente em novos orçamentos, OS e alertas de estoque.
            </Typography>
            <Grid container spacing={3}>
              <Grid item xs={12} sm={6} md={4}>
                <TextField fullWidth label="Valor/hora de mão de obra (R$)" type="number"
                  value={draft.default_labor_rate ?? 0} InputProps={{ startAdornment: <InputAdornment position="start">R$</InputAdornment> }}
                  onChange={(e) => setField('default_labor_rate', e.target.value)} />
              </Grid>
              <Grid item xs={12} sm={6} md={4}>
                <TextField fullWidth label="Horas de mão de obra padrão" type="number"
                  value={draft.default_labor_hours ?? 1}
                  onChange={(e) => setField('default_labor_hours', e.target.value)} />
              </Grid>
              <Grid item xs={12} sm={6} md={4}>
                <TextField fullWidth label="Garantia padrão (dias)" type="number"
                  value={draft.default_warranty_days ?? 90}
                  onChange={(e) => setField('default_warranty_days', e.target.value)} />
              </Grid>
              <Grid item xs={12} sm={6} md={4}>
                <TextField fullWidth label="Validade do orçamento (dias)" type="number"
                  value={draft.budget_validity_days ?? 30}
                  onChange={(e) => setField('budget_validity_days', e.target.value)} />
              </Grid>
              <Grid item xs={12} sm={6} md={4}>
                <TextField fullWidth label="Alerta de estoque mínimo (un)" type="number"
                  value={draft.low_stock_threshold ?? 1}
                  onChange={(e) => setField('low_stock_threshold', e.target.value)} />
              </Grid>
              <Grid item xs={12} sm={6} md={4}>
                <TextField fullWidth label="Margem de lucro padrão (%)" type="number"
                  value={draft.profit_margin_pct ?? 30}
                  onChange={(e) => setField('profit_margin_pct', e.target.value)} />
              </Grid>
              {/* Existia no catálogo do backend mas NÃO tinha campo aqui — o valor
                  nunca saía de 100 (= sem restrição) e o desconto era ilimitado. */}
              <Grid item xs={12} sm={6} md={4}>
                <TextField fullWidth type="number" label="Desconto máximo por item (%)"
                  value={draft.max_discount_pct ?? 100}
                  inputProps={{ min: 0, max: 100 }}
                  onChange={(e) => setField('max_discount_pct', e.target.value)}
                  helperText="0 = sem desconto · 100 = sem restrição. Vale para O.S., orçamentos e vendas." />
              </Grid>
              <Grid item xs={12} sm={6} md={4}>
                <TextField fullWidth label="Dias de validade da sessão" type="number"
                  value={draft.session_days ?? 7}
                  onChange={(e) => setField('session_days', e.target.value)} />
              </Grid>
              <Grid item xs={12}>
                <FormControlLabel
                  control={<Switch checked={draft.allow_self_registration === true || draft.allow_self_registration === 'true'}
                    onChange={(e) => setField('allow_self_registration', e.target.checked)} />}
                  label="Permitir auto-cadastro de usuários"
                />
              </Grid>

              {/* ---------------------------------------------------------- SCHEDULE
                  Horário comercial da agenda de visitas: define quais slots o
                  popup de agendamento oferece e a duração padrão ("Tempo
                  Serviço") quando o vendedor não informa. */}
              <Grid item xs={12}>
                <Divider sx={{ mb: 1 }} />
                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                  Agenda de visitas
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Define os horários oferecidos no agendamento e a duração padrão da visita.
                </Typography>
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <TextField fullWidth type="time" label="Início do expediente"
                  value={draft.business_hour_start ?? '08:00'} InputLabelProps={{ shrink: true }}
                  onChange={(e) => setField('business_hour_start', e.target.value)} />
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <TextField fullWidth type="time" label="Fim do expediente"
                  value={draft.business_hour_end ?? '18:00'} InputLabelProps={{ shrink: true }}
                  onChange={(e) => setField('business_hour_end', e.target.value)} />
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <TextField fullWidth type="number" label="Intervalo entre horários (min)"
                  value={draft.schedule_slot_minutes ?? 30}
                  onChange={(e) => setField('schedule_slot_minutes', e.target.value)} />
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <TextField fullWidth type="number" label="Duração padrão da visita (min)"
                  value={draft.schedule_default_duration_minutes ?? 60}
                  onChange={(e) => setField('schedule_default_duration_minutes', e.target.value)} />
              </Grid>

              <Grid item xs={12} sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                <PrimaryButton startIcon={<Save />} loading={saveMutation.isPending}
                  onClick={() => saveCategory(['FINANCIAL', 'LABOR', 'SYSTEM', 'SCHEDULE'])}>
                  Salvar Padrões
                </PrimaryButton>
              </Grid>
            </Grid>
          </CardContent>
        </Card>
      )}

      {/* ---------------------------------------------------------------- Backup */}
      {activeTab === 2 && (
        <BackupTab draft={draft} setField={setField} onSave={() => saveCategory(['BACKUP'])}
          saving={saveMutation.isPending} onError={setError} onFlash={flash} />
      )}

      {/* ---------------------------------------------------------------- Inventário */}
      {activeTab === 3 && <InventoryTab onError={setError} onFlash={flash} />}

      {/* ---------------------------------------------------------------- Serviços */}
      {activeTab === 4 && <ServicesTab onError={setError} onFlash={flash} />}

      {/* ---------------------------------------------------------------- Financeiro */}
      {activeTab === 5 && <FinancialTab onError={setError} onFlash={flash} />}

      {/* ---------------------------------------------------------------- Usuários */}
      {activeTab === 6 && <UsersTab onError={setError} onFlash={flash} />}
    </Box>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: any; mono?: boolean }) {
  return (
    <Box sx={{ mb: 1.5 }}>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography variant="body2" fontWeight={600} sx={mono ? { fontFamily: 'monospace', fontSize: '0.8rem', wordBreak: 'break-all' } : undefined}>
        {value}
      </Typography>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// File System Access API — cópia local em C:\Users\<usuário>\Documents\Backup
// ---------------------------------------------------------------------------
type DirHandleLike = {
  name: string;
  queryPermission?: (d: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (d: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
  getFileHandle: (name: string, opts?: { create?: boolean }) => Promise<any>;
};

const LOCAL_BKP_NAME = 'papatec_backup.bkp';
const LOCAL_BACKUP_FLAG = 'papatec-local-backup';

function saveBlobAs(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function idbOpen(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('papatec-backup', 1);
    req.onupgradeneeded = () => { req.result.createObjectStore('handles'); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(key: string, value: any): Promise<void> {
  const db = await idbOpen();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('handles', 'readwrite');
    tx.objectStore('handles').put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGet(key: string): Promise<any> {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('handles', 'readonly');
    const req = tx.objectStore('handles').get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function idbDel(key: string): Promise<void> {
  const db = await idbOpen();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('handles', 'readwrite');
    tx.objectStore('handles').delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

declare global {
  interface Window {
    showDirectoryPicker?: (opts?: { mode?: 'read' | 'readwrite'; id?: string; startIn?: string }) => Promise<DirHandleLike>;
  }
}

// ===========================================================================
// ABA BACKUP E RECUPERAÇÃO
// ===========================================================================
function BackupTab({
  draft, setField, onSave, saving, onError, onFlash,
}: {
  draft: Record<string, any>;
  setField: (k: string, v: any) => void;
  onSave: () => void;
  saving: boolean;
  onError: (m: string) => void;
  onFlash: (m: string) => void;
}) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState('');
  const [uploaded, setUploaded] = useState<{
    file: string; name: string; generatedAt: string | null; tables: number; rows: number; size: number;
  } | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Cópia desta máquina (File System Access API)
  const [dirHandle, setDirHandle] = useState<DirHandleLike | null>(null);
  const [permState, setPermState] = useState<PermissionState | null>(null);
  const [autoSave, setAutoSave] = useState(() => localStorage.getItem(LOCAL_BACKUP_FLAG) === '1');
  const [lastLocalAt, setLastLocalAt] = useState<string | null>(null);
  const syncedRef = useRef<string | null>(null);
  const syncingRef = useRef(false);

  const { data: files, isLoading: loadingFiles } = useQuery({
    queryKey: ['backups'],
    queryFn: () => backupApi.list(),
  });

  const { data: effectivePath } = useQuery({
    queryKey: ['backupListInfo'],
    queryFn: () => backupApi.getConfig(),
  });

  // Status on-time (último dump) — observado a cada 5s enquanto a aba está aberta
  const { data: status } = useQuery({
    queryKey: ['backupStatus'],
    queryFn: () => backupApi.status(),
    refetchInterval: 5000,
  });

  const { data: tokenData } = useQuery({
    queryKey: ['backupToken'],
    queryFn: () => backupApi.getToken(),
  });

  const run = async (label: string, fn: () => Promise<any>, done: (r: any) => string) => {
    setBusy(label);
    onError('');
    try {
      const result = await fn();
      onFlash(done(result));
      queryClient.invalidateQueries({ queryKey: ['backups'] });
    } catch (err: any) {
      onError(err.response?.data?.message || 'Falha na operação de backup');
    } finally {
      setBusy('');
    }
  };

  // --- Recupera a pasta escolhida e a permissão salvas (IndexedDB) ---------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const handle = await idbGet('dir');
        if (!handle || cancelled) return;
        setDirHandle(handle);
        const perm = handle.queryPermission ? await handle.queryPermission({ mode: 'readwrite' }) : 'denied';
        if (!cancelled) setPermState(perm);
      } catch { /* sem suporte ao recurso */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // --- On-time nesta máquina: a cada novo dump do servidor, grava 1:1 ------
  useEffect(() => {
    const lastRun = status?.lastRunAt;
    if (!lastRun || !autoSave || permState !== 'granted' || !dirHandle || !status?.lastFile) return;
    if (syncedRef.current === lastRun || syncingRef.current) return;
    syncingRef.current = true;
    (async () => {
      try {
        const { blob } = await backupApi.downloadBlob(status.lastFile as string);
        const fh = await dirHandle.getFileHandle(LOCAL_BKP_NAME, { create: true });
        const writer = await fh.createWritable();
        await writer.write(blob);
        await writer.close();
        syncedRef.current = lastRun;
        setLastLocalAt(new Date().toISOString());
      } catch (err) {
        console.warn('[Backup local] falha ao gravar na pasta', err);
      } finally {
        syncingRef.current = false;
      }
    })();
  }, [status?.lastRunAt, status?.lastFile, autoSave, permState, dirHandle]);

  const supportsFsAccess = !!window.showDirectoryPicker;

  const pickFolder = async () => {
    if (!window.showDirectoryPicker) {
      onError('Este navegador não suporta gravação automática em pasta. Use “Baixar .bkp” ou o instalador por script.');
      return;
    }
    try {
      const handle = await window.showDirectoryPicker({ id: 'papatec-backup', mode: 'readwrite', startIn: 'documents' });
      const perm = handle.requestPermission ? await handle.requestPermission({ mode: 'readwrite' }) : 'denied';
      if (perm !== 'granted') { onError('Permissão negada para gravar na pasta escolhida.'); return; }
      await idbPut('dir', handle);
      setDirHandle(handle);
      setPermState(perm);
      setAutoSave(true);
      localStorage.setItem(LOCAL_BACKUP_FLAG, '1');
      onFlash(`Pasta "${handle.name}" conectada — cópias locais on-time ativadas.`);
    } catch { /* usuário cancelou o diálogo */ }
  };

  const reactivate = async () => {
    if (!dirHandle?.requestPermission) return;
    try {
      const perm = await dirHandle.requestPermission({ mode: 'readwrite' });
      setPermState(perm);
      if (perm === 'granted') onFlash('Acesso à pasta reativado.');
    } catch { /* permissão não concedida */ }
  };

  const disconnectFolder = async () => {
    await idbDel('dir');
    setDirHandle(null);
    setPermState(null);
    setAutoSave(false);
    localStorage.setItem(LOCAL_BACKUP_FLAG, '0');
    onFlash('Cópia local desligada.');
  };

  const toggleAutoSave = (value: boolean) => {
    setAutoSave(value);
    localStorage.setItem(LOCAL_BACKUP_FLAG, value ? '1' : '0');
    if (value && permState !== 'granted') onFlash('Conecte uma pasta para gravar as cópias locais.');
  };

  const downloadLatest = async () => {
    setBusy('download'); onError('');
    try {
      if (!status?.lastFile) throw new Error('Nenhum backup gerado no servidor ainda.');
      const { blob, name } = await backupApi.downloadBlob(status.lastFile);
      saveBlobAs(blob, name);
      onFlash('Download do .bkp iniciado.');
    } catch (err: any) {
      onError(err.response?.data?.message || err.message || 'Falha no download do backup');
    } finally { setBusy(''); }
  };

  const saveLocalNow = async () => {
    setBusy('local'); onError('');
    try {
      if (permState !== 'granted' || !dirHandle) throw new Error('Conecte uma pasta primeiro.');
      if (!status?.lastFile) throw new Error('Nenhum backup gerado no servidor ainda.');
      const { blob } = await backupApi.downloadBlob(status.lastFile);
      const fh = await dirHandle.getFileHandle(LOCAL_BKP_NAME, { create: true });
      const writer = await fh.createWritable();
      await writer.write(blob);
      await writer.close();
      syncedRef.current = status.lastRunAt || null;
      setLastLocalAt(new Date().toISOString());
      onFlash('Cópia gravada em Documents\\Backup\\' + LOCAL_BKP_NAME);
    } catch (err: any) {
      onError(err.response?.data?.message || err.message || 'Falha ao gravar a cópia local');
    } finally { setBusy(''); }
  };

  const onFileChosen = async (file: File) => {
    setUploading(true); onError(''); setUploaded(null);
    try {
      const info = await backupApi.upload(file);
      setUploaded(info);
      onFlash(`Arquivo validado: ${info.tables} tabelas / ${info.rows} linhas.`);
      queryClient.invalidateQueries({ queryKey: ['backups'] });
    } catch (err: any) {
      onError(err.response?.data?.message || 'Arquivo .bkp inválido ou corrompido');
    } finally { setUploading(false); }
  };

  const restoreUploaded = () => {
    if (!uploaded) return;
    if (!window.confirm(`ATENÇÃO: restaurar "${uploaded.name}" SOBRESCREVE TODOS os dados atuais do sistema. Continuar?`)) return;
    run('restore', () => backupApi.restore(uploaded.file), (r: any) => {
      queryClient.invalidateQueries({ queryKey: ['backupStatus'] });
      return `Sistema restaurado (${r?.restoredRows ?? 0} linhas em ${r?.restoredTables ?? 0} tabelas)`;
    });
  };

  const copyToken = async () => {
    try {
      await navigator.clipboard.writeText(tokenData?.token || '');
      onFlash('Token copiado.');
    } catch { onError('Não foi possível copiar o token.'); }
  };

  const downloadInstaller = async () => {
    setBusy('script'); onError('');
    try {
      if (!tokenData?.token) throw new Error('Token indisponível.');
      const res = await fetch('/scripts/papatec-backup-local.ps1');
      if (!res.ok) throw new Error('Instalador não encontrado no servidor.');
      let text = await res.text();
      text = text.split('__API_BASE__').join(window.location.origin + '/api');
      text = text.split('__TOKEN__').join(tokenData.token);
      saveBlobAs(new Blob([text], { type: 'text/plain;charset=utf-8' }), 'papatec-backup-local.ps1');
      onFlash('Instalador gerado — execute-o 1x nesta máquina (como administrador).');
    } catch (err: any) {
      onError(err.message || 'Falha ao gerar o instalador');
    } finally { setBusy(''); }
  };

  return (
    <Grid container spacing={3}>
      {/* ------------------------------------------ Status on-time (1:1) */}
      <Grid item xs={12}>
        <Card>
          <CardContent>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <Typography variant="h6">Backup On-Time (1:1)</Typography>
                {status?.realtime
                  ? <Chip size="small" color="success" label="Tempo real ativo" />
                  : <Chip size="small" label="Tempo real desligado" />}
                {status?.dirty ? <Chip size="small" color="warning" label="Gerando dump…" /> : null}
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
                <FormControlLabel
                  control={<Switch
                    checked={draft.backup_realtime === true || draft.backup_realtime === 'true'}
                    onChange={(e) => setField('backup_realtime', e.target.checked)} />}
                  label="Gravar a cada alteração"
                />
                <PrimaryButton startIcon={<Save />} loading={saving} onClick={onSave}>Salvar</PrimaryButton>
              </Box>
            </Box>
            <Divider sx={{ my: 2 }} />
            <Grid container spacing={2}>
              <Grid item xs={12} sm={4}>
                <InfoRow label="Último dump no servidor" value={status?.lastRunAt ? new Date(status.lastRunAt).toLocaleString('pt-BR') : '—'} />
              </Grid>
              <Grid item xs={12} sm={4}>
                <InfoRow label="Arquivo mais recente" value={status?.lastFile || '—'} mono />
              </Grid>
              <Grid item xs={12} sm={4}>
                <InfoRow label="Tamanho" value={status?.lastSize ? `${(status.lastSize / 1024 / 1024).toFixed(2)} MB` : '—'} />
              </Grid>
              <Grid item xs={12} sm={4}>
                <InfoRow label="Destino no servidor (principal)" value={status?.path || '—'} mono />
              </Grid>
              <Grid item xs={12} sm={4}>
                <InfoRow label="Cron de segurança" value={status?.schedule || '—'} />
              </Grid>
              <Grid item xs={12} sm={4}>
                <InfoRow label="Última cópia nesta máquina" value={lastLocalAt ? new Date(lastLocalAt).toLocaleString('pt-BR') : '—'} />
              </Grid>
            </Grid>
            <Alert severity="info" sx={{ mt: 2 }}>
              Qualquer alteração mínima dispara um novo dump automaticamente (debounce de 1,5s) — o arquivo do
              servidor fica sempre 1:1 com o que está acontecendo. O cron agendado roda apenas como rede de segurança.
            </Alert>
          </CardContent>
        </Card>
      </Grid>
      <Grid item xs={12} md={5}>
        <Card>
          <CardContent>
            <Typography variant="h6" sx={{ mb: 3 }}>Destino e Agendamento</Typography>
            <Grid container spacing={2}>
              <Grid item xs={12}>
                <TextField fullWidth label="Caminho de destino (pasta local ou rede)"
                  placeholder="\\\\servidor\\backups\\papatec ou C:\\backups"
                  value={draft.backup_path ?? ''} onChange={(e) => setField('backup_path', e.target.value)}
                  helperText="Deixe vazio para usar a variável BACKUP_NETWORK_PATH do servidor." />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField fullWidth label="Agendamento (cron)" value={draft.backup_schedule ?? '0 12,18 * * *'}
                  onChange={(e) => setField('backup_schedule', e.target.value)}
                  helperText="Padrão: 12h e 18h" />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField fullWidth label="Retenção (dias)" type="number"
                  value={draft.backup_retention_days ?? 30}
                  onChange={(e) => setField('backup_retention_days', e.target.value)} />
              </Grid>
              <Grid item xs={12}>
                <FormControlLabel
                  control={<Switch checked={draft.backup_include_uploads === true || draft.backup_include_uploads === 'true'}
                    onChange={(e) => setField('backup_include_uploads', e.target.checked)} />}
                  label="Incluir pasta de uploads (fotos e anexos)"
                />
              </Grid>
              <Grid item xs={12} sx={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
                <PrimaryButton startIcon={<Save />} loading={saving} onClick={onSave}>Salvar Configuração</PrimaryButton>
              </Grid>
            </Grid>

            <Divider sx={{ my: 3 }} />
            <Typography variant="subtitle2" sx={{ mb: 1 }}>Destino efetivo</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ wordBreak: 'break-all' }}>
              {effectivePath?.backup_path || effectivePath?.path || 'Padrão (BACKUP_NETWORK_PATH)'}
              {effectivePath?.backup_schedule ? ` · cron: ${effectivePath.backup_schedule}` : ''}
            </Typography>

            <Box sx={{ mt: 3, display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
              <PrimaryButton startIcon={<CloudUpload />} loading={busy === 'create'}
                onClick={() => run('create', () => backupApi.create(), (r: any) => `Backup criado: ${r?.file || ''} (${((r?.size || 0) / 1024 / 1024).toFixed(2)} MB)`)}>
                Criar Backup Agora
              </PrimaryButton>
              <SecondaryButton startIcon={<Refresh />} loading={busy === 'cleanup'}
                onClick={() => run('cleanup', () => backupApi.cleanup(Number(draft.backup_retention_days) || 30), (r: any) => `${r?.removed ?? 0} backup(s) antigo(s) removido(s)`)}>
                Limpar Antigos
              </SecondaryButton>
            </Box>
          </CardContent>
        </Card>
      </Grid>

      <Grid item xs={12} md={7}>
        <Card sx={{ height: '100%' }}>
          <CardContent>
            <Typography variant="h6" sx={{ mb: 2 }}>Backups Disponíveis</Typography>
            {loadingFiles ? (
              <Skeleton variant="rectangular" height={160} />
            ) : !files || files.length === 0 ? (
              <Alert severity="info">Nenhum backup gerado ainda. Clique em “Criar Backup Agora”.</Alert>
            ) : (
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Arquivo</TableCell>
                      <TableCell align="right">Tamanho</TableCell>
                      <TableCell align="right">Data</TableCell>
                      <TableCell align="center">Ações</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {files.map((b: any) => (
                      <TableRow key={b.name} hover>
                        <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{b.name}</TableCell>
                        <TableCell align="right">{((b.size || 0) / 1024 / 1024).toFixed(2)} MB</TableCell>
                        <TableCell align="right">{new Date(b.createdAt).toLocaleString('pt-BR')}</TableCell>
                        <TableCell align="center">
                          <Tooltip title="Restaurar (sobrescreve os dados atuais)">
                            <IconButton size="small" color="warning" disabled={busy !== ''}
                              onClick={() => {
                                if (window.confirm('ATENÇÃO: restaurar este backup sobrescreve todos os dados atuais. Continuar?')) {
                                  run('restore', () => backupApi.restore(b.name), (r: any) => `Backup restaurado (${r?.restoredRows ?? 0} linhas)`);
                                }
                              }}>
                              <Restore fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Sincronizar para a rede">
                            <IconButton size="small" color="info" disabled={busy !== ''}
                              onClick={() => run('sync', () => backupApi.sync(b.name), (r: any) => `Sincronizado para ${r?.syncedTo || 'destino'}`)}>
                              <Sync fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Excluir">
                            <IconButton size="small" color="error" disabled={busy !== ''}
                              onClick={() => { if (window.confirm('Excluir este backup?')) run('delete', () => backupApi.delete(b.name), () => 'Backup excluído'); }}>
                              <Delete fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </CardContent>
        </Card>
      </Grid>

      {/* ------------------------------------------ Recuperação do Sistema */}
      <Grid item xs={12} md={6}>
        <Card sx={{ height: '100%' }}>
          <CardContent>
            <Typography variant="h6" sx={{ mb: 1 }}>Recuperação do Sistema</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Carregue um arquivo <b>.bkp</b> (ex.: baixado de outra máquina) e restaure todos os dados do sistema.
            </Typography>

            <input
              ref={fileInputRef}
              type="file"
              accept=".bkp,.zip"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onFileChosen(f);
                e.target.value = '';
              }}
            />

            <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
              <SecondaryButton startIcon={<UploadFile />} loading={uploading} onClick={() => fileInputRef.current?.click()}>
                Carregar .bkp…
              </SecondaryButton>
              <SecondaryButton startIcon={<Download />} loading={busy === 'download'} disabled={!status?.lastFile} onClick={downloadLatest}>
                Baixar backup mais recente
              </SecondaryButton>
            </Box>

            {uploaded && (
              <Alert severity="warning" sx={{ mt: 2 }}>
                <Typography variant="subtitle2" sx={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{uploaded.name}</Typography>
                <Typography variant="body2">
                  Gerado em: {uploaded.generatedAt ? new Date(uploaded.generatedAt).toLocaleString('pt-BR') : '—'}
                  {' · '}{uploaded.tables} tabelas · {uploaded.rows} linhas · {(uploaded.size / 1024 / 1024).toFixed(2)} MB
                </Typography>
                <Box sx={{ mt: 1.5, display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
                  <DangerButton startIcon={<Restore />} loading={busy === 'restore'} onClick={restoreUploaded}>
                    Restaurar Agora (sobrescreve tudo)
                  </DangerButton>
                  <SecondaryButton onClick={() => setUploaded(null)}>Descartar</SecondaryButton>
                </Box>
              </Alert>
            )}

            <Alert severity="info" sx={{ mt: 2 }}>
              A restauração apaga os dados atuais e reinsere tudo do arquivo escolhido. Logo em seguida um novo
              dump 1:1 é gerado automaticamente.
            </Alert>
          </CardContent>
        </Card>
      </Grid>

      {/* ------------------------------------------ Backup nesta máquina */}
      <Grid item xs={12} md={6}>
        <Card sx={{ height: '100%' }}>
          <CardContent>
            <Typography variant="h6" sx={{ mb: 1 }}>Backup nesta Máquina</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Cada máquina interna mantém a própria cópia em
              {' '}
              <Box component="span" sx={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>
                C:\Users\&lt;usuário&gt;\Documents\Backup\{LOCAL_BKP_NAME}
              </Box>
              .
            </Typography>

            {!supportsFsAccess && (
              <Alert severity="info" sx={{ mb: 2 }}>
                Este navegador não permite gravação automática em pasta. Use “Baixar .bkp agora” ou o instalador
                por script (recomendado nas máquinas internas).
              </Alert>
            )}

            {!dirHandle ? (
              <PrimaryButton startIcon={<FolderOpen />} onClick={pickFolder} disabled={!supportsFsAccess}>
                Escolher pasta (Documents\Backup)
              </PrimaryButton>
            ) : (
              <Box>
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap', mb: 1.5 }}>
                  <Chip size="small" color={permState === 'granted' ? 'success' : 'default'} label={`Pasta: ${dirHandle.name}`} />
                  {permState === 'granted' && <Chip size="small" color="success" label="Conectada" />}
                  {permState === 'prompt' && <Chip size="small" color="warning" label="Permissão pendente" />}
                  {permState === 'denied' && <Chip size="small" color="error" label="Permissão negada" />}
                </Box>
                <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', mb: 1.5 }}>
                  {(permState === 'prompt' || permState === 'denied') && (
                    <PrimaryButton onClick={reactivate}>Reativar acesso à pasta</PrimaryButton>
                  )}
                  {permState === 'granted' && (
                    <>
                      <SecondaryButton startIcon={<Save />} loading={busy === 'local'} onClick={saveLocalNow}>
                        Gravar cópia agora
                      </SecondaryButton>
                      <SecondaryButton onClick={disconnectFolder}>Desconectar pasta</SecondaryButton>
                    </>
                  )}
                </Box>
                {permState === 'granted' && (
                  <FormControlLabel
                    control={<Switch checked={autoSave} onChange={(e) => toggleAutoSave(e.target.checked)} />}
                    label="Gravar .bkp automaticamente (a cada dump do servidor)"
                  />
                )}
              </Box>
            )}

            <Divider sx={{ my: 2.5 }} />
            <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
              <SecondaryButton startIcon={<Download />} loading={busy === 'download'} disabled={!status?.lastFile} onClick={downloadLatest}>
                Baixar .bkp agora
              </SecondaryButton>
              <SecondaryButton startIcon={<CloudUpload />} loading={busy === 'script'} onClick={downloadInstaller}>
                Baixar instalador desta máquina (.ps1)
              </SecondaryButton>
            </Box>

            <Divider sx={{ my: 2.5 }} />
            <Typography variant="subtitle2" sx={{ mb: 1 }}>Token das máquinas internas</Typography>
            <TextField
              fullWidth
              size="small"
              value={tokenData?.token || ''}
              InputProps={{ readOnly: true, sx: { fontFamily: 'monospace', fontSize: '0.8rem' } }}
            />
            <Box sx={{ mt: 1.5, display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
              <SecondaryButton startIcon={<ContentCopy />} onClick={copyToken} disabled={!tokenData?.token}>
                Copiar token
              </SecondaryButton>
              <SecondaryButton
                startIcon={<Refresh />}
                loading={busy === 'token'}
                disabled={!tokenData?.token}
                onClick={() => run('token', () => backupApi.regenerateToken(), () => 'Token regenerado — gere o instalador novamente nas máquinas')}
              >
                Gerar novo token
              </SecondaryButton>
            </Box>
            <Alert severity="info" sx={{ mt: 2 }}>
              O instalador (.ps1) cria a pasta Documents\Backup, baixa o .bkp do servidor e agenda uma tarefa
              (padrão: a cada 1 minuto) para manter a cópia 1:1 mesmo com o navegador fechado.
            </Alert>
          </CardContent>
        </Card>
      </Grid>
    </Grid>
  );
}

// ===========================================================================
// ABA INVENTÁRIO
// ===========================================================================
function InventoryTab({ onError, onFlash }: { onError: (m: string) => void; onFlash: (m: string) => void }) {
  const queryClient = useQueryClient();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const valuation = useQuery({ queryKey: ['valuation'], queryFn: () => reportsApi.inventoryValuation() });
  const movements = useQuery({ queryKey: ['monthlyMovements', year, month], queryFn: () => reportsApi.monthlyMovements({ year, month }) });
  const lowStock = useQuery({ queryKey: ['lowStock'], queryFn: () => inventoryApi.getLowStock() });

  const v = valuation.data;
  const m = movements.data;

  // ---------------------------------------------------------------------
  // Gestão de itens: adicionar, editar preços, entrada/saída e exclusão
  // ---------------------------------------------------------------------
  const [search, setSearch] = useState('');
  const [formDialog, setFormDialog] = useState<{ open: boolean; mode: 'create' | 'edit'; item: any }>({
    open: false, mode: 'create', item: null,
  });
  const [form, setForm] = useState<any>({ ...EMPTY_ITEM_FORM });
  const [adjustTarget, setAdjustTarget] = useState<any | null>(null);
  const [adjust, setAdjust] = useState({ type: 'IN', qty: 1, reason: '' });
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);

  const itemsQuery = useQuery({
    queryKey: ['inventoryItems', search],
    queryFn: () => inventoryApi.list({ search: search || undefined, limit: 200 }),
  });
  const items: any[] = itemsQuery.data?.data || [];

  const refreshInventory = () => {
    queryClient.invalidateQueries({ queryKey: ['inventoryItems'] });
    queryClient.invalidateQueries({ queryKey: ['valuation'] });
    queryClient.invalidateQueries({ queryKey: ['lowStock'] });
    queryClient.invalidateQueries({ queryKey: ['monthlyMovements'] });
  };

  const setField = (key: string, value: any) => setForm((prev: any) => ({ ...prev, [key]: value }));

  const openCreate = () => {
    setForm({ ...EMPTY_ITEM_FORM });
    setFormDialog({ open: true, mode: 'create', item: null });
  };

  const openEdit = (item: any) => {
    setForm({ ...EMPTY_ITEM_FORM, ...item });
    setFormDialog({ open: true, mode: 'edit', item });
  };

  const itemMutation = useMutation({
    mutationFn: (payload: any) =>
      formDialog.mode === 'create'
        ? inventoryApi.create(payload)
        : inventoryApi.update(formDialog.item.id, payload),
    onSuccess: () => {
      refreshInventory();
      setFormDialog({ open: false, mode: 'create', item: null });
      onFlash(formDialog.mode === 'create' ? 'Item adicionado ao estoque!' : 'Item atualizado!');
    },
    onError: (err: any) => onError(err.response?.data?.message || 'Erro ao salvar o item'),
  });

  const adjustMutation = useMutation({
    mutationFn: (payload: any) => inventoryApi.adjustStock(payload.id, { type: payload.type, qty: payload.qty, reason: payload.reason }),
    onSuccess: () => {
      refreshInventory();
      setAdjustTarget(null);
      onFlash('Movimentação de estoque registrada!');
    },
    onError: (err: any) => onError(err.response?.data?.message || 'Erro ao movimentar o estoque'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => inventoryApi.delete(id),
    onSuccess: (res: any) => {
      refreshInventory();
      setDeleteTarget(null);
      onFlash(res?.message || 'Item removido do estoque.');
    },
    onError: (err: any) => onError(err.response?.data?.message || 'Erro ao excluir o item'),
  });

  const submitItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!String(form.code || '').trim() || !String(form.name || '').trim()) {
      onError('Código (SKU) e nome são obrigatórios.');
      return;
    }
    itemMutation.mutate(form);
  };

  const submitAdjust = (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustTarget) return;
    adjustMutation.mutate({ id: adjustTarget.id, ...adjust });
  };

  return (
    <Grid container spacing={3}>
      {/* ---------------------------------------------------- Gerenciar itens */}
      <Grid item xs={12}>
        <Card>
          <CardContent>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 1.5 }}>
              <Box>
                <Typography variant="h6">Itens do Estoque</Typography>
                <Typography variant="caption" color="text.secondary">
                  Adicione itens, retire itens, ajuste quantidades e altere preços de custo e venda.
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                <TextField
                  size="small"
                  placeholder="Buscar nome, código ou categoria"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  sx={{ minWidth: 250 }}
                  InputProps={{
                    startAdornment: <InputAdornment position="start"><Search fontSize="small" /></InputAdornment>,
                  }}
                />
                <SecondaryButton startIcon={<Refresh />} onClick={() => itemsQuery.refetch()}>
                  Atualizar
                </SecondaryButton>
                <PrimaryButton startIcon={<Add />} onClick={openCreate}>Adicionar item</PrimaryButton>
              </Box>
            </Box>

            <TableContainer sx={{ maxHeight: 420 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell>Código</TableCell>
                    <TableCell>Nome</TableCell>
                    <TableCell>Categoria</TableCell>
                    <TableCell align="right">Estoque</TableCell>
                    <TableCell align="right">Custo</TableCell>
                    <TableCell align="right">Venda</TableCell>
                    <TableCell align="right">Valor em estoque</TableCell>
                    <TableCell align="center">Ações</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {itemsQuery.isLoading && (
                    <TableRow><TableCell colSpan={8}>Carregando itens…</TableCell></TableRow>
                  )}
                  {!itemsQuery.isLoading && items.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8}>
                        <Alert severity="info">
                          {search ? `Nenhum item encontrado para "${search}".` : 'Nenhum item cadastrado. Clique em "Adicionar item".'}
                        </Alert>
                      </TableCell>
                    </TableRow>
                  )}
                  {items.map((p) => (
                    <TableRow key={p.id} hover sx={p.status === 'INACTIVE' ? { opacity: 0.55 } : undefined}>
                      <TableCell sx={{ fontFamily: 'monospace' }}>{p.code}</TableCell>
                      <TableCell>
                        {p.name}
                        {p.status === 'INACTIVE' && <Chip size="small" label="Inativo" sx={{ ml: 1 }} />}
                        {p.quantity <= p.minStock && (
                          <Chip size="small" color="warning" label="Repor" sx={{ ml: 1 }} />
                        )}
                      </TableCell>
                      <TableCell>{p.category || '-'}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 700, color: p.quantity === 0 ? 'error.main' : 'text.primary' }}>
                        {p.quantity}
                      </TableCell>
                      <TableCell align="right">{formatCurrency(p.costPrice)}</TableCell>
                      <TableCell align="right">{formatCurrency(p.salePrice)}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>
                        {formatCurrency(p.quantity * p.salePrice)}
                      </TableCell>
                      <TableCell align="center" sx={{ whiteSpace: 'nowrap' }}>
                        <Tooltip title="Editar (nome, preços, estoque)">
                          <IconButton size="small" color="primary" onClick={() => openEdit(p)}>
                            <Edit fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Entrada / saída de estoque">
                          <IconButton
                            size="small"
                            color="success"
                            onClick={() => { setAdjustTarget(p); setAdjust({ type: 'IN', qty: 1, reason: '' }); }}
                          >
                            <SwapHoriz fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Excluir item">
                          <IconButton size="small" color="error" onClick={() => setDeleteTarget(p)}>
                            <Delete fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>
      </Grid>

      <Grid item xs={12}>
        <Typography variant="h6" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
          <Inventory2 fontSize="small" /> Valoração do Estoque
        </Typography>
        <Grid container spacing={2}>
          {[
            { label: 'Itens em estoque', value: v ? String(v.totalItems) : '—' },
            { label: 'Valor de custo', value: v ? formatCurrency(v.costValue) : '—' },
            { label: 'Valor de venda', value: v ? formatCurrency(v.saleValue) : '—' },
            { label: 'Lucro potencial', value: v ? formatCurrency(v.potentialProfit) : '—' },
            { label: 'Abaixo do mínimo', value: v ? String(v.lowStockItems) : '—' },
            { label: 'Sem estoque', value: v ? String(v.outOfStockItems) : '—' },
          ].map((card) => (
            <Grid item xs={6} md={4} lg={2} key={card.label}>
              <Card sx={{ height: '100%' }}>
                <CardContent sx={{ py: 2 }}>
                  <Typography variant="caption" color="text.secondary">{card.label}</Typography>
                  <Typography variant="h6" fontWeight={700}>{valuation.isLoading ? '…' : card.value}</Typography>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      </Grid>

      <Grid item xs={12} md={6}>
        <Card sx={{ height: '100%' }}>
          <CardContent>
            <Typography variant="h6" sx={{ mb: 2 }}>Valoração por Categoria</Typography>
            <TableContainer sx={{ maxHeight: 320 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell>Categoria</TableCell>
                    <TableCell align="right">Un.</TableCell>
                    <TableCell align="right">Custo</TableCell>
                    <TableCell align="right">Venda</TableCell>
                    <TableCell align="right">Lucro</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {valuation.isLoading && (
                    <TableRow><TableCell colSpan={5}>Carregando…</TableCell></TableRow>
                  )}
                  {v && Object.entries(v.byCategory || {}).map(([cat, c]: [string, any]) => (
                    <TableRow key={cat}>
                      <TableCell>{cat}</TableCell>
                      <TableCell align="right">{c.items}</TableCell>
                      <TableCell align="right">{formatCurrency(c.costValue)}</TableCell>
                      <TableCell align="right">{formatCurrency(c.saleValue)}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600, color: c.profit >= 0 ? 'success.main' : 'error.main' }}>
                        {formatCurrency(c.profit)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>
      </Grid>

      <Grid item xs={12} md={6}>
        <Card sx={{ height: '100%' }}>
          <CardContent>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 1 }}>
              <Typography variant="h6">Movimentações do Mês</Typography>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <FormControl size="small" sx={{ minWidth: 110 }}>
                  <InputLabel>Mês</InputLabel>
                  <Select value={month} label="Mês" onChange={(e) => setMonth(Number(e.target.value))}>
                    {Array.from({ length: 12 }, (_, i) => (
                      <MenuItem key={i + 1} value={i + 1}>{i + 1}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <FormControl size="small" sx={{ minWidth: 100 }}>
                  <InputLabel>Ano</InputLabel>
                  <Select value={year} label="Ano" onChange={(e) => setYear(Number(e.target.value))}>
                    {[now.getFullYear(), now.getFullYear() - 1].map((y) => (
                      <MenuItem key={y} value={y}>{y}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Box>
            </Box>

            <Grid container spacing={2} sx={{ mb: 2 }}>
              <Grid item xs={4}>
                <Box sx={{ p: 1.5, borderRadius: 2, bgcolor: 'success.light', color: '#fff', textAlign: 'center' }}>
                  <Typography variant="caption">ENTRADAS (IN)</Typography>
                  <Typography variant="h6" fontWeight={700}>{m?.entries?.qty ?? 0}</Typography>
                  <Typography variant="caption">{formatCurrency(m?.entries?.costValue || 0)}</Typography>
                </Box>
              </Grid>
              <Grid item xs={4}>
                <Box sx={{ p: 1.5, borderRadius: 2, bgcolor: 'error.light', color: '#fff', textAlign: 'center' }}>
                  <Typography variant="caption">SAÍDAS (OUT)</Typography>
                  <Typography variant="h6" fontWeight={700}>{m?.exits?.qty ?? 0}</Typography>
                  <Typography variant="caption">{formatCurrency(m?.exits?.costValue || 0)}</Typography>
                </Box>
              </Grid>
              <Grid item xs={4}>
                <Box sx={{ p: 1.5, borderRadius: 2, bgcolor: 'info.light', color: '#fff', textAlign: 'center' }}>
                  <Typography variant="caption">AJUSTES</Typography>
                  <Typography variant="h6" fontWeight={700}>{m?.adjustments?.qty ?? 0}</Typography>
                  <Typography variant="caption">{m?.adjustments?.count ?? 0} lançamento(s)</Typography>
                </Box>
              </Grid>
            </Grid>

            <TableContainer sx={{ maxHeight: 260 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell>Data</TableCell>
                    <TableCell>Peça</TableCell>
                    <TableCell align="center">Tipo</TableCell>
                    <TableCell align="right">Qtd</TableCell>
                    <TableCell>Usuário</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {movements.isLoading && <TableRow><TableCell colSpan={5}>Carregando…</TableCell></TableRow>}
                  {(m?.movements || []).slice(0, 50).map((mov: any) => (
                    <TableRow key={mov.id} hover>
                      <TableCell>{formatDate(mov.createdAt, true)}</TableCell>
                      <TableCell>{mov.part?.name || mov.reason || '-'}</TableCell>
                      <TableCell align="center">
                        <Chip size="small" label={mov.type}
                          color={mov.type === 'IN' ? 'success' : mov.type === 'OUT' ? 'error' : 'info'} />
                      </TableCell>
                      <TableCell align="right">{mov.qty}</TableCell>
                      <TableCell>{mov.user?.name || '-'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>
      </Grid>

      <Grid item xs={12}>
        <Card>
          <CardContent>
            <Typography variant="h6" sx={{ mb: 2 }}>Peças Abaixo do Estoque Mínimo</Typography>
            {!lowStock.data || lowStock.data.length === 0 ? (
              <Alert severity="success">Nenhuma peça precisa de reposição.</Alert>
            ) : (
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Código</TableCell>
                      <TableCell>Peça</TableCell>
                      <TableCell>Categoria</TableCell>
                      <TableCell align="right">Atual</TableCell>
                      <TableCell align="right">Mínimo</TableCell>
                      <TableCell align="right">Sugestão de compra</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {lowStock.data.map((p: any) => (
                      <TableRow key={p.id} hover>
                        <TableCell sx={{ fontFamily: 'monospace' }}>{p.code}</TableCell>
                        <TableCell>{p.name}</TableCell>
                        <TableCell>{p.category || '-'}</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 700, color: p.quantity === 0 ? 'error.main' : 'warning.main' }}>
                          {p.quantity}
                        </TableCell>
                        <TableCell align="right">{p.minStock}</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600 }}>
                          {Math.max(p.minStock * 2 - p.quantity, 1)} un.
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </CardContent>
        </Card>
      </Grid>

      {/* ------------------------------------------- Diálogo: adicionar/editar */}
      <Dialog
        open={formDialog.open}
        onClose={() => setFormDialog({ open: false, mode: 'create', item: null })}
        maxWidth="sm"
        fullWidth
      >
        <form onSubmit={submitItem}>
          <DialogTitle>{formDialog.mode === 'create' ? 'Adicionar item ao estoque' : 'Editar item'}</DialogTitle>
          <DialogContent dividers>
            <Grid container spacing={2} sx={{ mt: 0 }}>
              <Grid item xs={12} sm={6}>
                <TextField fullWidth required label="Código (SKU)" value={form.code ?? ''}
                  onChange={(e) => setField('code', e.target.value.toUpperCase())} />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField fullWidth required label="Nome" value={form.name ?? ''}
                  onChange={(e) => setField('name', e.target.value)} />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField fullWidth label="Categoria" value={form.category ?? ''}
                  onChange={(e) => setField('category', e.target.value)} />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField fullWidth label="Unidade" value={form.unit ?? 'UN'}
                  onChange={(e) => setField('unit', e.target.value)} />
              </Grid>
              <Grid item xs={6} sm={3}>
                <TextField fullWidth type="number" label="Estoque atual" value={form.quantity ?? 0}
                  inputProps={{ min: 0, step: 1 }}
                  onChange={(e) => setField('quantity', e.target.value)} />
              </Grid>
              <Grid item xs={6} sm={3}>
                <TextField fullWidth type="number" label="Estoque mínimo" value={form.minStock ?? 1}
                  inputProps={{ min: 0, step: 1 }}
                  onChange={(e) => setField('minStock', e.target.value)} />
              </Grid>
              <Grid item xs={6} sm={3}>
                <TextField fullWidth type="number" label="Custo (R$)" value={form.costPrice ?? 0}
                  inputProps={{ min: 0, step: 0.01 }}
                  onChange={(e) => setField('costPrice', e.target.value)} />
              </Grid>
              <Grid item xs={6} sm={3}>
                <TextField fullWidth type="number" label="Venda (R$)" value={form.salePrice ?? 0}
                  inputProps={{ min: 0, step: 0.01 }}
                  onChange={(e) => setField('salePrice', e.target.value)} />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField fullWidth label="Fornecedor" value={form.supplier ?? ''}
                  onChange={(e) => setField('supplier', e.target.value)} />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField fullWidth label="Localização" value={form.location ?? ''}
                  onChange={(e) => setField('location', e.target.value)} />
              </Grid>
              <Grid item xs={12}>
                <TextField fullWidth multiline rows={2} label="Descrição" value={form.description ?? ''}
                  onChange={(e) => setField('description', e.target.value)} />
              </Grid>
              <Grid item xs={12}>
                <FormControlLabel
                  control={
                    <Switch checked={form.status !== 'INACTIVE'}
                      onChange={(e) => setField('status', e.target.checked ? 'ACTIVE' : 'INACTIVE')} />
                  }
                  label="Item ativo (visível nos orçamentos e O.S.)"
                />
              </Grid>
            </Grid>
          </DialogContent>
          <DialogActions>
            <SecondaryButton type="button"
              onClick={() => setFormDialog({ open: false, mode: 'create', item: null })}>
              Cancelar
            </SecondaryButton>
            <PrimaryButton type="submit" disabled={itemMutation.isPending}>
              {itemMutation.isPending ? 'Salvando…' : formDialog.mode === 'create' ? 'Adicionar' : 'Salvar'}
            </PrimaryButton>
          </DialogActions>
        </form>
      </Dialog>

      {/* ------------------------------------------- Diálogo: entrada/saída */}
      <Dialog open={Boolean(adjustTarget)} onClose={() => setAdjustTarget(null)} maxWidth="xs" fullWidth>
        <form onSubmit={submitAdjust}>
          <DialogTitle>
            Movimentar estoque{adjustTarget ? ` — ${adjustTarget.name}` : ''}
          </DialogTitle>
          <DialogContent dividers>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Estoque atual: <b>{adjustTarget?.quantity ?? 0}</b> un.
            </Typography>
            <FormControl fullWidth sx={{ mb: 2 }}>
              <InputLabel>Tipo de movimento</InputLabel>
              <Select
                value={adjust.type}
                label="Tipo de movimento"
                onChange={(e) => setAdjust((p) => ({ ...p, type: e.target.value }))}
              >
                <MenuItem value="IN">Entrada (compra / devolução)</MenuItem>
                <MenuItem value="OUT">Saída (uso em serviço / perda)</MenuItem>
                <MenuItem value="ADJUSTMENT">Ajuste (define o estoque final)</MenuItem>
              </Select>
            </FormControl>
            <TextField fullWidth type="number" label="Quantidade" value={adjust.qty}
              inputProps={{ min: 1, step: 1 }}
              onChange={(e) => setAdjust((p) => ({ ...p, qty: Number(e.target.value) }))} sx={{ mb: 2 }} />
            <TextField fullWidth label="Motivo" value={adjust.reason}
              placeholder="Ex.: compra de fornecedor, uso em O.S. #123"
              onChange={(e) => setAdjust((p) => ({ ...p, reason: e.target.value }))} />
          </DialogContent>
          <DialogActions>
            <SecondaryButton type="button" onClick={() => setAdjustTarget(null)}>Cancelar</SecondaryButton>
            <PrimaryButton type="submit" disabled={adjustMutation.isPending}>
              {adjustMutation.isPending ? 'Registrando…' : 'Registrar'}
            </PrimaryButton>
          </DialogActions>
        </form>
      </Dialog>

      {/* ------------------------------------------- Diálogo: confirma exclusão */}
      <Dialog open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Excluir item</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2">
            Confirma a exclusão de <b>{deleteTarget?.name}</b> (código {deleteTarget?.code})?
          </Typography>
          <Alert severity="warning" sx={{ mt: 2 }}>
            Itens com histórico em orçamentos ou O.S. não são apagados: eles são
            apenas <b>desativados</b>, preservando o histórico.
          </Alert>
        </DialogContent>
        <DialogActions>
          <SecondaryButton onClick={() => setDeleteTarget(null)}>Cancelar</SecondaryButton>
          <DangerButton
            disabled={deleteMutation.isPending}
            onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
          >
            {deleteMutation.isPending ? 'Excluindo…' : 'Excluir'}
          </DangerButton>
        </DialogActions>
      </Dialog>
    </Grid>
  );
}

// ===========================================================================
// ABA SERVIÇOS
// ===========================================================================
function ServicesTab({ onError, onFlash }: { onError: (m: string) => void; onFlash: (m: string) => void }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ name: '', description: '', price: 0, category: 'MAINTENANCE', estimatedHours: 1 });

  const { data: services, isLoading } = useQuery({
    queryKey: ['servicesCatalog'],
    queryFn: () => servicesApi.list(),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['servicesCatalog'] });

  const saveMutation = useMutation({
    mutationFn: () => (editing ? servicesApi.update(editing.id, form) : servicesApi.create(form)),
    onSuccess: () => { invalidate(); setOpen(false); setEditing(null); onFlash('Serviço salvo!'); },
    onError: (err: any) => onError(err.response?.data?.message || 'Erro ao salvar serviço'),
  });

  const toggleMutation = useMutation({
    mutationFn: (id: string) => servicesApi.toggle(id),
    onSuccess: () => { invalidate(); onFlash('Serviço atualizado.'); },
    onError: (err: any) => onError(err.response?.data?.message || 'Erro ao alterar serviço'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => servicesApi.remove(id),
    onSuccess: () => { invalidate(); onFlash('Serviço excluído.'); },
    onError: (err: any) => onError(err.response?.data?.message || 'Erro ao excluir serviço'),
  });

  const initMutation = useMutation({
    mutationFn: () => servicesApi.initDefaults(),
    onSuccess: (r: any) => { invalidate(); onFlash(r?.message || 'Serviços padrão criados.'); },
    onError: (err: any) => onError(err.response?.data?.message || 'Erro ao restaurar padrões'),
  });

  const openNew = () => {
    setEditing(null);
    setForm({ name: '', description: '', price: 0, category: 'MAINTENANCE', estimatedHours: 1 });
    setOpen(true);
  };

  const openEdit = (s: any) => {
    setEditing(s);
    setForm({
      name: s.name,
      description: s.description || '',
      price: s.price,
      category: s.category || 'MAINTENANCE',
      estimatedHours: s.estimatedHours || 1,
    });
    setOpen(true);
  };

  const grouped = useMemo(() => {
    const acc: Record<string, any[]> = {};
    for (const s of (services as any[]) || []) {
      const key = s.category || 'OUTROS';
      (acc[key] ||= []).push(s);
    }
    return acc;
  }, [services]);

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3, flexWrap: 'wrap', gap: 1 }}>
        <Box>
          <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}><Build fontSize="small" /> Catálogo de Serviços</Typography>
          <Typography variant="body2" color="text.secondary">
            Serviços pré-cadastrados (Formatação, Limpeza, Montagem, etc.) usados nos orçamentos.
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1.5 }}>
          <SecondaryButton loading={initMutation.isPending} onClick={() => {
            if (window.confirm('Criar os serviços padrão que ainda não existirem?')) initMutation.mutate();
          }}>
            Restaurar Padrões
          </SecondaryButton>
          <PrimaryButton startIcon={<Add />} onClick={openNew}>Novo Serviço</PrimaryButton>
        </Box>
      </Box>

      {isLoading ? (
        <Skeleton variant="rectangular" height={200} />
      ) : Object.keys(grouped).length === 0 ? (
        <Alert severity="info">Nenhum serviço cadastrado. Use “Restaurar Padrões” ou “Novo Serviço”.</Alert>
      ) : (
        <Grid container spacing={2}>
          {Object.entries(grouped).map(([category, list]) => (
            <Grid item xs={12} md={6} lg={4} key={category}>
              <Card sx={{ height: '100%' }}>
                <CardContent>
                  <Chip label={category} size="small" color="primary" variant="outlined" sx={{ mb: 1.5 }} />
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Serviço</TableCell>
                          <TableCell align="right">Preço</TableCell>
                          <TableCell align="center">Ativo</TableCell>
                          <TableCell align="center">Ações</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {list.map((s: any) => (
                          <TableRow key={s.id} hover>
                            <TableCell>
                              <Typography variant="body2" fontWeight={600}>{s.name}</Typography>
                              <Typography variant="caption" color="text.secondary">
                                {s.estimatedHours}h · {s.description || 'sem descrição'}
                              </Typography>
                            </TableCell>
                            <TableCell align="right">{formatCurrency(s.price)}</TableCell>
                            <TableCell align="center">
                              <Switch size="small" checked={!!s.isActive} onChange={() => toggleMutation.mutate(s.id)} />
                            </TableCell>
                            <TableCell align="center">
                              <IconButton size="small" onClick={() => openEdit(s)}><Edit fontSize="small" /></IconButton>
                              <IconButton size="small" color="error" onClick={() => {
                                if (window.confirm(`Excluir o serviço "${s.name}"?`)) deleteMutation.mutate(s.id);
                              }}>
                                <Delete fontSize="small" />
                              </IconButton>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{editing ? 'Editar Serviço' : 'Novo Serviço'}</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid item xs={12}>
              <TextField fullWidth label="Nome *" value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Grid>
            <Grid item xs={12}>
              <TextField fullWidth label="Descrição" multiline rows={2} value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField fullWidth label="Preço (R$) *" type="number" value={form.price}
                onChange={(e) => setForm({ ...form, price: Number(e.target.value) })}
                InputProps={{ startAdornment: <InputAdornment position="start">R$</InputAdornment> }} />
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField fullWidth label="Horas estimadas" type="number" value={form.estimatedHours}
                onChange={(e) => setForm({ ...form, estimatedHours: Number(e.target.value) })} />
            </Grid>
            <Grid item xs={12} sm={4}>
              <FormControl fullWidth>
                <InputLabel>Categoria</InputLabel>
                <Select value={form.category} label="Categoria"
                  onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  {SERVICE_CATEGORIES.map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}
                </Select>
              </FormControl>
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <SecondaryButton onClick={() => setOpen(false)}>Cancelar</SecondaryButton>
          <PrimaryButton loading={saveMutation.isPending} disabled={!form.name.trim() || form.price < 0}
            onClick={() => saveMutation.mutate()}>
            Salvar
          </PrimaryButton>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

// ===========================================================================
// ABA FINANCEIRO
// ===========================================================================
function FinancialTab({ onError, onFlash }: { onError: (m: string) => void; onFlash: (m: string) => void }) {
  const queryClient = useQueryClient();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ description: '', amount: 0, category: 'OTHER', date: now.toISOString().split('T')[0], notes: '' });

  const pl = useQuery({ queryKey: ['pl', year, month], queryFn: () => reportsApi.profitLossMonthly({ year, month }) });
  const expenses = useQuery({ queryKey: ['expenses', year, month], queryFn: () => expensesApi.list({ page: 1, limit: 50 }) });
  const byCategory = useQuery({ queryKey: ['expensesByCategory'], queryFn: () => expensesApi.byCategory({}) });
  const valuation = useQuery({ queryKey: ['valuation'], queryFn: () => reportsApi.inventoryValuation() });

  const createMutation = useMutation({
    mutationFn: () => expensesApi.create(form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['pl'] });
      queryClient.invalidateQueries({ queryKey: ['expensesByCategory'] });
      setOpen(false);
      setForm({ description: '', amount: 0, category: 'OTHER', date: now.toISOString().split('T')[0], notes: '' });
      onFlash('Despesa registrada!');
    },
    onError: (err: any) => onError(err.response?.data?.message || 'Erro ao registrar despesa'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => expensesApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['pl'] });
      queryClient.invalidateQueries({ queryKey: ['expensesByCategory'] });
      onFlash('Despesa excluída.');
    },
    onError: (err: any) => onError(err.response?.data?.message || 'Erro ao excluir despesa'),
  });

  const d = pl.data;

  return (
    <Grid container spacing={3}>
      <Grid item xs={12}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 1 }}>
          <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <AttachMoney fontSize="small" /> Lucro & Despesas
          </Typography>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <FormControl size="small" sx={{ minWidth: 110 }}>
              <InputLabel>Mês</InputLabel>
              <Select value={month} label="Mês" onChange={(e) => setMonth(Number(e.target.value))}>
                {Array.from({ length: 12 }, (_, i) => <MenuItem key={i + 1} value={i + 1}>{i + 1}</MenuItem>)}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 100 }}>
              <InputLabel>Ano</InputLabel>
              <Select value={year} label="Ano" onChange={(e) => setYear(Number(e.target.value))}>
                {[now.getFullYear(), now.getFullYear() - 1].map((y) => <MenuItem key={y} value={y}>{y}</MenuItem>)}
              </Select>
            </FormControl>
            <PrimaryButton startIcon={<Add />} onClick={() => setOpen(true)}>Nova Despesa</PrimaryButton>
          </Box>
        </Box>

        <Grid container spacing={2}>
          {[
            { label: 'Receita total', value: d?.revenue?.total, color: 'success.main' },
            { label: '  · Peças', value: d?.revenue?.parts },
            { label: '  · Serviços', value: d?.revenue?.services },
            { label: '  · Mão de obra', value: d?.revenue?.labor },
            { label: 'Custos totais', value: d?.costs?.total, color: 'error.main' },
            { label: 'Lucro líquido', value: d?.profit?.net, color: d?.profit?.net >= 0 ? 'success.main' : 'error.main' },
          ].map((card) => (
            <Grid item xs={6} md={4} lg={2} key={card.label}>
              <Card sx={{ height: '100%' }}>
                <CardContent sx={{ py: 2 }}>
                  <Typography variant="caption" color="text.secondary">{card.label}</Typography>
                  <Typography variant="h6" fontWeight={700} sx={card.color ? { color: card.color } : undefined}>
                    {pl.isLoading ? '…' : formatCurrency(card.value || 0)}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      </Grid>

      <Grid item xs={12} md={4}>
        <Card sx={{ height: '100%' }}>
          <CardContent>
            <Typography variant="h6" sx={{ mb: 2 }}>Indicadores do Mês</Typography>
            <InfoRow label="Margem líquida" value={`${d?.profit?.margin ?? 0}%`} />
            <InfoRow label="Lucro bruto" value={formatCurrency(d?.profit?.gross || 0)} />
            <InfoRow label="OS entregues" value={d?.ordersCount ?? 0} />
            <InfoRow label="Ticket médio" value={formatCurrency(d?.avgTicket || 0)} />
            <Divider sx={{ my: 2 }} />
            <Typography variant="subtitle2" sx={{ mb: 1 }}>Valorização de estoque</Typography>
            <InfoRow label="Custo em estoque" value={formatCurrency(valuation.data?.costValue || 0)} />
            <InfoRow label="Venda em estoque" value={formatCurrency(valuation.data?.saleValue || 0)} />
            <InfoRow label="Lucro potencial" value={formatCurrency(valuation.data?.potentialProfit || 0)} />
          </CardContent>
        </Card>
      </Grid>

      <Grid item xs={12} md={4}>
        <Card sx={{ height: '100%' }}>
          <CardContent>
            <Typography variant="h6" sx={{ mb: 2 }}>Despesas por Categoria</Typography>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Categoria</TableCell>
                    <TableCell align="right">Valor</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(byCategory.data?.breakdown || []).map((c: any) => (
                    <TableRow key={c.category}>
                      <TableCell>{EXPENSE_CATEGORIES.find((x) => x.value === c.category)?.label || c.category}</TableCell>
                      <TableCell align="right">{formatCurrency(c.total)}</TableCell>
                    </TableRow>
                  ))}
                  {!byCategory.data?.breakdown?.length && (
                    <TableRow><TableCell colSpan={2}>Sem despesas registradas.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>
      </Grid>

      <Grid item xs={12} md={4}>
        <Card sx={{ height: '100%' }}>
          <CardContent>
            <Typography variant="h6" sx={{ mb: 2 }}>Últimas Despesas</Typography>
            <TableContainer sx={{ maxHeight: 340 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell>Descrição</TableCell>
                    <TableCell align="right">Valor</TableCell>
                    <TableCell align="center">Ações</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(expenses.data?.data || []).map((e: any) => (
                    <TableRow key={e.id} hover>
                      <TableCell>
                        <Typography variant="body2">{e.description}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {formatDate(e.date)} · {EXPENSE_CATEGORIES.find((x) => x.value === e.category)?.label || e.category}
                        </Typography>
                      </TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>{formatCurrency(e.amount)}</TableCell>
                      <TableCell align="center">
                        <IconButton size="small" color="error" onClick={() => {
                          if (window.confirm('Excluir esta despesa?')) deleteMutation.mutate(e.id);
                        }}>
                          <Delete fontSize="small" />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!expenses.isLoading && !(expenses.data?.data || []).length && (
                    <TableRow><TableCell colSpan={3}>Nenhuma despesa registrada.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>
      </Grid>

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Nova Despesa</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid item xs={12}>
              <TextField fullWidth label="Descrição *" value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField fullWidth label="Valor (R$) *" type="number" value={form.amount}
                onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })}
                InputProps={{ startAdornment: <InputAdornment position="start">R$</InputAdornment> }} />
            </Grid>
            <Grid item xs={12} sm={4}>
              <FormControl fullWidth>
                <InputLabel>Categoria</InputLabel>
                <Select value={form.category} label="Categoria"
                  onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  {EXPENSE_CATEGORIES.map((c) => <MenuItem key={c.value} value={c.value}>{c.label}</MenuItem>)}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField fullWidth label="Data" type="date" value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                InputLabelProps={{ shrink: true }} />
            </Grid>
            <Grid item xs={12}>
              <TextField fullWidth label="Observações" multiline rows={2} value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <SecondaryButton onClick={() => setOpen(false)}>Cancelar</SecondaryButton>
          <PrimaryButton loading={createMutation.isPending}
            disabled={!form.description.trim() || !(form.amount > 0)}
            onClick={() => createMutation.mutate()}>
            Registrar
          </PrimaryButton>
        </DialogActions>
      </Dialog>
    </Grid>
  );
}

// ===========================================================================
// ABA USUÁRIOS (cadastro completo de Funcionário/Parceiro - PDF p.4)
// ===========================================================================
const EMPTY_EMPLOYEE_FORM = {
  name: '', email: '', password: '', role: 'TECHNICIAN',
  phone: '', ramal: '', cpf: '', rg: '', cnpj: '', ie: '', im: '',
  street: '', number: '', complement: '', district: '', zip: '', city: '', state: '',
  site: '', notes: '', commissionPercent: '',
};

function UsersTab({ onError, onFlash }: { onError: (m: string) => void; onFlash: (m: string) => void }) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['users'], queryFn: () => usersApi.list({ page: 1, limit: 100 }) });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState<any>({ ...EMPTY_EMPLOYEE_FORM });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['users'] });
  const set = (key: string, value: any) => setForm((f: any) => ({ ...f, [key]: value }));

  const openCreate = () => { setEditing(null); setForm({ ...EMPTY_EMPLOYEE_FORM }); setOpen(true); };
  const openEdit = (u: any) => {
    setEditing(u);
    setForm({
      ...EMPTY_EMPLOYEE_FORM,
      ...u,
      password: '',
      commissionPercent: u.commissionPercent ?? '',
    });
    setOpen(true);
  };

  const payload = () => {
    const body: any = { ...form };
    if (!body.password) delete body.password;
    if (body.commissionPercent === '' || body.commissionPercent === null || Number.isNaN(Number(body.commissionPercent))) {
      body.commissionPercent = null;
    } else {
      body.commissionPercent = Number(body.commissionPercent);
    }
    return body;
  };

  const createMutation = useMutation({
    mutationFn: () => usersApi.create(payload()),
    onSuccess: () => {
      invalidate(); setOpen(false);
      setForm({ ...EMPTY_EMPLOYEE_FORM });
      onFlash('Funcionário criado!');
    },
    onError: (err: any) => onError(err.response?.data?.message || 'Erro ao criar usuário'),
  });

  const updateMutation = useMutation({
    mutationFn: () => usersApi.update(editing.id, payload()),
    onSuccess: () => { invalidate(); setOpen(false); onFlash('Funcionário atualizado!'); },
    onError: (err: any) => onError(err.response?.data?.message || 'Erro ao atualizar usuário'),
  });

  const toggleMutation = useMutation({
    mutationFn: (id: string) => usersApi.toggleActive(id),
    onSuccess: () => { invalidate(); onFlash('Usuário atualizado.'); },
    onError: (err: any) => onError(err.response?.data?.message || 'Erro ao alterar usuário'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => usersApi.delete(id),
    onSuccess: () => { invalidate(); onFlash('Usuário excluído.'); },
    onError: (err: any) => onError(err.response?.data?.message || 'Erro ao excluir usuário'),
  });

  const valid = form.name.trim() && form.email.trim() && (editing || form.password.length >= 6);

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3, flexWrap: 'wrap', gap: 1 }}>
        <Box>
          <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <People fontSize="small" /> Funcionários / Usuários
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Cadastro completo (endereço, documentos, contato, comissão). O limite de usuários é definido pela licença ativa (maxUsers).
          </Typography>
        </Box>
        <PrimaryButton startIcon={<Add />} onClick={openCreate}>Novo Funcionário</PrimaryButton>
      </Box>

      <Card>
        <CardContent>
          {isLoading ? (
            <Skeleton variant="rectangular" height={180} />
          ) : (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Código</TableCell>
                    <TableCell>Nome</TableCell>
                    <TableCell>E-mail</TableCell>
                    <TableCell>CPF/CNPJ</TableCell>
                    <TableCell>Telefone</TableCell>
                    <TableCell>Perfil</TableCell>
                    <TableCell align="center">Ativo</TableCell>
                    <TableCell align="center">Ações</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(data?.data || []).map((u: any) => (
                    <TableRow key={u.id} hover>
                      <TableCell>{u.code || '—'}</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>{u.name}</TableCell>
                      <TableCell>{u.email}</TableCell>
                      <TableCell>{u.cnpj || u.cpf || '—'}</TableCell>
                      <TableCell>{u.phone || '—'}</TableCell>
                      <TableCell>
                        <Chip size="small" color={u.role === 'ADMIN' ? 'primary' : u.role === 'TECHNICIAN' ? 'info' : 'default'}
                          label={USER_ROLES.find((r) => r.value === u.role)?.label || u.role} />
                      </TableCell>
                      <TableCell align="center">
                        <Switch size="small" checked={!!u.active} onChange={() => toggleMutation.mutate(u.id)} />
                      </TableCell>
                      <TableCell align="center">
                        <IconButton size="small" onClick={() => openEdit(u)}><Edit fontSize="small" /></IconButton>
                        <IconButton size="small" color="error" onClick={() => {
                          if (window.confirm(`Excluir o usuário "${u.name}"?`)) deleteMutation.mutate(u.id);
                        }}>
                          <Delete fontSize="small" />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!(data?.data || []).length && (
                    <TableRow><TableCell colSpan={8}>Nenhum usuário encontrado.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="md">
        <DialogTitle>{editing ? `Editar ${editing.name}` : 'Novo Funcionário'}</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid item xs={12} sm={6}>
              <TextField fullWidth label="Nome *" value={form.name}
                onChange={(e) => set('name', e.target.value)} />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField fullWidth label="E-mail *" type="email" value={form.email}
                onChange={(e) => set('email', e.target.value)} />
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField fullWidth label={editing ? 'Nova senha (deixe vazio para manter)' : 'Senha *'} type="password" value={form.password}
                onChange={(e) => set('password', e.target.value)}
                helperText={editing ? 'Preencha apenas se quiser trocar' : 'Mínimo de 6 caracteres'} />
            </Grid>
            <Grid item xs={12} sm={4}>
              <FormControl fullWidth>
                <InputLabel>Perfil</InputLabel>
                <Select value={form.role} label="Perfil"
                  onChange={(e) => set('role', e.target.value)}>
                  {USER_ROLES.map((r) => <MenuItem key={r.value} value={r.value}>{r.label}</MenuItem>)}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField fullWidth label="% Comissão" type="number" value={form.commissionPercent}
                onChange={(e) => set('commissionPercent', e.target.value)}
                inputProps={{ step: 0.1, min: 0, max: 100 }} />
            </Grid>

            {/* Contato */}
            <Grid item xs={12}>
              <Typography variant="caption" color="text.secondary">CONTATO</Typography>
            </Grid>
            <Grid item xs={12} sm={3}>
              <TextField fullWidth label="Telefone" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
            </Grid>
            <Grid item xs={12} sm={3}>
              <TextField fullWidth label="Ramal" value={form.ramal} onChange={(e) => set('ramal', e.target.value)} />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField fullWidth label="Site" value={form.site} onChange={(e) => set('site', e.target.value)} placeholder="https://" />
            </Grid>

            {/* Documentos */}
            <Grid item xs={12}>
              <Typography variant="caption" color="text.secondary">DOCUMENTOS</Typography>
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField fullWidth label="CPF" value={form.cpf} onChange={(e) => set('cpf', e.target.value)} />
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField fullWidth label="RG" value={form.rg} onChange={(e) => set('rg', e.target.value)} />
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField fullWidth label="CNPJ" value={form.cnpj} onChange={(e) => set('cnpj', e.target.value)} />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField fullWidth label="Inscrição Estadual" value={form.ie} onChange={(e) => set('ie', e.target.value)} />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField fullWidth label="Inscrição Municipal" value={form.im} onChange={(e) => set('im', e.target.value)} />
            </Grid>

            {/* Endereço */}
            <Grid item xs={12}>
              <Typography variant="caption" color="text.secondary">ENDEREÇO</Typography>
            </Grid>
            <Grid item xs={12} sm={5}>
              <TextField fullWidth label="Rua / Avenida" value={form.street} onChange={(e) => set('street', e.target.value)} />
            </Grid>
            <Grid item xs={12} sm={1}>
              <TextField fullWidth label="Nº" value={form.number} onChange={(e) => set('number', e.target.value)} />
            </Grid>
            <Grid item xs={12} sm={3}>
              <TextField fullWidth label="Complemento" value={form.complement} onChange={(e) => set('complement', e.target.value)} />
            </Grid>
            <Grid item xs={12} sm={3}>
              <TextField fullWidth label="Bairro" value={form.district} onChange={(e) => set('district', e.target.value)} />
            </Grid>
            <Grid item xs={12} sm={3}>
              <TextField fullWidth label="CEP" value={form.zip} onChange={(e) => set('zip', e.target.value)} />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField fullWidth label="Cidade" value={form.city} onChange={(e) => set('city', e.target.value)} />
            </Grid>
            <Grid item xs={12} sm={3}>
              <TextField fullWidth label="Estado (UF)" value={form.state} onChange={(e) => set('state', e.target.value)}
                inputProps={{ maxLength: 2 }} />
            </Grid>

            <Grid item xs={12}>
              <TextField fullWidth label="Observações" multiline rows={2} value={form.notes}
                onChange={(e) => set('notes', e.target.value)} />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <SecondaryButton onClick={() => setOpen(false)}>Cancelar</SecondaryButton>
          <PrimaryButton loading={createMutation.isPending || updateMutation.isPending} disabled={!valid}
            onClick={() => (editing ? updateMutation.mutate() : createMutation.mutate())}>
            {editing ? 'Salvar' : 'Criar Funcionário'}
          </PrimaryButton>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
