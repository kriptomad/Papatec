import { Box, Card, CardContent, TextField, Button, Typography, Grid, Alert, CircularProgress, Tabs, Tab, TableContainer, Table, TableHead, TableBody, TableRow, TableCell, Chip, IconButton, Divider, Autocomplete, List, ListItemButton, ListItemText, ListItemSecondaryAction, Tooltip, FormControl, Select, MenuItem, ToggleButtonGroup, ToggleButton } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import ScienceIcon from '@mui/icons-material/Science';
import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { budgetsApi, clientsApi, inventoryApi, servicesApi } from '../../services/api';
import FormErrors from '../../components/ui/FormErrors';
import { PrimaryButton, SecondaryButton, DangerButton } from '../../components/ui/Buttons';
import { BudgetStatusChip } from '../../components/ui/StatusChips';
import { formatCurrency, formatDate } from '../../utils/formatters';
import { formatPhone } from '../../utils/formatters';

const itemSchema = z.object({
  partId: z.string().optional(),
  serviceId: z.string().optional(),
  name: z.string().min(1, 'Nome obrigatório'),
  qty: z.number().min(1, 'Mínimo 1'),
  unitPrice: z.number().min(0, 'Preço inválido'),
  // Briefing B3: desconto por item (% ou R$) — validado no backend
  discount: z.number().min(0),
  discountType: z.enum(['VALUE', 'PERCENT']),
  type: z.enum(['PART', 'SERVICE']),
  // Briefing C: comissão personalizada por item (% ou R$)
  commissionPercent: z.number().min(0),
  commissionValue: z.number().min(0),
  commissionType: z.enum(['PERCENT', 'VALUE']),
});

const budgetSchema = z.object({
  clientId: z.string().min(1, 'Cliente obrigatório'),
  equipment: z.array(z.object({
    name: z.string().min(1, 'Nome do equipamento obrigatório'),
    brand: z.string().optional(),
    model: z.string().optional(),
    serial: z.string().optional(),
    photos: z.array(z.string()).optional(),
    notes: z.string().optional(),
  })).min(1, 'Pelo menos um equipamento'),
  defect: z.string().min(5, 'Descreva o defeito'),
  laborHours: z.number().min(0),
  laborRate: z.number().min(0),
  items: z.array(itemSchema).min(1, 'Pelo menos um item'),
  notes: z.string().optional(),
  validUntil: z.string().optional(),
  // Briefing B2.2: serviço local × externo + endereço do serviço
  serviceType: z.enum(['LOCAL', 'EXTERNAL']),
  serviceAddress: z.any().optional().nullable(),
});

type BudgetForm = z.infer<typeof budgetSchema>;
type ItemForm = z.infer<typeof itemSchema>;

export function BudgetFormPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const copyFromId = searchParams.get('copy');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isNew = !id || id === 'new';
  const isCopy = !!copyFromId;
  // Guarda o erro cru do axios (err.response.data.error.fields) p/ o FormErrors
  const [error, setError] = useState<any>(null);
  const [activeTab, setActiveTab] = useState(0);
  const [photos, setPhotos] = useState<File[]>([]);

  const { register, control, handleSubmit, watch, setValue, formState: { errors, isSubmitting }, reset } = useForm<BudgetForm>({
    resolver: zodResolver(budgetSchema),
    defaultValues: {
      clientId: '', equipment: [{ name: '', brand: '', model: '', serial: '', photos: [], notes: '' }],
      defect: '', laborHours: 0, laborRate: 80, items: [], notes: '', validUntil: '',
      serviceType: 'LOCAL', serviceAddress: null,
    },
  });

  const { fields: equipmentFields, append: appendEquipment, remove: removeEquipment } = useFieldArray({ control, name: 'equipment' });
  const { fields: itemFields, append: appendItem, remove: removeItem } = useFieldArray({ control, name: 'items' });

  const laborHours = watch('laborHours');
  const laborRate = watch('laborRate');
  const items = watch('items');
  const clientId = watch('clientId');
  const serviceType = watch('serviceType');
  const serviceAddress = watch('serviceAddress');

  /** Briefing B3: valor líquido do item (bruto − desconto %/R$). */
  const itemNetVal = (i: { qty?: number; unitPrice?: number; discount?: number; discountType?: string }) => {
    const base = (i.qty || 0) * (i.unitPrice || 0);
    const d = i.discountType === 'PERCENT' ? (base * (i.discount || 0)) / 100 : i.discount || 0;
    return base - Math.min(Math.max(0, d), base);
  };

  /** Briefing C: comissão do item — líquido × % ou valor fixo em R$. */
  const itemCommission = (i: { qty?: number; unitPrice?: number; discount?: number; discountType?: string; commissionType?: string; commissionPercent?: number; commissionValue?: number }) => {
    if (i.commissionType === 'VALUE') return i.commissionValue || 0;
    return (itemNetVal(i) * (i.commissionPercent || 0)) / 100;
  };

  const totals = useMemo(() => {
    const totalParts = items.filter(i => i.type === 'PART').reduce((sum, i) => sum + itemNetVal(i), 0);
    const totalServices = items.filter(i => i.type === 'SERVICE').reduce((sum, i) => sum + itemNetVal(i), 0);
    const totalLabor = laborHours * laborRate;
    const gross = items.reduce((sum, i) => sum + (i.qty || 0) * (i.unitPrice || 0), 0);
    const descontos = gross + totalLabor - (totalParts + totalServices + totalLabor);
    return { totalParts, totalServices, totalLabor, descontos, total: totalParts + totalServices + totalLabor };
  }, [items, laborHours, laborRate]);

  // Briefing B2/D3: dados do cliente (endereços + equipamentos) p/ seleção rápida
  const clientDetailQuery = useQuery({
    queryKey: ['client', clientId],
    queryFn: () => clientsApi.get(clientId),
    enabled: !!clientId,
  });
  const clientAddresses: any[] = clientDetailQuery.data?.addresses || [];
  const clientEquipments: any[] = clientDetailQuery.data?.equipments || [];

  // Briefing B2.2: ao ligar "externo", pré-seleciona o endereço padrão do cliente
  useEffect(() => {
    if (serviceType === 'EXTERNAL' && !serviceAddress && clientAddresses.length) {
      const padrao = clientAddresses.find((a) => a.isDefault) || clientAddresses[0];
      setValue('serviceAddress', padrao, { shouldDirty: true });
    }
  }, [serviceType, serviceAddress, clientAddresses]);

  const clientsQuery = useQuery({ queryKey: ['clientsAll'], queryFn: () => clientsApi.list({ limit: 1000 }) });
  const clientData: any[] = clientsQuery.data?.data || [];

  const partsQuery = useQuery({ queryKey: ['partsActive'], queryFn: () => inventoryApi.list({ status: 'ACTIVE', limit: 1000 }) });
  const partsData: any[] = partsQuery.data?.data || [];

  const servicesQuery = useQuery({ queryKey: ['servicesCatalog'], queryFn: () => servicesApi.byCategory() });
  const servicesCatalog: Record<string, any[]> = servicesQuery.data || {};

  const saveMutation = useMutation({
    mutationFn: async (data: BudgetForm) => {
      const formData = new FormData();
      formData.append('data', JSON.stringify(data));
      photos.forEach((photo, i) => formData.append('photos', photo));
      return isNew || isCopy ? budgetsApi.create(formData) : budgetsApi.update(id!, formData);
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['budgets'] }); queryClient.invalidateQueries({ queryKey: ['budget', id] }); navigate('/budgets'); },
    onError: (err: any) => setError(err),
  });

  const statusMutation = useMutation({
    mutationFn: (status: string) => budgetsApi.updateStatus(id!, status),
    // ['budgets'] cobre só a lista (prefixo); o detalhe aberto em outra aba
    // usava ['budget', id] e ficava com o status antigo.
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['budgets'] }); queryClient.invalidateQueries({ queryKey: ['budget', id] }); },
  });

  const convertMutation = useMutation({
    mutationFn: (data: { technicianId?: string; warrantyDays?: number }) => budgetsApi.convertToOs(id!, data),
    onSuccess: (os) => { queryClient.invalidateQueries({ queryKey: ['budgets'] }); navigate(`/service-orders/${os.id}`); },
  });

  // Carrega dados se edição
  useEffect(() => {
    if (!isNew && !isCopy) {
      budgetsApi.get(id!).then(b => {
        reset({
          clientId: b.clientId,
          equipment: b.equipment,
          defect: b.defect,
          laborHours: b.laborHours,
          laborRate: b.laborRate,
          items: b.items.map(i => ({
            partId: i.partId, serviceId: i.serviceId, name: i.name, qty: i.qty, unitPrice: i.unitPrice,
            discount: i.discount ?? 0, discountType: i.discountType ?? 'VALUE', type: i.type,
            commissionPercent: i.commissionPercent ?? 0, commissionValue: i.commissionValue ?? 0,
            commissionType: i.commissionType ?? 'PERCENT',
          })),
          notes: b.notes,
          validUntil: b.validUntil?.split('T')[0],
          serviceType: b.serviceType || 'LOCAL',
          serviceAddress: b.serviceAddress || null,
        });
      });
    }
  }, [id, isNew, isCopy]);

  // Carrega dados do orçamento para cópia
  useEffect(() => {
    if (isCopy) {
      budgetsApi.get(copyFromId!).then(b => {
        reset({
          clientId: b.clientId,
          equipment: b.equipment,
          defect: b.defect,
          laborHours: b.laborHours,
          laborRate: b.laborRate,
          items: b.items.map(i => ({
            partId: i.partId, serviceId: i.serviceId, name: i.name, qty: i.qty, unitPrice: i.unitPrice,
            discount: i.discount ?? 0, discountType: i.discountType ?? 'VALUE', type: i.type,
            commissionPercent: i.commissionPercent ?? 0, commissionValue: i.commissionValue ?? 0,
            commissionType: i.commissionType ?? 'PERCENT',
          })),
          notes: '',
          validUntil: '',
          serviceType: b.serviceType || 'LOCAL',
          serviceAddress: b.serviceAddress || null,
        });
      });
    }
  }, [copyFromId, isCopy]);

  const onSubmit = (data: BudgetForm) => {
    setError(null);
    saveMutation.mutate(data);
  };

  const addItem = (type: 'PART' | 'SERVICE') => {
    appendItem({ partId: '', serviceId: '', name: '', qty: 1, unitPrice: 0, discount: 0, discountType: 'VALUE', type, commissionPercent: 0, commissionValue: 0, commissionType: 'PERCENT' });
  };

  /** Insere um serviço pré-cadastrado no orçamento (aba Serviços). */
  const addService = (service: any) => {
    const existing = items.findIndex((i) => i.type === 'SERVICE' && i.serviceId === service.id);
    if (existing >= 0) {
      setValue(`items.${existing}.qty`, (items[existing].qty || 1) + 1, { shouldDirty: true });
      return;
    }
    appendItem({
      partId: '',
      serviceId: service.id,
      name: service.name,
      qty: 1,
      unitPrice: service.price,
      discount: 0,
      discountType: 'VALUE',
      type: 'SERVICE',
      commissionPercent: 0,
      commissionValue: 0,
      commissionType: 'PERCENT',
    });
  };

  const removeService = (serviceId: string) => {
    const index = items.findIndex((i) => i.type === 'SERVICE' && i.serviceId === serviceId);
    if (index >= 0) removeItem(index);
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3, flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography variant="h4" fontWeight={700} sx={{ mb: 0.5 }}>{isNew || isCopy ? 'Novo Orçamento' : 'Editar Orçamento'}</Typography>
          <Typography variant="body1" color="text.secondary">{isNew ? 'Crie um orçamento completo' : `ID: ${id?.slice(0,8)}...`}</Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          {!isNew && <SecondaryButton onClick={() => navigate('/budgets')}>Voltar</SecondaryButton>}
        </Box>
      </Box>

      {/* Briefing A: erro de validação por campo (backend devolve error.fields) */}
      <FormErrors error={error} onClose={() => setError(null)} />

      <Tabs value={activeTab} onChange={(_, v) => setActiveTab(v)} sx={{ mb: 3 }}>
        <Tab label="Dados do Orçamento" />
        <Tab label="Itens (Peças)" />
        <Tab label="Serviços" />
        <Tab label="Equipamentos" />
      </Tabs>

      <form onSubmit={handleSubmit(onSubmit)}>
        {/* Aba 1: Dados */}
        {activeTab === 0 && (
          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Grid container spacing={3}>
                <Grid item xs={12} sm={6}>
                  <Autocomplete
                    fullWidth
                    options={clientData || []}
                    getOptionLabel={(o: any) =>
                      o && typeof o === 'object'
                        ? `${o.name ?? ''}${o.phone ? ` - ${formatPhone(o.phone)}` : ''}`
                        : ''
                    }
                    isOptionEqualToValue={(o: any, v: any) => o?.id === v?.id}
                    renderInput={(params) => <TextField {...params} label="Cliente *" error={!!errors.clientId} helperText={errors.clientId?.message} />}
                    value={clientData?.find((c: any) => c?.id === watch('clientId')) || null}
                    onChange={(_, v) => setValue('clientId', v?.id || '', { shouldDirty: true, shouldValidate: true })}
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField fullWidth label="Defeito Relatado *" multiline rows={3} {...register('defect')} error={!!errors.defect} helperText={errors.defect?.message} />
                </Grid>
                {/* Briefing B2.2: serviço local × externo */}
                <Grid item xs={12} sm={6}>
                  <Typography variant="caption" color="text.secondary">Tipo de Serviço</Typography>
                  <ToggleButtonGroup
                    exclusive
                    size="small"
                    fullWidth
                    value={serviceType}
                    onChange={(_, v) => {
                      if (!v) return;
                      setValue('serviceType', v, { shouldDirty: true });
                      if (v === 'LOCAL') setValue('serviceAddress', null, { shouldDirty: true });
                    }}
                    sx={{ mt: 0.5 }}
                  >
                    <ToggleButton value="LOCAL">Local (na loja)</ToggleButton>
                    <ToggleButton value="EXTERNAL">Externo (no cliente)</ToggleButton>
                  </ToggleButtonGroup>
                </Grid>
                {serviceType === 'EXTERNAL' && (
                  <Grid item xs={12}>
                    <Alert severity="info" sx={{ mb: 1.5 }}>
                      <b>Endereço Para Serviço</b> — escolha um endereço do cliente ou digite outro.
                    </Alert>
                    <Grid container spacing={2} alignItems="center">
                      <Grid item xs={12} md={5}>
                        <Autocomplete
                          fullWidth
                          size="small"
                          options={clientAddresses as any[]}
                          getOptionLabel={(a: any) => (a ? `${a.label || 'Endereço'} — ${a.street}${a.number ? ', ' + a.number : ''}${a.city ? ' · ' + a.city : ''}` : '')}
                          isOptionEqualToValue={(a: any, b: any) => a?.id === b?.id}
                          value={serviceAddress && serviceAddress.street ? serviceAddress : null}
                          onChange={(_, v) => setValue('serviceAddress', v, { shouldDirty: true })}
                          renderInput={(params) => <TextField {...params} label="Endereços do cliente" placeholder="Selecionar..." />}
                          noOptionsText={clientId ? 'Sem endereços cadastrados - digite abaixo' : 'Escolha o cliente primeiro'}
                        />
                      </Grid>
                      {(['street', 'number', 'district', 'city', 'state', 'zip', 'complement'] as const).map((f) => (
                        <Grid item xs={12} sm={f === 'street' ? 6 : f === 'complement' ? 6 : f === 'number' ? 2 : 3} md={f === 'street' ? 4 : f === 'complement' ? 4 : 2} key={f}>
                          <TextField
                            fullWidth
                            size="small"
                            label={f === 'street' ? 'Rua *' : f === 'number' ? 'Nº' : f === 'district' ? 'Bairro' : f === 'city' ? 'Cidade' : f === 'state' ? 'UF' : f === 'zip' ? 'CEP' : 'Complemento'}
                            value={(serviceAddress && serviceAddress[f]) || ''}
                            onChange={(e) => setValue('serviceAddress', { ...(serviceAddress || {}), street: serviceAddress?.street || '', [f]: e.target.value }, { shouldDirty: true })}
                          />
                        </Grid>
                      ))}
                    </Grid>
                  </Grid>
                )}
                <Grid item xs={12} sm={3}>
                  <TextField fullWidth label="Horas Mão de Obra" type="number" inputProps={{ step: 0.5 }} {...register('laborHours', { valueAsNumber: true })} />
                </Grid>
                <Grid item xs={12} sm={3}>
                  <TextField fullWidth label="Valor/Hora (R$)" type="number" inputProps={{ step: 0.01 }} {...register('laborRate', { valueAsNumber: true })} />
                </Grid>
                <Grid item xs={12} sm={3}>
                  <TextField fullWidth label="Validade até" type="date" {...register('validUntil')} InputLabelProps={{ shrink: true }} />
                </Grid>
                <Grid item xs={12}>
                  <TextField fullWidth label="Observações Internas" multiline rows={2} {...register('notes')} />
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        )}

        {/* Aba 2: Itens */}
        {activeTab === 1 && (
          <>
            <Card sx={{ mb: 3 }}>
              <CardContent>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                  <Typography variant="h6">Itens do Orçamento</Typography>
                  <Box sx={{ display: 'flex', gap: 1 }}>
                    <SecondaryButton startIcon={<AddIcon />} onClick={() => addItem('PART')}>Adicionar Peça</SecondaryButton>
                    <SecondaryButton startIcon={<AddIcon />} onClick={() => addItem('SERVICE')}>Adicionar Serviço</SecondaryButton>
                  </Box>
                </Box>
                <TableContainer>
                  <Table>
                    <TableHead>
                      <TableRow>
                        <TableCell>Tipo</TableCell>
                        <TableCell>Peça/Serviço</TableCell>
                        <TableCell>Qtd</TableCell>
                        <TableCell>Valor Unit.</TableCell>
                        <TableCell>Desconto</TableCell>
                        <TableCell>Total</TableCell>
                        <TableCell>Comissão</TableCell>
                        <TableCell>Ações</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {itemFields.map((field, index) => (
                        <TableRow key={field.id}>
                          <TableCell>
                            <FormControl fullWidth>
                              <Select
                                value={watch(`items.${index}.type`)}
                                onChange={(e) => setValue(`items.${index}.type`, e.target.value as 'PART' | 'SERVICE')}
                                size="small"
                              >
                                <MenuItem value="PART">Peça</MenuItem>
                                <MenuItem value="SERVICE">Serviço</MenuItem>
                              </Select>
                            </FormControl>
                          </TableCell>
                          <TableCell>
                            {watch(`items.${index}.type`) === 'PART' ? (
                              <Autocomplete
                                fullWidth
                                options={partsData || []}
                                getOptionLabel={(o: any) => `${o.name} (${o.code}) - ${formatCurrency(o.salePrice)}`}
                                renderInput={(params) => <TextField {...params} size="small" placeholder="Buscar peça..." />}
                                value={watch(`items.${index}.partId`) ? partsData?.find(p => p.id === watch(`items.${index}.partId`)) : null}
                                onChange={(_, v) => {
                                  setValue(`items.${index}.partId`, v?.id);
                                  setValue(`items.${index}.name`, v?.name);
                                  setValue(`items.${index}.unitPrice`, v?.salePrice);
                                }}
                              />
                            ) : (
                              <TextField fullWidth size="small" {...register(`items.${index}.name`)} placeholder="Nome do serviço" />
                            )}
                          </TableCell>
                          <TableCell>
                            <TextField size="small" type="number" {...register(`items.${index}.qty`, { valueAsNumber: true })} sx={{ width: 80 }} />
                          </TableCell>
                          <TableCell>
                            <TextField size="small" type="number" inputProps={{ step: 0.01 }} {...register(`items.${index}.unitPrice`, { valueAsNumber: true })} sx={{ width: 110 }} />
                          </TableCell>
                          <TableCell>
                            {/* Briefing B3: desconto por item (% ou R$) — limite validado no backend */}
                            <Box sx={{ display: 'flex', gap: 0.5 }}>
                              <TextField
                                size="small"
                                type="number"
                                inputProps={{ step: 0.01, min: 0 }}
                                sx={{ width: 80 }}
                                {...register(`items.${index}.discount`, { valueAsNumber: true })}
                              />
                              <FormControl size="small" sx={{ width: 72 }}>
                                <Select
                                  value={watch(`items.${index}.discountType`) || 'VALUE'}
                                  onChange={(e) => setValue(`items.${index}.discountType`, e.target.value as 'VALUE' | 'PERCENT')}
                                >
                                  <MenuItem value="VALUE">R$</MenuItem>
                                  <MenuItem value="PERCENT">%</MenuItem>
                                </Select>
                              </FormControl>
                            </Box>
                          </TableCell>
                          <TableCell sx={{ fontWeight: 500 }}>
                            {formatCurrency(itemNetVal(watch(`items.${index}`) || {}))}
                          </TableCell>
                          <TableCell>
                            {/* Briefing C: comissão personalizada por item (% ou R$) */}
                            <Box sx={{ display: 'flex', gap: 0.5 }}>
                              <TextField
                                size="small"
                                type="number"
                                inputProps={{ step: 0.01, min: 0 }}
                                sx={{ width: 80 }}
                                value={
                                  (watch(`items.${index}.commissionType`) || 'PERCENT') === 'VALUE'
                                    ? (watch(`items.${index}.commissionValue`) ?? '')
                                    : (watch(`items.${index}.commissionPercent`) ?? '')
                                }
                                onChange={(e) => setValue(
                                  `items.${index}.${(watch(`items.${index}.commissionType`) || 'PERCENT') === 'VALUE' ? 'commissionValue' : 'commissionPercent'}`,
                                  e.target.value === '' ? 0 : Number(e.target.value),
                                  { shouldDirty: true },
                                )}
                              />
                              <FormControl size="small" sx={{ width: 72 }}>
                                <Select
                                  value={watch(`items.${index}.commissionType`) || 'PERCENT'}
                                  onChange={(e) => setValue(`items.${index}.commissionType`, e.target.value as 'PERCENT' | 'VALUE', { shouldDirty: true })}
                                >
                                  <MenuItem value="PERCENT">%</MenuItem>
                                  <MenuItem value="VALUE">R$</MenuItem>
                                </Select>
                              </FormControl>
                            </Box>
                            <Tooltip title="Valor da comissão deste item (líquido × % ou R$ fixo)">
                              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                                {formatCurrency(itemCommission(watch(`items.${index}`) || {}))}
                              </Typography>
                            </Tooltip>
                          </TableCell>
                          <TableCell>
                            <IconButton size="small" onClick={() => removeItem(index)}><DeleteIcon fontSize="small" /></IconButton>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </CardContent>
            </Card>

            {/* Totais */}
            <Card sx={{ mb: 3, backgroundColor: 'primary.light', color: 'primary.contrastText' }}>
              <CardContent>
                <Grid container spacing={2}>
                  <Grid item xs={6} sm={2}>
                    <Typography variant="body2" color="primary.contrastText">Total Peças</Typography>
                    <Typography variant="h6" fontWeight={700}>{formatCurrency(totals.totalParts)}</Typography>
                  </Grid>
                  <Grid item xs={6} sm={2}>
                    <Typography variant="body2" color="primary.contrastText">Total Serviços</Typography>
                    <Typography variant="h6" fontWeight={700}>{formatCurrency(totals.totalServices)}</Typography>
                  </Grid>
                  <Grid item xs={6} sm={2}>
                    <Typography variant="body2" color="primary.contrastText">Descontos</Typography>
                    <Typography variant="h6" fontWeight={700} color={totals.descontos > 0 ? '#ffeb3b' : 'inherit'}>
                      {totals.descontos > 0 ? `− ${formatCurrency(totals.descontos)}` : formatCurrency(0)}
                    </Typography>
                  </Grid>
                  <Grid item xs={6} sm={3}>
                    <Typography variant="body2" color="primary.contrastText">Mão de Obra ({laborHours}h × R$ {laborRate})</Typography>
                    <Typography variant="h6" fontWeight={700}>{formatCurrency(totals.totalLabor)}</Typography>
                  </Grid>
                  <Grid item xs={12} sm={3}>
                    <Typography variant="body2" color="primary.contrastText">Total Geral</Typography>
                    <Typography variant="h5" fontWeight={700}>{formatCurrency(totals.total)}</Typography>
                  </Grid>
                </Grid>
              </CardContent>
            </Card>
          </>
        )}

        {/* Aba 3: Serviços pré-cadastrados */}
        {activeTab === 2 && (
          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 1 }}>
                <Box>
                  <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <ScienceIcon fontSize="small" /> Catálogo de Serviços
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Formatação, Limpeza, Montagem e demais serviços já configurados (Admin → Configurações → Serviços).
                  </Typography>
                </Box>
                <SecondaryButton startIcon={<AddIcon />} onClick={() => addItem('SERVICE')}>
                  Adicionar Serviço Manual
                </SecondaryButton>
              </Box>

              {servicesQuery.isLoading ? (
                <CircularProgress sx={{ display: 'block', mx: 'auto', my: 4 }} />
              ) : Object.keys(servicesCatalog).length === 0 ? (
                <Alert severity="info">Nenhum serviço cadastrado ainda. Use "Adicionar Serviço Manual" ou contate o administrador.</Alert>
              ) : (
                <Grid container spacing={2}>
                  {Object.entries(servicesCatalog).map(([category, list]) => (
                    <Grid item xs={12} md={6} key={category}>
                      <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 1.5 }}>
                        <Chip label={category} size="small" color="primary" variant="outlined" sx={{ mb: 1 }} />
                        <List dense disablePadding>
                          {(list || []).map((service: any) => {
                            const addedQty = items
                              .filter((i) => i.type === 'SERVICE' && i.serviceId === service.id)
                              .reduce((sum, i) => sum + (i.qty || 0), 0);
                            return (
                              <ListItemButton
                                key={service.id}
                                selected={addedQty > 0}
                                onClick={() => addService(service)}
                                sx={{ borderRadius: 1, mb: 0.5, alignItems: 'flex-start' }}
                              >
                                <ListItemText
                                  primary={
                                    <Typography variant="body2" fontWeight={600}>
                                      {service.name} {addedQty > 0 && <Chip label={`x${addedQty}`} size="small" color="success" />}
                                    </Typography>
                                  }
                                  secondary={
                                    <>
                                      {service.description || 'Sem descrição'}
                                      <br />
                                      <b>{formatCurrency(service.price)}</b> · {service.estimatedHours}h
                                    </>
                                  }
                                />
                                <ListItemSecondaryAction>
                                  {addedQty > 0 ? (
                                    <IconButton size="small" color="error" onClick={(e) => { e.stopPropagation(); removeService(service.id); }}>
                                      <DeleteIcon fontSize="small" />
                                    </IconButton>
                                  ) : (
                                    <IconButton size="small" color="primary" onClick={(e) => { e.stopPropagation(); addService(service); }}>
                                      <AddIcon fontSize="small" />
                                    </IconButton>
                                  )}
                                </ListItemSecondaryAction>
                              </ListItemButton>
                            );
                          })}
                        </List>
                      </Box>
                    </Grid>
                  ))}
                </Grid>
              )}

              {/* Resumo dos serviços selecionados */}
              {items.filter((i) => i.type === 'SERVICE').length > 0 && (
                <Box sx={{ mt: 2 }}>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>Serviços neste orçamento</Typography>
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Serviço</TableCell>
                          <TableCell align="right">Qtd</TableCell>
                          <TableCell align="right">Valor Unit.</TableCell>
                          <TableCell align="right">Desconto</TableCell>
                          <TableCell align="right">Total</TableCell>
                          <TableCell align="center">Ações</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {items.map((item, index) =>
                          item.type === 'SERVICE' ? (
                            <TableRow key={`svc-${index}`}>
                              <TableCell>
                                <TextField size="small" fullWidth {...register(`items.${index}.name`)} />
                              </TableCell>
                              <TableCell align="right">
                                <TextField
                                  size="small"
                                  type="number"
                                  sx={{ width: 70 }}
                                  {...register(`items.${index}.qty`, { valueAsNumber: true })}
                                />
                              </TableCell>
                              <TableCell align="right">
                                <TextField
                                  size="small"
                                  type="number"
                                  inputProps={{ step: 0.01 }}
                                  sx={{ width: 110 }}
                                  {...register(`items.${index}.unitPrice`, { valueAsNumber: true })}
                                />
                              </TableCell>
                              <TableCell align="right">
                                <TextField
                                  size="small"
                                  type="number"
                                  inputProps={{ step: 0.01, min: 0 }}
                                  sx={{ width: 90 }}
                                  {...register(`items.${index}.discount`, { valueAsNumber: true })}
                                />
                                <FormControl size="small" sx={{ width: 70, ml: 1 }}>
                                  <Select
                                    value={watch(`items.${index}.discountType`) || 'VALUE'}
                                    onChange={(e) => setValue(`items.${index}.discountType`, e.target.value as 'VALUE' | 'PERCENT')}
                                  >
                                    <MenuItem value="VALUE">R$</MenuItem>
                                    <MenuItem value="PERCENT">%</MenuItem>
                                  </Select>
                                </FormControl>
                              </TableCell>
                              <TableCell align="right" sx={{ fontWeight: 600 }}>
                                {formatCurrency(itemNetVal(item))}
                              </TableCell>
                              <TableCell align="center">
                                <IconButton size="small" color="error" onClick={() => removeItem(index)}>
                                  <DeleteIcon fontSize="small" />
                                </IconButton>
                              </TableCell>
                            </TableRow>
                          ) : null
                        )}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Box>
              )}
            </CardContent>
          </Card>
        )}

        {/* Aba 4: Equipamentos */}
        {activeTab === 3 && (
          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, gap: 1, flexWrap: 'wrap' }}>
                <Typography variant="h6">Equipamentos</Typography>
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                  {/* Briefing B2.1: equipamentos já cadastrados no cliente */}
                  <Autocomplete
                    size="small"
                    sx={{ minWidth: 300 }}
                    options={clientEquipments}
                    getOptionLabel={(e: any) => (e ? `${e.name}${e.brand ? ' · ' + e.brand : ''}${e.serialNumber ? ' · S/N ' + e.serialNumber : ''}` : '')}
                    value={null}
                    onChange={(_, v) => {
                      if (!v) return;
                      appendEquipment({ name: v.name, brand: v.brand || '', model: v.model || '', serial: v.serialNumber || '', photos: [], notes: v.notes || '' });
                    }}
                    renderInput={(params) => (
                      <TextField {...params} label="Buscar do cliente" placeholder={clientId ? 'Equipamentos cadastrados' : 'Escolha o cliente'} />
                    )}
                    disabled={!clientId}
                    noOptionsText={clientId ? 'Cliente sem equipamentos' : 'Escolha o cliente'}
                  />
                  <SecondaryButton startIcon={<AddIcon />} onClick={() => appendEquipment({ name: '', brand: '', model: '', serial: '', photos: [], notes: '' })}>
                    Adicionar Equipamento
                  </SecondaryButton>
                </Box>
              </Box>
              {equipmentFields.map((field, index) => (
                <Box key={field.id} sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 2, mb: 2, position: 'relative' }}>
                  <IconButton size="small" onClick={() => removeEquipment(index)} sx={{ position: 'absolute', top: 8, right: 8 }}><DeleteIcon fontSize="small" /></IconButton>
                  <Grid container spacing={2}>
                    <Grid item xs={12} sm={4}>
                      <TextField
                        fullWidth
                        label="Nome do Equipamento *"
                        {...register(`equipment.${index}.name`)}
                        error={!!errors.equipment?.[index]?.name}
                        helperText={errors.equipment?.[index]?.name?.message}
                      />
                    </Grid>
                    <Grid item xs={12} sm={4}>
                      <TextField fullWidth label="Marca" {...register(`equipment.${index}.brand`)} />
                    </Grid>
                    <Grid item xs={12} sm={4}>
                      <TextField fullWidth label="Modelo" {...register(`equipment.${index}.model`)} />
                    </Grid>
                    <Grid item xs={12} sm={6}>
                      <TextField fullWidth label="Número de Série" {...register(`equipment.${index}.serial`)} />
                    </Grid>
                    <Grid item xs={12} sm={6}>
                      <TextField fullWidth label="Observações" {...register(`equipment.${index}.notes`)} />
                    </Grid>
                    <Grid item xs={12}>
                      <TextField fullWidth label="Fotos do Equipamento" multiline rows={2} inputProps={{ readOnly: true }} placeholder="As fotos anexadas aparecerão aqui" />
                    </Grid>
                  </Grid>
                </Box>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Ações */}
        <Box sx={{ display: 'flex', gap: 2, justifyContent: 'flex-end', p: 2, borderTop: 1, borderColor: 'divider' }}>
          {!isNew && <SecondaryButton type="button" onClick={() => navigate('/budgets')}>Cancelar</SecondaryButton>}
          <PrimaryButton type="submit" loading={isSubmitting} disabled={!isNew && totals.total === 0}>
            {isNew || isCopy ? 'Criar Orçamento' : 'Salvar Alterações'}
          </PrimaryButton>
        </Box>
      </form>

      {/* Status actions para orçamentos existentes */}
      {!isNew && (
        <Card sx={{ mt: 3 }}>
          <CardContent>
            <Typography variant="h6" sx={{ mb: 2 }}>Ações de Status</Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              <SecondaryButton onClick={() => statusMutation.mutate('SENT')}>Marcar como Enviado</SecondaryButton>
              <PrimaryButton onClick={() => statusMutation.mutate('APPROVED')}>Aprovar</PrimaryButton>
              <SecondaryButton color="warning" onClick={() => statusMutation.mutate('REJECTED')}>Rejeitar</SecondaryButton>
              <SecondaryButton color="error" onClick={() => { if(window.confirm('Cancelar orçamento?')) statusMutation.mutate('EXPIRED'); }}>Expirar</SecondaryButton>
            </Box>
          </CardContent>
        </Card>
      )}
    </Box>
  );
}
