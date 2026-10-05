import { useEffect, useMemo, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, Grid, MenuItem,
  Switch, FormControlLabel, Typography,
} from '@mui/material';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { usersApi } from '../../services/api';
import FormErrors from '../../components/ui/FormErrors';
import { PrimaryButton, SecondaryButton } from '../../components/ui/Buttons';
import type { User } from '../../types';
import { ROLE_OPTIONS } from './employeeMeta';

// ---------------------------------------------------------------------------
// Esquema do cadastro de Funcionário/Parceiro (PDF p.4)
// ---------------------------------------------------------------------------
const employeeBaseSchema = z.object({
  code: z.string().optional(),
  name: z.string().min(2, 'Mínimo 2 caracteres'),
  email: z.string().email('Email inválido'),
  password: z.string().optional(),
  role: z.enum(['ADMIN', 'TECHNICIAN', 'RECEPTIONIST']),
  active: z.boolean(),
  docType: z.enum(['PF', 'PJ']),
  phone: z.string().optional(),
  ramal: z.string().optional(),
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
  commissionPercent: z.string().optional(),
});

type EmployeeFormValues = z.infer<typeof employeeBaseSchema>;

function toFormValues(user?: User | null): EmployeeFormValues {
  return {
    code: user?.code || '',
    name: user?.name || '',
    email: user?.email || '',
    password: '',
    role: (user?.role || 'TECHNICIAN') as EmployeeFormValues['role'],
    active: user ? user.active !== false : true,
    docType: user?.cnpj ? 'PJ' : 'PF',
    phone: user?.phone || '',
    ramal: user?.ramal || '',
    site: user?.site || '',
    street: user?.street || '',
    number: user?.number || '',
    complement: user?.complement || '',
    district: user?.district || '',
    zip: user?.zip || '',
    city: user?.city || '',
    state: user?.state || '',
    cpf: user?.cpf || '',
    rg: user?.rg || '',
    cnpj: user?.cnpj || '',
    ie: user?.ie || '',
    im: user?.im || '',
    notes: user?.notes || '',
    commissionPercent: user?.commissionPercent != null ? String(user.commissionPercent) : '',
  };
}

/** Aceita '12,5' ou '12.5'; devolve null quando vazio/inválido. */
function parsePercent(raw?: string): number | null {
  if (!raw) return null;
  const value = Number(String(raw).replace(',', '.'));
  return Number.isNaN(value) ? null : value;
}

export interface EmployeeFormDialogProps {
  open: boolean;
  employee?: User | null;
  onClose: () => void;
  onSaved?: (user: any) => void;
}

/** Diálogo compartilhado de criação/edição de Funcionário/Parceiro. */
export function EmployeeFormDialog({ open, employee, onClose, onSaved }: EmployeeFormDialogProps) {
  const isNew = !employee;
  const queryClient = useQueryClient();
  const [apiError, setApiError] = useState<any>(null);

  const schema = useMemo(
    () =>
      employeeBaseSchema.superRefine((value, ctx) => {
        if (isNew && (!value.password || value.password.length < 6)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['password'],
            message: 'A senha deve ter no mínimo 6 caracteres',
          });
        }
      }),
    [isNew]
  );

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors },
  } = useForm<EmployeeFormValues>({
    resolver: zodResolver(schema),
    defaultValues: toFormValues(employee),
  });

  // Dependência apenas de `open`: ao refazer o fetch do registro (react-query)
  // o objeto `employee` muda de identidade e um reset apagaria o digitado.
  useEffect(() => {
    if (open) {
      setApiError(null);
      reset(toFormValues(employee));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const saveMutation = useMutation({
    mutationFn: (payload: Record<string, any>) =>
      isNew ? usersApi.create(payload) : usersApi.update(employee!.id, payload),
    onSuccess: (saved: any) => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      queryClient.invalidateQueries({ queryKey: ['users-all'] });
      queryClient.invalidateQueries({ queryKey: ['technicians'] });
      if (!isNew) queryClient.invalidateQueries({ queryKey: ['employee', employee!.id] });
      if (onSaved) onSaved(saved);
      onClose();
    },
    onError: (err: any) => setApiError(err),
  });

  const handleClose = () => {
    if (!saveMutation.isPending) onClose();
  };

  const onSubmit = (data: EmployeeFormValues) => {
    setApiError(null);
    const payload: Record<string, any> = {
      code: data.code || undefined,
      name: data.name,
      email: data.email,
      role: data.role,
      active: data.active,
      phone: data.phone || null,
      ramal: data.ramal || null,
      site: data.site || null,
      street: data.street || null,
      number: data.number || null,
      complement: data.complement || null,
      district: data.district || null,
      zip: data.zip || null,
      city: data.city || null,
      state: data.state ? data.state.toUpperCase() : null,
      cpf: data.cpf || null,
      rg: data.rg || null,
      cnpj: data.cnpj || null,
      ie: data.ie || null,
      im: data.im || null,
      notes: data.notes || null,
      commissionPercent: parsePercent(data.commissionPercent),
    };
    if (data.password) payload.password = data.password;
    saveMutation.mutate(payload);
  };

  // Erros locais (zod/react-hook-form) formatados para o componente FormErrors
  const localFields: Record<string, string> = {};
  Object.entries(errors).forEach(([field, info]: [string, any]) => {
    localFields[field] = info?.message || 'Campo inválido';
  });

  const role = watch('role');
  const active = watch('active');
  const docType = watch('docType');

  const roleMenuItems = ROLE_OPTIONS.map((option) => (
    <MenuItem key={option.value} value={option.value}>
      {option.label}
    </MenuItem>
  ));

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="md" scroll="paper">
      <DialogTitle fontWeight={700}>
        {isNew ? 'Novo Funcionário / Parceiro' : `Editar Funcionário — ${employee?.name || ''}`}
      </DialogTitle>
      <form onSubmit={handleSubmit(onSubmit)}>
        <DialogContent dividers>
          <FormErrors
            error={apiError}
            localFields={localFields}
            onClose={() => setApiError(null)}
            title={isNew ? 'Não foi possível cadastrar' : 'Não foi possível salvar'}
          />

          <Grid container spacing={2}>
            {/* Identificação */}
            <Grid item xs={12}>
              <Typography variant="subtitle2" color="text.secondary">Identificação</Typography>
            </Grid>
            <Grid item xs={12} sm={3}>
              <TextField
                fullWidth
                label="Código"
                {...register('code')}
                InputProps={{ readOnly: true }}
                helperText="Gerado automaticamente pelo sistema"
              />
            </Grid>
            <Grid item xs={12} sm={5}>
              <TextField
                fullWidth
                label="Nome *"
                {...register('name')}
                error={!!errors.name}
                helperText={errors.name?.message}
                placeholder="Nome completo ou razão social"
              />
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField
                fullWidth
                label="Email *"
                type="email"
                {...register('email')}
                error={!!errors.email}
                helperText={errors.email?.message}
              />
            </Grid>
            {isNew ? (
              <Grid item xs={12} sm={4}>
                <TextField
                  fullWidth
                  label="Senha *"
                  type="password"
                  {...register('password')}
                  error={!!errors.password}
                  helperText={errors.password?.message || 'Mínimo 6 caracteres'}
                  autoComplete="new-password"
                />
              </Grid>
            ) : null}
            <Grid item xs={12} sm={isNew ? 4 : 6}>
              <TextField
                select
                fullWidth
                label="Cargo *"
                value={role}
                onChange={(e) => setValue('role', e.target.value as EmployeeFormValues['role'])}
              >
                {roleMenuItems}
              </TextField>
            </Grid>
            <Grid item xs={12} sm={isNew ? 4 : 6} sx={{ display: 'flex', alignItems: 'center' }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={active}
                    onChange={(e) => setValue('active', e.target.checked)}
                  />
                }
                label={active ? 'Ativo' : 'Inativo'}
              />
            </Grid>

            {/* Documentos */}
            <Grid item xs={12} sx={{ mt: 1 }}>
              <Typography variant="subtitle2" color="text.secondary">Documentos</Typography>
            </Grid>
            <Grid item xs={12} sm={3}>
              <TextField
                select
                fullWidth
                label="Classificação"
                value={docType}
                onChange={(e) => setValue('docType', e.target.value as 'PF' | 'PJ')}
              >
                <MenuItem value="PF">Pessoa Física</MenuItem>
                <MenuItem value="PJ">Pessoa Jurídica</MenuItem>
              </TextField>
            </Grid>
            {docType === 'PF' ? (
              <>
                <Grid item xs={12} sm={4}>
                  <TextField fullWidth label="CPF" {...register('cpf')} placeholder="000.000.000-00" error={!!errors.cpf} helperText={errors.cpf?.message} />
                </Grid>
                <Grid item xs={12} sm={4}>
                  <TextField fullWidth label="RG" {...register('rg')} error={!!errors.rg} helperText={errors.rg?.message} />
                </Grid>
              </>
            ) : (
              <>
                <Grid item xs={12} sm={4}>
                  <TextField fullWidth label="CNPJ" {...register('cnpj')} placeholder="00.000.000/0000-00" error={!!errors.cnpj} helperText={errors.cnpj?.message} />
                </Grid>
                <Grid item xs={12} sm={3}>
                  <TextField fullWidth label="Inscrição Estadual" {...register('ie')} />
                </Grid>
                <Grid item xs={12} sm={3}>
                  <TextField fullWidth label="Inscrição Municipal" {...register('im')} />
                </Grid>
              </>
            )}

            {/* Endereço */}
            <Grid item xs={12} sx={{ mt: 1 }}>
              <Typography variant="subtitle2" color="text.secondary">Endereço</Typography>
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

            {/* Contato */}
            <Grid item xs={12} sx={{ mt: 1 }}>
              <Typography variant="subtitle2" color="text.secondary">Contato</Typography>
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField fullWidth label="Telefone" {...register('phone')} placeholder="(00) 00000-0000" />
            </Grid>
            <Grid item xs={12} sm={2}>
              <TextField fullWidth label="Ramal" {...register('ramal')} />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField fullWidth label="Site" {...register('site')} placeholder="https://" />
            </Grid>

            {/* Comissão */}
            <Grid item xs={12} sx={{ mt: 1 }}>
              <Typography variant="subtitle2" color="text.secondary">Comissão</Typography>
            </Grid>
            <Grid item xs={12} sm={3}>
              <TextField
                fullWidth
                label="Comissão (%)"
                {...register('commissionPercent')}
                type="number"
                inputProps={{ min: 0, max: 100, step: 0.01 }}
                error={!!errors.commissionPercent}
                helperText={errors.commissionPercent?.message || 'Percentual sobre vendas'}
              />
            </Grid>

            {/* Observações */}
            <Grid item xs={12} sx={{ mt: 1 }}>
              <Typography variant="subtitle2" color="text.secondary">Observações</Typography>
            </Grid>
            <Grid item xs={12}>
              <TextField fullWidth label="Observações" multiline rows={3} {...register('notes')} />
            </Grid>
          </Grid>
        </DialogContent>

        <DialogActions>
          <SecondaryButton type="button" onClick={handleClose} disabled={saveMutation.isPending}>
            Cancelar
          </SecondaryButton>
          <PrimaryButton type="submit" loading={saveMutation.isPending}>
            {isNew ? 'Cadastrar' : 'Salvar'}
          </PrimaryButton>
        </DialogActions>
      </form>
    </Dialog>
  );
}

export default EmployeeFormDialog;
