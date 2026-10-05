import { Box, Card, CardContent, TextField, Button, Typography, Grid, Alert, CircularProgress, Autocomplete, Divider, MenuItem, Switch, FormControlLabel } from '@mui/material';
import { Visibility, Add } from '@mui/icons-material';
import { useParams, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { inventoryApi } from '../../services/api';
import { PrimaryButton, SecondaryButton } from '../../components/ui/Buttons';
import { formatCurrency } from '../../utils/formatters';

const partSchema = z.object({
  code: z.string().min(3, 'Mínimo 3 caracteres'),
  name: z.string().min(2, 'Mínimo 2 caracteres'),
  // Briefing D11: código de barra (SKU) da peça — enviado no payload de criação/edição
  barcode: z.string().nullish(),
  // nullish(): o reset() injeta null vindo do banco nos opcionais — sem isso o
  // salvamento falhava em silêncio para peças com campos vazios
  description: z.string().nullish(),
  category: z.string().nullish(),
  unit: z.string().nullish(),
  costPrice: z.number().min(0).optional(),
  salePrice: z.number().min(0, 'Preço de venda obrigatório'),
  minStock: z.number().min(0).optional(),
  quantity: z.number().min(0).optional(),
  supplier: z.string().nullish(),
  location: z.string().nullish(),
  // PDF p.3: Tipo (Novo/Usado/Digital), NCM e % de comissão específica
  productType: z.string().nullish(),
  ncm: z.string().nullish(),
  commissionPercent: z.preprocess(
    (v) => (v === '' || v === null || v === undefined || Number.isNaN(v) ? undefined : v),
    z.number().min(0).max(100).optional()
  ),
  // Briefing A: fabricante/características (busca) e limite de desconto por item
  manufacturer: z.string().nullish(),
  characteristics: z.string().nullish(),
  maxDiscountPercent: z.preprocess(
    (v) => (v === '' || v === null || v === undefined || Number.isNaN(v) ? undefined : v),
    z.number().min(0).max(100).optional()
  ),
  maxDiscountValue: z.preprocess(
    (v) => (v === '' || v === null || v === undefined || Number.isNaN(v) ? undefined : v),
    z.number().min(0).optional()
  ),
  // Briefing A3: item pode ficar fora do alerta de reposição
  alertEnabled: z.boolean().optional(),
});

type PartForm = z.infer<typeof partSchema>;

export function PartFormPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isNew = !id || id === 'new';
  const [error, setError] = useState('');

  const { register, handleSubmit, formState: { errors, isSubmitting }, reset, watch, setValue } = useForm<PartForm>({
    resolver: zodResolver(partSchema),
    defaultValues: { code: '', name: '', barcode: '', description: '', category: '', unit: 'UN', costPrice: 0, salePrice: 0, minStock: 1, quantity: 0, supplier: '', location: '', productType: '', ncm: '', commissionPercent: undefined, manufacturer: '', characteristics: '', maxDiscountPercent: undefined, maxDiscountValue: undefined, alertEnabled: true },
  });

  // Evita falha "silenciosa": mostra aviso quando o zod derruba o submit
  useEffect(() => {
    if (Object.keys(errors).length > 0) setError('Verifique os campos destacados do formulário.');
  }, [errors]);

  // Lucro bruto ao vivo (R$ e %) - PDF p.3
  const costPrice = Number(watch('costPrice')) || 0;
  const salePrice = Number(watch('salePrice')) || 0;
  const grossProfit = salePrice - costPrice;
  const grossProfitPct = costPrice > 0 ? ((salePrice - costPrice) / costPrice) * 100 : null;

  const { data: part, isLoading } = useQuery({
    queryKey: ['part', id],
    queryFn: () => inventoryApi.get(id!),
    enabled: !isNew,
  });

  const { data: categories } = useQuery({ queryKey: ['categories'], queryFn: () => inventoryApi.getCategories() });

  const saveMutation = useMutation({
    mutationFn: (data: PartForm) => isNew ? inventoryApi.create(data) : inventoryApi.update(id!, data),
    onSuccess: () => {
      // Lista + os painéis derivados que senão ficariam defasados 30s+
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['inventoryStats'] });
      queryClient.invalidateQueries({ queryKey: ['lowStock'] });
      // Seletor de itens dos formulários de orçamento/OS: uma peça nova só
      // aparecia lá depois de recarregar a página.
      queryClient.invalidateQueries({ queryKey: ['partsActive'] });
      navigate('/inventory');
    },
    onError: (err: any) => setError(err.response?.data?.message || 'Erro ao salvar'),
  });

  const toggleMutation = useMutation({
    mutationFn: () => inventoryApi.toggleStatus(id!),
    onSuccess: () => {
      // A chave antiga `['inventory', id]` não casava com nada: o detalhe é
      // ['part', id] e a lista é ['inventory', page, ...].
      queryClient.invalidateQueries({ queryKey: ['part', id] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['inventoryStats'] });
      queryClient.invalidateQueries({ queryKey: ['lowStock'] });
    },
  });

  useEffect(() => {
    if (part && !isNew) {
      reset({
        ...part,
        barcode: part.barcode || '',
        productType: part.productType || '',
        ncm: part.ncm || '',
        commissionPercent: part.commissionPercent ?? undefined,
        manufacturer: part.manufacturer || '',
        characteristics: part.characteristics || '',
        maxDiscountPercent: part.maxDiscountPercent ?? undefined,
        maxDiscountValue: part.maxDiscountValue ?? undefined,
        alertEnabled: part.alertEnabled ?? true,
      });
    }
  }, [part, isNew]);

  const onSubmit = (data: PartForm) => {
    setError('');
    saveMutation.mutate(data);
  };

  if (isLoading && !isNew) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>;

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3, flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography variant="h4" fontWeight={700} sx={{ mb: 0.5 }}>{isNew ? 'Nova Peça' : 'Editar Peça'}</Typography>
          <Typography variant="body1" color="text.secondary">{isNew ? 'Cadastre uma nova peça no estoque' : part?.code}</Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          {!isNew && <SecondaryButton onClick={() => navigate('/inventory')}>Voltar</SecondaryButton>}
        </Box>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError('')}>{error}</Alert>}

      <Card>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)}>
            <Grid container spacing={3}>
              <Grid item xs={12} sm={6}>
                <TextField fullWidth label="Código/SKU *" {...register('code')} error={!!errors.code} helperText={errors.code?.message} />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField fullWidth label="Nome *" {...register('name')} error={!!errors.name} helperText={errors.name?.message} />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField fullWidth label="Código de barra (SKU)" {...register('barcode')} placeholder="Ex.: 7891234567890" helperText="Código de barras/EAN da peça (usado na busca)" />
              </Grid>
              <Grid item xs={12} sm={6}>
                <Autocomplete
                  fullWidth
                  options={categories || []}
                  freeSolo
                  renderInput={(params) => <TextField {...params} label="Categoria" {...register('category')} />}
                  value={watch('category')}
                  onChange={(_, v) => setValue('category', v || '')}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField fullWidth label="Unidade" {...register('unit')} />
              </Grid>
              <Grid item xs={12} sm={3}>
                <TextField select fullWidth label="Tipo" {...register('productType')}>
                  <MenuItem value="">—</MenuItem>
                  <MenuItem value="NEW">Novo</MenuItem>
                  <MenuItem value="USED">Usado</MenuItem>
                  <MenuItem value="DIGITAL">Digital</MenuItem>
                </TextField>
              </Grid>
              <Grid item xs={12} sm={3}>
                <TextField fullWidth label="NCM" {...register('ncm')} placeholder="0000.00.00" />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField fullWidth label="Fabricante / Marca" {...register('manufacturer')} helperText="Encontrado na busca por característica" />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField fullWidth label="Preço de Custo (R$)" type="number" inputProps={{ step: 0.01 }} {...register('costPrice', { valueAsNumber: true })} />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField fullWidth label="Preço de Venda (R$) *" type="number" inputProps={{ step: 0.01 }} {...register('salePrice', { valueAsNumber: true })} error={!!errors.salePrice} helperText={errors.salePrice?.message} />
              </Grid>
              <Grid item xs={12} sm={6}>
                <Alert severity={grossProfit >= 0 ? 'success' : 'warning'} variant="outlined" sx={{ py: 0.4 }}>
                  <strong>Lucro bruto:</strong> {formatCurrency(grossProfit)}
                  {grossProfitPct !== null && ` (${grossProfitPct.toFixed(1)}%)`}
                  {costPrice <= 0 && ' — informe o custo para ver o %'}
                </Alert>
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField fullWidth label="% Comissão específica" type="number" inputProps={{ step: 0.1, min: 0, max: 100 }} {...register('commissionPercent', { valueAsNumber: true })} helperText="Percentual de comissão deste produto" />
              </Grid>
              <Grid item xs={12} sm={3}>
                <TextField fullWidth label="Desconto máx. (%)" type="number" inputProps={{ step: 0.1, min: 0, max: 100 }} {...register('maxDiscountPercent', { valueAsNumber: true })} helperText="Teto de desconto deste item" />
              </Grid>
              <Grid item xs={12} sm={3}>
                <TextField fullWidth label="Desconto máx. (R$)" type="number" inputProps={{ step: 0.01, min: 0 }} {...register('maxDiscountValue', { valueAsNumber: true })} helperText="Ou valor máximo em R$" />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField fullWidth label="Estoque Mínimo" type="number" {...register('minStock', { valueAsNumber: true })} disabled={!watch('alertEnabled')} helperText={!watch('alertEnabled') ? 'Alerta desativado para este item' : undefined} />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField fullWidth label="Qtd. Inicial" type="number" {...register('quantity', { valueAsNumber: true })} />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField fullWidth label="Fornecedor" {...register('supplier')} />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField fullWidth label="Localização (prateleira)" {...register('location')} />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="Características"
                  {...register('characteristics')}
                  helperText='Ex.: placa de vídeo, placa mãe, processador — usado na busca'
                />
              </Grid>
              <Grid item xs={12} sm={6} sx={{ display: 'flex', alignItems: 'center' }}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={watch('alertEnabled') ?? true}
                      onChange={(_, v) => setValue('alertEnabled', v)}
                    />
                  }
                  label="Alertar quando o estoque chegar ao mínimo"
                />
              </Grid>
              <Grid item xs={12}>
                <TextField fullWidth label="Descrição" multiline rows={3} {...register('description')} />
              </Grid>
              <Grid item xs={12} sx={{ display: 'flex', gap: 2, justifyContent: 'flex-end', pt: 1 }}>
                {!isNew && <SecondaryButton type="button" onClick={() => navigate('/inventory')}>Cancelar</SecondaryButton>}
                <PrimaryButton type="submit" loading={isSubmitting}>{isNew ? 'Cadastrar' : 'Salvar'}</PrimaryButton>
              </Grid>
            </Grid>
          </form>
        </CardContent>
      </Card>

      {!isNew && part && (
        <Card sx={{ mt: 3 }}>
          <CardContent>
            <Typography variant="h6" sx={{ mb: 2 }}>Ações Rápidas</Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
              <SecondaryButton startIcon={<Visibility />} onClick={() => toggleMutation.mutate()}>
                {part.status === 'ACTIVE' ? 'Desativar' : 'Ativar'}
              </SecondaryButton>
              <SecondaryButton startIcon={<Add />} onClick={() => navigate(`/inventory/${id}/adjust`)}>
                Ajustar Estoque
              </SecondaryButton>
            </Box>
            <Divider sx={{ mb: 2 }} />
            <Typography variant="h6" sx={{ mb: 2 }}>Informações</Typography>
            <Grid container spacing={2}>
              <Grid item xs={12} sm={4}>
                <Typography variant="body2" color="text.secondary">Status</Typography>
                <Typography variant="body1" fontWeight={500}>{part.status === 'ACTIVE' ? 'Ativa' : 'Inativa'}</Typography>
              </Grid>
              <Grid item xs={12} sm={4}>
                <Typography variant="body2" color="text.secondary">Estoque Atual</Typography>
                <Typography variant="body1" fontWeight={500} color={part.needsRestock ? 'warning.main' : undefined}>
                  {part.quantity} {part.unit}
                </Typography>
              </Grid>
              <Grid item xs={12} sm={4}>
                <Typography variant="body2" color="text.secondary">Estoque Mínimo</Typography>
                <Typography variant="body1">{part.minStock} {part.unit}</Typography>
              </Grid>
              <Grid item xs={12} sm={4}>
                <Typography variant="body2" color="text.secondary">Margem</Typography>
                <Typography variant="body1" fontWeight={500}>
                  {part.costPrice > 0 ? (((part.salePrice - part.costPrice) / part.costPrice) * 100).toFixed(1) + '%' : '-'}
                </Typography>
              </Grid>
              <Grid item xs={12} sm={4}>
                <Typography variant="body2" color="text.secondary">Valor Estoque</Typography>
                <Typography variant="body1">{formatCurrency(part.salePrice * part.quantity)}</Typography>
              </Grid>
              <Grid item xs={12} sm={4}>
                <Typography variant="body2" color="text.secondary">Última Movimentação</Typography>
                <Typography variant="body1">{part.movements?.[0] ? new Date(part.movements[0].createdAt).toLocaleString('pt-BR') : 'Nenhuma'}</Typography>
              </Grid>
            </Grid>
          </CardContent>
        </Card>
      )}
    </Box>
  );
}

import { useState, useEffect } from 'react';