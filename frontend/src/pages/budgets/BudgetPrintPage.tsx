import { Box, Typography, Grid, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper, Button, IconButton, Tabs, Tab, Alert, Chip } from '@mui/material';
import { useState, useEffect, useRef } from 'react';
import { Print, Close } from '@mui/icons-material';
import { useParams, useNavigate } from 'react-router-dom';
import { budgetsApi } from '../../services/api';
import { formatCurrency, formatDate, formatDateTime, formatCpf, formatCnpj } from '../../utils/formatters';

type ViaType = 'cliente' | 'loja';

// Desembrulha o envelope da API (quando existir)
const unwrapAny = (r: any) => (r && r.data && !r.id ? r.data : r);

const round2 = (n: any): number => Math.round((Number(n) || 0) * 100) / 100;

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Rascunho',
  SENT: 'Enviado',
  APPROVED: 'Aprovado',
  REJECTED: 'Rejeitado',
  EXPIRED: 'Expirado',
  CONVERTED_TO_OS: 'Convertido em OS',
};

const STATUS_COLORS: Record<string, 'default' | 'info' | 'success' | 'error' | 'warning' | 'primary'> = {
  DRAFT: 'default',
  SENT: 'info',
  APPROVED: 'success',
  REJECTED: 'error',
  EXPIRED: 'warning',
  CONVERTED_TO_OS: 'primary',
};

const clientDoc = (client: any): string => {
  if (!client) return 'Não informado';
  if (client.cnpj) return formatCnpj(String(client.cnpj));
  if (client.cpf) return formatCpf(String(client.cpf));
  return 'Não informado';
};

const clientAddress = (client: any): string => {
  if (!client) return 'Não informado';
  if (client.address) return client.address;
  const parts = [client.street, client.number, client.complement, client.district, client.zip, client.city, client.state].filter(Boolean);
  return parts.join(', ') || 'Não informado';
};

const formatAddress = (addr: any): string => {
  if (!addr) return 'Não informado';
  const parts = [addr.street, addr.number, addr.complement, addr.district, addr.zip, addr.city, addr.state].filter(Boolean);
  return parts.join(', ') || 'Não informado';
};

const discountLabel = (it: any): string => {
  if (!it.discount || Number(it.discount) <= 0) return '-';
  return it.discountType === 'PERCENT' ? `${it.discount}%` : formatCurrency(it.discount);
};

export function BudgetPrintPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [budget, setBudget] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeVia, setActiveVia] = useState<ViaType>('cliente');
  const [printReady, setPrintReady] = useState(false);
  const printContentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (id) {
      budgetsApi
        .get(id)
        .then((r: any) => {
          setBudget(unwrapAny(r));
          setLoading(false);
          setTimeout(() => setPrintReady(true), 100);
        })
        .catch(() => {
          setError('Não foi possível carregar o orçamento.');
          setLoading(false);
        });
    }
  }, [id]);

  // Define o título do documento para o nome do arquivo ao salvar como PDF
  useEffect(() => {
    if (budget?.code) {
      document.title = `ORC-${budget.code} - Papatec`;
    }
  }, [budget?.code]);

  const handlePrint = () => {
    if (printContentRef.current) window.print();
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
        <Typography>Carregando...</Typography>
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => navigate('/budgets')}>Voltar</Button>}>
          {error}
        </Alert>
      </Box>
    );
  }

  if (!budget) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
        <Typography>Orçamento não encontrado</Typography>
      </Box>
    );
  }

  const budgetCode = budget.code || (budget.id ? `#${String(budget.id).slice(0, 8).toUpperCase()}` : '—');
  const statusLabel = STATUS_LABELS[budget.status] || budget.status;
  const statusColor = STATUS_COLORS[budget.status] || 'default';

  const items: any[] = budget.items || [];
  const partItems = items.filter((i: any) => i.type === 'PART');
  const serviceItems = items.filter((i: any) => i.type !== 'PART');

  const computedTotalParts = round2(partItems.reduce((s: number, i: any) => s + (Number(i.total) || 0), 0));
  const computedTotalServices = round2(serviceItems.reduce((s: number, i: any) => s + (Number(i.total) || 0), 0));
  const laborHours = Number(budget.laborHours) || 0;
  const laborRate = Number(budget.laborRate) || 0;
  const computedTotalLabor = round2(budget.totalLabor != null ? budget.totalLabor : laborHours * laborRate);

  const totalParts = budget.totalParts != null ? round2(budget.totalParts) : computedTotalParts;
  const totalServices = budget.totalServices != null ? round2(budget.totalServices) : computedTotalServices;
  const totalLabor = computedTotalLabor;
  const grandTotal = budget.total != null ? round2(budget.total) : round2(totalParts + totalServices + totalLabor);

  const isExternal = budget.serviceType === 'EXTERNAL';

  // Regra TS7: nunca .map() retornando JSX direto no return — extrair para const
  const equipmentRows = (budget.equipment || []).map((eq: any, idx: number) => (
    <Box key={idx} sx={{ mb: 1, p: 1.5, border: 1, borderColor: 'divider', borderRadius: 1 }}>
      <Grid container spacing={1}>
        <Grid item xs={12} sm={4}><Typography variant="body2" color="text.secondary">Equipamento</Typography><Typography variant="body1" sx={{ fontWeight: 500 }}>{eq.name}</Typography></Grid>
        <Grid item xs={12} sm={4}><Typography variant="body2" color="text.secondary">Marca / Modelo</Typography><Typography variant="body1">{[eq.brand, eq.model].filter(Boolean).join(' ') || 'Não informado'}</Typography></Grid>
        <Grid item xs={12} sm={4}><Typography variant="body2" color="text.secondary">N° Série</Typography><Typography variant="body1">{eq.serial || 'Não informado'}</Typography></Grid>
        {eq.notes && <Grid item xs={12}><Typography variant="body2" color="text.secondary">Observações do equipamento</Typography><Typography variant="body1">{eq.notes}</Typography></Grid>}
      </Grid>
    </Box>
  ));

  const partRows = partItems.map((it: any, idx: number) => (
    <TableRow key={it.id || idx}>
      <TableCell sx={{ whiteSpace: 'normal' }}>{it.name}{it.part?.code ? ` (${it.part.code})` : ''}</TableCell>
      <TableCell align="right">{it.qty}</TableCell>
      <TableCell align="right">{formatCurrency(it.unitPrice)}</TableCell>
      <TableCell align="right">{discountLabel(it)}</TableCell>
      <TableCell align="right" sx={{ fontWeight: 600 }}>{formatCurrency(it.total)}</TableCell>
    </TableRow>
  ));

  const serviceRows = serviceItems.map((it: any, idx: number) => (
    <TableRow key={it.id || idx}>
      <TableCell sx={{ whiteSpace: 'normal' }}>{it.name}{it.service?.code ? ` (${it.service.code})` : ''}</TableCell>
      <TableCell align="right">{it.qty}</TableCell>
      <TableCell align="right">{formatCurrency(it.unitPrice)}</TableCell>
      <TableCell align="right">{discountLabel(it)}</TableCell>
      <TableCell align="right" sx={{ fontWeight: 600 }}>{formatCurrency(it.total)}</TableCell>
    </TableRow>
  ));

  // Renderiza uma via completa (a flag da via é definida aqui dentro)
  const renderVia = (via: ViaType) => {
    const isLoja = via === 'loja';

    return (
      <Paper sx={{ p: { xs: 2, sm: 3 }, '@media print': { boxShadow: 'none', border: 'none', padding: 0 } }}>
        {/* Cabeçalho */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 3, pb: 2, borderBottom: 2, borderColor: 'primary.main' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <img src="/images/logo-papatec.png" alt="Papatec" style={{ width: 60, height: 60, objectFit: 'contain' }} />
            <Box>
              <Typography variant="h4" sx={{ fontWeight: 700, color: 'primary.main', lineHeight: 1.2 }}>Papatec - Orçamento</Typography>
              <Typography variant="body2" color="text.secondary">Assistência Técnica & Vendas</Typography>
            </Box>
          </Box>
          <Box sx={{ textAlign: 'right' }}>
            <Typography variant="h5" sx={{ fontWeight: 700, color: 'primary.main' }}>
              {isLoja ? '2ª VIA - LOJA' : '1ª VIA - CLIENTE'}
            </Typography>
            <Typography variant="body1" sx={{ fontWeight: 600 }}>ORÇAMENTO</Typography>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>{budgetCode}</Typography>
            <Typography variant="caption" color="text.secondary">Emitido em {formatDate(budget.createdAt, true)}</Typography>
          </Box>
        </Box>

        {/* Dados do orçamento */}
        <Box sx={{ mb: 3 }}>
          <Typography variant="h6" sx={{ mb: 1, color: 'primary.main', borderBottom: 1, borderColor: 'primary.main', pb: 0.5 }}>Dados do Orçamento</Typography>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}><Typography variant="body2" color="text.secondary">Código</Typography><Typography variant="body1" sx={{ fontWeight: 500 }}>{budgetCode}</Typography></Grid>
            <Grid item xs={12} sm={6}><Typography variant="body2" color="text.secondary">Status</Typography><Chip label={statusLabel} color={statusColor} size="small" variant="outlined" /></Grid>
            <Grid item xs={12} sm={6}><Typography variant="body2" color="text.secondary">Data de emissão</Typography><Typography variant="body1" sx={{ fontWeight: 500 }}>{formatDate(budget.createdAt, true)}</Typography></Grid>
            <Grid item xs={12} sm={6}><Typography variant="body2" color="text.secondary">Válido até</Typography><Typography variant="body1" sx={{ fontWeight: 500 }}>{budget.validUntil ? formatDate(budget.validUntil) : 'Não definida'}</Typography></Grid>
            <Grid item xs={12} sm={6}><Typography variant="body2" color="text.secondary">Criado por</Typography><Typography variant="body1" sx={{ fontWeight: 500 }}>{budget.creator?.name || budget.user?.name || 'Não informado'}</Typography></Grid>
          </Grid>
        </Box>

        {/* Cliente */}
        <Box sx={{ mb: 3 }}>
          <Typography variant="h6" sx={{ mb: 1, color: 'primary.main', borderBottom: 1, borderColor: 'primary.main', pb: 0.5 }}>Dados do Cliente</Typography>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}><Typography variant="body2" color="text.secondary">Nome</Typography><Typography variant="body1" sx={{ fontWeight: 500 }}>{budget.client?.name || 'Não informado'}</Typography></Grid>
            <Grid item xs={12} sm={6}><Typography variant="body2" color="text.secondary">CPF / CNPJ</Typography><Typography variant="body1" sx={{ fontWeight: 500 }}>{clientDoc(budget.client)}</Typography></Grid>
            <Grid item xs={12} sm={6}><Typography variant="body2" color="text.secondary">Telefone</Typography><Typography variant="body1" sx={{ fontWeight: 500 }}>{budget.client?.phone || 'Não informado'}</Typography></Grid>
            <Grid item xs={12} sm={6}><Typography variant="body2" color="text.secondary">Email</Typography><Typography variant="body1" sx={{ fontWeight: 500 }}>{budget.client?.email || 'Não informado'}</Typography></Grid>
            <Grid item xs={12}><Typography variant="body2" color="text.secondary">Endereço</Typography><Typography variant="body1">{clientAddress(budget.client)}</Typography></Grid>
          </Grid>
        </Box>

        {/* Equipamentos */}
        <Box sx={{ mb: 3 }}>
          <Typography variant="h6" sx={{ mb: 1, color: 'primary.main', borderBottom: 1, borderColor: 'primary.main', pb: 0.5 }}>Equipamento(s)</Typography>
          {equipmentRows}
        </Box>

        {/* Defeito */}
        <Box sx={{ mb: 3 }}>
          <Typography variant="h6" sx={{ mb: 1, color: 'primary.main', borderBottom: 1, borderColor: 'primary.main', pb: 0.5 }}>Defeito Relatado</Typography>
          <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>{budget.defect || 'Não informado'}</Typography>
        </Box>

        {/* Diagnóstico / Solução */}
        {(budget.diagnosis || budget.solution) && (
          <Box sx={{ mb: 3, p: 2, bgcolor: 'grey.50', borderRadius: 1, border: 1, borderColor: 'divider' }}>
            <Typography variant="h6" sx={{ mb: 1, color: 'primary.main' }}>Diagnóstico / Solução</Typography>
            {budget.diagnosis && (
              <Box sx={{ mb: 1.5 }}>
                <Typography variant="body2" color="text.secondary">Diagnóstico Técnico</Typography>
                <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>{budget.diagnosis}</Typography>
              </Box>
            )}
            {budget.solution && (
              <Box>
                <Typography variant="body2" color="text.secondary">Solução Aplicada</Typography>
                <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>{budget.solution}</Typography>
              </Box>
            )}
          </Box>
        )}

        {/* Peças */}
        <Box sx={{ mb: 3 }}>
          <Typography variant="h6" sx={{ mb: 1, color: 'primary.main', borderBottom: 1, borderColor: 'primary.main', pb: 0.5 }}>Peças</Typography>
          {partRows.length > 0 ? (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Item</TableCell>
                    <TableCell align="right">Qtd</TableCell>
                    <TableCell align="right">Vl. Unit.</TableCell>
                    <TableCell align="right">Desc.</TableCell>
                    <TableCell align="right">Total</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>{partRows}</TableBody>
                <TableBody>
                  <TableRow sx={{ bgcolor: 'grey.100' }}>
                    <TableCell colSpan={4} sx={{ fontWeight: 700 }}>Total de peças</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700 }}>{formatCurrency(totalParts)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </TableContainer>
          ) : (
            <Typography variant="body2" color="text.secondary">Nenhuma peça neste orçamento.</Typography>
          )}
        </Box>

        {/* Serviços */}
        <Box sx={{ mb: 3 }}>
          <Typography variant="h6" sx={{ mb: 1, color: 'primary.main', borderBottom: 1, borderColor: 'primary.main', pb: 0.5 }}>Serviços</Typography>
          {serviceRows.length > 0 ? (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Item</TableCell>
                    <TableCell align="right">Qtd</TableCell>
                    <TableCell align="right">Vl. Unit.</TableCell>
                    <TableCell align="right">Desc.</TableCell>
                    <TableCell align="right">Total</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>{serviceRows}</TableBody>
                <TableBody>
                  <TableRow sx={{ bgcolor: 'grey.100' }}>
                    <TableCell colSpan={4} sx={{ fontWeight: 700 }}>Total de serviços</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700 }}>{formatCurrency(totalServices)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </TableContainer>
          ) : (
            <Typography variant="body2" color="text.secondary">Nenhum serviço neste orçamento.</Typography>
          )}
        </Box>

        {/* Mão de obra + totais */}
        <Box sx={{ mb: 3, maxWidth: 460, ml: 'auto' }}>
          <TableContainer>
            <Table size="small">
              <TableBody>
                <TableRow>
                  <TableCell>Total de peças</TableCell>
                  <TableCell align="right">{formatCurrency(totalParts)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Total de serviços</TableCell>
                  <TableCell align="right">{formatCurrency(totalServices)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Mão de obra ({laborHours}h × {formatCurrency(laborRate)})</TableCell>
                  <TableCell align="right">{formatCurrency(totalLabor)}</TableCell>
                </TableRow>
                <TableRow sx={{ fontWeight: 700, bgcolor: 'primary.light' }}>
                  <TableCell>TOTAL GERAL</TableCell>
                  <TableCell align="right">{formatCurrency(grandTotal)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </TableContainer>
        </Box>

        {/* Endereço do serviço (externo) */}
        {isExternal && budget.serviceAddress && (
          <Box sx={{ mb: 3, p: 2, bgcolor: 'info.light', borderRadius: 1, border: 1, borderColor: 'info.main' }}>
            <Typography variant="h6" sx={{ mb: 1, color: 'info.dark' }}>Local do Serviço (Externo)</Typography>
            <Typography variant="body1">{formatAddress(budget.serviceAddress)}</Typography>
          </Box>
        )}

        {/* Observações */}
        {budget.notes && (
          <Box sx={{ mb: 3 }}>
            <Typography variant="h6" sx={{ mb: 1, color: 'primary.main', borderBottom: 1, borderColor: 'primary.main', pb: 0.5 }}>Observações</Typography>
            <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>{budget.notes}</Typography>
          </Box>
        )}

        {/* Área de aprovação */}
        <Box sx={{ mb: 3, p: 2, border: 1, borderColor: 'divider', borderRadius: 1 }}>
          <Typography variant="h6" sx={{ mb: 2, color: 'primary.main' }}>Aprovação do Orçamento</Typography>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={4}>
              <Typography variant="body2" color="text.secondary">Status</Typography>
              <Chip label={statusLabel} color={statusColor} size="small" variant="outlined" sx={{ mt: 0.5 }} />
            </Grid>
            <Grid item xs={12} sm={4}>
              <Typography variant="body2" color="text.secondary">Data</Typography>
              <Typography variant="body1">{budget.status === 'APPROVED' || budget.status === 'REJECTED' || budget.status === 'CONVERTED_TO_OS' ? formatDate(budget.updatedAt || budget.createdAt) : '____/____/______'}</Typography>
            </Grid>
            <Grid item xs={12} sm={4}>
              <Typography variant="body2" color="text.secondary">Assinatura do cliente</Typography>
              <Typography variant="body1" sx={{ mt: 1 }}>___________________________________</Typography>
            </Grid>
          </Grid>
        </Box>

        {/* Assinaturas */}
        <Box sx={{ mt: 4, pt: 2, borderTop: 2, borderColor: 'divider' }}>
          <Typography variant="h6" sx={{ mb: 3, color: 'primary.main', textAlign: 'center' }}>Assinaturas</Typography>
          <Grid container spacing={4}>
            <Grid item xs={12} sm={6}>
              <Box sx={{ textAlign: 'center', p: 2, borderTop: 1, borderColor: 'divider', minHeight: 100 }}>
                <Typography variant="caption" color="text.secondary">___________________________________</Typography>
                <Typography variant="body2" color="text.secondary">Cliente</Typography>
                <Typography variant="body1" sx={{ fontWeight: 500, mt: 1 }}>{budget.client?.name || 'Não informado'}</Typography>
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>Data: ___/___/______</Typography>
              </Box>
            </Grid>
            <Grid item xs={12} sm={6}>
              <Box sx={{ textAlign: 'center', p: 2, borderTop: 1, borderColor: 'divider', minHeight: 100 }}>
                <Typography variant="caption" color="text.secondary">___________________________________</Typography>
                <Typography variant="body2" color="text.secondary">Responsável técnico</Typography>
                <Typography variant="body1" sx={{ fontWeight: 500, mt: 1 }}>{budget.creator?.name || budget.user?.name || 'Não informado'}</Typography>
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>Data: ___/___/______</Typography>
              </Box>
            </Grid>
          </Grid>
        </Box>

        {/* Rodapé */}
        <Box sx={{ mt: 4, pt: 2, borderTop: 1, borderColor: 'divider', textAlign: 'center', color: 'text.secondary' }}>
          <Typography variant="caption">
            Papatec - Orçamento {budgetCode} | Emitido em {formatDateTime(budget.createdAt)} |{' '}
            {isLoja ? '2ª VIA - LOJA' : '1ª VIA - CLIENTE'}
          </Typography>
        </Box>
      </Paper>
    );
  };

  return (
    <Box sx={{ p: 3, minHeight: '100vh', backgroundColor: '#fff' }}>
      {/* Regras de impressão A4 — esconde os controles na impressão */}
      <style>{`
        @page { size: A4; margin: 10mm; }
        @media print {
          .no-print { display: none !important; }
          html, body { background: #fff !important; }
        }
      `}</style>

      {/* Barra de ações (some na impressão) */}
      <Box
        className="no-print"
        sx={{
          position: 'fixed', top: 0, left: 0, right: 0, zIndex: 1000,
          bgcolor: 'background.paper', borderBottom: 1, borderColor: 'divider', p: 2,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          '@media print': { display: 'none' },
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <IconButton onClick={() => navigate(-1)} aria-label="Voltar"><Close /></IconButton>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>Imprimir Orçamento {budgetCode}</Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Tabs value={activeVia} onChange={(_, v) => setActiveVia(v as ViaType)} sx={{ minWidth: 340 }}>
            <Tab value="cliente" label="1ª VIA - CLIENTE" />
            <Tab value="loja" label="2ª VIA - LOJA" />
          </Tabs>
          <Button variant="contained" startIcon={<Print />} onClick={handlePrint} size="large" disabled={!printReady}>
            Imprimir / Salvar PDF
          </Button>
        </Box>
      </Box>

      {/* Tela: exibe somente a via ativa (Tabs) — some na impressão */}
      <Box
        ref={printContentRef}
        className="via-screen"
        sx={{
          mt: printReady ? '120px' : 0,
          p: { xs: 2, sm: 3 },
          '@media print': { display: 'none !important' },
        }}
      >
        {renderVia(activeVia)}
      </Box>

      {/* Impressão: as duas vias empilhadas no A4, uma embaixo da outra (sem page-break entre elas) */}
      <Box
        className="via-print"
        sx={{ display: 'none', '@media print': { display: 'block !important' } }}
      >
        {renderVia('cliente')}

        {/* Separador tracejado entre as vias */}
        <Box
          sx={{
            my: 3, display: 'flex', alignItems: 'center', gap: 1,
            breakBefore: 'avoid', breakAfter: 'avoid',
          }}
        >
          <Box sx={{ flex: 1, borderTop: '2px dashed', borderColor: 'text.disabled' }} />
          <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
            corte / separação de vias
          </Typography>
          <Box sx={{ flex: 1, borderTop: '2px dashed', borderColor: 'text.disabled' }} />
        </Box>

        {renderVia('loja')}
      </Box>
    </Box>
  );
}

export default BudgetPrintPage;
