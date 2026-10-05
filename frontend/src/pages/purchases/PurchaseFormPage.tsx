import { Box, Card, CardContent, TextField, Typography, Grid, Alert, MenuItem, Autocomplete, IconButton, TableContainer, Table, TableHead, TableBody, TableRow, TableCell, Chip, Divider, useTheme } from '@mui/material';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery, useMutation } from '@tanstack/react-query';
import { purchasesApi, suppliersApi, inventoryApi } from '../../services/api';
import { PrimaryButton, SecondaryButton, DangerButton } from '../../components/ui/Buttons';
import { formatCurrency } from '../../utils/formatters';
import { Delete, Add } from '@mui/icons-material';

const purchaseSchema = z.object({
  supplierId: z.string().min(1, 'Selecione o fornecedor'),
  purchaseDate: z.string().min(1, 'Data obrigatória'),
  freight: z.number().min(0, 'Não pode ser negativo'),
  tax: z.number().min(0, 'Não pode ser negativo'),
  discountType: z.enum(['VALUE', 'PERCENT']),
  discount: z.number().min(0, 'Não pode ser negativo'),
  paymentMethod: z.string().optional(),
  nfNumber: z.string().optional(),
  nfTransport: z.string().optional(),
  notes: z.string().optional(),
});

type PurchaseFormValues = z.infer<typeof purchaseSchema>;

interface DraftItem {
  partId: string;
  code: string;
  name: string;
  qty: number;
  unitPrice: number;
}

const PAYMENT_OPTIONS = ['Dinheiro', 'PIX', 'Cartão de Crédito', 'Cartão de Débito', 'Boleto', 'Transferência', 'A Prazo'];
const round2 = (v: number) => Math.round(v * 100) / 100;

export function PurchaseFormPage() {
  const navigate = useNavigate();
  const theme = useTheme();
  const [error, setError] = useState('');
  const [items, setItems] = useState<DraftItem[]>([]);
  const [partInput, setPartInput] = useState('');

  const { register, handleSubmit, watch, formState: { errors, isSubmitting }, setValue } = useForm<PurchaseFormValues>({
    resolver: zodResolver(purchaseSchema),
    defaultValues: {
      supplierId: '',
      // Data local de hoje (o toISOString() puro usava a data UTC e, à noite,
      // sugeria o dia seguinte para o usuário)
      purchaseDate: new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10),
      freight: 0,
      tax: 0,
      discountType: 'VALUE',
      discount: 0,
      paymentMethod: '',
      nfNumber: '',
      nfTransport: '',
      notes: '',
    },
  });

  const { data: suppliers } = useQuery({
    queryKey: ['suppliers-options'],
    queryFn: () => suppliersApi.options(),
  });

  // Busca de produto por SKU/nome para adicionar à grade (PDF p.5)
  const { data: partResults } = useQuery({
    queryKey: ['purchase-part-search', partInput],
    queryFn: () => inventoryApi.list({ search: partInput, take: 10, status: 'ACTIVE' }),
    enabled: partInput.trim().length >= 1,
  });

  const freight = Number(watch('freight')) || 0;
  const tax = Number(watch('tax')) || 0;
  const discount = Number(watch('discount')) || 0;
  const discountType = watch('discountType');

  // Totais e rateio ao vivo (mesma fórmula do backend)
  const itemsTotal = round2(items.reduce((s, it) => s + it.qty * it.unitPrice, 0));
  const discountValue = round2(discountType === 'PERCENT' ? (itemsTotal * discount) / 100 : discount);
  const total = round2(itemsTotal + freight + tax - discountValue);
  const extraTotal = freight + tax - discountValue;
  const itemShare = (it: DraftItem) => (itemsTotal > 0 ? round2(it.qty * it.unitPrice) / itemsTotal : 0);
  const itemUnitCost = (it: DraftItem) => round2(it.unitPrice + (extraTotal * itemShare(it)) / it.qty);

  const addItem = (part: any) => {
    if (!part) return;
    if (items.some((i) => i.partId === part.id)) {
      setError('Produto já está na lista. Ajuste a quantidade na linha.');
      return;
    }
    setItems((prev) => [
      ...prev,
      { partId: part.id, code: part.code, name: part.name, qty: 1, unitPrice: Number(part.costPrice) || 0 },
    ]);
    setPartInput('');
    setError('');
  };

  const updateItem = (partId: string, patch: Partial<DraftItem>) => {
    setItems((prev) => prev.map((i) => (i.partId === partId ? { ...i, ...patch } : i)));
  };

  const removeItem = (partId: string) => setItems((prev) => prev.filter((i) => i.partId !== partId));

  const saveMutation = useMutation({
    mutationFn: (data: PurchaseFormValues) =>
      purchasesApi.create({
        ...data,
        purchaseDate: new Date(`${data.purchaseDate}T12:00:00`).toISOString(),
        items: items.map((i) => ({ partId: i.partId, qty: i.qty, unitPrice: i.unitPrice })),
      }),
    onSuccess: (purchase: any) => navigate(`/purchases/${purchase.id}`),
    onError: (err: any) => setError(err.response?.data?.message || 'Erro ao registrar a compra'),
  });

  const onSubmit = (data: PurchaseFormValues) => {
    setError('');
    if (items.length === 0) {
      setError('Adicione pelo menos um produto à compra.');
      return;
    }
    if (items.some((i) => i.qty <= 0 || i.unitPrice < 0)) {
      setError('Verifique quantidade e valor dos itens.');
      return;
    }
    saveMutation.mutate(data);
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3, flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography variant="h4" fontWeight={700} sx={{ mb: 0.5 }}>Nova Compra</Typography>
          <Typography variant="body1" color="text.secondary">Entrada de mercadoria — estoque e custo atualizados automaticamente</Typography>
        </Box>
        <SecondaryButton onClick={() => navigate('/purchases')}>Voltar</SecondaryButton>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError('')}>{error}</Alert>}

      <form onSubmit={handleSubmit(onSubmit)}>
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Grid container spacing={3}>
              <Grid item xs={12} sm={5}>
                <TextField
                  select fullWidth label="Fornecedor *"
                  {...register('supplierId')}
                  error={!!errors.supplierId}
                  helperText={errors.supplierId?.message}
                >
                  <MenuItem value="">Selecione...</MenuItem>
                  {(suppliers || []).map((s: any) => (
                    <MenuItem key={s.id} value={s.id}>{s.code ? `${s.code} — ` : ''}{s.name}</MenuItem>
                  ))}
                </TextField>
              </Grid>
              <Grid item xs={12} sm={3}>
                <TextField fullWidth label="Data *" type="date"
                  {...register('purchaseDate')}
                  error={!!errors.purchaseDate}
                  helperText={errors.purchaseDate?.message}
                  InputLabelProps={{ shrink: true }}
                />
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField
                  select fullWidth label="Forma de pagamento"
                  {...register('paymentMethod')}
                  defaultValue=""
                >
                  <MenuItem value="">—</MenuItem>
                  {PAYMENT_OPTIONS.map((o) => <MenuItem key={o} value={o}>{o}</MenuItem>)}
                </TextField>
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField fullWidth label="NF de compra" {...register('nfNumber')} placeholder="Número" />
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField fullWidth label="NF de transporte" {...register('nfTransport')} placeholder="Número (opcional)" />
              </Grid>
            </Grid>
          </CardContent>
        </Card>

        {/* Itens da compra */}
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 2 }}>Itens comprados</Typography>

            <Autocomplete
              options={(partResults?.data || [])}
              getOptionLabel={(o: any) => `${o.code} — ${o.name}${o.quantity !== undefined ? ` (estoque: ${o.quantity})` : ''}`}
              isOptionEqualToValue={(o: any, v: any) => o.id === v?.id}
              inputValue={partInput}
              onInputChange={(_, v, reason) => {
                // Aceita apenas digitação do usuário. O MUI emite 'reset' em
                // ocasiões programáticas (ex.: foco de janela perdido) e isso
                // apagava o texto digitado e desabilitava a busca.
                if (reason === 'input') setPartInput(v);
              }}
              onChange={(_, value) => addItem(value as any)}
              renderInput={(params) => (
                <TextField {...params} label="Buscar produto por SKU ou nome..." variant="outlined" size="small" />
              )}
              sx={{ mb: 2 }}
            />

            {items.length > 0 ? (
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>SKU</TableCell>
                      <TableCell>Descrição</TableCell>
                      <TableCell align="right" style={{ width: 90 }}>Qtd</TableCell>
                      <TableCell align="right" style={{ width: 140 }}>Valor unit.</TableCell>
                      <TableCell align="right" style={{ width: 130 }}>Total</TableCell>
                      <TableCell align="right" style={{ width: 170 }} title="Custo unitário já com frete, imposto e desconto rateados">
                        Custo unit. c/ rateio
                      </TableCell>
                      <TableCell style={{ width: 50 }} />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {items.map((it) => (
                      <TableRow key={it.partId}>
                        <TableCell><Chip size="small" label={it.code} variant="outlined" /></TableCell>
                        <TableCell>{it.name}</TableCell>
                        <TableCell align="right">
                          <TextField
                            type="number" size="small" value={it.qty}
                            onChange={(e) => updateItem(it.partId, { qty: Math.max(1, Math.trunc(Number(e.target.value) || 1)) })}
                            inputProps={{ style: { textAlign: 'right' }, min: 1 }}
                          />
                        </TableCell>
                        <TableCell align="right">
                          <TextField
                            type="number" size="small" value={it.unitPrice}
                            onChange={(e) => updateItem(it.partId, { unitPrice: Math.max(0, Number(e.target.value) || 0) })}
                            inputProps={{ style: { textAlign: 'right' }, step: 0.01, min: 0 }}
                          />
                        </TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600 }}>{formatCurrency(it.qty * it.unitPrice)}</TableCell>
                        <TableCell align="right" sx={{ color: 'text.secondary' }}>{formatCurrency(itemUnitCost(it))}</TableCell>
                        <TableCell align="center">
                          <IconButton size="small" color="error" onClick={() => removeItem(it.partId)}>
                            <Delete fontSize="small" />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            ) : (
              <Alert severity="info">Busque o produto acima para adicionar o primeiro item.</Alert>
            )}
          </CardContent>
        </Card>

        {/* Valores e totais */}
        <Grid container spacing={3}>
          <Grid item xs={12} md={7}>
            <Card sx={{ height: '100%' }}>
              <CardContent>
                <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 2 }}>Frete, imposto e desconto</Typography>
                <Grid container spacing={2}>
                  <Grid item xs={12} sm={4}>
                    <TextField fullWidth label="Frete (R$)" type="number"
                      {...register('freight', { valueAsNumber: true })}
                      error={!!errors.freight} helperText={errors.freight?.message}
                      inputProps={{ step: 0.01, min: 0 }}
                    />
                  </Grid>
                  <Grid item xs={12} sm={4}>
                    <TextField fullWidth label="Imposto (R$)" type="number"
                      {...register('tax', { valueAsNumber: true })}
                      error={!!errors.tax} helperText={errors.tax?.message}
                      inputProps={{ step: 0.01, min: 0 }}
                    />
                  </Grid>
                  <Grid item xs={12} sm={4}>
                    <TextField select fullWidth label="Tipo do desconto" {...register('discountType')}>
                      <MenuItem value="VALUE">Valor (R$)</MenuItem>
                      <MenuItem value="PERCENT">Percentual (%)</MenuItem>
                    </TextField>
                  </Grid>
                  <Grid item xs={12} sm={4}>
                    <TextField fullWidth label="Desconto" type="number"
                      {...register('discount', { valueAsNumber: true })}
                      error={!!errors.discount} helperText={errors.discount?.message}
                      inputProps={{ step: 0.01, min: 0 }}
                    />
                  </Grid>
                  <Grid item xs={12}>
                    <TextField fullWidth label="Observações" multiline rows={2} {...register('notes')} />
                  </Grid>
                </Grid>
                <Alert severity="info" sx={{ mt: 2 }}>
                  Frete, imposto e desconto são distribuídos automaticamente entre os itens e somados ao custo de cada produto (PDF — melhorias da entrada de mercadoria).
                </Alert>
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={12} md={5}>
            <Card sx={{ height: '100%', bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.03)' : '#fafafa' }}>
              <CardContent>
                <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 2 }}>Resumo</Typography>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                  <Typography color="text.secondary">Itens ({items.length})</Typography>
                  <Typography>{formatCurrency(itemsTotal)}</Typography>
                </Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                  <Typography color="text.secondary">Frete</Typography>
                  <Typography>{formatCurrency(freight)}</Typography>
                </Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                  <Typography color="text.secondary">Imposto</Typography>
                  <Typography>{formatCurrency(tax)}</Typography>
                </Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                  <Typography color="text.secondary">Desconto{discount > 0 ? (discountType === 'PERCENT' ? ` (${discount}%)` : '') : ''}</Typography>
                  <Typography color="success.main">- {formatCurrency(discountValue)}</Typography>
                </Box>
                <Divider sx={{ my: 1.5 }} />
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Typography variant="subtitle1" fontWeight={700}>Total</Typography>
                  <Typography variant="h5" fontWeight={700} color="primary.main">{formatCurrency(total)}</Typography>
                </Box>

                <Box sx={{ display: 'flex', gap: 2, mt: 3, justifyContent: 'flex-end' }}>
                  <SecondaryButton type="button" onClick={() => navigate('/purchases')}>Cancelar</SecondaryButton>
                  <PrimaryButton type="submit" loading={isSubmitting} startIcon={<Add />}>Registrar entrada</PrimaryButton>
                </Box>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      </form>
    </Box>
  );
}
