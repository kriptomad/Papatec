import { Box, Typography, Grid, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper, Button, IconButton, Tabs, Tab, Alert } from '@mui/material';
import { useState, useEffect, useRef } from 'react';
import { Print, Close } from '@mui/icons-material';
import { useParams, useNavigate } from 'react-router-dom';
import { purchasesApi } from '../../services/api';
import { formatCurrency, formatDate, formatDateTime, formatCpf, formatCnpj } from '../../utils/formatters';

type ViaType = 'fornecedor' | 'estoque';

// Desembrulha o envelope da API (quando existir)
const unwrapAny = (r: any) => (r && r.data && !r.id ? r.data : r);

const round2 = (n: any): number => Math.round((Number(n) || 0) * 100) / 100;

const supplierDoc = (s: any): string => {
  if (!s) return 'Não informado';
  if (s.cnpj) return formatCnpj(String(s.cnpj));
  if (s.cpf) return formatCpf(String(s.cpf));
  return 'Não informado';
};

export function PurchasePrintPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [purchase, setPurchase] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeVia, setActiveVia] = useState<ViaType>('fornecedor');
  const [printReady, setPrintReady] = useState(false);
  const printContentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (id) {
      purchasesApi
        .get(id)
        .then((r: any) => {
          setPurchase(unwrapAny(r));
          setLoading(false);
          setTimeout(() => setPrintReady(true), 100);
        })
        .catch(() => {
          setError('Não foi possível carregar a compra.');
          setLoading(false);
        });
    }
  }, [id]);

  // Define o título do documento para o nome do arquivo ao salvar como PDF
  useEffect(() => {
    if (purchase?.code) {
      document.title = `COM-${purchase.code} - Papatec`;
    }
  }, [purchase?.code]);

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
        <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => navigate('/purchases')}>Voltar</Button>}>
          {error}
        </Alert>
      </Box>
    );
  }

  if (!purchase) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
        <Typography>Compra não encontrada</Typography>
      </Box>
    );
  }

  const items: any[] = purchase.items || [];
  const itemsTotal =
    round2(purchase.itemsTotal) ||
    round2(items.reduce((s: number, it: any) => s + (Number(it.qty) || 0) * (Number(it.unitPrice) || 0), 0));
  const freight = round2(purchase.freight);
  const tax = round2(purchase.tax);
  const discountValue =
    purchase.discountType === 'PERCENT'
      ? round2((itemsTotal * (Number(purchase.discount) || 0)) / 100)
      : round2(purchase.discount);

  // Contagem de itens (título da seção — vale para ambas as vias)
  const totalQty = items.reduce((s: number, it: any) => s + (Number(it.qty) || 0), 0);

  // Rateio proporcional de frete/imposto por item (mesma base do formulário de compra)
  const itemShare = (it: any): number => {
    const line = round2((Number(it.qty) || 0) * (Number(it.unitPrice) || 0));
    return itemsTotal > 0 ? line / itemsTotal : 0;
  };
  const freightShareOf = (it: any): number => round2(freight * itemShare(it));
  const taxShareOf = (it: any): number => round2(tax * itemShare(it));

  // Regra TS7: nunca .map() retornando JSX direto no return — extrair para const
  const itemRows = items.map((it: any, idx: number) => (
    <TableRow key={it.id || idx}>
      <TableCell>{it.code || it.part?.code || '—'}</TableCell>
      <TableCell sx={{ whiteSpace: 'normal' }}>{it.name}</TableCell>
      <TableCell align="right">{it.qty}</TableCell>
      <TableCell align="right">{formatCurrency(it.unitCost ?? it.unitPrice)}</TableCell>
      <TableCell align="right">{formatCurrency(freightShareOf(it))}</TableCell>
      <TableCell align="right">{formatCurrency(taxShareOf(it))}</TableCell>
      <TableCell align="right" sx={{ fontWeight: 600 }}>{formatCurrency(it.total)}</TableCell>
    </TableRow>
  ));

  const itemTotalsRow = (
    <TableRow sx={{ bgcolor: 'grey.100' }}>
      <TableCell colSpan={3} sx={{ fontWeight: 700 }}>Totais dos itens</TableCell>
      <TableCell align="right" sx={{ fontWeight: 700 }}>{formatCurrency(itemsTotal)}</TableCell>
      <TableCell align="right" sx={{ fontWeight: 700 }}>{formatCurrency(freight)}</TableCell>
      <TableCell align="right" sx={{ fontWeight: 700 }}>{formatCurrency(tax)}</TableCell>
      <TableCell align="right" sx={{ fontWeight: 700 }}>{formatCurrency(items.reduce((s: number, it: any) => s + (Number(it.total) || 0), 0))}</TableCell>
    </TableRow>
  );

  // Renderiza uma via completa (a flag da via é definida aqui dentro)
  const renderVia = (via: ViaType) => {
    const isEstoque = via === 'estoque';

    return (
      <Paper sx={{ p: { xs: 2, sm: 3 }, '@media print': { boxShadow: 'none', border: 'none', padding: 0 } }}>
        {/* Cabeçalho */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 3, pb: 2, borderBottom: 2, borderColor: 'primary.main' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <img src="/images/logo-papatec.png" alt="Papatec" style={{ width: 60, height: 60, objectFit: 'contain' }} />
            <Box>
              <Typography variant="h4" sx={{ fontWeight: 700, color: 'primary.main', lineHeight: 1.2 }}>Papatec - Via Fornecedor</Typography>
              <Typography variant="body2" color="text.secondary">Assistência Técnica & Vendas</Typography>
            </Box>
          </Box>
          <Box sx={{ textAlign: 'right' }}>
            <Typography variant="h5" sx={{ fontWeight: 700, color: 'primary.main' }}>
              {isEstoque ? '2ª VIA - ESTOQUE/LOJA' : '1ª VIA - FORNECEDOR'}
            </Typography>
            <Typography variant="body1" sx={{ fontWeight: 600 }}>NOTA DE ENTRADA / DOCUMENTO DE COMPRA</Typography>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>{purchase.code || '—'}</Typography>
            <Typography variant="caption" color="text.secondary">Entrada em {formatDate(purchase.purchaseDate || purchase.createdAt)}</Typography>
          </Box>
        </Box>

        {/* Dados da compra */}
        <Box sx={{ mb: 3 }}>
          <Typography variant="h6" sx={{ mb: 1, color: 'primary.main', borderBottom: 1, borderColor: 'primary.main', pb: 0.5 }}>Dados da Compra</Typography>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}><Typography variant="body2" color="text.secondary">Código</Typography><Typography variant="body1" sx={{ fontWeight: 500 }}>{purchase.code || '—'}</Typography></Grid>
            <Grid item xs={12} sm={6}><Typography variant="body2" color="text.secondary">Data da Entrada</Typography><Typography variant="body1" sx={{ fontWeight: 500 }}>{formatDate(purchase.purchaseDate || purchase.createdAt, true)}</Typography></Grid>
            <Grid item xs={12} sm={6}><Typography variant="body2" color="text.secondary">Lançada por</Typography><Typography variant="body1" sx={{ fontWeight: 500 }}>{purchase.user?.name || 'Não informado'}</Typography></Grid>
            {purchase.paymentMethod && (
              <Grid item xs={12} sm={6}><Typography variant="body2" color="text.secondary">Forma de pagamento</Typography><Typography variant="body1" sx={{ fontWeight: 500 }}>{purchase.paymentMethod}</Typography></Grid>
            )}
          </Grid>
        </Box>

        {/* Fornecedor */}
        <Box sx={{ mb: 3 }}>
          <Typography variant="h6" sx={{ mb: 1, color: 'primary.main', borderBottom: 1, borderColor: 'primary.main', pb: 0.5 }}>Fornecedor</Typography>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}><Typography variant="body2" color="text.secondary">Nome / Razão social</Typography><Typography variant="body1" sx={{ fontWeight: 500 }}>{purchase.supplier?.name || 'Não informado'}</Typography></Grid>
            <Grid item xs={12} sm={6}><Typography variant="body2" color="text.secondary">CNPJ / CPF</Typography><Typography variant="body1" sx={{ fontWeight: 500 }}>{supplierDoc(purchase.supplier)}</Typography></Grid>
            {purchase.supplier?.code && (
              <Grid item xs={12} sm={6}><Typography variant="body2" color="text.secondary">Código do fornecedor</Typography><Typography variant="body1" sx={{ fontWeight: 500 }}>{purchase.supplier.code}</Typography></Grid>
            )}
          </Grid>
        </Box>

        {/* Notas fiscais */}
        <Box sx={{ mb: 3, p: 2, bgcolor: 'grey.50', borderRadius: 1, border: 1, borderColor: 'divider' }}>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}><Typography variant="body2" color="text.secondary">NF de compra</Typography><Typography variant="body1" sx={{ fontWeight: 500 }}>{purchase.nfNumber || '—'}</Typography></Grid>
            <Grid item xs={12} sm={6}><Typography variant="body2" color="text.secondary">NF de transporte</Typography><Typography variant="body1" sx={{ fontWeight: 500 }}>{purchase.nfTransport || '—'}</Typography></Grid>
          </Grid>
        </Box>

        {/* Itens */}
        <Box sx={{ mb: 3 }}>
          <Typography variant="h6" sx={{ mb: 0.5, color: 'primary.main', borderBottom: 1, borderColor: 'primary.main', pb: 0.5 }}>Itens da Entrada</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Contagem de itens: {items.length} item(ns) · {totalQty} unidade(s)
          </Typography>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Código</TableCell>
                  <TableCell>Descrição</TableCell>
                  <TableCell align="right">Qtd</TableCell>
                  <TableCell align="right">Custo Unit.</TableCell>
                  <TableCell align="right">Frete (rateio)</TableCell>
                  <TableCell align="right">Imposto (rateio)</TableCell>
                  <TableCell align="right">Total</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {itemRows}
                {itemTotalsRow}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>

        {/* Totais */}
        <Box sx={{ mb: 3, maxWidth: 420, ml: 'auto' }}>
          <TableContainer>
            <Table size="small">
              <TableBody>
                <TableRow>
                  <TableCell>Soma dos itens</TableCell>
                  <TableCell align="right">{formatCurrency(itemsTotal)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Frete</TableCell>
                  <TableCell align="right">{formatCurrency(freight)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Imposto</TableCell>
                  <TableCell align="right">{formatCurrency(tax)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Desconto {purchase.discountType === 'PERCENT' ? `(${purchase.discount}%)` : ''}</TableCell>
                  <TableCell align="right" color="error">- {formatCurrency(discountValue)}</TableCell>
                </TableRow>
                <TableRow sx={{ fontWeight: 700, bgcolor: 'primary.light' }}>
                  <TableCell>TOTAL GERAL</TableCell>
                  <TableCell align="right">{formatCurrency(purchase.total)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </TableContainer>
        </Box>

        {/* Observações */}
        {purchase.notes && (
          <Box sx={{ mb: 3 }}>
            <Typography variant="h6" sx={{ mb: 1, color: 'primary.main', borderBottom: 1, borderColor: 'primary.main', pb: 0.5 }}>Observações</Typography>
            <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>{purchase.notes}</Typography>
          </Box>
        )}

        {/* Informações internas — somente 2ª via (Estoque/Loja) */}
        {isEstoque && (
          <Box sx={{ mb: 3, p: 2, bgcolor: 'warning.light', borderRadius: 1, border: 1, borderColor: 'warning.main' }}>
            <Typography variant="h6" sx={{ mb: 1, color: 'warning.dark' }}>Conferência de Entrada (Uso interno)</Typography>
            <Grid container spacing={2}>
              <Grid item xs={12} sm={6}><Typography variant="body2" color="text.secondary">Lançamento registrado em</Typography><Typography variant="body1">{formatDateTime(purchase.createdAt)}</Typography></Grid>
              <Grid item xs={12} sm={6}><Typography variant="body2" color="text.secondary">Responsável pelo lançamento</Typography><Typography variant="body1">{purchase.user?.name || 'Não informado'}</Typography></Grid>
              <Grid item xs={12} sm={6}><Typography variant="body2" color="text.secondary">NF de compra</Typography><Typography variant="body1">{purchase.nfNumber || '—'}</Typography></Grid>
              <Grid item xs={12} sm={6}><Typography variant="body2" color="text.secondary">Itens conferidos no estoque</Typography><Typography variant="body1">{items.length} item(ns)</Typography></Grid>
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
                <Typography variant="body2" color="text.secondary">Responsável pela entrada</Typography>
                <Typography variant="body1" sx={{ fontWeight: 500, mt: 1 }}>{purchase.user?.name || 'Não informado'}</Typography>
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>Data: ___/___/______</Typography>
              </Box>
            </Grid>
            <Grid item xs={12} sm={6}>
              <Box sx={{ textAlign: 'center', p: 2, borderTop: 1, borderColor: 'divider', minHeight: 100 }}>
                <Typography variant="caption" color="text.secondary">___________________________________</Typography>
                <Typography variant="body2" color="text.secondary">Visto</Typography>
                <Typography variant="body1" sx={{ fontWeight: 500, mt: 1 }}>&nbsp;</Typography>
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>Data: ___/___/______</Typography>
              </Box>
            </Grid>
          </Grid>
        </Box>

        {/* Rodapé */}
        <Box sx={{ mt: 4, pt: 2, borderTop: 1, borderColor: 'divider', textAlign: 'center', color: 'text.secondary' }}>
          <Typography variant="caption">
            Papatec - Via Fornecedor | Nota de Entrada {purchase.code || ''} | Emitida em {formatDateTime(new Date())} |{' '}
            {isEstoque ? '2ª VIA - ESTOQUE/LOJA' : '1ª VIA - FORNECEDOR'}
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
          <Typography variant="h6" sx={{ fontWeight: 700 }}>Imprimir Compra {purchase.code || ''}</Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Tabs value={activeVia} onChange={(_, v) => setActiveVia(v as ViaType)} sx={{ minWidth: 360 }}>
            <Tab value="fornecedor" label="1ª VIA - FORNECEDOR" />
            <Tab value="estoque" label="2ª VIA - ESTOQUE/LOJA" />
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
        {renderVia('fornecedor')}

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

        {renderVia('estoque')}
      </Box>
    </Box>
  );
}

export default PurchasePrintPage;
