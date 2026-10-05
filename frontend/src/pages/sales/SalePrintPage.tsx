import { Box, Typography, Grid, Divider, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper, Button, IconButton, Tabs, Tab, Chip } from '@mui/material';
import { useState, useEffect, useRef } from 'react';
import { Print, Close } from '@mui/icons-material';
import { useParams, useNavigate } from 'react-router-dom';
import { salesApi } from '../../services/api';
import { formatCurrency, formatDateTime, formatCpf, formatCnpj } from '../../utils/formatters';

// ---------------------------------------------------------------------------
// Helpers locais
// ---------------------------------------------------------------------------
const PAYMENT_LABELS: Record<string, string> = {
  DINHEIRO: 'Dinheiro',
  PIX: 'PIX',
  CARTAO_CREDITO: 'Cartão de Crédito',
  CARTAO_DEBITO: 'Cartão de Débito',
  BOLETO: 'Boleto',
  TRANSFERENCIA: 'Transferência',
  OUTRO: 'Outro',
};

const paymentLabel = (value?: string | null): string => (value ? PAYMENT_LABELS[value] || value : '—');

const unwrapAny = (r: any) => (r && r.data && !r.id ? r.data : r);

const formatAddress = (addr: any): string => {
  if (!addr) return 'Não informado';
  const parts = [addr.street, addr.number, addr.complement, addr.district, addr.zip, addr.city, addr.state].filter(Boolean);
  return parts.join(', ') || 'Não informado';
};

const clientDoc = (client: any): string => {
  if (!client) return 'Não informado';
  if (client.cnpj) return formatCnpj(client.cnpj);
  if (client.cpf) return formatCpf(client.cpf);
  return 'Não informado';
};

const itemDiscountLabel = (it: any): string => {
  if (!it.discount || Number(it.discount) <= 0) return '-';
  return it.discountType === 'PERCENT' ? `${it.discount}%` : formatCurrency(it.discount);
};

type ViaType = 'cliente' | 'loja';

export function SalePrintPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [sale, setSale] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeVia, setActiveVia] = useState<ViaType>('cliente');
  const [printReady, setPrintReady] = useState(false);
  const printContentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (id) {
      salesApi
        .get(id)
        .then((r: any) => {
          setSale(unwrapAny(r));
          setLoading(false);
          setTimeout(() => setPrintReady(true), 100);
        })
        .catch(() => setLoading(false));
    }
  }, [id]);

  // Define o título do documento para o nome do arquivo ao salvar como PDF
  useEffect(() => {
    if (sale?.code) {
      document.title = `VDA-${sale.code} - Papatec`;
    }
  }, [sale?.code]);

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
  if (!sale) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
        <Typography>Venda não encontrada</Typography>
      </Box>
    );
  }

  const items: any[] = sale.items || [];
  const returns: any[] = sale.returns || [];
  const itemsNet = items.reduce((s: number, it: any) => s + (Number(it.total) || 0), 0);
  const itemsQty = items.reduce((s: number, it: any) => s + (Number(it.qty) || 0), 0);

  // ---------------------------------------------------------------------------
  // Renderiza uma via completa (1ª = cliente / 2ª = loja-vendedor).
  // No A4 a impressão empilha as duas vias, cada uma ocupando ~meia folha.
  // ---------------------------------------------------------------------------
  const renderVia = (via: ViaType) => {
    const isLoja = via === 'loja';

    const itemCommission = (it: any): number => {
      const net = Number(it.total) || 0;
      if (it.commissionType === 'VALUE') return Number(it.commissionValue) || 0;
      return (net * (Number(it.commissionPercent) || 0)) / 100;
    };
    const totalCommission = items.reduce((s: number, it: any) => s + itemCommission(it), 0);

    // Extract map results to variables (TS7 rule: nunca .map() JSX direto no return)
    const itemRows = items.map((it: any, idx: number) => (
      <TableRow key={it.id || idx}>
        <TableCell>{it.code || it.part?.code || '-'}</TableCell>
        <TableCell>{it.name}</TableCell>
        <TableCell align="right">{it.qty}</TableCell>
        <TableCell align="right">{formatCurrency(it.unitPrice)}</TableCell>
        <TableCell align="right">{itemDiscountLabel(it)}</TableCell>
        {isLoja && (
          <TableCell align="right">
            {it.commissionType === 'VALUE' ? formatCurrency(it.commissionValue) : `${it.commissionPercent || 0}%`}
          </TableCell>
        )}
        <TableCell align="right" sx={{ fontWeight: 600 }}>{formatCurrency(it.total)}</TableCell>
      </TableRow>
    ));

    const returnBlocks = returns.map((ret: any) => {
      const rRows = (ret.items || []).map((ri: any, idx: number) => (
        <TableRow key={ri.id || idx}>
          <TableCell>{ri.name}</TableCell>
          <TableCell align="right">{ri.qty}</TableCell>
          <TableCell align="right">{formatCurrency(ri.unitPrice)}</TableCell>
          <TableCell align="right" sx={{ fontWeight: 600 }}>{formatCurrency(ri.total)}</TableCell>
        </TableRow>
      ));
      return (
        <Box key={ret.id} sx={{ mb: 2, p: 1.5, border: 1, borderColor: 'divider', borderRadius: 1 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1, flexWrap: 'wrap', gap: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Chip size="small" color={ret.type === 'EXCHANGE' ? 'info' : 'warning'} label={ret.type === 'EXCHANGE' ? 'TROCA' : 'DEVOLUÇÃO'} />
              <Typography variant="body2" sx={{ fontWeight: 700 }}>{ret.code}</Typography>
              <Typography variant="caption" color="text.secondary">{formatDateTime(ret.createdAt)} · {ret.user?.name || '-'}</Typography>
            </Box>
            <Typography variant="body2" sx={{ fontWeight: 700 }}>{formatCurrency(ret.total)}</Typography>
          </Box>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Produto</TableCell>
                  <TableCell align="right">Qtd</TableCell>
                  <TableCell align="right">Vl. unit.</TableCell>
                  <TableCell align="right">Total</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>{rRows}</TableBody>
            </Table>
          </TableContainer>
          {ret.reason && (
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
              Motivo: {ret.reason}
            </Typography>
          )}
          {ret.notes && (
            <Typography variant="caption" color="text.secondary" display="block">
              Obs.: {ret.notes}
            </Typography>
          )}
        </Box>
      );
    });

    return (
      <Paper sx={{ p: { xs: 2, sm: 3 }, '@media print': { boxShadow: 'none', border: 'none', padding: 0 } }}>
        {/* Cabeçalho */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 3, pb: 2, borderBottom: 2, borderColor: 'primary.main' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <img src="/images/logo-papatec.png" alt="Papatec" style={{ width: 60, height: 60, objectFit: 'contain' }} />
            <Box>
              <Typography variant="h4" sx={{ fontWeight: 700, color: 'primary.main', lineHeight: 1.2 }}>Papatec - Nota de Venda</Typography>
              <Typography variant="body2" color="text.secondary">Assistência Técnica & Vendas</Typography>
            </Box>
          </Box>
          <Box sx={{ textAlign: 'right' }}>
            <Typography variant="h5" sx={{ fontWeight: 700, color: 'primary.main' }}>
              {isLoja ? '2ª VIA — LOJA/VENDEDOR' : '1ª VIA — CLIENTE'}
            </Typography>
            <Typography variant="body1" sx={{ fontWeight: 600 }}>Nota de Venda {sale.code}</Typography>
            <Typography variant="caption" color="text.secondary">Emitida em {formatDateTime(sale.createdAt)}</Typography>
            {sale.saleType === 'FROM_OS' && (
              <Typography variant="caption" color="text.secondary" display="block">Gerada a partir de O.S.</Typography>
            )}
          </Box>
        </Box>

        {/* Cliente / vendedor */}
        <Box sx={{ mb: 3 }}>
          <Typography variant="h6" sx={{ mb: 1, color: 'primary.main', borderBottom: 1, borderColor: 'primary.main', pb: 0.5 }}>Dados da Venda</Typography>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}><Typography variant="body2" color="text.secondary">Cliente</Typography><Typography variant="body1" sx={{ fontWeight: 500 }}>{sale.client?.name || 'Consumidor'}</Typography></Grid>
            <Grid item xs={12} sm={6}><Typography variant="body2" color="text.secondary">CPF/CNPJ</Typography><Typography variant="body1" sx={{ fontWeight: 500 }}>{clientDoc(sale.client)}</Typography></Grid>
            <Grid item xs={12} sm={6}><Typography variant="body2" color="text.secondary">Vendedor</Typography><Typography variant="body1" sx={{ fontWeight: 500 }}>{sale.user?.name || 'Não informado'}</Typography></Grid>
            <Grid item xs={12} sm={6}><Typography variant="body2" color="text.secondary">Forma de pagamento</Typography><Typography variant="body1" sx={{ fontWeight: 500 }}>{paymentLabel(sale.paymentMethod)}</Typography></Grid>
          </Grid>
        </Box>

        {/* Endereço de entrega */}
        <Box sx={{ mb: 3 }}>
          <Typography variant="h6" sx={{ mb: 1, color: 'primary.main', borderBottom: 1, borderColor: 'primary.main', pb: 0.5 }}>Entrega</Typography>
          {sale.deliveryAddress ? (
            <Box sx={{ p: 1.5, bgcolor: 'info.light', borderRadius: 1, border: 1, borderColor: 'info.main' }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>{sale.deliveryAddress.label || 'Endereço de entrega'}</Typography>
              <Typography variant="body1">{formatAddress(sale.deliveryAddress)}</Typography>
            </Box>
          ) : (
            <Typography variant="body1">Retirar na loja</Typography>
          )}
        </Box>

        {/* Itens */}
        <Box sx={{ mb: 3 }}>
          <Typography variant="h6" sx={{ mb: 1, color: 'primary.main', borderBottom: 1, borderColor: 'primary.main', pb: 0.5 }}>Itens</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Contagem de itens: {items.length} item(ns) · {itemsQty} unidade(s)
          </Typography>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Código</TableCell>
                  <TableCell>Descrição</TableCell>
                  <TableCell align="right">Qtd</TableCell>
                  <TableCell align="right">Vl. Unit.</TableCell>
                  <TableCell align="right">Desc.</TableCell>
                  {isLoja && <TableCell align="right">Comissão</TableCell>}
                  <TableCell align="right">Total</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>{itemRows}</TableBody>
            </Table>
          </TableContainer>
        </Box>

        {/* Totais */}
        <Box sx={{ mb: 3, maxWidth: 420, ml: 'auto' }}>
          <TableContainer>
            <Table size="small">
              <TableBody>
                <TableRow>
                  <TableCell>Subtotal dos itens</TableCell>
                  <TableCell align="right">{formatCurrency(itemsNet)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Desconto</TableCell>
                  <TableCell align="right" color="error">- {formatCurrency(Number(sale.discount) || 0)}</TableCell>
                </TableRow>
                {Number(sale.freight) > 0 && (
                  <TableRow>
                    <TableCell>Frete</TableCell>
                    <TableCell align="right">{formatCurrency(Number(sale.freight))}</TableCell>
                  </TableRow>
                )}
                {isLoja && (
                  <TableRow>
                    <TableCell>Comissão total</TableCell>
                    <TableCell align="right">{formatCurrency(totalCommission)}</TableCell>
                  </TableRow>
                )}
                <TableRow sx={{ fontWeight: 700, bgcolor: 'primary.light' }}>
                  <TableCell>TOTAL GERAL</TableCell>
                  <TableCell align="right">{formatCurrency(sale.total)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </TableContainer>
        </Box>

        {/* Devoluções / trocas */}
        {returns.length > 0 && (
          <Box sx={{ mb: 3 }}>
            <Typography variant="h6" sx={{ mb: 1, color: 'warning.main', borderBottom: 1, borderColor: 'warning.main', pb: 0.5 }}>
              Devoluções / Trocas
            </Typography>
            {returnBlocks}
          </Box>
        )}

        {/* Observações */}
        {sale.notes && (
          <Box sx={{ mb: 3, p: 2, bgcolor: 'grey.50', borderRadius: 1 }}>
            <Typography variant="h6" sx={{ mb: 0.5, color: 'primary.main' }}>Observações</Typography>
            <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>{sale.notes}</Typography>
          </Box>
        )}

        {/* Retirada na loja (quando NÃO há entrega) */}
        {!sale.deliveryAddress && (
          <Box sx={{ mt: 4, p: 2, border: 1, borderColor: 'primary.main', borderRadius: 1, bgcolor: 'grey.50' }}>
            <Typography variant="h6" sx={{ mb: 2, color: 'primary.main', textAlign: 'center' }}>Retirada na Loja</Typography>
            <Grid container spacing={2}>
              <Grid item xs={12} sm={4}>
                <Typography variant="body2" color="text.secondary">Nome</Typography>
                <Typography variant="body1" sx={{ fontWeight: 500, mt: 0.5, borderBottom: 1, borderColor: 'divider', pb: 0.5, minHeight: 24 }}>
                  {sale.client?.name || 'Consumidor'}
                </Typography>
              </Grid>
              <Grid item xs={12} sm={4}>
                <Typography variant="body2" color="text.secondary">Documento</Typography>
                <Typography variant="body1" sx={{ fontWeight: 500, mt: 0.5, borderBottom: 1, borderColor: 'divider', pb: 0.5, minHeight: 24 }}>
                  {clientDoc(sale.client)}
                </Typography>
              </Grid>
              <Grid item xs={12} sm={4}>
                <Typography variant="body2" color="text.secondary">Data</Typography>
                <Typography variant="body1" sx={{ fontWeight: 500, mt: 0.5, borderBottom: 1, borderColor: 'divider', pb: 0.5, minHeight: 24 }}>
                  ___/___/______
                </Typography>
              </Grid>
              <Grid item xs={12}>
                <Typography variant="body2" color="text.secondary">Assinatura</Typography>
                <Typography variant="body1" sx={{ fontWeight: 500, mt: 0.5, minHeight: 24 }}>
                  ___________________________________
                </Typography>
              </Grid>
            </Grid>
          </Box>
        )}

        {/* Assinaturas */}
        <Box sx={{ mt: 4, pt: 2, borderTop: 2, borderColor: 'divider' }}>
          <Typography variant="h6" sx={{ mb: 3, color: 'primary.main', textAlign: 'center' }}>Assinaturas</Typography>
          <Grid container spacing={4}>
            <Grid item xs={12} sm={6}>
              <Box sx={{ textAlign: 'center', p: 2, borderTop: 1, borderColor: 'divider', minHeight: 100 }}>
                <Typography variant="caption" color="text.secondary">___________________________________</Typography>
                <Typography variant="body2" color="text.secondary">Assinatura do cliente</Typography>
                <Typography variant="body1" sx={{ fontWeight: 500, mt: 1 }}>{sale.client?.name || 'Consumidor'}</Typography>
              </Box>
            </Grid>
            <Grid item xs={12} sm={6}>
              <Box sx={{ textAlign: 'center', p: 2, borderTop: 1, borderColor: 'divider', minHeight: 100 }}>
                <Typography variant="caption" color="text.secondary">___________________________________</Typography>
                <Typography variant="body2" color="text.secondary">Assinatura do vendedor</Typography>
                <Typography variant="body1" sx={{ fontWeight: 500, mt: 1 }}>{sale.user?.name || 'Não informado'}</Typography>
              </Box>
            </Grid>
          </Grid>
        </Box>

        {/* Rodapé */}
        <Box sx={{ mt: 4, pt: 2, borderTop: 1, borderColor: 'divider', textAlign: 'center', color: 'text.secondary' }}>
          <Typography variant="caption">
            Papatec - Nota de Venda {sale.code} | Emitida em {formatDateTime(sale.createdAt)} |{' '}
            {isLoja ? '2ª VIA — LOJA/VENDEDOR' : '1ª VIA — CLIENTE'}
          </Typography>
        </Box>
      </Paper>
    );
  };

  return (
    <Box sx={{ p: 3, minHeight: '100vh', backgroundColor: '#fff' }}>
      {/* Regras de impressão A4 — 2 vias empilhadas (meia folha cada) */}
      <style>{`
        @page { size: A4; margin: 10mm; }
        @media print {
          .no-print { display: none !important; }
          .via-screen { display: none !important; }
          .via-print { display: block !important; }
          .via-print .via-block { min-height: 125mm; }
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
          <Typography variant="h6" sx={{ fontWeight: 700 }}>Imprimir Venda {sale.code}</Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Tabs
            value={activeVia}
            onChange={(_, v) => setActiveVia(v as ViaType)}
            sx={{ minWidth: 340 }}
          >
            <Tab value="cliente" label="1ª VIA — CLIENTE" />
            <Tab value="loja" label="2ª VIA — LOJA/VENDEDOR" />
          </Tabs>
          <Button variant="contained" startIcon={<Print />} onClick={handlePrint} size="large" disabled={!printReady}>
            Imprimir / Salvar PDF
          </Button>
        </Box>
      </Box>

      <Box
        ref={printContentRef}
        className="print-content"
        sx={{ mt: printReady ? '120px' : 0, p: { xs: 2, sm: 3 }, '@media print': { mt: 0, p: 0, width: '100%', maxWidth: 'none' } }}
      >
        {/* Tela: apenas a via ativa (controlada pelas Tabs) */}
        <Box
          className="via-screen"
          sx={{ '@media print': { display: 'none !important' } }}
        >
          {renderVia(activeVia)}
        </Box>

        {/* Impressão: as duas vias empilhadas no A4, uma embaixo da outra */}
        <Box
          className="via-print"
          sx={{ display: 'none', '@media print': { display: 'block !important' } }}
        >
          <Box className="via-block">{renderVia('cliente')}</Box>

          <Box className="via-separator" sx={{ display: 'flex', alignItems: 'center', gap: 1.5, my: 1.5 }}>
            <Divider sx={{ flex: 1, borderStyle: 'dashed' }} />
            <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
              — 1ª via cliente / 2ª via loja —
            </Typography>
            <Divider sx={{ flex: 1, borderStyle: 'dashed' }} />
          </Box>

          <Box className="via-block">{renderVia('loja')}</Box>
        </Box>
      </Box>
    </Box>
  );
}

export default SalePrintPage;
