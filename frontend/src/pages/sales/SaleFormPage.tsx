import { Box, Card, CardContent, TextField, Typography, Grid, Alert, MenuItem, Autocomplete, IconButton, TableContainer, Table, TableHead, TableBody, TableRow, TableCell, Chip, Divider, RadioGroup, FormControlLabel, Radio, Stack, useTheme } from '@mui/material';
import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery, useMutation } from '@tanstack/react-query';
import { salesApi, clientsApi, inventoryApi } from '../../services/api';
import { PrimaryButton, SecondaryButton } from '../../components/ui/Buttons';
import FormErrors from '../../components/ui/FormErrors';
import { formatCurrency } from '../../utils/formatters';
import { Delete, Add } from '@mui/icons-material';

// ---------------------------------------------------------------------------
// Schema / tipos
// ---------------------------------------------------------------------------
const saleSchema = z.object({
  clientId: z.string().min(1, 'Selecione o cliente'),
  discountType: z.enum(['VALUE', 'PERCENT']),
  discount: z.number().min(0, 'Não pode ser negativo'),
  // PDF p.6: frete da venda (entra no total geral)
  freight: z.number().min(0, 'Não pode ser negativo').optional(),
  paymentMethod: z.string().optional(),
  notes: z.string().optional(),
});

type SaleFormValues = z.infer<typeof saleSchema>;

interface DraftItem {
  key: string;
  partId: string;
  code: string;
  name: string;
  qty: number;
  unitPrice: number;
  discount: number;
  discountType: 'VALUE' | 'PERCENT';
  commissionType: 'PERCENT' | 'VALUE';
  commissionPercent: number;
  commissionValue: number;
}

interface AddressForm {
  label: string;
  street: string;
  number: string;
  complement: string;
  district: string;
  zip: string;
  city: string;
  state: string;
}

const PAYMENT_OPTIONS = [
  { value: 'DINHEIRO', label: 'Dinheiro' },
  { value: 'PIX', label: 'PIX' },
  { value: 'CARTAO_CREDITO', label: 'Cartão de Crédito' },
  { value: 'CARTAO_DEBITO', label: 'Cartão de Débito' },
  { value: 'BOLETO', label: 'Boleto' },
  { value: 'TRANSFERENCIA', label: 'Transferência' },
  { value: 'OUTRO', label: 'Outro' },
];

const emptyAddress = (): AddressForm => ({
  label: '', street: '', number: '', complement: '', district: '', zip: '', city: '', state: '',
});

const addrFrom = (a: any): AddressForm => ({
  label: a?.label || '',
  street: a?.street || '',
  number: a?.number || '',
  complement: a?.complement || '',
  district: a?.district || '',
  zip: a?.zip || '',
  city: a?.city || '',
  state: a?.state || '',
});

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Desembrulha o envelope { data } caso o payload venha duplicado. */
const unwrapAny = (r: any) => (r && r.data && !r.id ? r.data : r);

const itemNet = (it: DraftItem): number => {
  const line = it.qty * it.unitPrice;
  const disc = it.discountType === 'PERCENT' ? (line * it.discount) / 100 : it.discount;
  return round2(line - Math.min(disc, line));
};

const itemCommission = (it: DraftItem): number => {
  const net = itemNet(it);
  return round2(it.commissionType === 'PERCENT' ? (net * it.commissionPercent) / 100 : it.commissionValue);
};

let seq = 0;
const nextKey = () => `draft-${Date.now()}-${seq++}`;

// ---------------------------------------------------------------------------
export function SaleFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id;
  const navigate = useNavigate();
  const theme = useTheme();

  const [error, setError] = useState<any>(null);
  const [items, setItems] = useState<DraftItem[]>([]);
  const [partInput, setPartInput] = useState('');
  const [clientInput, setClientInput] = useState('');
  const [clientOption, setClientOption] = useState<any>(null);
  const [deliveryMode, setDeliveryMode] = useState<'PICKUP' | 'DELIVERY'>('PICKUP');
  const [addressSource, setAddressSource] = useState<string>('manual');
  const [address, setAddress] = useState<AddressForm>(emptyAddress());
  const loadedRef = useRef(false);

  const { register, handleSubmit, watch, setValue, formState: { errors, isSubmitting } } = useForm<SaleFormValues>({
    resolver: zodResolver(saleSchema),
    defaultValues: {
      clientId: '',
      discountType: 'VALUE',
      discount: 0,
      freight: 0,
      paymentMethod: '',
      notes: '',
    },
  });

  // Venda em edição
  const { data: saleRes } = useQuery({
    queryKey: ['sale', id],
    queryFn: () => salesApi.get(id!),
    enabled: isEdit,
  });
  const sale: any = saleRes ? unwrapAny(saleRes) : null;

  // Busca de clientes para o Autocomplete
  //
  // BUG: `enabled: clientInput.length >= 1` mantinha `clientResults` undefined
  // enquanto o campo estava vazio, e `clientOptions` = `clientResults?.data || []`
  // resultava em `options = []`. O popup abria, mas SEM NENHUMA opção — só
  // aparecia algo quando o usuário digitava algo que já existia na lista.
  // O backend trata `search` vazio listando os primeiros registros.
  const { data: clientResults } = useQuery({
    queryKey: ['clients-search', clientInput],
    queryFn: () => clientsApi.list({ search: clientInput.trim(), limit: 20 }),
  });

  const clientId = watch('clientId');

  // Cadastro completo do cliente (endereços de entrega)
  const { data: clientRes } = useQuery({
    queryKey: ['client-full', clientId],
    queryFn: () => clientsApi.get(clientId),
    enabled: !!clientId,
  });
  const clientFull: any = clientRes ? unwrapAny(clientRes) : null;
  const addresses: any[] = clientFull?.addresses || [];

  // Busca de produto por SKU/nome — mesma causa do caso acima: com `enabled`
  // travado em 1+ caractere, a lista de produtos só surgia após digitar.
  const { data: partResults } = useQuery({
    queryKey: ['sale-part-search', partInput],
    queryFn: () => inventoryApi.list({ search: partInput.trim(), take: 10, status: 'ACTIVE' }),
  });

  // Preenchimento inicial no modo edição (uma única vez)
  useEffect(() => {
    if (!sale || loadedRef.current) return;
    loadedRef.current = true;

    setValue('clientId', sale.clientId || '');
    setClientOption(sale.client || null);
    setValue('paymentMethod', sale.paymentMethod || '');
    setValue('notes', sale.notes || '');
    setValue('discountType', sale.discountType === 'PERCENT' ? 'PERCENT' : 'VALUE');
    setValue('freight', Number(sale.freight) || 0);

    const mapped: DraftItem[] = (sale.items || []).map((it: any, idx: number) => ({
      key: it.id || `${nextKey()}-${idx}`,
      partId: it.partId || '',
      code: it.code || it.part?.code || '',
      name: it.name || '',
      qty: Number(it.qty) || 1,
      unitPrice: Number(it.unitPrice) || 0,
      discount: Number(it.discount) || 0,
      discountType: it.discountType === 'PERCENT' ? 'PERCENT' : 'VALUE',
      commissionType: it.commissionType === 'VALUE' ? 'VALUE' : 'PERCENT',
      commissionPercent: Number(it.commissionPercent) || 0,
      commissionValue: Number(it.commissionValue) || 0,
    }));
    setItems(mapped);

    // O backend grava em `discount` o VALOR já calculado. Quando o tipo é
    // PERCENT, convertemos de volta para porcentagem para não reaplicar o
    // desconto em cima do valor na edição.
    const itemsNet = mapped.reduce((s, i) => s + itemNet(i), 0);
    const rawDiscount = Number(sale.discount) || 0;
    if (sale.discountType === 'PERCENT' && itemsNet > 0) {
      setValue('discount', round2((rawDiscount / itemsNet) * 100));
    } else {
      setValue('discount', rawDiscount);
    }

    if (sale.deliveryAddress) {
      setDeliveryMode('DELIVERY');
      setAddress(addrFrom(sale.deliveryAddress));
      setAddressSource('manual');
    }
  }, [sale, setValue]);

  // Ao entregar, sugere o endereço padrão do cliente quando existir
  useEffect(() => {
    if (deliveryMode !== 'DELIVERY') return;
    if (addresses.length === 0) return;
    if (addressSource !== 'manual') return;
    if (address.street) return;
    const def = addresses.find((a: any) => a.isDefault) || addresses[0];
    setAddressSource(def.id);
    setAddress(addrFrom(def));
  }, [deliveryMode, addresses, addressSource, address.street]);

  // Totais ao vivo (mesma fórmula do backend: frete somado após o desconto)
  const discount = Number(watch('discount')) || 0;
  const discountType = watch('discountType');
  const freight = Number(watch('freight')) || 0;
  const itemsTotal = round2(items.reduce((s, it) => s + itemNet(it), 0));
  const discountValue = round2(
    Math.min(discountType === 'PERCENT' ? (itemsTotal * discount) / 100 : discount, itemsTotal)
  );
  const total = round2(itemsTotal - discountValue + freight);
  const totalCommission = round2(items.reduce((s, it) => s + itemCommission(it), 0));

  const addItem = (part: any) => {
    if (!part) return;
    if (items.some((i) => i.partId === part.id)) {
      setError('Este produto já está na venda. Ajuste a quantidade na linha.');
      return;
    }
    setItems((prev) => [
      ...prev,
      {
        key: nextKey(),
        partId: part.id,
        code: part.code || '',
        name: part.name || '',
        qty: 1,
        unitPrice: Number(part.salePrice) || 0,
        discount: 0,
        discountType: 'VALUE',
        commissionType: 'PERCENT',
        commissionPercent: Number(part.commissionPercent) || 0,
        commissionValue: 0,
      },
    ]);
    setPartInput('');
    setError(null);
  };

  const updateItem = (key: string, patch: Partial<DraftItem>) => {
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  };

  const removeItem = (key: string) => setItems((prev) => prev.filter((i) => i.key !== key));

  const handleModeChange = (mode: 'PICKUP' | 'DELIVERY') => {
    setDeliveryMode(mode);
    if (mode === 'DELIVERY' && !address.street && addresses.length > 0) {
      const def = addresses.find((a: any) => a.isDefault) || addresses[0];
      setAddressSource(def.id);
      setAddress(addrFrom(def));
    }
  };

  const handleAddressSourceChange = (value: string) => {
    setAddressSource(value);
    if (value === 'manual') {
      setAddress(emptyAddress());
      return;
    }
    const found = addresses.find((a: any) => a.id === value);
    if (found) setAddress(addrFrom(found));
  };

  const saveMutation = useMutation({
    mutationFn: (payload: any) => (isEdit ? salesApi.update(id!, payload) : salesApi.create(payload)),
    onSuccess: (res: any) => {
      const created = unwrapAny(res);
      navigate(created?.id ? `/sales/${created.id}` : '/sales');
    },
    onError: (err: any) => setError(err),
  });

  const onSubmit = (values: SaleFormValues) => {
    setError(null);
    if (items.length === 0) {
      setError('Adicione pelo menos um produto à venda.');
      return;
    }
    if (items.some((i) => i.qty <= 0 || i.unitPrice < 0)) {
      setError('Verifique a quantidade e o valor dos itens.');
      return;
    }
    if (deliveryMode === 'DELIVERY' && !address.street.trim()) {
      setError('Informe o endereço de entrega (rua).');
      return;
    }

    const payload = {
      clientId: values.clientId,
      items: items.map((i) => ({
        partId: i.partId || undefined,
        name: i.name,
        code: i.code || undefined,
        qty: i.qty,
        unitPrice: i.unitPrice,
        discount: i.discount || 0,
        discountType: i.discountType,
        commissionType: i.commissionType,
        commissionPercent: i.commissionPercent || 0,
        commissionValue: i.commissionValue || 0,
      })),
      discount: Number(values.discount) || 0,
      discountType: values.discountType,
      freight: Number(values.freight) || 0,
      paymentMethod: values.paymentMethod || null,
      notes: values.notes || null,
      deliveryAddress:
        deliveryMode === 'DELIVERY'
          ? {
              label: address.label || undefined,
              street: address.street,
              number: address.number || undefined,
              complement: address.complement || undefined,
              district: address.district || undefined,
              zip: address.zip || undefined,
              city: address.city || undefined,
              state: address.state || undefined,
            }
          : null,
    };

    saveMutation.mutate(payload);
  };

  const clientOptions: any[] = clientResults?.data || [];
  const partOptions: any[] = partResults?.data || [];

  // Extract map results to variables (TS7 rule: nunca .map() JSX direto no return)
  const paymentMenuItems = PAYMENT_OPTIONS.map((o) => (
    <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
  ));

  const addressMenuItems = addresses.map((a: any) => (
    <MenuItem key={a.id} value={a.id}>
      {a.label ? `${a.label} — ` : ''}{a.street}, {a.number || 's/n'} — {a.city || ''}/{a.state || ''}
    </MenuItem>
  ));

  // Extract map results to variables (TS7 rule: nunca .map() JSX direto no return)
  const itemRows = items.map((it) => (
    <TableRow key={it.key}>
      <TableCell>
        <Chip size="small" label={it.code || '—'} variant="outlined" sx={{ mr: 1 }} />
        {it.name}
      </TableCell>
      <TableCell align="right">
        <TextField
          type="number" size="small" value={it.qty}
          onChange={(e) => updateItem(it.key, { qty: Math.max(1, Math.trunc(Number(e.target.value) || 1)) })}
          inputProps={{ style: { textAlign: 'right' }, min: 1 }}
          sx={{ width: 70 }}
        />
      </TableCell>
      <TableCell align="right">
        <TextField
          type="number" size="small" value={it.unitPrice}
          onChange={(e) => updateItem(it.key, { unitPrice: Math.max(0, Number(e.target.value) || 0) })}
          inputProps={{ style: { textAlign: 'right' }, step: 0.01, min: 0 }}
          sx={{ width: 100 }}
        />
      </TableCell>
      <TableCell>
        <Stack direction="row" spacing={0.5}>
          <TextField
            type="number" size="small" value={it.discount}
            onChange={(e) => updateItem(it.key, { discount: Math.max(0, Number(e.target.value) || 0) })}
            inputProps={{ style: { textAlign: 'right' }, step: 0.01, min: 0 }}
            sx={{ width: 75 }}
          />
          <TextField
            select size="small" value={it.discountType}
            onChange={(e) => updateItem(it.key, { discountType: e.target.value as 'VALUE' | 'PERCENT' })}
            sx={{ width: 85 }}
          >
            <MenuItem value="VALUE">R$</MenuItem>
            <MenuItem value="PERCENT">%</MenuItem>
          </TextField>
        </Stack>
      </TableCell>
      <TableCell align="right" sx={{ fontWeight: 600 }}>{formatCurrency(itemNet(it))}</TableCell>
      <TableCell align="center">
        <IconButton size="small" color="error" onClick={() => removeItem(it.key)}>
          <Delete fontSize="small" />
        </IconButton>
      </TableCell>
    </TableRow>
  ));

  const addressFields = (
    <Grid container spacing={2}>
      <Grid item xs={12} sm={6}>
        <TextField fullWidth size="small" label="Apelido do endereço" value={address.label}
          onChange={(e) => setAddress((a) => ({ ...a, label: e.target.value }))} placeholder="Casa, Trabalho..." />
      </Grid>
      <Grid item xs={12} sm={9}>
        <TextField fullWidth size="small" label="Rua *" value={address.street}
          onChange={(e) => setAddress((a) => ({ ...a, street: e.target.value }))} />
      </Grid>
      <Grid item xs={12} sm={3}>
        <TextField fullWidth size="small" label="Número" value={address.number}
          onChange={(e) => setAddress((a) => ({ ...a, number: e.target.value }))} />
      </Grid>
      <Grid item xs={12} sm={4}>
        <TextField fullWidth size="small" label="Complemento" value={address.complement}
          onChange={(e) => setAddress((a) => ({ ...a, complement: e.target.value }))} />
      </Grid>
      <Grid item xs={12} sm={4}>
        <TextField fullWidth size="small" label="Bairro" value={address.district}
          onChange={(e) => setAddress((a) => ({ ...a, district: e.target.value }))} />
      </Grid>
      <Grid item xs={12} sm={4}>
        <TextField fullWidth size="small" label="CEP" value={address.zip}
          onChange={(e) => setAddress((a) => ({ ...a, zip: e.target.value }))} />
      </Grid>
      <Grid item xs={12} sm={8}>
        <TextField fullWidth size="small" label="Cidade" value={address.city}
          onChange={(e) => setAddress((a) => ({ ...a, city: e.target.value }))} />
      </Grid>
      <Grid item xs={12} sm={4}>
        <TextField fullWidth size="small" label="UF" value={address.state}
          onChange={(e) => setAddress((a) => ({ ...a, state: e.target.value.toUpperCase().slice(0, 2) }))} />
      </Grid>
    </Grid>
  );

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3, flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography variant="h4" fontWeight={700} sx={{ mb: 0.5 }}>
            {isEdit ? `Editar Venda ${sale?.code || ''}` : 'Nova Venda'}
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Venda de mercadoria — dá baixa no estoque e registra a nota
          </Typography>
        </Box>
        <SecondaryButton onClick={() => navigate('/sales')}>Voltar</SecondaryButton>
      </Box>

      <FormErrors error={error} onClose={() => setError(null)} />

      <form onSubmit={handleSubmit(onSubmit)}>
        {/* Dados da venda */}
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Grid container spacing={3}>
              <Grid item xs={12} md={7}>
                <Autocomplete
                  options={clientOptions}
                  // Abre a lista já no clique/focus, sem exigir que o usuário
                  // digite primeiro para ver as opções.
                  openOnFocus
                  getOptionLabel={(o: any) => (typeof o === 'string' ? o : `${o.code ? o.code + ' — ' : ''}${o.name || ''}`)}
                  isOptionEqualToValue={(o: any, v: any) => o.id === v?.id}
                  value={clientOption}
                  inputValue={clientInput}
                  onInputChange={(_, v, reason) => {
                    // 'clear' (botão X) e 'reset' também precisam atualizar —
                    // antes só 'input' era tratado e o campo ficava preso no
                    // texto antigo, refletindo um filtro que não existia mais.
                    if (reason === 'input' || reason === 'clear') setClientInput(v);
                  }}
                  onChange={(_, value) => {
                    setClientOption(value);
                    setValue('clientId', (value as any)?.id || '', { shouldValidate: true });
                  }}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Cliente *"
                      placeholder="Buscar por nome, CPF/CNPJ, código..."
                      error={!!errors.clientId}
                      helperText={errors.clientId?.message}
                    />
                  )}
                />
              </Grid>
              <Grid item xs={12} sm={5}>
                <TextField select fullWidth label="Forma de pagamento" {...register('paymentMethod')} defaultValue="">
                  <MenuItem value="">—</MenuItem>
                  {paymentMenuItems}
                </TextField>
              </Grid>
            </Grid>
          </CardContent>
        </Card>

        {/* Itens */}
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 2 }}>Itens da venda</Typography>

            <Autocomplete
              options={partOptions}
              openOnFocus
              getOptionLabel={(o: any) =>
                typeof o === 'string'
                  ? o
                  : `${o.code || ''} — ${o.name || ''}${o.quantity !== undefined ? ` (estoque: ${o.quantity})` : ''}`
              }
              isOptionEqualToValue={(o: any, v: any) => o.id === v?.id}
              inputValue={partInput}
              onInputChange={(_, v, reason) => {
                if (reason === 'input' || reason === 'clear') setPartInput(v);
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
                      <TableCell>Produto</TableCell>
                      <TableCell align="right" style={{ width: 80 }}>Qtd</TableCell>
                      <TableCell align="right" style={{ width: 110 }}>Vl. unit.</TableCell>
                      <TableCell style={{ width: 175 }}>Desconto</TableCell>
                      <TableCell align="right" style={{ width: 110 }}>Total</TableCell>
                      <TableCell style={{ width: 50 }} />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {itemRows}
                  </TableBody>
                </Table>
              </TableContainer>
            ) : (
              <Alert severity="info">Busque o produto acima para adicionar o primeiro item.</Alert>
            )}
          </CardContent>
        </Card>

        {/* Valores, entrega e resumo */}
        <Grid container spacing={3}>
          <Grid item xs={12} md={7}>
            <Card sx={{ height: '100%' }}>
              <CardContent>
                <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 2 }}>Desconto, entrega e observações</Typography>
                <Grid container spacing={2}>
                  <Grid item xs={12} sm={4}>
                    <TextField select fullWidth label="Tipo do desconto" {...register('discountType')}>
                      <MenuItem value="VALUE">Valor (R$)</MenuItem>
                      <MenuItem value="PERCENT">Percentual (%)</MenuItem>
                    </TextField>
                  </Grid>
                  <Grid item xs={12} sm={4}>
                    <TextField fullWidth label="Desconto" type="number"
                      {...register('discount', { valueAsNumber: true })}
                      error={!!errors.discount}
                      helperText={errors.discount?.message}
                      inputProps={{ step: 0.01, min: 0 }}
                    />
                  </Grid>
                  <Grid item xs={12} sm={4}>
                    <TextField fullWidth label="Frete (R$)" type="number"
                      {...register('freight', { valueAsNumber: true })}
                      error={!!errors.freight}
                      helperText={errors.freight?.message || 'Soma ao total'}
                      inputProps={{ step: 0.01, min: 0 }}
                    />
                  </Grid>
                </Grid>

                <Divider sx={{ my: 2 }} />

                <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>Entrega</Typography>
                <RadioGroup
                  row
                  value={deliveryMode}
                  onChange={(e) => handleModeChange(e.target.value as 'PICKUP' | 'DELIVERY')}
                  sx={{ mb: 2 }}
                >
                  <FormControlLabel value="PICKUP" control={<Radio />} label="Retirar na loja" />
                  <FormControlLabel value="DELIVERY" control={<Radio />} label="Entregar" />
                </RadioGroup>

                {deliveryMode === 'DELIVERY' && (
                  <Box>
                    {addresses.length > 0 && (
                      <TextField
                        select
                        fullWidth
                        size="small"
                        label="Endereço do cliente"
                        value={addressSource}
                        onChange={(e) => handleAddressSourceChange(e.target.value)}
                        sx={{ mb: 2 }}
                      >
                        {addressMenuItems}
                        <MenuItem value="manual">Digitar manualmente</MenuItem>
                      </TextField>
                    )}
                    {addressFields}
                  </Box>
                )}

                <Divider sx={{ my: 2 }} />

                <TextField fullWidth label="Observações" multiline rows={2} {...register('notes')} />
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
                  <Typography color="text.secondary">
                    Desconto{discount > 0 && discountType === 'PERCENT' ? ` (${discount}%)` : ''}
                  </Typography>
                  <Typography color="success.main">- {formatCurrency(discountValue)}</Typography>
                </Box>
                {freight > 0 && (
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                    <Typography color="text.secondary">Frete</Typography>
                    <Typography>+ {formatCurrency(freight)}</Typography>
                  </Box>
                )}
                <Divider sx={{ my: 1.5 }} />
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                  <Typography variant="subtitle1" fontWeight={700}>Total</Typography>
                  <Typography variant="h5" fontWeight={700} color="primary.main">{formatCurrency(total)}</Typography>
                </Box>

                <Box sx={{ display: 'flex', gap: 2, mt: 2, justifyContent: 'flex-end' }}>
                  <SecondaryButton type="button" onClick={() => navigate('/sales')}>Cancelar</SecondaryButton>
                  <PrimaryButton type="submit" loading={isSubmitting || saveMutation.isPending} startIcon={<Add />}>
                    {isEdit ? 'Salvar alterações' : 'Registrar venda'}
                  </PrimaryButton>
                </Box>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      </form>
    </Box>
  );
}

export default SaleFormPage;
