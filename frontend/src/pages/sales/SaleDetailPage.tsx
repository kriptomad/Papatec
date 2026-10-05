import { Box, Card, CardContent, Typography, Grid, Alert, CircularProgress, TableContainer, Table, TableHead, TableBody, TableRow, TableCell, Chip, Divider, Dialog, DialogTitle, DialogContent, DialogActions, RadioGroup, FormControlLabel, Radio, TextField, MenuItem, Chip as MuiChip } from '@mui/material';
import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { salesApi, cardMachinesApi, type CardMachine, type PaymentKind, type CardChargeResult } from '../../services/api';
import { PrimaryButton, SecondaryButton, DangerButton } from '../../components/ui/Buttons';
import FormErrors from '../../components/ui/FormErrors';
import { formatCurrency, formatDateTime, formatCpf, formatCnpj } from '../../utils/formatters';
import { Edit, Print, Delete, Undo, ArrowBack, CreditCard } from '@mui/icons-material';

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

/**
 * `paymentStatus` é o ESTADO do pagamento. `paymentMethod` é só a forma
 * escolhida no cadastro — "Cartão" aqui NÃO significa que a venda foi paga.
 */
const PAYMENT_STATUS_LABELS: Record<string, string> = {
  PENDING: 'Em aberto',
  PAID: 'Paga',
  FAILED: 'Recusada',
  CANCELLED: 'Cancelada',
  REFUNDED: 'Estornada',
  PARTIAL: 'Parcial',
};
const paymentStatusLabel = (value?: string | null): string =>
  value ? PAYMENT_STATUS_LABELS[value] || value : 'Em aberto';

const PAYMENT_STATUS_COLOR: Record<string, 'default' | 'success' | 'error' | 'warning'> = {
  PENDING: 'warning',
  PAID: 'success',
  FAILED: 'error',
  CANCELLED: 'default',
  REFUNDED: 'default',
  PARTIAL: 'warning',
};

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

const returnItems = (ret: any): any[] => ret?.items || [];

/** Comissão calculada de um item (o backend só persiste o total da venda). */
const itemCommission = (it: any): number => {
  const net = Number(it.total) || 0;
  if (it.commissionType === 'VALUE') return Number(it.commissionValue) || 0;
  return (net * (Number(it.commissionPercent) || 0)) / 100;
};

// ---------------------------------------------------------------------------
export function SaleDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [error, setError] = useState<any>(null);
  const [returnOpen, setReturnOpen] = useState(false);

  // -----------------------------------------------------------------maquininha
  const [chargeOpen, setChargeOpen] = useState(false);
  const [chargeKind, setChargeKind] = useState<PaymentKind>('CREDIT');
  const [chargeInstallments, setChargeInstallments] = useState(1);
  const [chargeMachineId, setChargeMachineId] = useState('');
  const [chargeResult, setChargeResult] = useState<CardChargeResult | null>(null);
  const openChargeDialog = () => {
    setChargeResult(null);
    setError(null);
    setChargeOpen(true);
  };
  const closeChargeDialog = () => setChargeOpen(false);

  const machinesQuery = useQuery({
    queryKey: ['cardMachines'],
    queryFn: () => cardMachinesApi.list(),
    enabled: chargeOpen,
  });
  const machines: CardMachine[] = (machinesQuery.data as any) || [];
  const activeMachines = machines.filter((m) => m.isActive && (m.supportedTypes || []).includes(chargeKind));

  const chargeMutation = useMutation({
    mutationFn: () =>
      cardMachinesApi.chargeSale(id as string, {
        type: chargeKind,
        installments: chargeKind === 'CREDIT' ? chargeInstallments : 1,
        machineId: chargeMachineId || undefined,
      }),
    onSuccess: (r: any) => {
      setChargeResult(r);
      queryClient.invalidateQueries({ queryKey: ['sale', id] });
      queryClient.invalidateQueries({ queryKey: ['sales'] });
      queryClient.invalidateQueries({ queryKey: ['cardMachines'] });
    },
    onError: (e: any) => setError(e),
  });
  const [returnType, setReturnType] = useState<'RETURN' | 'EXCHANGE'>('RETURN');
  const [returnQtys, setReturnQtys] = useState<Record<string, number>>({});
  const [returnReason, setReturnReason] = useState('');
  const [returnNotes, setReturnNotes] = useState('');
  const [createdReturn, setCreatedReturn] = useState<any>(null);

  const currentUser = JSON.parse(localStorage.getItem('user') || '{}');
  const isAdmin = currentUser?.role === 'ADMIN';

  const { data, isLoading } = useQuery({
    queryKey: ['sale', id],
    queryFn: () => salesApi.get(id!),
  });
  const sale: any = data ? unwrapAny(data) : null;

  const deleteMutation = useMutation({
    mutationFn: () => salesApi.remove(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sales'] });
      navigate('/sales');
    },
    onError: (err: any) => setError(err),
  });

  const returnMutation = useMutation({
    mutationFn: (payload: any) => salesApi.createReturn(id!, payload),
    onSuccess: (res: any) => {
      setCreatedReturn(unwrapAny(res));
      queryClient.invalidateQueries({ queryKey: ['sale', id] });
      queryClient.invalidateQueries({ queryKey: ['sales'] });
    },
    onError: (err: any) => setError(err),
  });

  const openReturnDialog = () => {
    setReturnType('RETURN');
    setReturnQtys({});
    setReturnReason('');
    setReturnNotes('');
    setCreatedReturn(null);
    setError(null);
    setReturnOpen(true);
  };

  const closeReturnDialog = () => {
    setReturnOpen(false);
    setCreatedReturn(null);
    setError(null);
  };

  const confirmReturn = () => {
    setError(null);
    const selected = (sale?.items || [])
      .map((it: any) => ({ saleItemId: it.id, qty: Number(returnQtys[it.id]) || 0 }))
      .filter((i: any) => i.qty > 0);
    if (selected.length === 0) {
      setError('Selecione ao menos um item para devolver (quantidade maior que zero).');
      return;
    }
    returnMutation.mutate({
      type: returnType,
      items: selected,
      reason: returnReason.trim() || undefined,
      notes: returnNotes.trim() || undefined,
    });
  };

  const handleDelete = () => {
    if (window.confirm('Excluir esta venda? O estoque dos itens será devolvido automaticamente.')) {
      deleteMutation.mutate();
    }
  };

  const handlePrint = () => {
    window.open(`/sales/${id}/print`, '_blank');
  };

  if (isLoading) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>;
  }
  if (!sale) {
    return <Alert severity="error">Venda não encontrada.</Alert>;
  }

  const items: any[] = sale.items || [];
  const returns: any[] = sale.returns || [];
  const itemsNet = items.reduce((s: number, it: any) => s + (Number(it.total) || 0), 0);

  const statusLabel = returns.length > 0 ? 'Com devoluções' : 'Concluída';
  const statusColor = returns.length > 0 ? 'warning' : 'success';

  // Extract map results to variables (TS7 rule: nunca .map() JSX direto no return)
  const itemRows = items.map((it: any) => (
    <TableRow key={it.id}>
      <TableCell><Chip size="small" label={it.code || it.part?.code || '—'} variant="outlined" /></TableCell>
      <TableCell>
        {it.name}
        {it.part && (
          <Typography variant="caption" display="block" color="text.secondary">
            estoque atual: {it.part.quantity}
          </Typography>
        )}
      </TableCell>
      <TableCell align="right">{it.qty}</TableCell>
      <TableCell align="right">{formatCurrency(it.unitPrice)}</TableCell>
      <TableCell align="right">
        {(Number(it.discount) || 0) > 0 ? (
          <Typography variant="caption" color="error">
            {it.discountType === 'PERCENT' ? `${it.discount}%` : formatCurrency(it.discount)}
          </Typography>
        ) : '-'}
      </TableCell>
      <TableCell align="right" sx={{ fontWeight: 600 }}>{formatCurrency(it.total)}</TableCell>
      <TableCell align="right">
        <Typography variant="caption" color="success.main" fontWeight={600} display="block">
          {it.commissionType === 'VALUE' ? formatCurrency(it.commissionValue) : `${it.commissionPercent || 0}%`}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          = {formatCurrency(itemCommission(it))}
        </Typography>
      </TableCell>
    </TableRow>
  ));

  const itemsEmptyRow = (
    <TableRow>
      <TableCell colSpan={7} align="center" sx={{ py: 4, color: 'text.secondary' }}>
        Esta venda não possui itens.
      </TableCell>
    </TableRow>
  );

  const returnCards = returns.map((ret: any) => {
    const rItems = returnItems(ret).map((ri: any) => (
      <TableRow key={ri.id}>
        <TableCell>{ri.name}</TableCell>
        <TableCell align="right">{ri.qty}</TableCell>
        <TableCell align="right">{formatCurrency(ri.unitPrice)}</TableCell>
        <TableCell align="right" sx={{ fontWeight: 600 }}>{formatCurrency(ri.total)}</TableCell>
      </TableRow>
    ));
    return (
      <Card key={ret.id} variant="outlined" sx={{ mb: 2 }}>
        <CardContent>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1, mb: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
              <Chip
                size="small"
                color={ret.type === 'EXCHANGE' ? 'info' : 'warning'}
                label={ret.type === 'EXCHANGE' ? 'Troca' : 'Devolução'}
              />
              <Typography variant="subtitle2" fontWeight={700}>{ret.code}</Typography>
              <Typography variant="caption" color="text.secondary">{formatDateTime(ret.createdAt)}</Typography>
              <Typography variant="caption" color="text.secondary">por {ret.user?.name || '—'}</Typography>
            </Box>
            <Typography variant="subtitle2" fontWeight={700}>{formatCurrency(ret.total)}</Typography>
          </Box>
          {ret.reason && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
              <strong>Motivo:</strong> {ret.reason}
            </Typography>
          )}
          {ret.notes && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              <strong>Observações:</strong> {ret.notes}
            </Typography>
          )}
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
              <TableBody>{rItems}</TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>
    );
  });

  const returnDialogBody = createdReturn ? (
    <Box>
      <Alert severity="success" sx={{ mb: 2 }}>
        Documento <strong>{createdReturn.code}</strong> gerado com sucesso. Estoque devolvido automaticamente.
      </Alert>
      <Grid container spacing={2}>
        <Grid item xs={6}>
          <Typography variant="caption" color="text.secondary">Documento</Typography>
          <Typography variant="body1" fontWeight={700}>{createdReturn.code}</Typography>
        </Grid>
        <Grid item xs={6}>
          <Typography variant="caption" color="text.secondary">Tipo</Typography>
          <Typography variant="body1">{createdReturn.type === 'EXCHANGE' ? 'Troca' : 'Devolução'}</Typography>
        </Grid>
        <Grid item xs={6}>
          <Typography variant="caption" color="text.secondary">Total</Typography>
          <Typography variant="body1" fontWeight={700}>{formatCurrency(createdReturn.total)}</Typography>
        </Grid>
        <Grid item xs={6}>
          <Typography variant="caption" color="text.secondary">Data</Typography>
          <Typography variant="body1">{formatDateTime(createdReturn.createdAt)}</Typography>
        </Grid>
        <Grid item xs={12}>
          <Typography variant="caption" color="text.secondary">Itens</Typography>
          {(createdReturn.items || []).map((ri: any) => (
            <Typography key={ri.id} variant="body2">• {ri.name} — {ri.qty} un.</Typography>
          ))}
        </Grid>
      </Grid>
    </Box>
  ) : (
    <Box>
      <FormErrors error={error} onClose={() => setError(null)} />
      <RadioGroup
        row
        value={returnType}
        onChange={(e) => setReturnType(e.target.value as 'RETURN' | 'EXCHANGE')}
        sx={{ mb: 2 }}
      >
        <FormControlLabel value="RETURN" control={<Radio />} label="Devolução" />
        <FormControlLabel value="EXCHANGE" control={<Radio />} label="Troca" />
      </RadioGroup>

      <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>Itens da venda</Typography>
      <TableContainer sx={{ mb: 2 }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Produto</TableCell>
              <TableCell align="right" style={{ width: 130 }}>Qtd a devolver</TableCell>
              <TableCell align="right" style={{ width: 90 }}>Vl. unit.</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {items.map((it: any) => (
              <TableRow key={it.id}>
                <TableCell>
                  {it.name}
                  <Typography variant="caption" display="block" color="text.secondary">
                    comprado: {it.qty} un.
                  </Typography>
                </TableCell>
                <TableCell align="right">
                  <TextField
                    type="number"
                    size="small"
                    value={returnQtys[it.id] ?? 0}
                    onChange={(e) =>
                      setReturnQtys((prev) => ({
                        ...prev,
                        [it.id]: Math.max(0, Math.min(it.qty, Math.trunc(Number(e.target.value) || 0))),
                      }))
                    }
                    inputProps={{ style: { textAlign: 'right' }, min: 0, max: it.qty }}
                    sx={{ width: 90 }}
                  />
                  <Typography variant="caption" display="block" color="text.secondary">máx. {it.qty}</Typography>
                </TableCell>
                <TableCell align="right">{formatCurrency(it.unitPrice)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <TextField
        fullWidth
        size="small"
        label="Motivo"
        value={returnReason}
        onChange={(e) => setReturnReason(e.target.value)}
        placeholder="Ex.: produto com defeito, arrependimento..."
        sx={{ mb: 2 }}
      />
      <TextField
        fullWidth
        size="small"
        label="Observações"
        multiline
        rows={2}
        value={returnNotes}
        onChange={(e) => setReturnNotes(e.target.value)}
      />
    </Box>
  );

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3, flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography variant="h4" fontWeight={700} sx={{ mb: 0.5, display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            Venda {sale.code}
            <MuiChip size="small" label={formatDateTime(sale.createdAt)} />
            <Chip size="small" color={statusColor as any} label={statusLabel} />
            <Chip
              size="small"
              variant="outlined"
              label={sale.saleType === 'FROM_OS' ? 'Gerada da O.S.' : 'Venda de produto'}
            />
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Cliente: {sale.client?.name || 'Consumidor'} · Vendedor: {sale.user?.name || '—'}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <SecondaryButton startIcon={<ArrowBack />} onClick={() => navigate('/sales')}>Voltar</SecondaryButton>
          {sale.saleType === 'PRODUCT_ONLY' && (
            <SecondaryButton startIcon={<Edit />} onClick={() => navigate(`/sales/${id}/edit`)}>Editar</SecondaryButton>
          )}
          <PrimaryButton
            startIcon={<CreditCard />}
            onClick={openChargeDialog}
            disabled={sale.paymentStatus === 'PAID'}
          >
            {sale.paymentStatus === 'PAID' ? 'Paga' : 'Cobrar maquininha'}
          </PrimaryButton>
          <SecondaryButton startIcon={<Print />} onClick={handlePrint}>Imprimir</SecondaryButton>
          <SecondaryButton startIcon={<Undo />} onClick={openReturnDialog}>Devolver / Trocar</SecondaryButton>
          {isAdmin && (
            <DangerButton startIcon={<Delete />} onClick={handleDelete} loading={deleteMutation.isPending}>
              Excluir
            </DangerButton>
          )}
        </Box>
      </Box>

      {error && !returnOpen && <FormErrors error={error} onClose={() => setError(null)} />}

      <Grid container spacing={3}>
        <Grid item xs={12} md={8}>
          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 2 }}>Itens da venda</Typography>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Código</TableCell>
                      <TableCell>Descrição</TableCell>
                      <TableCell align="right">Qtd</TableCell>
                      <TableCell align="right">Vl. unit.</TableCell>
                      <TableCell align="right">Desc.</TableCell>
                      <TableCell align="right">Total</TableCell>
                      <TableCell align="right">Comissão</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {items.length > 0 ? itemRows : itemsEmptyRow}
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 2 }}>
                Devoluções e trocas ({returns.length})
              </Typography>
              {returns.length > 0 ? (
                returnCards
              ) : (
                <Alert severity="info">Nenhuma devolução ou troca registrada para esta venda.</Alert>
              )}
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={4}>
          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 2 }}>Resumo financeiro</Typography>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                <Typography color="text.secondary">Subtotal dos itens</Typography>
                <Typography>{formatCurrency(itemsNet)}</Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                <Typography color="text.secondary">
                  Desconto{sale.discountType === 'PERCENT' ? ' (percentual)' : ''}
                </Typography>
                <Typography color="success.main">- {formatCurrency(sale.discount || 0)}</Typography>
              </Box>
              {(Number(sale.freight) || 0) > 0 && (
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                  <Typography color="text.secondary">Frete</Typography>
                  <Typography>+ {formatCurrency(Number(sale.freight) || 0)}</Typography>
                </Box>
              )}
              <Divider sx={{ my: 1.5 }} />
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                <Typography fontWeight={700}>Total</Typography>
                <Typography variant="h5" fontWeight={700} color="primary.main">{formatCurrency(sale.total)}</Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography color="text.secondary">Comissão total</Typography>
                <Typography color="success.main" fontWeight={600}>{formatCurrency(sale.totalCommission)}</Typography>
              </Box>

              <Divider sx={{ my: 2 }} />
              <Grid container spacing={1}>
                <Grid item xs={12}>
                  <Typography variant="caption" color="text.secondary">Forma de pagamento</Typography>
                  <Typography variant="body2">{paymentLabel(sale.paymentMethod)}</Typography>
                </Grid>
                <Grid item xs={12}>
                  <Typography variant="caption" color="text.secondary">Situação do pagamento</Typography>
                  <Box sx={{ mt: 0.5 }}>
                    <Chip
                      size="small"
                      label={paymentStatusLabel(sale.paymentStatus)}
                      color={PAYMENT_STATUS_COLOR[sale.paymentStatus as string] || 'default'}
                    />
                    {sale.paidAt && (
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                        Pago em {formatDateTime(sale.paidAt)}
                      </Typography>
                    )}
                  </Box>
                </Grid>
                {(sale.cardNsu || sale.cardAuthorizationCode) && (
                  <Grid item xs={12}>
                    <Typography variant="caption" color="text.secondary">Comprovante da maquininha</Typography>
                    <Typography variant="body2">
                      {sale.cardNsu ? `NSU ${sale.cardNsu}` : ''}
                      {sale.cardNsu && sale.cardAuthorizationCode ? ' · ' : ''}
                      {sale.cardAuthorizationCode ? `Aut. ${sale.cardAuthorizationCode}` : ''}
                      {sale.cardInstallments ? ` · ${sale.cardInstallments}x` : ''}
                    </Typography>
                  </Grid>
                )}
                <Grid item xs={12}>
                  <Typography variant="caption" color="text.secondary">Emitida em</Typography>
                  <Typography variant="body2">{formatDateTime(sale.createdAt)}</Typography>
                </Grid>
                <Grid item xs={12}>
                  <Typography variant="caption" color="text.secondary">Cliente (CPF/CNPJ)</Typography>
                  <Typography variant="body2">{clientDoc(sale.client)}</Typography>
                </Grid>
                {sale.osId && (
                  <Grid item xs={12}>
                    <Typography variant="caption" color="text.secondary">O.S. de origem</Typography>
                    <Typography
                      variant="body2"
                      sx={{ color: 'primary.main', cursor: 'pointer' }}
                      onClick={() => navigate(`/service-orders/${sale.osId}`)}
                    >
                      Ver ordem de serviço
                    </Typography>
                  </Grid>
                )}
                {sale.notes && (
                  <Grid item xs={12}>
                    <Typography variant="caption" color="text.secondary">Observações</Typography>
                    <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{sale.notes}</Typography>
                  </Grid>
                )}
              </Grid>
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1 }}>Entrega</Typography>
              {sale.deliveryAddress ? (
                <Box>
                  <Chip size="small" color="info" label="Entrega" sx={{ mb: 1 }} />
                  <Typography variant="body2">{formatAddress(sale.deliveryAddress)}</Typography>
                  {sale.deliveryAddress.label && (
                    <Typography variant="caption" color="text.secondary" display="block">
                      {sale.deliveryAddress.label}
                    </Typography>
                  )}
                </Box>
              ) : (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Chip size="small" variant="outlined" label="Retirar na loja" />
                  <Typography variant="caption" color="text.secondary">Sem entrega programada</Typography>
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Dialog Devolver / Trocar */}
      <Dialog open={returnOpen} onClose={closeReturnDialog} maxWidth="sm" fullWidth>
        <DialogTitle>
          {createdReturn ? 'Documento gerado' : 'Devolver / Trocar itens'}
        </DialogTitle>
        <DialogContent dividers>
          {returnDialogBody}
        </DialogContent>
        <DialogActions>
          {createdReturn ? (
            <>
              <SecondaryButton onClick={closeReturnDialog}>Fechar</SecondaryButton>
              <PrimaryButton
                startIcon={<Print />}
                onClick={() => window.open(`/sales/${id}/print`, '_blank')}
              >
                Imprimir documento
              </PrimaryButton>
            </>
          ) : (
            <>
              <SecondaryButton onClick={closeReturnDialog}>Cancelar</SecondaryButton>
              <PrimaryButton onClick={confirmReturn} loading={returnMutation.isPending}>
                Confirmar {returnType === 'EXCHANGE' ? 'troca' : 'devolução'}
              </PrimaryButton>
            </>
          )}
        </DialogActions>
      </Dialog>

      {/* -------------------------------------------------- Cobrar maquininha */}
      <Dialog open={chargeOpen} onClose={closeChargeDialog} maxWidth="sm" fullWidth>
        <DialogTitle>Cobrar com maquininha</DialogTitle>
        <DialogContent dividers>
          {error && chargeOpen && <FormErrors error={error} onClose={() => setError(null)} />}

          {chargeResult ? (
            <Box>
              <Alert severity={chargeResult.status === 'APPROVED' ? 'success' : chargeResult.status === 'PENDING' ? 'info' : 'error'} sx={{ mb: 2 }}>
                {chargeResult.status === 'APPROVED' && 'Pagamento aprovado.'}
                {chargeResult.status === 'PENDING' && 'Transação em andamento na maquininha. O resultado será confirmado automaticamente.'}
                {chargeResult.status === 'DECLINED' && `Recusada${chargeResult.message ? `: ${chargeResult.message}` : '.'}`}
                {chargeResult.status === 'CANCELLED' && 'Cancelada.'}
                {chargeResult.status === 'ERROR' && `Erro: ${chargeResult.message || 'falha na comunicação'}`}
              </Alert>
              <Box sx={{ display: 'grid', gap: 0.5 }}>
                <Typography variant="body2">Gateway: <strong>{chargeResult.gateway}</strong></Typography>
                <Typography variant="body2">Maquininha: <strong>{chargeResult.machineId}</strong></Typography>
                {chargeResult.nsu && <Typography variant="body2">NSU: <strong>{chargeResult.nsu}</strong></Typography>}
                {chargeResult.authorizationCode && (
                  <Typography variant="body2">Autorização: <strong>{chargeResult.authorizationCode}</strong></Typography>
                )}
              </Box>
            </Box>
          ) : (
            <Box sx={{ display: 'grid', gap: 2 }}>
              <Alert severity="info">
                Valor a cobrar: <strong>{formatCurrency(sale.total)}</strong>
              </Alert>

              <TextField
                select
                fullWidth
                label="Tipo de pagamento"
                value={chargeKind}
                onChange={(e) => {
                  setChargeKind(e.target.value as PaymentKind);
                  setChargeMachineId('');
                }}
              >
                <MenuItem value="CREDIT">Cartão de crédito</MenuItem>
                <MenuItem value="DEBIT">Cartão de débito</MenuItem>
                <MenuItem value="PIX">PIX</MenuItem>
              </TextField>

              {chargeKind === 'CREDIT' && (
                <TextField
                  select
                  fullWidth
                  label="Parcelas"
                  value={chargeInstallments}
                  onChange={(e) => setChargeInstallments(Number(e.target.value))}
                >
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => (
                    <MenuItem key={n} value={n}>{n}x</MenuItem>
                  ))}
                </TextField>
              )}

              <TextField
                select
                fullWidth
                label="Maquininha"
                value={chargeMachineId}
                onChange={(e) => setChargeMachineId(e.target.value)}
                helperText={
                  machinesQuery.isLoading
                    ? 'Carregando maquininhas...'
                    : activeMachines.length === 0
                      ? 'Nenhuma maquininha ativa para este tipo. Cadastre em Configurações.'
                      : 'Deixe vazio para usar a maquininha disponível.'
                }
              >
                <MenuItem value="">Automática</MenuItem>
                {activeMachines.map((m) => (
                  <MenuItem key={m.id} value={m.id}>
                    {m.name} ({m.gateway?.driver || 'TEF_IP'})
                  </MenuItem>
                ))}
              </TextField>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <SecondaryButton onClick={closeChargeDialog}>Fechar</SecondaryButton>
          {!chargeResult && (
            <PrimaryButton
              startIcon={<CreditCard />}
              onClick={() => chargeMutation.mutate()}
              loading={chargeMutation.isPending}
            >
              Cobrar {formatCurrency(sale.total)}
            </PrimaryButton>
          )}
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default SaleDetailPage;
