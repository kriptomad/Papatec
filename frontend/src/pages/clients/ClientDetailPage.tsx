import { Box, Card, CardContent, TextField, Typography, Grid, Alert, CircularProgress, Tabs, Tab, TableContainer, Table, TableHead, TableBody, TableRow, TableCell, Chip, MenuItem, Switch, FormControlLabel, IconButton } from '@mui/material';
import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Edit as EditIcon, Delete as DeleteIcon, Add as AddIcon, Home as HomeIcon, DevicesOther as DevicesIcon } from '@mui/icons-material';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { clientsApi, usersApi } from '../../services/api';
import { PrimaryButton, SecondaryButton, DangerButton } from '../../components/ui/Buttons';
import FormErrors from '../../components/ui/FormErrors';
import { BudgetStatusChip, OSStatusChip } from '../../components/ui/StatusChips';
import { BudgetStatus, OSStatus } from '../../types';
import { formatCurrency, formatDate } from '../../utils/formatters';

// Cadastro completo de Cliente conforme o PDF (p.1): código único, classificação
// PF/PJ, status, endereço estruturado, documentos, contato, site e responsável.
const clientSchema = z.object({
  name: z.string().min(2, 'Mínimo 2 caracteres'),
  phone: z.string().min(10, 'Telefone inválido'),
  type: z.enum(['PF', 'PJ']),
  active: z.boolean(),
  ramal: z.string().optional(),
  email: z.string().email('Email inválido').optional().or(z.literal('')),
  site: z.string().optional(),
  address: z.string().optional(),
  street: z.string().optional(),
  number: z.string().optional(),
  complement: z.string().optional(),
  district: z.string().optional(),
  zip: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  cpf: z.string().optional(),
  rg: z.string().optional(),
  cnpj: z.string().optional(),
  ie: z.string().optional(),
  im: z.string().optional(),
  responsibleId: z.string().optional(),
  notes: z.string().optional(),
}).superRefine((val, ctx) => {
  // Briefing D2: CPF obrigatório p/ Pessoa Física, CNPJ p/ Pessoa Jurídica
  if (val.type === 'PF' && !String(val.cpf || '').trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['cpf'], message: 'CPF é obrigatório para Pessoa Física' });
  }
  if (val.type === 'PJ' && !String(val.cnpj || '').trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['cnpj'], message: 'CNPJ é obrigatório para Pessoa Jurídica' });
  }
});

type ClientForm = z.infer<typeof clientSchema>;

export function ClientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isNew = !id || id === 'new';
  const [error, setError] = useState('');
  // Briefing A: erro cru do axios (error.fields) para o FormErrors
  const [apiError, setApiError] = useState<any>(null);
  const [activeTab, setActiveTab] = useState(0);

  const { register, handleSubmit, setValue, watch, formState: { errors, isSubmitting }, reset } = useForm<ClientForm>({
    resolver: zodResolver(clientSchema),
    defaultValues: {
      name: '', phone: '', type: 'PF', active: true, ramal: '', email: '', site: '', address: '',
      street: '', number: '', complement: '', district: '', zip: '', city: '', state: '',
      cpf: '', rg: '', cnpj: '', ie: '', im: '', responsibleId: '', notes: '',
    },
  });

  const type = watch('type');

  // Evita falha "silenciosa": avisa quando o zod derruba o submit
  useEffect(() => {
    if (Object.keys(errors).length > 0) setError('Verifique os campos destacados do formulário.');
  }, [errors]);

  const { data: client, isLoading } = useQuery({
    queryKey: ['client', id],
    queryFn: () => clientsApi.get(id!),
    enabled: !isNew,
  });

  const { data: history } = useQuery({
    queryKey: ['clientHistory', id],
    queryFn: () => clientsApi.getHistory(id!),
    enabled: !isNew,
  });

  // Opções de funcionário responsável (PDF p.1)
  const { data: users } = useQuery({
    queryKey: ['client-responsible-options'],
    queryFn: () => usersApi.list({ limit: 200 }),
  });

  const saveMutation = useMutation({
    mutationFn: (data: ClientForm) => (isNew ? clientsApi.create(data) : clientsApi.update(id!, data)),
    onSuccess: (saved: any) => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      queryClient.invalidateQueries({ queryKey: ['clientsAll'] });
      queryClient.invalidateQueries({ queryKey: ['client', id] });
      if (isNew) navigate(`/clients/${saved.id}`);
      else setError('Salvo com sucesso!');
    },
    onError: (err: any) => setApiError(err),
  });

  const deleteMutation = useMutation({
    mutationFn: () => clientsApi.delete(id!),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['clients'] }); queryClient.invalidateQueries({ queryKey: ['clientsAll'] }); navigate('/clients'); },
    onError: (err: any) => setError(err.response?.data?.message || 'Erro ao excluir'),
  });

  const toggleMutation = useMutation({
    mutationFn: () => clientsApi.update(id!, { active: !(client?.active !== false) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['client', id] }),
  });

  // ---------------------------------------------------------------------------
  // Briefing D3/D1: endereços e equipamentos do cliente (formulários inline)
  // ---------------------------------------------------------------------------
  const blankAddr = { label: '', street: '', number: '', complement: '', district: '', zip: '', city: '', state: '', isDefault: false };
  const blankEq = { name: '', brand: '', model: '', serialNumber: '', notes: '' };
  const [addrForm, setAddrForm] = useState<any | null>(null);
  const [eqForm, setEqForm] = useState<any | null>(null);

  const saveAddrMutation = useMutation({
    mutationFn: (payload: { addrId?: string; data: any }) =>
      payload.addrId
        ? clientsApi.updateAddress(id!, payload.addrId, payload.data)
        : clientsApi.createAddress(id!, payload.data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['client', id] }); setAddrForm(null); },
    onError: (err: any) => setApiError(err),
  });

  const deleteAddrMutation = useMutation({
    mutationFn: (addrId: string) => clientsApi.deleteAddress(id!, addrId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['client', id] }),
    onError: (err: any) => setError(err.response?.data?.message || 'Erro ao excluir endereço'),
  });

  const saveEqMutation = useMutation({
    mutationFn: (payload: { eqId?: string; data: any }) =>
      payload.eqId
        ? clientsApi.updateEquipment(id!, payload.eqId, payload.data)
        : clientsApi.createEquipment(id!, payload.data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['client', id] }); setEqForm(null); },
    onError: (err: any) => setApiError(err),
  });

  const deleteEqMutation = useMutation({
    mutationFn: (eqId: string) => clientsApi.deleteEquipment(id!, eqId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['client', id] }),
    onError: (err: any) => setError(err.response?.data?.message || 'Erro ao excluir equipamento'),
  });

  // Preenche formulário quando dados carregam
  useEffect(() => {
    if (client && !isNew) {
      reset({
        name: client.name || '',
        phone: client.phone || '',
        type: client.type || 'PF',
        active: client.active !== false,
        ramal: client.ramal || '',
        email: client.email || '',
        site: client.site || '',
        address: client.address || '',
        street: client.street || '',
        number: client.number || '',
        complement: client.complement || '',
        district: client.district || '',
        zip: client.zip || '',
        city: client.city || '',
        state: client.state || '',
        cpf: client.cpf || '',
        rg: client.rg || '',
        cnpj: client.cnpj || '',
        ie: client.ie || '',
        im: client.im || '',
        responsibleId: client.responsibleId || '',
        notes: client.notes || '',
      });
    }
  }, [client]);

  const onSubmit = (data: ClientForm) => {
    setError('');
    setApiError(null);
    saveMutation.mutate(data);
  };

  // Briefing D: vendas do cliente (GET /clients/:id/history devolve sales)
  // Extract map results to a const (não colocar .map() direto no return — TS7)
  const salesRows = (history?.sales || []).map((s: any) => (
    <TableRow key={s.id} hover>
      <TableCell>{s.code || s.id.slice(0, 8).toUpperCase()}</TableCell>
      <TableCell>{formatDate(s.createdAt)}</TableCell>
      <TableCell align="right" sx={{ fontWeight: 500 }}>{formatCurrency(s.total)}</TableCell>
      <TableCell>{s.user?.name || '-'}</TableCell>
    </TableRow>
  ));

  if (isLoading && !isNew) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>;

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3, flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography variant="h4" fontWeight={700} sx={{ mb: 0.5 }}>{isNew ? 'Novo Cliente' : client?.name}</Typography>
          <Typography variant="body1" color="text.secondary">
            {isNew
              ? 'Cadastre um novo cliente'
              : `Código: ${client?.code || '—'} · ${client?.type === 'PJ' ? 'Pessoa Jurídica' : 'Pessoa Física'}${client?.active === false ? ' · INATIVO' : ''}`}
          </Typography>
        </Box>
        {!isNew && (
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
            <FormControlLabel
              control={<Switch checked={client?.active !== false} onChange={() => toggleMutation.mutate()} />}
              label={client?.active !== false ? 'Ativo' : 'Inativo'}
            />
            <SecondaryButton onClick={() => navigate('/clients')}>Voltar</SecondaryButton>
            <DangerButton onClick={() => { if (window.confirm('Excluir cliente?')) deleteMutation.mutate(); }}>Excluir</DangerButton>
          </Box>
        )}
      </Box>

      {error && <Alert severity={error.includes('sucesso') ? 'success' : 'error'} sx={{ mb: 3 }} onClose={() => setError('')}>{error}</Alert>}
      {/* Briefing A: erros de API por campo (create/update/endereço/equipamento) */}
      <FormErrors error={apiError} onClose={() => setApiError(null)} />

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)}>
            <Grid container spacing={3}>
              {/* Identificação */}
              <Grid item xs={12} sm={4}>
                <TextField
                  select fullWidth label="Classificação *"
                  value={type}
                  onChange={(e) => setValue('type', e.target.value as 'PF' | 'PJ')}
                >
                  <MenuItem value="PF">Pessoa Física</MenuItem>
                  <MenuItem value="PJ">Pessoa Jurídica</MenuItem>
                </TextField>
              </Grid>
              <Grid item xs={12} sm={5}>
                <TextField fullWidth label="Nome *" {...register('name')} error={!!errors.name} helperText={errors.name?.message} />
              </Grid>
              <Grid item xs={12} sm={3}>
                <TextField
                  select fullWidth label="Funcionário responsável"
                  {...register('responsibleId')}
                >
                  <MenuItem value="">—</MenuItem>
                  {(users?.data || []).map((u: any) => (
                    <MenuItem key={u.id} value={u.id}>{u.name}</MenuItem>
                  ))}
                </TextField>
              </Grid>

              {/* Contato */}
              <Grid item xs={12} sm={3}>
                <TextField fullWidth label="Telefone *" type="tel" {...register('phone')} error={!!errors.phone} helperText={errors.phone?.message} />
              </Grid>
              <Grid item xs={12} sm={1}>
                <TextField fullWidth label="Ramal" {...register('ramal')} />
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField fullWidth label="Email" type="email" {...register('email')} error={!!errors.email} helperText={errors.email?.message} />
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField fullWidth label="Site" {...register('site')} placeholder="https://" />
              </Grid>

              {/* Endereço estruturado */}
              <Grid item xs={12}>
                <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 0.5 }}>Endereço</Typography>
              </Grid>
              <Grid item xs={12} sm={5}>
                <TextField fullWidth label="Rua / Avenida" {...register('street')} />
              </Grid>
              <Grid item xs={12} sm={1}>
                <TextField fullWidth label="Nº" {...register('number')} />
              </Grid>
              <Grid item xs={12} sm={3}>
                <TextField fullWidth label="Complemento" {...register('complement')} />
              </Grid>
              <Grid item xs={12} sm={3}>
                <TextField fullWidth label="Bairro" {...register('district')} />
              </Grid>
              <Grid item xs={12} sm={3}>
                <TextField fullWidth label="CEP" {...register('zip')} placeholder="00000-000" />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField fullWidth label="Cidade" {...register('city')} />
              </Grid>
              <Grid item xs={12} sm={3}>
                <TextField fullWidth label="Estado (UF)" {...register('state')} inputProps={{ maxLength: 2 }} />
              </Grid>

              {/* Documentos */}
              <Grid item xs={12}>
                <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 0.5 }}>Documentos</Typography>
              </Grid>
              {type === 'PF' ? (
                <>
                  <Grid item xs={12} sm={4}>
                    <TextField fullWidth label="CPF" {...register('cpf')} placeholder="000.000.000-00" required={type === 'PF'} helperText={errors.cpf?.message} error={!!errors.cpf} />
                  </Grid>
                  <Grid item xs={12} sm={4}>
                    <TextField fullWidth label="RG" {...register('rg')} />
                  </Grid>
                </>
              ) : (
                <>
                  <Grid item xs={12} sm={4}>
                    <TextField fullWidth label="CNPJ" {...register('cnpj')} placeholder="00.000.000/0000-00" required={type === 'PJ'} helperText={errors.cnpj?.message} error={!!errors.cnpj} />
                  </Grid>
                  <Grid item xs={12} sm={4}>
                    <TextField fullWidth label="Inscrição Estadual" {...register('ie')} />
                  </Grid>
                  <Grid item xs={12} sm={4}>
                    <TextField fullWidth label="Inscrição Municipal" {...register('im')} />
                  </Grid>
                </>
              )}

              <Grid item xs={12}>
                <TextField fullWidth label="Observações" multiline rows={3} {...register('notes')} />
              </Grid>

              <Grid item xs={12} sx={{ display: 'flex', gap: 2, justifyContent: 'flex-end', pt: 1 }}>
                {!isNew && <SecondaryButton type="button" onClick={() => reset()}>Cancelar</SecondaryButton>}
                <PrimaryButton type="submit" loading={isSubmitting}>{isNew ? 'Cadastrar' : 'Salvar'}</PrimaryButton>
              </Grid>
            </Grid>
          </form>
        </CardContent>
      </Card>

      {!isNew && (
        <Grid container spacing={3} sx={{ mb: 3 }}>
          {/* Briefing D3: vários endereços por cliente (dropdown no orçamento/O.S.) */}
          <Grid item xs={12} md={6}>
            <Card sx={{ height: '100%' }}>
              <CardContent>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                    <HomeIcon color="primary" fontSize="small" />
                    <Typography variant="h6" fontWeight={600}>Endereços</Typography>
                  </Box>
                  <PrimaryButton size="small" startIcon={<AddIcon />} onClick={() => setAddrForm({ ...blankAddr })}>
                    Novo
                  </PrimaryButton>
                </Box>

                {addrForm && (
                  <Box
                    component="form"
                    onSubmit={(e) => { e.preventDefault(); saveAddrMutation.mutate({ addrId: addrForm.id, data: addrForm }); }}
                    sx={{ mb: 2, p: 2, bgcolor: 'action.hover', borderRadius: 1 }}
                  >
                    <Grid container spacing={2}>
                      <Grid item xs={12} sm={6}>
                        <TextField fullWidth size="small" label="Apelido (ex.: Residência)" value={addrForm.label || ''} onChange={(e) => setAddrForm({ ...addrForm, label: e.target.value })} />
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <TextField fullWidth size="small" label="CEP" value={addrForm.zip || ''} onChange={(e) => setAddrForm({ ...addrForm, zip: e.target.value })} />
                      </Grid>
                      <Grid item xs={12} sm={8}>
                        <TextField fullWidth size="small" required label="Rua" value={addrForm.street || ''} onChange={(e) => setAddrForm({ ...addrForm, street: e.target.value })} />
                      </Grid>
                      <Grid item xs={12} sm={4}>
                        <TextField fullWidth size="small" label="Número" value={addrForm.number || ''} onChange={(e) => setAddrForm({ ...addrForm, number: e.target.value })} />
                      </Grid>
                      <Grid item xs={12} sm={4}>
                        <TextField fullWidth size="small" label="Complemento" value={addrForm.complement || ''} onChange={(e) => setAddrForm({ ...addrForm, complement: e.target.value })} />
                      </Grid>
                      <Grid item xs={12} sm={4}>
                        <TextField fullWidth size="small" label="Bairro" value={addrForm.district || ''} onChange={(e) => setAddrForm({ ...addrForm, district: e.target.value })} />
                      </Grid>
                      <Grid item xs={12} sm={3}>
                        <TextField fullWidth size="small" label="Cidade" value={addrForm.city || ''} onChange={(e) => setAddrForm({ ...addrForm, city: e.target.value })} />
                      </Grid>
                      <Grid item xs={12} sm={2}>
                        <TextField fullWidth size="small" label="UF" value={addrForm.state || ''} onChange={(e) => setAddrForm({ ...addrForm, state: e.target.value })} inputProps={{ maxLength: 2 }} />
                      </Grid>
                      <Grid item xs={12} sm={3} sx={{ display: 'flex', alignItems: 'center' }}>
                        <FormControlLabel
                          control={<Switch checked={!!addrForm.isDefault} onChange={(_, v) => setAddrForm({ ...addrForm, isDefault: v })} />}
                          label="Padrão"
                        />
                      </Grid>
                      <Grid item xs={12} sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
                        <SecondaryButton size="small" onClick={() => setAddrForm(null)}>Cancelar</SecondaryButton>
                        <PrimaryButton type="submit" size="small" loading={saveAddrMutation.isPending}>Salvar</PrimaryButton>
                      </Grid>
                    </Grid>
                  </Box>
                )}

                {(client?.addresses || []).length === 0 && !addrForm && (
                  <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 2 }}>
                    Nenhum endereço cadastrado.
                  </Typography>
                )}
                {(client?.addresses || []).map((a) => (
                  <Box key={a.id} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', py: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
                    <Box sx={{ pr: 1 }}>
                      <Typography variant="body2" fontWeight={600}>
                        {a.label || 'Endereço'}
                        {a.isDefault && <Chip size="small" color="primary" label="Padrão" sx={{ ml: 1, height: 18, fontSize: 10 }} />}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {a.street}{a.number ? `, ${a.number}` : ''}{a.complement ? ` - ${a.complement}` : ''}
                        {a.district ? ` · ${a.district}` : ''}
                        {a.city ? ` · ${a.city}${a.state ? '/' + a.state : ''}` : ''}
                        {a.zip ? ` · CEP ${a.zip}` : ''}
                      </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', gap: 0.5, flexShrink: 0 }}>
                      <IconButton size="small" title="Editar" onClick={() => setAddrForm({ ...a })}><EditIcon fontSize="small" /></IconButton>
                      <IconButton size="small" title="Excluir" onClick={() => { if (window.confirm('Excluir este endereço?')) deleteAddrMutation.mutate(a.id); }}><DeleteIcon fontSize="small" /></IconButton>
                    </Box>
                  </Box>
                ))}
              </CardContent>
            </Card>
          </Grid>

          {/* Briefing D1: equipamentos com ID único atrelados ao cliente */}
          <Grid item xs={12} md={6}>
            <Card sx={{ height: '100%' }}>
              <CardContent>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                    <DevicesIcon color="primary" fontSize="small" />
                    <Typography variant="h6" fontWeight={600}>Equipamentos</Typography>
                  </Box>
                  <PrimaryButton size="small" startIcon={<AddIcon />} onClick={() => setEqForm({ ...blankEq })}>
                    Novo
                  </PrimaryButton>
                </Box>

                {eqForm && (
                  <Box
                    component="form"
                    onSubmit={(e) => { e.preventDefault(); saveEqMutation.mutate({ eqId: eqForm.id, data: eqForm }); }}
                    sx={{ mb: 2, p: 2, bgcolor: 'action.hover', borderRadius: 1 }}
                  >
                    <Grid container spacing={2}>
                      <Grid item xs={12} sm={6}>
                        <TextField fullWidth size="small" required label="Nome (ex.: Notebook Dell)" value={eqForm.name || ''} onChange={(e) => setEqForm({ ...eqForm, name: e.target.value })} />
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <TextField fullWidth size="small" label="Marca" value={eqForm.brand || ''} onChange={(e) => setEqForm({ ...eqForm, brand: e.target.value })} />
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <TextField fullWidth size="small" label="Modelo" value={eqForm.model || ''} onChange={(e) => setEqForm({ ...eqForm, model: e.target.value })} />
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <TextField fullWidth size="small" label="Nº de série" value={eqForm.serialNumber || ''} onChange={(e) => setEqForm({ ...eqForm, serialNumber: e.target.value })} />
                      </Grid>
                      <Grid item xs={12}>
                        <TextField fullWidth size="small" label="Observações" value={eqForm.notes || ''} onChange={(e) => setEqForm({ ...eqForm, notes: e.target.value })} />
                      </Grid>
                      <Grid item xs={12} sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
                        <SecondaryButton size="small" onClick={() => setEqForm(null)}>Cancelar</SecondaryButton>
                        <PrimaryButton type="submit" size="small" loading={saveEqMutation.isPending}>Salvar</PrimaryButton>
                      </Grid>
                    </Grid>
                  </Box>
                )}

                {(client?.equipments || []).length === 0 && !eqForm && (
                  <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 2 }}>
                    Nenhum equipamento cadastrado.
                  </Typography>
                )}
                {(client?.equipments || []).map((eq) => (
                  <Box key={eq.id} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', py: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
                    <Box sx={{ pr: 1 }}>
                      <Typography variant="body2" fontWeight={600}>{eq.name}</Typography>
                      <Typography variant="body2" color="text.secondary">
                        {[eq.brand, eq.model].filter(Boolean).join(' · ')}
                        {eq.serialNumber ? ` · S/N ${eq.serialNumber}` : ''}
                      </Typography>
                      {eq.notes && <Typography variant="caption" color="text.secondary">{eq.notes}</Typography>}
                    </Box>
                    <Box sx={{ display: 'flex', gap: 0.5, flexShrink: 0 }}>
                      <IconButton size="small" title="Editar" onClick={() => setEqForm({ ...eq })}><EditIcon fontSize="small" /></IconButton>
                      <IconButton size="small" title="Excluir" onClick={() => { if (window.confirm('Excluir este equipamento?')) deleteEqMutation.mutate(eq.id); }}><DeleteIcon fontSize="small" /></IconButton>
                    </Box>
                  </Box>
                ))}
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}

      {!isNew && (
        <>
          {/* Histórico: últimos serviços/vendas relacionados ao cliente (PDF p.1) */}
          <Tabs value={activeTab} onChange={(_, v) => setActiveTab(v)} sx={{ mb: 2 }}>
            <Tab label={`Orçamentos (${history?.budgets?.length || 0})`} />
            <Tab label={`Ordens de Serviço (${history?.serviceOrders?.length || 0})`} />
            <Tab label={`Vendas (${history?.sales?.length || 0})`} />
          </Tabs>

          {activeTab === 0 && (
            <Card>
              <TableContainer>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell>ID</TableCell>
                      <TableCell>Data</TableCell>
                      <TableCell>Equipamento</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell align="right">Total</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {history?.budgets?.map((b: any) => (
                      <TableRow key={b.id} hover sx={{ cursor: 'pointer' }} onClick={() => navigate(`/budgets/${b.id}`)}>
                        <TableCell>{b.id.slice(0,8).toUpperCase()}</TableCell>
                        <TableCell>{formatDate(b.createdAt)}</TableCell>
                        <TableCell>{b.equipment?.[0]?.name || 'N/A'}</TableCell>
                        <TableCell><BudgetStatusChip status={b.status as BudgetStatus} /></TableCell>
                        <TableCell align="right" sx={{ fontWeight: 500 }}>{formatCurrency(b.total)}</TableCell>
                      </TableRow>
                    ))}
                    {(history?.budgets || []).length === 0 && (
                      <TableRow><TableCell colSpan={5} align="center" sx={{ py: 4, color: 'text.secondary' }}>Nenhum orçamento.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </Card>
          )}

          {activeTab === 1 && (
            <Card>
              <TableContainer>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell>OS</TableCell>
                      <TableCell>Data</TableCell>
                      <TableCell>Equipamento</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell align="right">Total</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {history?.serviceOrders?.map((o: any) => (
                      <TableRow key={o.id} hover sx={{ cursor: 'pointer' }} onClick={() => navigate(`/service-orders/${o.id}`)}>
                        <TableCell>#{o.osNumber ?? o.id.slice(0,8).toUpperCase()}</TableCell>
                        <TableCell>{formatDate(o.createdAt)}</TableCell>
                        <TableCell>{o.equipment?.[0]?.name || 'N/A'}</TableCell>
                        <TableCell><OSStatusChip status={o.status as OSStatus} /></TableCell>
                        <TableCell align="right" sx={{ fontWeight: 500 }}>{formatCurrency(o.total)}</TableCell>
                      </TableRow>
                    ))}
                    {(history?.serviceOrders || []).length === 0 && (
                      <TableRow><TableCell colSpan={5} align="center" sx={{ py: 4, color: 'text.secondary' }}>Nenhuma ordem de serviço.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </Card>
          )}

          {/* Briefing D: histórico de vendas do cliente (código, data, total, vendedor) */}
          {activeTab === 2 && (
            <Card>
              <TableContainer>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell>Venda</TableCell>
                      <TableCell>Data</TableCell>
                      <TableCell align="right">Total</TableCell>
                      <TableCell>Vendedor</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {salesRows}
                    {(history?.sales || []).length === 0 && (
                      <TableRow><TableCell colSpan={4} align="center" sx={{ py: 4, color: 'text.secondary' }}>Nenhuma venda.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </Card>
          )}
        </>
      )}
    </Box>
  );
}
