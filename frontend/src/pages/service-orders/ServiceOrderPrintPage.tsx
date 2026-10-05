import { Box, Typography, Grid, Divider, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper, Button, IconButton, Tabs, Tab } from '@mui/material';
import { useState, useEffect, useRef } from 'react';
import { Print, Close, ArrowDownward } from '@mui/icons-material';
import { useParams, useNavigate } from 'react-router-dom';
import { serviceOrdersApi } from '../../services/api';
import type { ServiceOrder, ServiceAddress, ServiceVisit } from '../../types';
import { formatCurrency, formatDate, formatDateTime } from '../../utils/formatters';

type ViaType = 'cliente' | 'tecnico';

// Briefing: rótulos brutos de forma de pagamento (se não mapear, exibe o valor cru)
const PAYMENT_METHOD_LABELS: Record<string, string> = {
  DINHEIRO: 'Dinheiro',
  PIX: 'PIX',
  CARTAO_CREDITO: 'Cartão de Crédito',
  CARTAO_DEBITO: 'Cartão de Débito',
  BOLETO: 'Boleto',
  TRANSFERENCIA: 'Transferência',
  OUTRO: 'Outro',
};

export function ServiceOrderPrintPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [os, setOs] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeVia, setActiveVia] = useState<ViaType>('cliente');
  const [printReady, setPrintReady] = useState(false);
  const printContentRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (id) { serviceOrdersApi.get(id).then(data => { setOs(data.data || data); setLoading(false); setTimeout(() => setPrintReady(true), 100); }).catch(() => { setLoading(false); }); } }, [id]);

  // Define o título do documento para o nome do arquivo ao salvar como PDF
  useEffect(() => {
    if (os?.osNumber) {
      document.title = `OS-${os.osNumber} - Papatec`;
    }
  }, [os?.osNumber]);

  const handlePrint = () => { if (printContentRef.current) window.print(); };

  const formatAddress = (addr?: any) => { if (!addr) return 'Não informado'; const parts = [addr.street, addr.number, addr.complement, addr.district, addr.zip, addr.city, addr.state].filter(Boolean); return parts.join(', ') || 'Não informado'; };

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}><Typography>Carregando...</Typography></Box>;
  if (!os) return <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}><Typography>Ordem de Serviço não encontrada</Typography></Box>;

  // ---- Derivados compartilhados (não dependem da via) ----
  const totalParts = os.items?.filter((i: any) => i.type === 'PART').reduce((sum: number, i: any) => sum + (i.total || 0), 0) || 0;
  const totalServices = os.items?.filter((i: any) => i.type === 'SERVICE').reduce((sum: number, i: any) => sum + (i.total || 0), 0) || 0;
  const totalLabor = os.items?.filter((i: any) => i.type === 'LABOR').reduce((sum: number, i: any) => sum + (i.total || 0), 0) || 0;
  const laborManual = (os.laborHours || 0) * (os.laborRate || 0);

  // Briefing C / fechamento de O.S.: resumo p/ cliente com horas apontadas
  const isClosing = os.status === 'READY' || os.status === 'DELIVERED';
  const closedVisits = (os.visits || []).filter((v: any) => v.arrival && v.departure);
  const visitHours = closedVisits.reduce((sum: number, v: any) => sum + (new Date(v.departure).getTime() - new Date(v.arrival).getTime()) / 3_600_000, 0);
  const visitHoursLabel = visitHours > 0 ? `${Math.floor(visitHours)}h ${Math.round((visitHours % 1) * 60)}min` : null;

  // Briefing O.S.: rótulos dos novos campos impressos (entrega / conservação)
  const conditionLabel = (({ NOVO: 'Novo', OTIMO: 'Ótimo', BOM: 'Bom', RUIM: 'Ruim', PESSIMO: 'Péssimo' }) as Record<string, string>)[os.condition || ''] || os.condition || '';
  const deliveryLabel =
    os.deliveryType === 'PICKUP' ? 'Equipamento retirado pelo cliente'
    : os.deliveryType === 'DELIVERY' ? 'Levar/entregar ao cliente'
    : 'Não se aplica';

  // Briefing: tipo de atendimento + forma de pagamento (ambas as vias)
  const serviceTypeLabel =
    os.serviceType === 'EXTERNAL' ? 'Visita externa (no local do cliente)'
    : os.serviceType === 'REMOTE' ? 'Acesso remoto'
    : 'Local (na loja)';
  const paymentMethodLabel = os.paymentMethod ? (PAYMENT_METHOD_LABELS[os.paymentMethod] || os.paymentMethod) : null;

  // Extract map results to variables for TS7.0.2 bug
  const equipmentRows = os.equipment?.map((eq: any, idx: number) => (
    <Box key={idx} sx={{ mb: 1, p: 1, border: 1, borderColor: 'divider', borderRadius: 1 }}>
      <Grid container spacing={1}>
        <Grid item xs={12} sm={6}><Typography variant="body2" color="text.secondary">Nome</Typography><Typography variant="body1" sx={{ fontWeight: 500 }}>{eq.name}</Typography></Grid>
        <Grid item xs={12} sm={6}><Typography variant="body2" color="text.secondary">Marca / Modelo</Typography><Typography variant="body1">{eq.brand || ''} {eq.model || ''}</Typography></Grid>
        <Grid item xs={12} sm={6}><Typography variant="body2" color="text.secondary">N° Série</Typography><Typography variant="body1">{eq.serial || eq.serialNumber || 'Não informado'}</Typography></Grid>
        <Grid item xs={12} sm={6}><Typography variant="body2" color="text.secondary">Defeito Relatado</Typography><Typography variant="body1">{os.defect}</Typography></Grid>
      </Grid>
    </Box>
  ));

  const checklistRows = os.checklist?.map((item: any, idx: number) => (
    <Box key={idx} sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1, border: 1, borderColor: 'divider', borderRadius: 1 }}>
      <input type="checkbox" checked={item.done} disabled style={{ width: 20, height: 20 }} />
      <Typography variant="body1" sx={{ textDecoration: item.done ? 'line-through' : 'none', color: item.done ? 'text.secondary' : 'text.primary', flex: 1 }}>{item.label}</Typography>
    </Box>
  ));

  const visitRows = os.visits?.map((visit: any, idx: number) => (
    <Box key={idx} sx={{ mb: 1, p: 1, border: 1, borderColor: 'divider', borderRadius: 1 }}>
      <Grid container spacing={1}>
        <Grid item xs={12} sm={6}><Typography variant="body2" color="text.secondary">Data / Horário</Typography><Typography variant="body1">{formatDate(visit.date)} {visit.scheduledAt ? 'às ' + formatDateTime(visit.scheduledAt).split(' ')[1] : ''}</Typography></Grid>
        <Grid item xs={12} sm={6}><Typography variant="body2" color="text.secondary">Status</Typography><Typography variant="body1" sx={{ textTransform: 'capitalize' }}>{visit.appointmentStatus}</Typography></Grid>
        {visit.arrival && <Grid item xs={6}><Typography variant="body2" color="text.secondary">Entrada</Typography><Typography variant="body1">{formatDateTime(visit.arrival).split(' ')[1]}</Typography></Grid>}
        {visit.departure && <Grid item xs={6}><Typography variant="body2" color="text.secondary">Saída</Typography><Typography variant="body1">{formatDateTime(visit.departure).split(' ')[1]}</Typography></Grid>}
        <Grid item xs={12}><Typography variant="body2" color="text.secondary">Endereço</Typography><Typography variant="body1">{visit.address ? visit.address.street + ', ' + (visit.address.number || '') + ' - ' + (visit.address.city || '') : 'Não informado'}</Typography></Grid>
        {visit.notes && <Grid item xs={12}><Typography variant="body2" color="text.secondary">Observações</Typography><Typography variant="body1">{visit.notes}</Typography></Grid>}
      </Grid>
    </Box>
  ));

  // ---- Render de cada via (cliente / técnico) ----
  const renderVia = (via: ViaType) => {
    const isTecnico = via === 'tecnico';
    const showResumo = isTecnico || isClosing;

    const itemRows = os.items?.map((item: any, idx: number) => (
      <TableRow key={idx}>
        <TableCell><Typography variant="caption" sx={{ textTransform: 'capitalize' }}>{item.type === 'PART' ? 'Peça' : item.type === 'SERVICE' ? 'Serviço' : 'Mão de Obra'}</Typography></TableCell>
        <TableCell>{item.name}</TableCell>
        <TableCell align="right">{item.qty}</TableCell>
        <TableCell align="right">{formatCurrency(item.unitPrice)}</TableCell>
        {isTecnico && <TableCell align="right">{(item.discount || 0) > 0 ? <Typography variant="caption" color="error">{item.discountType === 'PERCENT' ? item.discount + '%' : formatCurrency(item.discount)}</Typography> : '-'}</TableCell>}
        <TableCell align="right" sx={{ fontWeight: 600 }}>{formatCurrency(item.total)}</TableCell>
      </TableRow>
    ));

    // Via do cliente: box resumido "Horário Marcado" (sem entrada/saída/observações/status)
    const horarioMarcadoRows = via === 'cliente' && (os.visits?.length > 0) ? os.visits.map((visit: any, idx: number) => (
      <Box key={idx} sx={{ mb: idx < os.visits.length - 1 ? 1 : 0, p: 1.5, border: 1, borderColor: 'divider', borderRadius: 1 }}>
        <Grid container spacing={1}>
          <Grid item xs={12} sm={4}><Typography variant="body2" color="text.secondary">Data</Typography><Typography variant="body1" sx={{ fontWeight: 500 }}>{formatDate(visit.date)}</Typography></Grid>
          <Grid item xs={12} sm={4}><Typography variant="body2" color="text.secondary">Horário agendado</Typography><Typography variant="body1" sx={{ fontWeight: 500 }}>{visit.scheduledAt ? 'às ' + formatDateTime(visit.scheduledAt).split(' ')[1] : ''}</Typography></Grid>
          <Grid item xs={12} sm={4}><Typography variant="body2" color="text.secondary">Endereço</Typography><Typography variant="body1">{visit.address ? formatAddress(visit.address) : formatAddress(os.serviceAddress)}</Typography></Grid>
        </Grid>
      </Box>
    )) : [];

    return (
      <Paper sx={{ p: { xs: 2, sm: 3 }, '@media print': { boxShadow: 'none', border: 'none', padding: 0, pageBreakInside: 'auto' } }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 3, pb: 2, borderBottom: 2, borderColor: 'primary.main' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <img src="/images/logo-papatec.png" alt="Papatec" style={{ width: 60, height: 60, objectFit: 'contain' }} />
            <Box>
              <Typography variant="h4" sx={{ fontWeight: 700, color: 'primary.main', lineHeight: 1.2 }}>Papatec - Ordem de Serviço</Typography>
              <Typography variant="body2" color="text.secondary">Assistência Técnica & Vendas</Typography>
            </Box>
          </Box>
          <Box sx={{ textAlign: 'right' }}><Typography variant="h5" sx={{ fontWeight: 700, color: 'primary.main' }}>{isTecnico ? 'VIA DO TÉCNICO' : 'VIA DO CLIENTE'}</Typography><Typography variant="body1" sx={{ fontWeight: 600 }}>OS #{os.osNumber}</Typography><Typography variant="caption" color="text.secondary">{formatDateTime(os.createdAt)}</Typography></Box>
        </Box>

        <Box sx={{ mb: 3 }}><Typography variant="h6" sx={{ mb: 1, color: 'primary.main', borderBottom: 1, borderColor: 'primary.main', pb: 0.5 }}>Dados do Cliente</Typography><Grid container spacing={2}>
          <Grid item xs={12} sm={6}><Typography variant="body2" color="text.secondary">Nome</Typography><Typography variant="body1" sx={{ fontWeight: 500 }}>{os.client?.name}</Typography></Grid>
          <Grid item xs={12} sm={6}><Typography variant="body2" color="text.secondary">Código</Typography><Typography variant="body1" sx={{ fontWeight: 500 }}>{os.client?.code || '—'}</Typography></Grid>
          <Grid item xs={12} sm={6}><Typography variant="body2" color="text.secondary">Telefone</Typography><Typography variant="body1" sx={{ fontWeight: 500 }}>{os.client?.phone}</Typography></Grid>
          <Grid item xs={12} sm={6}><Typography variant="body2" color="text.secondary">CPF/CNPJ</Typography><Typography variant="body1" sx={{ fontWeight: 500 }}>{os.client?.cpf || os.client?.cnpj || 'Não informado'}</Typography></Grid>
          <Grid item xs={12} sm={6}><Typography variant="body2" color="text.secondary">Email</Typography><Typography variant="body1" sx={{ fontWeight: 500 }}>{os.client?.email || 'Não informado'}</Typography></Grid>
          <Grid item xs={12} sm={6}><Typography variant="body2" color="text.secondary">Tipo de atendimento</Typography><Typography variant="body1" sx={{ fontWeight: 500 }}>{serviceTypeLabel}</Typography></Grid>
        </Grid></Box>

        {(os.serviceType === 'EXTERNAL' && os.serviceAddress) && <Box sx={{ mb: 3, p: 2, bgcolor: 'info.light', borderRadius: 1, border: 1, borderColor: 'info.main' }}><Typography variant="h6" sx={{ mb: 1, color: 'info.dark' }}>Endereço Para Serviço</Typography><Typography variant="body1">{formatAddress(os.serviceAddress)}</Typography></Box>}

        {/* Via do cliente: horários marcados (data + horário + endereço), detalhes técnicos só na via do técnico */}
        {via === 'cliente' && (os.visits?.length > 0) && (
          <Box sx={{ mb: 3 }}>
            <Typography variant="h6" sx={{ mb: 1, color: 'primary.main', borderBottom: 1, borderColor: 'primary.main', pb: 0.5 }}>Horário Marcado</Typography>
            {horarioMarcadoRows}
          </Box>
        )}

        <Box sx={{ mb: 3 }}><Typography variant="h6" sx={{ mb: 1, color: 'primary.main', borderBottom: 1, borderColor: 'primary.main', pb: 0.5 }}>Equipamento(s)</Typography>{equipmentRows}</Box>

        {/* Briefing O.S.: acessórios/estado/quem deixou — senha apenas na via do técnico (via loja) */}
        {(os.accessories || os.condition || os.droppedOffBy || (isTecnico && os.devicePassword)) && (
          <Box sx={{ mb: 3 }}>
            <Typography variant="h6" sx={{ mb: 1, color: 'primary.main', borderBottom: 1, borderColor: 'primary.main', pb: 0.5 }}>Equipamento - Entrega</Typography>
            <Grid container spacing={2}>
              {os.accessories && <Grid item xs={12} sm={6}><Typography variant="body2" color="text.secondary">Acessórios</Typography><Typography variant="body1">{os.accessories}</Typography></Grid>}
              {os.condition && <Grid item xs={12} sm={6}><Typography variant="body2" color="text.secondary">Estado de conservação</Typography><Typography variant="body1">{conditionLabel}</Typography></Grid>}
              {os.droppedOffBy && <Grid item xs={12} sm={6}><Typography variant="body2" color="text.secondary">Quem deixou o equipamento / contato</Typography><Typography variant="body1">{os.droppedOffBy}</Typography></Grid>}
              {isTecnico && os.devicePassword && <Grid item xs={12} sm={6}><Typography variant="body2" color="text.secondary">Senha do aparelho (uso interno)</Typography><Typography variant="body1" sx={{ fontFamily: 'monospace' }}>{os.devicePassword}</Typography></Grid>}
            </Grid>
          </Box>
        )}

        {/* Briefing: linha de entrega/retirada (aparece em ambas as vias) */}
        {os.deliveryType && os.deliveryType !== 'NONE' && (
          <Box sx={{ mb: 3, p: 1.5, border: 1, borderColor: 'divider', borderRadius: 1 }}>
            <Grid container spacing={1}>
              <Grid item xs={12} sm={4}><Typography variant="body2" color="text.secondary">Entrega / Retirada</Typography><Typography variant="body1">{deliveryLabel}</Typography></Grid>
              <Grid item xs={6} sm={4}><Typography variant="body2" color="text.secondary">Valor</Typography><Typography variant="body1">{formatCurrency(os.deliveryValue || 0)}</Typography></Grid>
              <Grid item xs={6} sm={4}><Typography variant="body2" color="text.secondary">Status</Typography><Typography variant="body1">{os.deliveryDone ? 'Concluída' : 'Pendente'}</Typography></Grid>
            </Grid>
          </Box>
        )}

        <Box sx={{ mb: 3 }}><Typography variant="h6" sx={{ mb: 1, color: 'primary.main', borderBottom: 1, borderColor: 'primary.main', pb: 0.5 }}>Itens do Serviço</Typography><TableContainer><Table size="small"><TableHead><TableRow><TableCell>Tipo</TableCell><TableCell>Descrição</TableCell><TableCell>Qtd</TableCell><TableCell align="right">Vl. Unit.</TableCell>{isTecnico && <TableCell align="right">Desc.</TableCell>}<TableCell align="right">Total</TableCell></TableRow></TableHead><TableBody>{itemRows}</TableBody></Table></TableContainer></Box>

        <Box sx={{ mb: 3 }}><Typography variant="h6" sx={{ mb: 1, color: 'primary.main', borderBottom: 1, borderColor: 'primary.main', pb: 0.5 }}>Totais</Typography><TableContainer><Table size="small"><TableBody>
          <TableRow><TableCell>Total Peças</TableCell><TableCell align="right">{formatCurrency(totalParts)}</TableCell></TableRow>
          <TableRow><TableCell>Total Serviços</TableCell><TableCell align="right">{formatCurrency(totalServices)}</TableCell></TableRow>
          <TableRow><TableCell>Mão de Obra</TableCell><TableCell align="right">{formatCurrency(laborManual + totalLabor)}</TableCell></TableRow>
          {isTecnico && os.items?.some((i: any) => (i.discount || 0) > 0) && <TableRow><TableCell>Total Descontos</TableCell><TableCell align="right" color="error">-{formatCurrency(os.items.reduce((s: number, i: any) => s + (i.discountType === 'PERCENT' ? (i.qty * i.unitPrice * i.discount / 100) : i.discount), 0))}</TableCell></TableRow>}
          <TableRow sx={{ fontWeight: 700, bgcolor: 'primary.light' }}><TableCell>TOTAL GERAL</TableCell><TableCell align="right">{formatCurrency(os.total)}</TableCell></TableRow>
        </TableBody></Table></TableContainer></Box>

        {/* Briefing: forma de pagamento logo após os Totais (em ambas as vias) */}
        {paymentMethodLabel && (
          <Box sx={{ mb: 3, p: 1.5, border: 1, borderColor: 'divider', borderRadius: 1 }}>
            <Grid container spacing={1}>
              <Grid item xs={12} sm={6}><Typography variant="body2" color="text.secondary">Forma de pagamento</Typography><Typography variant="body1" sx={{ fontWeight: 500 }}>{paymentMethodLabel}</Typography></Grid>
            </Grid>
          </Box>
        )}

        {/* Briefing O.S.: observações externas — impressa em ambas as vias */}
        {os.externalNotes && (
          <Box sx={{ mb: 3 }}>
            <Typography variant="h6" sx={{ mb: 1, color: 'primary.main', borderBottom: 1, borderColor: 'primary.main', pb: 0.5 }}>Observações</Typography>
            <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>{os.externalNotes}</Typography>
          </Box>
        )}

        {showResumo && (os.diagnosis || os.solution || (isTecnico && isClosing && visitHoursLabel)) && (
          <Box sx={{ mb: 3, p: 2, bgcolor: 'grey.50', borderRadius: 1 }}>
            <Typography variant="h6" sx={{ mb: 1, color: 'primary.main' }}>Resumo do Serviço{isClosing ? ' — Fechamento' : ''}</Typography>
            {os.diagnosis && <Box sx={{ mb: 2 }}><Typography variant="body2" color="text.secondary">Diagnóstico</Typography><Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>{os.diagnosis}</Typography></Box>}
            {os.solution && <Box sx={{ mb: 2 }}><Typography variant="body2" color="text.secondary">Solução Aplicada</Typography><Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>{os.solution}</Typography></Box>}
            {/* Método de cobrança de horas: exclusivo da via do técnico */}
            {isTecnico && isClosing && visitHoursLabel && <Box><Typography variant="body2" color="text.secondary">Horas apontadas pelo técnico ({closedVisits.length} visita(s))</Typography><Typography variant="body1" sx={{ fontWeight: 600 }}>{visitHoursLabel}</Typography></Box>}
          </Box>
        )}

        {isTecnico && os.checklist && os.checklist.length > 0 && <Box sx={{ mb: 3 }}><Typography variant="h6" sx={{ mb: 1, color: 'primary.main', borderBottom: 1, borderColor: 'primary.main', pb: 0.5 }}>Checklist do Serviço</Typography><Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>{checklistRows}</Box></Box>}

        {isTecnico && os.visits && os.visits.length > 0 && <Box sx={{ mb: 3 }}><Typography variant="h6" sx={{ mb: 1, color: 'primary.main', borderBottom: 1, borderColor: 'primary.main', pb: 0.5 }}>Visitas Agendadas / Realizadas</Typography>{visitRows}</Box>}

        <Box sx={{ mt: 4, pt: 2, borderTop: 2, borderColor: 'divider' }}><Typography variant="h6" sx={{ mb: 3, color: 'primary.main', textAlign: 'center' }}>Assinaturas</Typography><Grid container spacing={4}><Grid item xs={12} sm={6}><Box sx={{ textAlign: 'center', p: 2, borderTop: 1, borderColor: 'divider', minHeight: 100 }}><Typography variant="body2" color="text.secondary">Cliente</Typography><Typography variant="body1" sx={{ fontWeight: 500 }}>{os.client?.name}</Typography><Typography variant="caption" color="text.secondary" sx={{ mt: 2 }}>___________________________________</Typography><Typography variant="caption" color="text.secondary">Assinatura</Typography></Box></Grid><Grid item xs={12} sm={6}><Box sx={{ textAlign: 'center', p: 2, borderTop: 1, borderColor: 'divider', minHeight: 100 }}><Typography variant="body2" color="text.secondary">Técnico Responsável</Typography><Typography variant="body1" sx={{ fontWeight: 500 }}>{os.technician?.name || 'Não atribuído'}</Typography><Typography variant="caption" color="text.secondary" sx={{ mt: 2 }}>___________________________________</Typography><Typography variant="caption" color="text.secondary">Assinatura</Typography></Box></Grid></Grid></Box>

        {isTecnico && (os.notes || os.diagnosis) && <Box sx={{ mt: 3, p: 2, bgcolor: 'warning.light', borderRadius: 1, border: 1, borderColor: 'warning.main' }}><Typography variant="h6" sx={{ mb: 1, color: 'warning.dark' }}>Observações Internas (Via Técnico)</Typography>{os.notes && <Box sx={{ mb: 1 }}><Typography variant="body2" color="text.secondary">Observações</Typography><Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>{os.notes}</Typography></Box>}</Box>}

        <Box sx={{ mt: 4, pt: 2, borderTop: 1, borderColor: 'divider', textAlign: 'center', color: 'text.secondary' }}><Typography variant="caption">Papatec - Ordem de Serviço | OS #{os.osNumber} | Emitido em {formatDateTime(new Date())} | {isTecnico ? 'Via do Técnico' : 'Via do Cliente'}</Typography></Box>
      </Paper>
    );
  };

  return (
    <Box sx={{ p: 3, minHeight: '100vh', backgroundColor: '#fff' }}>
      {/* Formato do papel na impressão: A4 com margem de 10mm */}
      <style>{`@page { size: A4; margin: 10mm; }`}</style>

      <Box sx={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 1000, bgcolor: 'background.paper', borderBottom: 1, borderColor: 'divider', p: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', '@media print': { display: 'none' } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}><IconButton onClick={() => navigate(-1)} aria-label="Voltar"><Close /></IconButton><Typography variant="h6" sx={{ fontWeight: 700 }}>Imprimir OS #{os.osNumber}</Typography></Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}><Tabs value={activeVia} onChange={(_, v) => setActiveVia(v as ViaType)} sx={{ minWidth: 300 }}><Tab value="cliente" label="Via do Cliente" /><Tab value="tecnico" label="Via do Técnico" /></Tabs><Button variant="contained" startIcon={<Print />} onClick={handlePrint} size="large" disabled={!printReady}>Imprimir / Salvar PDF</Button></Box>
      </Box>

      <Box ref={printContentRef} sx={{ mt: printReady ? '120px' : 0, p: { xs: 2, sm: 3 }, '@media print': { mt: 0, p: 0, width: '100%', maxWidth: 'none' } }}>
        {/* Tela: controlada pelas Tabs (via ativa) */}
        <Box className="via-screen" sx={{ '@media print': { display: 'none !important' } }}>
          {renderVia(activeVia)}
        </Box>

        {/* Impressão: as duas vias empilhadas na mesma folha A4 (via do cliente em cima) */}
        <Box className="via-print" sx={{ display: 'none', '@media print': { display: 'block !important' } }}>
          {renderVia('cliente')}
          <Box
            className="via-separador"
            sx={{
              my: 2,
              py: 0.75,
              border: '1px dashed',
              borderColor: 'divider',
              borderRadius: 1,
              textAlign: 'center',
              '@media print': { pageBreakBefore: 'avoid', pageBreakAfter: 'avoid', pageBreakInside: 'avoid', breakInside: 'avoid' },
            }}
          >
            <Typography variant="caption" color="text.secondary" sx={{ letterSpacing: 1, textTransform: 'uppercase' }}>— via do cliente / via do técnico —</Typography>
          </Box>
          {renderVia('tecnico')}
        </Box>
      </Box>
    </Box>
  );
}
