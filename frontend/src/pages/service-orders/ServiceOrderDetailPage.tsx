import { Box, Card, CardContent, Typography, Grid, Chip, IconButton, Button, Divider, TableContainer, Table, TableHead, TableBody, TableRow, TableCell, Alert, CircularProgress, Tabs, Tab, Avatar, Dialog, DialogTitle, DialogContent, DialogActions, TextField, Tooltip, Paper, Switch, FormControlLabel, MenuItem } from '@mui/material';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import { serviceOrdersApi } from '../../services/api';
import { PrimaryButton, SecondaryButton, DangerButton } from '../../components/ui/Buttons';
import { OSStatusChip } from '../../components/ui/StatusChips';
import { OSStatus } from '../../types';
import { formatCurrency, formatDate, formatDateTime } from '../../utils/formatters';
import { Edit, Delete, CheckCircle, Build, Visibility, Print, LocalShipping, Cancel, Lock, LockOpen, Add, PhotoCamera, QrCode, Description, Schedule, Directions } from '@mui/icons-material';
import { useOSRealtime } from '../../hooks/useOSRealtime';
import { OSChecklist } from '../../components/os/OSChecklist';
import { OSRealtimeNotes } from '../../components/os/OSRealtimeNotes';
import { OSPhotoUpload } from '../../components/os/OSPhotoUpload';
import { OSVisitsTab } from '../../components/os/OSVisitsTab';

// Briefing PDF p.6/7: opções da "forma de pagamento combinada" (mesmas do formulário)
const PAYMENT_METHOD_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'DINHEIRO', label: 'Dinheiro' },
  { value: 'PIX', label: 'PIX' },
  { value: 'CARTAO_CREDITO', label: 'Cartão de Crédito' },
  { value: 'CARTAO_DEBITO', label: 'Cartão Débito' },
  { value: 'BOLETO', label: 'Boleto' },
  { value: 'TRANSFERENCIA', label: 'Transferência' },
  { value: 'A_PRAZO', label: 'A Prazo' },
  { value: 'OUTRO', label: 'Outro' },
];

const paymentMethodLabel = (value?: string | null) =>
  PAYMENT_METHOD_OPTIONS.find((o) => o.value === value)?.label || value || '';

// Body do PUT /service-orders/:id/closing
type ClosingPayload = {
  paymentMethod?: string | null;
  clientApproved?: boolean | null;
  clientContactNotes?: string | null;
  clientSummary?: string | null;
};

export function ServiceOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState(0);
  const [unlockDialogOpen, setUnlockDialogOpen] = useState(false);
  const [unlockPassword, setUnlockPassword] = useState('');
  const [unlockError, setUnlockError] = useState('');
  const [unlocking, setUnlocking] = useState(false);

  // Briefing PDF p.6/7: campos do card "Fechamento da O.S."
  const [paymentMethod, setPaymentMethod] = useState('');
  const [clientApproved, setClientApproved] = useState(false);
  const [clientContactNotes, setClientContactNotes] = useState('');
  const [clientSummary, setClientSummary] = useState('');
  const [closingFeedback, setClosingFeedback] = useState<{ message: string; severity: 'success' | 'error' } | null>(null);

  const { data: os, isLoading } = useQuery({ queryKey: ['serviceOrder', id], queryFn: () => serviceOrdersApi.get(id!) });

  // Inicializa os campos do fechamento uma única vez por O.S. (evita apagar edições não salvas em refetch)
  const [closingInitId, setClosingInitId] = useState<string | null>(null);
  useEffect(() => {
    if (!os || closingInitId === os.id) return;
    setPaymentMethod(os.paymentMethod || '');
    setClientApproved(os.clientApproved === true);
    setClientContactNotes(os.clientContactNotes || '');
    setClientSummary(os.clientSummary || '');
    setClosingInitId(os.id);
  }, [os, closingInitId]);

  const statusMutation = useMutation({
    mutationFn: (data: { status: string; note?: string; unlockPassword?: string }) => serviceOrdersApi.updateStatus(id!, data.status, data.unlockPassword || '', data.note),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['serviceOrder', id] }),
  });

  // Briefing PDF p.6/7: PUT /service-orders/:id/closing (forma de pagamento, contato e resumo)
  const closingMutation = useMutation({
    mutationFn: (data: ClosingPayload) => serviceOrdersApi.closing(id!, data),
  });

  const saveClosing = (data: ClosingPayload, successMessage: string) => {
    setClosingFeedback(null);
    closingMutation.mutate(data, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['serviceOrder', id] });
        queryClient.invalidateQueries({ queryKey: ['serviceOrders'] });
        setClosingFeedback({ message: successMessage, severity: 'success' });
      },
      onError: (e: any) => setClosingFeedback({ message: e.response?.data?.message || 'Erro ao salvar o fechamento', severity: 'error' }),
    });
  };

  const deleteMutation = useMutation({ mutationFn: () => serviceOrdersApi.delete(id!), onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['serviceOrders'] }); navigate('/service-orders'); } });

  const currentUser = JSON.parse(localStorage.getItem('user') || '{}');

  const { connected, movements, typingUsers, sendNote, setTyping, loadHistory } = useOSRealtime({
    osId: id!,
    enabled: true,
  });

  const handleUnlock = async () => {
    if (!unlockPassword.trim()) return;
    setUnlocking(true); setUnlockError('');
    try {
      await serviceOrdersApi.unlock(id!, unlockPassword);
      // Guarda na sessão p/ a tela de edição reusar a senha sem pedir de novo
      sessionStorage.setItem('os-unlock-' + id!, unlockPassword);
      setUnlockDialogOpen(false);
      setUnlockPassword('');
      queryClient.invalidateQueries({ queryKey: ['serviceOrder', id] });
      navigate('/service-orders/' + id + '/edit');
    }
    catch (e: any) { setUnlockError(e.response?.data?.message || 'Senha inválida'); }
    finally { setUnlocking(false); }
  };

  const handleStatusChange = (status: string, note?: string) => {
    if (os?.status === 'DELIVERED') { setUnlockDialogOpen(true); return; }
    statusMutation.mutate({ status, note });
  };

  const handleDelete = () => { if (window.confirm('Tem certeza que deseja excluir esta OS?')) deleteMutation.mutate(); };

  const handlePrint = (via: 'cliente' | 'tecnico') => { window.open('/service-orders/' + id + '/print?via=' + via, '_blank'); };

  if (isLoading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>;
  if (!os) return <Alert severity="error">OS não encontrada</Alert>;

  const canEdit = ['OPEN', 'IN_PROGRESS', 'WAITING_PARTS'].includes(os.status);
  // Briefing B1: O.S. concluída/entregue também edita, mas exige destravamento com senha
  const needsUnlockEdit = ['READY', 'DELIVERED'].includes(os.status);
  const isDelivered = os.status === 'DELIVERED';
  const canDelete = os.status === 'OPEN';

  // Extract map results to variables to avoid TS7.0.2 JSX map bug
  const itemRows = os.items.map((item: any) => {
    // Briefing C: comissão personalizada por item (% sobre o líquido ou R$ fixo)
    const commission = item.commissionType === 'VALUE'
      ? (item.commissionValue || 0)
      : ((item.total || 0) * (item.commissionPercent || 0)) / 100;
    return (
      <TableRow key={item.id}>
        <TableCell><Chip label={item.type === 'PART' ? 'Peça' : item.type === 'LABOR' ? 'Mão de Obra' : 'Serviço'} size="small" color={item.type === 'PART' ? 'primary' : item.type === 'LABOR' ? 'secondary' : 'info'} /></TableCell>
        <TableCell>{item.name}</TableCell>
        <TableCell>{item.qty}</TableCell>
        <TableCell align="right">{formatCurrency(item.unitPrice)}</TableCell>
        <TableCell align="right">{(item.discount || 0) > 0 ? <Typography variant="caption" color="error">{item.discountType === 'PERCENT' ? item.discount + '%' : formatCurrency(item.discount)}</Typography> : '-'}</TableCell>
        <TableCell align="right" sx={{ fontWeight: 500 }}>{formatCurrency(item.total)}</TableCell>
        <TableCell align="right">{commission > 0 ? formatCurrency(commission) : '-'}</TableCell>
      </TableRow>
    );
  });

  // Briefing O.S.: rótulos de exibição dos novos campos (entrega / conservação)
  const deliveryTypeLabel =
    os.deliveryType === 'PICKUP' ? 'Equipamento retirado pelo cliente'
    : os.deliveryType === 'DELIVERY' ? 'Levar/entregar ao cliente'
    : 'Não se aplica';
  const conditionLabel = (({ NOVO: 'Novo', OTIMO: 'Ótimo', BOM: 'Bom', RUIM: 'Ruim', PESSIMO: 'Péssimo' }) as Record<string, string>)[os.condition || ''] || os.condition || '-';

  const equipmentRows = os.equipment.map((eq: any, i: number) => (
    <Box key={i} sx={{ borderBottom: 1, borderColor: 'divider', py: 2, '&:last-child': { borderBottom: 'none' } }}>
      <Grid container spacing={2}>
        <Grid item xs={12} sm={6}>
          <Typography variant="subtitle1" fontWeight={500}>{eq.name}</Typography>
          <Typography variant="body2" color="text.secondary">{eq.brand} {eq.model}</Typography>
        </Grid>
        <Grid item xs={12} sm={6}>
          <Typography variant="body2" color="text.secondary">Série: {eq.serial || eq.serialNumber || 'Não informado'}</Typography>
        </Grid>
        <Grid item xs={12}>
          <Typography variant="body2" color="text.secondary">Defeito: {os.defect}</Typography>
        </Grid>
      </Grid>
    </Box>
  ));

  const movementRows = os.movements.map((mov: any, i: number) => (
    <Box key={mov.id} sx={{ display: 'flex', gap: 2, mb: 2, '&:last-child': { mb: 0 } }} style={{ borderLeft: '2px solid #e0e0e0', paddingLeft: 8 }}>
      <Box sx={{ minWidth: 40, textAlign: 'right', pt: 1, color: 'text.secondary' }}>
        <Typography variant="caption">{formatDateTime(mov.createdAt)}</Typography>
      </Box>
      <Box sx={{ flex: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
          {mov.fromStatus && <OSStatusChip status={mov.fromStatus as OSStatus} size="small" />}
          {mov.fromStatus && <Typography variant="body2">→</Typography>}
          <OSStatusChip status={mov.toStatus as OSStatus} size="small" />
          <Typography variant="body2" color="text.secondary" sx={{ ml: 1 }}>por {mov.user?.name}</Typography>
        </Box>
        {mov.note && <Typography variant="body2" sx={{ color: 'text.secondary', ml: 4, fontStyle: mov.fromStatus === mov.toStatus ? 'italic' : 'normal' }}>{mov.note}</Typography>}
      </Box>
    </Box>
  ));

  // Briefing PDF p.6/7: itens do select de pagamento (extraídos do return — bug de parse do TS 7)
  const paymentMethodMenuItems = PAYMENT_METHOD_OPTIONS.map((opt) => (
    <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
  ));

  /** Resumo p/ cliente montado com cabeçalho, diagnóstico, solução e total geral. */
  const buildClientSummary = () => [
    `Resumo do Serviço — OS #${os.osNumber ?? id?.slice(0, 8)}`,
    '',
    'Diagnóstico:',
    os.diagnosis?.trim() ? os.diagnosis : '(não informado)',
    '',
    'Solução:',
    os.solution?.trim() ? os.solution : '(não informado)',
    '',
    `Total Geral: ${formatCurrency(os.total || 0)}`,
  ].join('\n');

  const handleGenerateSummary = () => setClientSummary(buildClientSummary());

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3, flexWrap: 'wrap', gap: 2 }}>
        <Box><Typography variant="h4" fontWeight={700} sx={{ mb: 0.5 }}>OS #{os.osNumber}</Typography><Typography variant="body1" color="text.secondary">Cliente: {os.client?.name}</Typography></Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          {(canEdit || needsUnlockEdit) && (
            <Tooltip title={needsUnlockEdit ? 'Editar (requer destravamento)' : 'Editar'}>
              <IconButton onClick={() => { if (needsUnlockEdit) setUnlockDialogOpen(true); else navigate('/service-orders/' + id + '/edit'); }}>
                <Edit fontSize="medium" />
              </IconButton>
            </Tooltip>
          )}
          <Box sx={{ display: 'flex', gap: 1 }}>
            <IconButton color="primary" onClick={() => handlePrint('cliente')}><Print fontSize="medium" /></IconButton>
            <Tooltip title="Via do Técnico"><IconButton color="secondary" onClick={() => handlePrint('tecnico')}><Print fontSize="medium" /></IconButton></Tooltip>
          </Box>
          {canDelete && <Tooltip title="Excluir"><IconButton color="error" onClick={handleDelete}><Delete fontSize="medium" /></IconButton></Tooltip>}
        </Box>
      </Box>

      <Dialog open={unlockDialogOpen} onClose={() => { setUnlockDialogOpen(false); setUnlockPassword(''); setUnlockError(''); }} maxWidth="sm" fullWidth>
        <DialogTitle><Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}><Lock color="warning" fontSize="large" /><Typography>O.S. Concluída/Entregue — Destravar para Editar</Typography></Box></DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>Esta O.S. já foi concluída/entregue. Para editar, informe a senha de destravamento (senha de um administrador ou do vendedor responsável).</Alert>
          <TextField fullWidth type="password" label="Senha de Destrava" value={unlockPassword} onChange={(e) => setUnlockPassword(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') handleUnlock(); }} error={!!unlockError} helperText={unlockError} />
        </DialogContent>
        <DialogActions><Button onClick={() => { setUnlockDialogOpen(false); setUnlockPassword(''); setUnlockError(''); }}>Cancelar</Button><PrimaryButton onClick={handleUnlock} disabled={unlocking || !unlockPassword.trim()}>{unlocking ? 'Destrava...' : 'Destravar'}</PrimaryButton></DialogActions>
      </Dialog>

      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} lg={3}><Card><CardContent><Typography variant="caption" color="text.secondary">Status</Typography><OSStatusChip status={os.status as OSStatus} size="medium" sx={{ mt: 0.5 }} /></CardContent></Card></Grid>
        <Grid item xs={12} sm={6} lg={3}><Card><CardContent><Typography variant="caption" color="text.secondary">Peças</Typography><Typography variant="h6" fontWeight={700}>{formatCurrency(os.totalParts)}</Typography></CardContent></Card></Grid>
        <Grid item xs={12} sm={6} lg={3}><Card><CardContent><Typography variant="caption" color="text.secondary">Serviços</Typography><Typography variant="h6" fontWeight={700}>{formatCurrency(os.totalServices)}</Typography></CardContent></Card></Grid>
        <Grid item xs={12} sm={6} lg={3}><Card><CardContent><Typography variant="caption" color="text.secondary">Mão de Obra</Typography><Typography variant="h6" fontWeight={700}>{formatCurrency(os.totalLabor)}</Typography></CardContent></Card></Grid>
        <Grid item xs={12} sm={6} lg={3}><Card><CardContent><Typography variant="caption" color="text.secondary">Descontos</Typography><Typography variant="h6" fontWeight={700} color={os.totalParts + os.totalServices + os.totalLabor - os.total > 0 ? 'warning.main' : 'inherit'}>{formatCurrency(os.totalParts + os.totalServices + os.totalLabor - os.total)}</Typography></CardContent></Card></Grid>
        <Grid item xs={12} sm={6} lg={3}><Card sx={{ backgroundColor: 'primary.light', color: 'primary.contrastText' }}><CardContent><Typography variant="caption">Total Geral</Typography><Typography variant="h5" fontWeight={700}>{formatCurrency(os.total)}</Typography></CardContent></Card></Grid>
      </Grid>

      <Card sx={{ mb: 3 }}><CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="h6">Ações de Fluxo</Typography>
          {isDelivered && <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}><LockOpen color="warning" sx={{ mr: 0.5 }} /><Button variant="outlined" color="warning" onClick={() => setUnlockDialogOpen(true)} startIcon={<LockOpen />}>Destravar para Editar</Button></Box>}
        </Box>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          {os.status === 'OPEN' && (<><PrimaryButton startIcon={<Build />} onClick={() => handleStatusChange('IN_PROGRESS', 'Iniciado reparo')}>Iniciar Reparo</PrimaryButton><SecondaryButton color="warning" startIcon={<Build />} onClick={() => handleStatusChange('WAITING_PARTS', 'Aguardando peça')}>Aguardando Peças</SecondaryButton></>)}
          {os.status === 'IN_PROGRESS' && (<><SecondaryButton color="warning" startIcon={<Build />} onClick={() => handleStatusChange('WAITING_PARTS', 'Pausado - aguardando peça')}>Aguardando Peças</SecondaryButton><PrimaryButton startIcon={<CheckCircle />} onClick={() => handleStatusChange('READY', 'Reparo finalizado')}>Finalizar</PrimaryButton></>)}
          {os.status === 'WAITING_PARTS' && <PrimaryButton startIcon={<Build />} onClick={() => handleStatusChange('IN_PROGRESS', 'Peça chegou - continuando')}>Retomar Reparo</PrimaryButton>}
          {os.status === 'READY' && (<><SecondaryButton color="success" startIcon={<LocalShipping />} onClick={() => handleStatusChange('DELIVERED', 'Entregue ao cliente')}>Entregar</SecondaryButton><SecondaryButton startIcon={<Build />} onClick={() => handleStatusChange('IN_PROGRESS', 'Cliente solicitou ajuste')}>Reabrir</SecondaryButton></>)}
          {['OPEN', 'IN_PROGRESS', 'WAITING_PARTS', 'READY'].includes(os.status) && <DangerButton startIcon={<Cancel />} onClick={() => { if (window.confirm('Cancelar OS?')) handleStatusChange('CANCELLED', 'Cancelado'); }}>Cancelar</DangerButton>}
        </Box>
      </CardContent></Card>

      {/* Briefing PDF p.6/7: fechamento — forma de pagamento, contato com cliente e resumo */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 1 }}>
            <Typography variant="h6">Fechamento da O.S.</Typography>
            {closingFeedback && (
              <Alert severity={closingFeedback.severity} onClose={() => setClosingFeedback(null)} sx={{ py: 0 }}>
                {closingFeedback.message}
              </Alert>
            )}
          </Box>
          <Grid container spacing={3}>
            {/* 1. Forma de pagamento combinada */}
            <Grid item xs={12} md={4}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>Forma de pagamento combinada</Typography>
              <TextField
                select
                fullWidth
                size="small"
                label="Forma de pagamento"
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
              >
                <MenuItem value="">—</MenuItem>
                {paymentMethodMenuItems}
              </TextField>
              <PrimaryButton
                size="small"
                sx={{ mt: 1.5 }}
                disabled={closingMutation.isPending || paymentMethod === (os.paymentMethod || '')}
                onClick={() => saveClosing({ paymentMethod: paymentMethod || null }, 'Forma de pagamento salva')}
              >
                Salvar
              </PrimaryButton>
            </Grid>

            {/* 2. Contato com cliente */}
            <Grid item xs={12} md={4}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>Contato com Cliente</Typography>
              <FormControlLabel
                control={<Switch checked={clientApproved} onChange={(_, v) => setClientApproved(v)} />}
                label="Serviço aprovado pelo cliente"
              />
              <TextField
                fullWidth
                size="small"
                multiline
                rows={3}
                sx={{ mt: 1 }}
                label="Observações do contato (desconto concedido, combinados...)"
                value={clientContactNotes}
                onChange={(e) => setClientContactNotes(e.target.value)}
                placeholder="Ex.: concedido R$ 50 de desconto, cliente aprovou por telefone..."
              />
              <PrimaryButton
                size="small"
                sx={{ mt: 1.5 }}
                disabled={closingMutation.isPending
                  || (clientApproved === (os.clientApproved === true) && clientContactNotes === (os.clientContactNotes || ''))}
                onClick={() => saveClosing({ clientApproved, clientContactNotes }, 'Contato com o cliente salvo')}
              >
                Salvar
              </PrimaryButton>
            </Grid>

            {/* 3. Resumo p/ cliente */}
            <Grid item xs={12} md={4}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1, gap: 1 }}>
                <Typography variant="subtitle2">Resumo p/ Cliente</Typography>
                {!!os.clientSummary && <Chip size="small" color="success" variant="outlined" label="Resumo salvo" />}
              </Box>
              <TextField
                fullWidth
                size="small"
                multiline
                rows={6}
                label="Resumo para o cliente"
                value={clientSummary}
                onChange={(e) => setClientSummary(e.target.value)}
                placeholder="Clique em “Gerar” para montar a partir do diagnóstico, solução e totais"
              />
              <Box sx={{ mt: 1.5, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                <SecondaryButton size="small" onClick={handleGenerateSummary}>Gerar</SecondaryButton>
                <PrimaryButton
                  size="small"
                  disabled={closingMutation.isPending || clientSummary === (os.clientSummary || '')}
                  onClick={() => saveClosing({ clientSummary }, 'Resumo salvo')}
                >
                  Salvar
                </PrimaryButton>
              </Box>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      <Tabs value={activeTab} onChange={(_, v) => setActiveTab(v)} sx={{ mb: 3 }} variant="fullWidth" aria-label="OS Tabs">
        <Tab label="Detalhes" icon={<Visibility />} />
        <Tab label="Itens" icon={<Build />} />
        <Tab label="Equipamentos" icon={<Directions />} />
        <Tab label="Checklist" icon={<Description />} />
        <Tab label="Observações" icon={<Description />} />
        <Tab label="Fotos" icon={<PhotoCamera />} />
        <Tab label="Visitas" icon={<Schedule />} />
        <Tab label="Timeline" icon={<Schedule />} />
        <Tab label="Entrega & Observações" icon={<LocalShipping />} />
      </Tabs>

      {activeTab === 0 && (
        <Grid container spacing={3} sx={{ mb: 3 }}>
          <Grid item xs={12} lg={8}><Card><CardContent><Typography variant="h6" sx={{ mb: 2 }}>Informações do Cliente</Typography><Grid container spacing={2}>
            <Grid item xs={12} sm={6}><Typography variant="body2" color="text.secondary">Nome</Typography><Typography variant="body1" fontWeight={500}>{os.client?.name}</Typography></Grid>
            <Grid item xs={12} sm={6}><Typography variant="body2" color="text.secondary">Telefone</Typography><Typography variant="body1" fontWeight={500}>{os.client?.phone}</Typography></Grid>
            <Grid item xs={12} sm={6}><Typography variant="body2" color="text.secondary">Email</Typography><Typography variant="body1">{os.client?.email || '-'}</Typography></Grid>
            <Grid item xs={12} sm={6}><Typography variant="body2" color="text.secondary">CPF/CNPJ</Typography><Typography variant="body1">{os.client?.cpf || os.client?.cnpj || '-'}</Typography></Grid>
            <Grid item xs={12}><Typography variant="body2" color="text.secondary">Endereço</Typography><Typography variant="body1">{os.client?.address || os.client?.street ? (os.client?.street || '') + ', ' + (os.client?.number || '') + ' - ' + (os.client?.city || '') + ' - ' + (os.client?.state || '') : '-'}</Typography></Grid>
          </Grid></CardContent></Card></Grid>
          <Grid item xs={12} lg={4}><Card><CardContent><Typography variant="h6" sx={{ mb: 2 }}>Dados da OS</Typography><Grid container spacing={2}>
            <Grid item xs={12}><Typography variant="body2" color="text.secondary">Técnico</Typography><Typography variant="body1">{os.technician?.name || 'Não atribuído'}</Typography></Grid>
            <Grid item xs={12}><Typography variant="body2" color="text.secondary">Criado por</Typography><Typography variant="body1">{os.creator?.name}</Typography></Grid>
            <Grid item xs={12}><Typography variant="body2" color="text.secondary">Data de Abertura</Typography><Typography variant="body1">{formatDate(os.createdAt)}</Typography></Grid>
            <Grid item xs={12}><Typography variant="body2" color="text.secondary">Garantia</Typography><Typography variant="body1">{os.warrantyDays} dias</Typography></Grid>
            <Grid item xs={12}><Typography variant="body2" color="text.secondary">Tipo de Serviço</Typography><Typography variant="body1">{os.serviceType === 'EXTERNAL' ? 'Externo (no cliente)' : os.serviceType === 'REMOTE' ? 'Acesso Remoto' : 'Local (na loja)'}</Typography></Grid>
            {os.paymentMethod && (
              <Grid item xs={12}>
                <Typography variant="body2" color="text.secondary">Pagamento</Typography>
                <Chip size="small" color="primary" variant="outlined" label={`Forma de pagamento: ${paymentMethodLabel(os.paymentMethod)}`} sx={{ mt: 0.5 }} />
              </Grid>
            )}
            <Grid item xs={12}><Typography variant="body2" color="text.secondary">Origem Mão de Obra</Typography><Typography variant="body1">{os.laborSource === 'VISITS' ? 'Registro de Visitas' : 'Manual'}</Typography></Grid>
            <Grid item xs={12}><Typography variant="body2" color="text.secondary">Mão de Obra</Typography><Typography variant="body1">{os.laborHours}h × R$ {os.laborRate.toFixed(2)}</Typography></Grid>
            {os.budget && (
              <Grid item xs={12}>
                <Typography variant="body2" color="text.secondary">Orçamento de origem</Typography>
                <Chip
                  size="small"
                  color="primary"
                  variant="outlined"
                  clickable
                  label={`#${String(os.budget.id).slice(0, 8).toUpperCase()} · ${formatCurrency(os.budget.total || 0)}`}
                  onClick={() => navigate(`/budgets/${os.budget.id}`)}
                />
                {os.budget.defect && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>{os.budget.defect}</Typography>}
              </Grid>
            )}
            {os.startedAt && <Grid item xs={12}><Typography variant="body2" color="text.secondary">Iniciada em</Typography><Typography variant="body1">{formatDate(os.startedAt)}</Typography></Grid>}
            {os.finishedAt && <Grid item xs={12}><Typography variant="body2" color="text.secondary">Finalizada em</Typography><Typography variant="body1">{formatDate(os.finishedAt)}</Typography></Grid>}
            {os.deliveredAt && <Grid item xs={12}><Typography variant="body2" color="text.secondary">Entregue em</Typography><Typography variant="body1">{formatDate(os.deliveredAt)}</Typography></Grid>}
          </Grid></CardContent></Card></Grid>
        </Grid>
      )}

      {activeTab === 1 && <Card sx={{ mb: 3 }}><CardContent><Typography variant="h6" sx={{ mb: 2 }}>Itens da OS</Typography><TableContainer><Table><TableHead><TableRow><TableCell>Tipo</TableCell><TableCell>Item</TableCell><TableCell>Qtd</TableCell><TableCell align="right">Vl. Unit.</TableCell><TableCell align="right">Desc.</TableCell><TableCell align="right">Total</TableCell><TableCell align="right">Comissão</TableCell></TableRow></TableHead><TableBody>{itemRows}</TableBody></Table></TableContainer><Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 2, flexWrap: 'wrap', gap: 1 }}>{typeof os.totalCommission === 'number' && <Typography variant="body1" fontWeight={600} color="success.main">Comissão total: {formatCurrency(os.totalCommission)}</Typography>}<Typography variant="h6" fontWeight={700}>Total: {formatCurrency(os.total)}</Typography></Box></CardContent></Card>}

      {activeTab === 2 && <Card sx={{ mb: 3 }}><CardContent><Typography variant="h6" sx={{ mb: 2 }}>Equipamentos</Typography>{equipmentRows}</CardContent></Card>}

      {activeTab === 3 && <Card sx={{ mb: 3 }}><CardContent><OSChecklist checklist={os.checklist} onChange={(checklist) => serviceOrdersApi.updateChecklist(id!, checklist).then(() => queryClient.invalidateQueries({ queryKey: ['serviceOrder', id] }))} editable={canEdit && !isDelivered} title="Checklist do Serviço" /></CardContent></Card>}

      {activeTab === 4 && <Card sx={{ mb: 3, height: 600, display: 'flex', flexDirection: 'column' }}><CardContent sx={{ flex: 1, p: 2 }}><OSRealtimeNotes osId={id!} currentUserId={currentUser.id} currentUserName={currentUser.name} movements={os.movements} onMovementsChange={(movements) => queryClient.setQueryData(['serviceOrder', id], (old: any) => old ? { ...old, movements } : old)} /></CardContent></Card>}

      {activeTab === 5 && <Card sx={{ mb: 3 }}><CardContent><OSPhotoUpload osId={id!} photos={os.photos} onPhotosChange={(photos) => queryClient.setQueryData(['serviceOrder', id], (old: any) => old ? { ...old, photos } : old)} /></CardContent></Card>}

      {activeTab === 6 && <Card sx={{ mb: 3 }}><CardContent><OSVisitsTab osId={id!} visits={os.visits} onVisitsChange={(visits) => queryClient.setQueryData(['serviceOrder', id], (old: any) => old ? { ...old, visits } : old)} editable={canEdit && !isDelivered} clientAddresses={os.client?.addresses} currentUserId={currentUser.id} currentUserRole={currentUser.role} /></CardContent></Card>}

      {activeTab === 7 && <Card><CardContent><Typography variant="h6" sx={{ mb: 2 }}>Histórico de Movimentos</Typography>{movementRows}</CardContent></Card>}

      {/* Briefing O.S.: entrega, equipamento recebido e observações internas × externas */}
      {activeTab === 8 && (
        <Grid container spacing={3} sx={{ mb: 3 }}>
          <Grid item xs={12} md={4}>
            <Card sx={{ height: '100%' }}>
              <CardContent>
                <Typography variant="h6" sx={{ mb: 2 }}>Dados da entrega</Typography>
                <Grid container spacing={2}>
                  <Grid item xs={12}>
                    <Typography variant="body2" color="text.secondary">Tipo</Typography>
                    <Typography variant="body1" fontWeight={500}>{deliveryTypeLabel}</Typography>
                  </Grid>
                  <Grid item xs={12}>
                    <Typography variant="body2" color="text.secondary">Valor de entrega</Typography>
                    <Typography variant="body1" fontWeight={500}>{formatCurrency(os.deliveryValue || 0)}</Typography>
                  </Grid>
                  <Grid item xs={12}>
                    <Typography variant="body2" color="text.secondary">Entrega concluída</Typography>
                    <Chip
                      size="small"
                      label={os.deliveryDone ? 'Sim' : 'Não'}
                      color={os.deliveryDone ? 'success' : 'default'}
                      variant="outlined"
                      sx={{ mt: 0.5 }}
                    />
                  </Grid>
                </Grid>
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={12} md={4}>
            <Card sx={{ height: '100%' }}>
              <CardContent>
                <Typography variant="h6" sx={{ mb: 2 }}>Equipamento - entrega</Typography>
                <Grid container spacing={2}>
                  <Grid item xs={12}>
                    <Typography variant="body2" color="text.secondary">Acessórios</Typography>
                    <Typography variant="body1">{os.accessories || 'Nenhum informado'}</Typography>
                  </Grid>
                  <Grid item xs={12}>
                    <Typography variant="body2" color="text.secondary">Estado de conservação</Typography>
                    <Typography variant="body1">{conditionLabel}</Typography>
                  </Grid>
                  <Grid item xs={12}>
                    <Typography variant="body2" color="text.secondary">Senha do aparelho</Typography>
                    <Typography variant="body1" sx={{ fontFamily: 'monospace' }}>{os.devicePassword || 'Não informada'}</Typography>
                  </Grid>
                  <Grid item xs={12}>
                    <Typography variant="body2" color="text.secondary">Quem deixou o equipamento / contato</Typography>
                    <Typography variant="body1">{os.droppedOffBy || 'Não informado'}</Typography>
                  </Grid>
                </Grid>
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={12} md={4}>
            <Card sx={{ height: '100%' }}>
              <CardContent>
                <Typography variant="h6" sx={{ mb: 2 }}>Observações</Typography>
                <Grid container spacing={2}>
                  <Grid item xs={12}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                      <Lock fontSize="small" color="warning" />
                      <Typography variant="body2" color="text.secondary">Observações internas - NÃO aparece impressa</Typography>
                    </Box>
                    <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>{os.internalNotes || '—'}</Typography>
                  </Grid>
                  <Grid item xs={12}>
                    <Divider sx={{ my: 1 }} />
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                      <Print fontSize="small" color="primary" />
                      <Typography variant="body2" color="text.secondary">Observações externas - aparece no impresso da O.S.</Typography>
                    </Box>
                    <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>{os.externalNotes || '—'}</Typography>
                  </Grid>
                </Grid>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}

    </Box>
  );
}