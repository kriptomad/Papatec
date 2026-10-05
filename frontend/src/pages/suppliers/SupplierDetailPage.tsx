import { Box, Card, CardContent, TextField, Typography, Grid, Alert, CircularProgress, Tabs, Tab, TableContainer, Table, TableHead, TableBody, TableRow, TableCell, Chip, MenuItem, Switch, FormControlLabel, InputAdornment } from '@mui/material';
import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { suppliersApi } from '../../services/api';
import { PrimaryButton, SecondaryButton, DangerButton } from '../../components/ui/Buttons';
import { formatCurrency, formatDate } from '../../utils/formatters';

const supplierSchema = z.object({
  name: z.string().min(2, 'Mínimo 2 caracteres'),
  type: z.enum(['PF', 'PJ']),
  active: z.boolean(),
  contact: z.string().optional(),
  phone: z.string().optional(),
  ramal: z.string().optional(),
  email: z.string().email('Email inválido').optional().or(z.literal('')),
  site: z.string().optional(),
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
  notes: z.string().optional(),
});

type SupplierForm = z.infer<typeof supplierSchema>;

export function SupplierDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isNew = !id || id === 'new';
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState(0);

  const { register, handleSubmit, setValue, watch, formState: { errors, isSubmitting }, reset } = useForm<SupplierForm>({
    resolver: zodResolver(supplierSchema),
    defaultValues: {
      name: '', type: 'PF', active: true, contact: '', phone: '', ramal: '', email: '', site: '',
      street: '', number: '', complement: '', district: '', zip: '', city: '', state: '',
      cpf: '', rg: '', cnpj: '', ie: '', im: '', notes: '',
    },
  });

  const type = watch('type');

  const { data: supplier, isLoading } = useQuery({
    queryKey: ['supplier', id],
    queryFn: () => suppliersApi.get(id!),
    enabled: !isNew,
  });

  const saveMutation = useMutation({
    mutationFn: (data: SupplierForm) => (isNew ? suppliersApi.create(data) : suppliersApi.update(id!, data)),
    onSuccess: (saved: any) => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      queryClient.invalidateQueries({ queryKey: ['supplier', id] });
      if (isNew) navigate(`/suppliers/${saved.id}`);
      else setError('Salvo com sucesso!');
    },
    onError: (err: any) => setError(err.response?.data?.message || 'Erro ao salvar'),
  });

  const deleteMutation = useMutation({
    mutationFn: () => suppliersApi.delete(id!),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['suppliers'] }); navigate('/suppliers'); },
    onError: (err: any) => setError(err.response?.data?.message || 'Erro ao excluir'),
  });

  const toggleMutation = useMutation({
    mutationFn: () => suppliersApi.toggleActive(id!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['supplier', id] }),
  });

  useEffect(() => {
    if (supplier && !isNew) {
      reset({
        name: supplier.name || '',
        type: supplier.type || 'PF',
        active: supplier.active !== false,
        contact: supplier.contact || '',
        phone: supplier.phone || '',
        ramal: supplier.ramal || '',
        email: supplier.email || '',
        site: supplier.site || '',
        street: supplier.street || '',
        number: supplier.number || '',
        complement: supplier.complement || '',
        district: supplier.district || '',
        zip: supplier.zip || '',
        city: supplier.city || '',
        state: supplier.state || '',
        cpf: supplier.cpf || '',
        rg: supplier.rg || '',
        cnpj: supplier.cnpj || '',
        ie: supplier.ie || '',
        im: supplier.im || '',
        notes: supplier.notes || '',
      });
    }
  }, [supplier]);

  const onSubmit = (data: SupplierForm) => {
    setError('');
    saveMutation.mutate(data);
  };

  if (isLoading && !isNew) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>;

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3, flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography variant="h4" fontWeight={700} sx={{ mb: 0.5 }}>{isNew ? 'Novo Fornecedor' : supplier?.name}</Typography>
          <Typography variant="body1" color="text.secondary">
            {isNew ? 'Cadastre um fornecedor' : `Código: ${supplier?.code || '—'}${supplier?.active === false ? ' · INATIVO' : ''}`}
          </Typography>
        </Box>
        {!isNew && (
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
            <FormControlLabel
              control={<Switch checked={supplier?.active !== false} onChange={() => toggleMutation.mutate()} />}
              label={supplier?.active !== false ? 'Ativo' : 'Inativo'}
            />
            <SecondaryButton onClick={() => navigate('/suppliers')}>Voltar</SecondaryButton>
            <DangerButton onClick={() => { if (window.confirm('Excluir fornecedor?')) deleteMutation.mutate(); }}>Excluir</DangerButton>
          </Box>
        )}
      </Box>

      {error && <Alert severity={error.includes('sucesso') ? 'success' : 'error'} sx={{ mb: 3 }} onClose={() => setError('')}>{error}</Alert>}

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
                <TextField fullWidth label="Nome *" {...register('name')} error={!!errors.name} helperText={errors.name?.message} placeholder="Razão social ou nome completo" />
              </Grid>
              <Grid item xs={12} sm={3}>
                <TextField fullWidth label="Contato (responsável)" {...register('contact')} />
              </Grid>

              {/* Contato */}
              <Grid item xs={12} sm={3}>
                <TextField fullWidth label="Telefone" {...register('phone')} placeholder="(00) 00000-0000" />
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
                    <TextField fullWidth label="CPF" {...register('cpf')} placeholder="000.000.000-00" />
                  </Grid>
                  <Grid item xs={12} sm={4}>
                    <TextField fullWidth label="RG" {...register('rg')} />
                  </Grid>
                </>
              ) : (
                <>
                  <Grid item xs={12} sm={4}>
                    <TextField fullWidth label="CNPJ" {...register('cnpj')} placeholder="00.000.000/0000-00" />
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
        <>
          <Tabs value={activeTab} onChange={(_, v) => setActiveTab(v)} sx={{ mb: 2 }}>
            <Tab label={`Compras (${supplier?._count?.purchases || 0})`} />
          </Tabs>

          {activeTab === 0 && (
            <Card>
              <TableContainer>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell>Código</TableCell>
                      <TableCell>Data</TableCell>
                      <TableCell>Itens</TableCell>
                      <TableCell>Pagamento</TableCell>
                      <TableCell>NF</TableCell>
                      <TableCell align="right">Total</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(supplier?.purchases || []).map((p: any) => (
                      <TableRow key={p.id} hover sx={{ cursor: 'pointer' }} onClick={() => navigate(`/purchases/${p.id}`)}>
                        <TableCell><Chip size="small" label={p.code || '—'} variant="outlined" /></TableCell>
                        <TableCell>{formatDate(p.purchaseDate)}</TableCell>
                        <TableCell>{p.items?.length || 0}</TableCell>
                        <TableCell>{p.paymentMethod || '-'}</TableCell>
                        <TableCell>{p.nfNumber || '-'}</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 500 }}>{formatCurrency(p.total)}</TableCell>
                      </TableRow>
                    ))}
                    {(supplier?.purchases || []).length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} align="center" sx={{ py: 5, color: 'text.secondary' }}>
                          Nenhuma compra registrada para este fornecedor.
                        </TableCell>
                      </TableRow>
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
