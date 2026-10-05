import { Box, Card, CardContent, Typography, Grid, Alert, CircularProgress, TableContainer, Table, TableHead, TableBody, TableRow, TableCell, Chip, Divider, Chip as MuiChip } from '@mui/material';
import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { purchasesApi } from '../../services/api';
import { SecondaryButton, DangerButton } from '../../components/ui/Buttons';
import { formatCurrency, formatDateTime } from '../../utils/formatters';

export function PurchaseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState('');

  const { data: purchase, isLoading } = useQuery({
    queryKey: ['purchase', id],
    queryFn: () => purchasesApi.get(id!),
  });

  const deleteMutation = useMutation({
    mutationFn: () => purchasesApi.delete(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchases'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      navigate('/purchases');
    },
    onError: (err: any) => setError(err.response?.data?.message || 'Erro ao remover a compra'),
  });

  if (isLoading || !purchase) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>{isLoading ? <CircularProgress /> : <Typography>Compra não encontrada.</Typography>}</Box>;
  }

  const discountValue =
    purchase.discountType === 'PERCENT'
      ? Math.round(purchase.itemsTotal * purchase.discount * 100) / 10000
      : purchase.discount;

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3, flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography variant="h4" fontWeight={700} sx={{ mb: 0.5 }}>
            Compra {purchase.code} <MuiChip size="small" label={formatDateTime(purchase.purchaseDate)} sx={{ ml: 1 }} />
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Fornecedor: {purchase.supplier?.name} · Lançada por {purchase.user?.name}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <SecondaryButton onClick={() => navigate('/purchases')}>Voltar</SecondaryButton>
          <DangerButton
            onClick={() => {
              if (window.confirm('Remover esta compra e REVERTER a entrada no estoque? O custo dos produtos não é recalculado automaticamente.')) {
                deleteMutation.mutate();
              }
            }}
          >
            Remover e reverter estoque
          </DangerButton>
        </Box>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError('')}>{error}</Alert>}

      <Grid container spacing={3}>
        <Grid item xs={12} md={8}>
          <Card>
            <CardContent>
              <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 2 }}>Itens comprados</Typography>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>SKU</TableCell>
                      <TableCell>Descrição</TableCell>
                      <TableCell align="right">Qtd</TableCell>
                      <TableCell align="right">Valor unit.</TableCell>
                      <TableCell align="right">Total</TableCell>
                      <TableCell align="right">Custo unit. c/ rateio</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(purchase.items || []).map((it: any) => (
                      <TableRow key={it.id}>
                        <TableCell><Chip size="small" label={it.code || '—'} variant="outlined" /></TableCell>
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
                        <TableCell align="right" sx={{ fontWeight: 600 }}>{formatCurrency(it.total)}</TableCell>
                        <TableCell align="right" sx={{ color: 'success.main' }}>{formatCurrency(it.unitCost)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={4}>
          <Card>
            <CardContent>
              <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 2 }}>Resumo financeiro</Typography>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                <Typography color="text.secondary">Itens</Typography>
                <Typography>{formatCurrency(purchase.itemsTotal)}</Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                <Typography color="text.secondary">Frete</Typography>
                <Typography>{formatCurrency(purchase.freight)}</Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                <Typography color="text.secondary">Imposto</Typography>
                <Typography>{formatCurrency(purchase.tax)}</Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                <Typography color="text.secondary">Desconto {purchase.discountType === 'PERCENT' ? `(${purchase.discount}%)` : ''}</Typography>
                <Typography color="success.main">- {formatCurrency(discountValue)}</Typography>
              </Box>
              <Divider sx={{ my: 1.5 }} />
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography fontWeight={700}>Total</Typography>
                <Typography variant="h5" fontWeight={700} color="primary.main">{formatCurrency(purchase.total)}</Typography>
              </Box>

              <Divider sx={{ my: 2 }} />
              <Grid container spacing={1}>
                <Grid item xs={6}>
                  <Typography variant="caption" color="text.secondary">Forma de pagamento</Typography>
                  <Typography variant="body2">{purchase.paymentMethod || '—'}</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="caption" color="text.secondary">NF de compra</Typography>
                  <Typography variant="body2">{purchase.nfNumber || '—'}</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="caption" color="text.secondary">NF de transporte</Typography>
                  <Typography variant="body2">{purchase.nfTransport || '—'}</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="caption" color="text.secondary">Criada em</Typography>
                  <Typography variant="body2">{formatDateTime(purchase.createdAt)}</Typography>
                </Grid>
                {purchase.notes && (
                  <Grid item xs={12}>
                    <Typography variant="caption" color="text.secondary">Observações</Typography>
                    <Typography variant="body2">{purchase.notes}</Typography>
                  </Grid>
                )}
              </Grid>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
}
