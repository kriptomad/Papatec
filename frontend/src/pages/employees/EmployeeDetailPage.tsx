import { Box, Grid, Card, CardContent, Typography, Chip, CircularProgress, Avatar, Switch, FormControlLabel, Alert } from '@mui/material';
import { Edit, ArrowBack } from '@mui/icons-material';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usersApi } from '../../services/api';
import FormErrors from '../../components/ui/FormErrors';
import { PrimaryButton, SecondaryButton, DangerButton } from '../../components/ui/Buttons';
import EmployeeFormDialog from './EmployeeFormDialog';
import { ROLE_COLORS, roleLabel, display } from './employeeMeta';
import { formatCpf, formatCnpj, formatDate, formatPhone, getInitials } from '../../utils/formatters';

/** Rótulo + valor formatado (seções de leitura). */
function InfoItem({ label, value }: { label: string; value?: ReactNode }) {
  return (
    <Box sx={{ mb: 1.5 }}>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.25 }}>
        {label}
      </Typography>
      <Typography variant="body1" fontWeight={500}>{value !== undefined && value !== null && value !== '' ? value : '—'}</Typography>
    </Box>
  );
}

/** Cabeçalho de seção dentro dos cards. */
function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 2 }}>
      {children}
    </Typography>
  );
}

export function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [feedback, setFeedback] = useState<{ severity: 'success' | 'error'; text: string } | null>(null);

  const { data: user, isLoading, error: loadError } = useQuery({
    queryKey: ['employee', id],
    queryFn: () => usersApi.get(id!),
    enabled: !!id,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['employee', id] });
    queryClient.invalidateQueries({ queryKey: ['users'] });
    queryClient.invalidateQueries({ queryKey: ['users-all'] });
    queryClient.invalidateQueries({ queryKey: ['technicians'] });
  };

  const toggleMutation = useMutation({
    mutationFn: () => usersApi.toggleActive(id!),
    onSuccess: (updated: any) => {
      invalidate();
      setFeedback({
        severity: 'success',
        text: updated?.active ? 'Funcionário ativado com sucesso.' : 'Funcionário desativado com sucesso.',
      });
    },
    onError: (err: any) =>
      setFeedback({ severity: 'error', text: err?.response?.data?.message || 'Erro ao alterar o status do funcionário' }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => usersApi.delete(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      queryClient.invalidateQueries({ queryKey: ['users-all'] });
      navigate('/employees');
    },
    onError: (err: any) =>
      setFeedback({ severity: 'error', text: err?.response?.data?.message || 'Erro ao excluir o funcionário' }),
  });

  if (isLoading) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>;
  }

  if (loadError || !user) {
    return (
      <Box>
        <FormErrors error={loadError || 'Funcionário não encontrado.'} title="Erro ao carregar" />
        <SecondaryButton startIcon={<ArrowBack />} onClick={() => navigate('/employees')}>
          Voltar para Funcionários
        </SecondaryButton>
      </Box>
    );
  }

  // -------------------------------------------------------------------------
  // Dados derivados (formatados) — todos antes do return
  // -------------------------------------------------------------------------
  const isPJ = !!user.cnpj;
  const addressLine = [display(user.street), user.number ? `nº ${user.number}` : '', display(user.complement)]
    .filter((part) => part && part !== '—')
    .join(', ');
  const cityState = [user.city, user.state].filter(Boolean).join(' / ');

  const feedbackAlert = feedback ? (
    <Alert severity={feedback.severity} sx={{ mb: 3 }} onClose={() => setFeedback(null)}>
      {feedback.text}
    </Alert>
  ) : null;

  return (
    <Box>
      {/* Cabeçalho */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3, flexWrap: 'wrap', gap: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Avatar sx={{ width: 64, height: 64, bgcolor: 'primary.main', fontSize: 26, fontWeight: 700 }}>
            {getInitials(user.name || '?')}
          </Avatar>
          <Box>
            <Typography variant="h4" fontWeight={700} sx={{ mb: 0.5 }}>{user.name}</Typography>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
              <Chip size="small" variant="outlined" label={roleLabel(user.role)} color={ROLE_COLORS[user.role] || 'default'} />
              <Chip
                size="small"
                variant="outlined"
                label={user.active !== false ? 'Ativo' : 'Inativo'}
                color={user.active !== false ? 'success' : 'default'}
              />
              <Typography variant="body2" color="text.secondary">
                Código {user.code || '—'} · {user.email}
              </Typography>
            </Box>
          </Box>
        </Box>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          <FormControlLabel
            control={
              <Switch
                checked={user.active !== false}
                onChange={() => toggleMutation.mutate()}
                disabled={toggleMutation.isPending}
              />
            }
            label={user.active !== false ? 'Ativo' : 'Inativo'}
          />
          <SecondaryButton startIcon={<ArrowBack />} onClick={() => navigate('/employees')}>Voltar</SecondaryButton>
          <PrimaryButton startIcon={<Edit />} onClick={() => setFormOpen(true)}>Editar</PrimaryButton>
          <DangerButton
            onClick={() => {
              if (window.confirm(`Excluir o funcionário "${user.name}"? Esta ação não pode ser desfeita.`)) {
                deleteMutation.mutate();
              }
            }}
          >
            Excluir
          </DangerButton>
        </Box>
      </Box>

      {feedbackAlert}

      <Grid container spacing={3}>
        {/* Resumo */}
        <Grid item xs={12}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <SectionTitle>Resumo</SectionTitle>
              <Grid container spacing={2}>
                <Grid item xs={6} sm={3}>
                  <InfoItem
                    label="Comissão"
                    value={user.commissionPercent != null ? `${user.commissionPercent}%` : '—'}
                  />
                </Grid>
                <Grid item xs={6} sm={3}>
                  <InfoItem label="Cargo" value={roleLabel(user.role)} />
                </Grid>
                <Grid item xs={6} sm={3}>
                  <InfoItem label="Vínculo desde" value={user.createdAt ? formatDate(user.createdAt) : '—'} />
                </Grid>
                <Grid item xs={6} sm={3}>
                  <InfoItem label="Última atualização" value={user.updatedAt ? formatDate(user.updatedAt) : '—'} />
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        </Grid>

        {/* Dados pessoais */}
        <Grid item xs={12} md={4}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <SectionTitle>Dados Pessoais</SectionTitle>
              <InfoItem label="Nome" value={user.name} />
              <InfoItem label="Email" value={user.email} />
              <InfoItem label="Cargo" value={roleLabel(user.role)} />
              <InfoItem label="Código" value={user.code} />
              <InfoItem
                label="Status"
                value={
                  <Chip
                    size="small"
                    variant="outlined"
                    label={user.active !== false ? 'Ativo' : 'Inativo'}
                    color={user.active !== false ? 'success' : 'default'}
                  />
                }
              />
            </CardContent>
          </Card>
        </Grid>

        {/* Documentos */}
        <Grid item xs={12} md={4}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <SectionTitle>Documentos — {isPJ ? 'Pessoa Jurídica' : 'Pessoa Física'}</SectionTitle>
              {isPJ ? (
                <>
                  <InfoItem label="CNPJ" value={user.cnpj ? formatCnpj(user.cnpj) : '—'} />
                  <InfoItem label="Inscrição Estadual" value={user.ie} />
                  <InfoItem label="Inscrição Municipal" value={user.im} />
                </>
              ) : (
                <>
                  <InfoItem label="CPF" value={user.cpf ? formatCpf(user.cpf) : '—'} />
                  <InfoItem label="RG" value={user.rg} />
                </>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Contato */}
        <Grid item xs={12} md={4}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <SectionTitle>Contato</SectionTitle>
              <InfoItem label="Telefone" value={user.phone ? formatPhone(user.phone) : '—'} />
              <InfoItem label="Ramal" value={user.ramal} />
              <InfoItem label="Site" value={user.site} />
            </CardContent>
          </Card>
        </Grid>

        {/* Endereço */}
        <Grid item xs={12} md={6}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <SectionTitle>Endereço</SectionTitle>
              <InfoItem label="Logradouro" value={addressLine || '—'} />
              <InfoItem label="Bairro" value={user.district} />
              <InfoItem label="CEP" value={user.zip} />
              <InfoItem label="Cidade / UF" value={cityState || '—'} />
            </CardContent>
          </Card>
        </Grid>

        {/* Observações */}
        <Grid item xs={12} md={6}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <SectionTitle>Observações</SectionTitle>
              <Typography
                variant="body2"
                color={user.notes ? 'text.primary' : 'text.secondary'}
                sx={{ whiteSpace: 'pre-wrap' }}
              >
                {user.notes || 'Nenhuma observação registrada.'}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {formOpen && (
        <EmployeeFormDialog
          open={formOpen}
          employee={user}
          onClose={() => setFormOpen(false)}
          onSaved={() => setFeedback({ severity: 'success', text: 'Dados atualizados com sucesso!' })}
        />
      )}
    </Box>
  );
}

export default EmployeeDetailPage;
