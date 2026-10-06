import { Box, Card, CardContent, Typography, Grid, Chip, IconButton, Button, Divider, TableContainer, Table, TableHead, TableBody, TableRow, TableCell, Alert, CircularProgress, Tabs, Tab } from '@mui/material';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { budgetsApi, serviceOrdersApi } from '../../services/api';
import { PrimaryButton, SecondaryButton, DangerButton } from '../../components/ui/Buttons';
import { BudgetStatusChip } from '../../components/ui/StatusChips';
import { BudgetStatus } from '../../types';
import { formatCurrency, formatDate } from '../../utils/formatters';
import { Edit, Delete, CheckCircle, ContentCopy, Visibility, Print, Download } from '@mui/icons-material';
import { Tooltip } from '@mui/material';

export function BudgetDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: budget, isLoading } = useQuery({
    queryKey: ['budget', id],
    queryFn: () => budgetsApi.get(id!),
  });

  const statusMutation = useMutation({
    mutationFn: (status: string) => budgetsApi.updateStatus(id!, status),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['budget', id] }),
  });

  const convertMutation = useMutation({
    mutationFn: (data: { technicianId?: string; warrantyDays?: number }) => budgetsApi.convertToOs(id!, data),
    onSuccess: (os) => { queryClient.invalidateQueries({ queryKey: ['budgets'] }); navigate(`/service-orders/${os.id}`); },
  });

  const deleteMutation = useMutation({
    mutationFn: () => budgetsApi.delete(id!),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['budgets'] }); navigate('/budgets'); },
  });

  if (isLoading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>;
  if (!budget) return <Alert severity="error">Orçamento não encontrado</Alert>;

  // Extract map results to a const (não colocar .map() direto no return — TS7)
  const itemRows = budget.items.map((item: any) => {
    // Comissão é dado interno: não aparece no orçamento (nem no PDF, que já
    // não trazia). Continua calculada e gravada — ver aba "Comissão".
    return (
      <TableRow key={item.id}>
        <TableCell><Chip label={item.type} size="small" color={item.type === 'PART' ? 'primary' : 'secondary'} /></TableCell>
        <TableCell>{item.name}</TableCell>
        <TableCell>{item.qty}</TableCell>
        <TableCell align="right">{formatCurrency(item.unitPrice)}</TableCell>
        <TableCell align="right" sx={{ fontWeight: 500 }}>{formatCurrency(item.total)}</TableCell>
      </TableRow>
    );
  });

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3, flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography variant="h4" fontWeight={700} sx={{ mb: 0.5 }}>Orçamento #{budget.id.slice(0,8).toUpperCase()}</Typography>
          <Typography variant="body1" color="text.secondary">Cliente: {budget.client?.name}</Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Tooltip title="Editar"><IconButton onClick={() => navigate(`/budgets/${id}/edit`)}><Edit fontSize="medium" /></IconButton></Tooltip>
          <Tooltip title="Duplicar"><IconButton onClick={() => navigate(`/budgets/new?copy=${id}`)}><ContentCopy fontSize="medium" /></IconButton></Tooltip>
          <Tooltip title="Imprimir PDF"><IconButton onClick={() => window.print()}><Print fontSize="medium" /></IconButton></Tooltip>
          {budget.status === 'DRAFT' && (
            <Tooltip title="Excluir"><IconButton color="error" onClick={() => { if(window.confirm('Excluir?')) deleteMutation.mutate(); }}><Delete fontSize="medium" /></IconButton></Tooltip>
          )}
        </Box>
      </Box>

      {/* Status e Totais */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} lg={3}>
          <Card>
            <CardContent>
              <Typography variant="caption" color="text.secondary">Status</Typography>
              <BudgetStatusChip status={budget.status as BudgetStatus} size="medium" sx={{ mt: 0.5 }} />
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} lg={3}>
          <Card>
            <CardContent>
              <Typography variant="caption" color="text.secondary">Total Peças</Typography>
              <Typography variant="h6" fontWeight={700}>{formatCurrency(budget.totalParts)}</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} lg={3}>
          <Card>
            <CardContent>
              <Typography variant="caption" color="text.secondary">Mão de Obra</Typography>
              <Typography variant="h6" fontWeight={700}>{formatCurrency(budget.totalLabor)}</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} lg={3}>
          <Card sx={{ backgroundColor: 'primary.light', color: 'primary.contrastText' }}>
            <CardContent>
              <Typography variant="caption">Total Geral</Typography>
              <Typography variant="h5" fontWeight={700}>{formatCurrency(budget.total)}</Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Ações de status */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 2 }}>Ações</Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {budget.status === 'DRAFT' && (
              <>
                <PrimaryButton startIcon={<CheckCircle />} onClick={() => statusMutation.mutate('SENT')}>Enviar ao Cliente</PrimaryButton>
                <DangerButton onClick={() => { if(window.confirm('Excluir orçamento?')) deleteMutation.mutate(); }}>Excluir</DangerButton>
              </>
            )}
            {budget.status === 'SENT' && (
              <>
                <PrimaryButton startIcon={<CheckCircle />} onClick={() => statusMutation.mutate('APPROVED')}>Aprovar</PrimaryButton>
                <SecondaryButton color="warning" onClick={() => statusMutation.mutate('REJECTED')}>Rejeitar</SecondaryButton>
              </>
            )}
            {budget.status === 'APPROVED' && !budget.serviceOrder && (
              <PrimaryButton startIcon={<CheckCircle />} onClick={() => convertMutation.mutate({ warrantyDays: 90 })}>
                Converter em OS
              </PrimaryButton>
            )}
            {budget.status === 'APPROVED' && budget.serviceOrder && (
              <SecondaryButton startIcon={<Visibility />} onClick={() => navigate(`/service-orders/${budget.serviceOrder.id}`)}>
                Ver OS Gerada
              </SecondaryButton>
            )}
          </Box>
        </CardContent>
      </Card>

      <Tabs value={0} sx={{ mb: 3 }}>
        <Tab label="Detalhes" />
        <Tab label="Itens" />
        <Tab label="Equipamentos" />
        <Tab label="Histórico" />
      </Tabs>

      {/* Detalhes */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} lg={8}>
          <Card>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 2 }}>Informações do Cliente</Typography>
              <Grid container spacing={2}>
                <Grid item xs={12} sm={6}>
                  <Typography variant="body2" color="text.secondary">Nome</Typography>
                  <Typography variant="body1" fontWeight={500}>{budget.client?.name}</Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography variant="body2" color="text.secondary">Telefone</Typography>
                  <Typography variant="body1" fontWeight={500}>{budget.client?.phone}</Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography variant="body2" color="text.secondary">Email</Typography>
                  <Typography variant="body1">{budget.client?.email || '-'}</Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography variant="body2" color="text.secondary">CPF</Typography>
                  <Typography variant="body1">{budget.client?.cpf || '-'}</Typography>
                </Grid>
                <Grid item xs={12}>
                  <Typography variant="body2" color="text.secondary">Endereço</Typography>
                  <Typography variant="body1">{budget.client?.address || '-'}</Typography>
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} lg={4}>
          <Card>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 2 }}>Dados do Orçamento</Typography>
              <Grid container spacing={2}>
                <Grid item xs={12}>
                  <Typography variant="body2" color="text.secondary">Criado por</Typography>
                  <Typography variant="body1">{budget.creator?.name}</Typography>
                </Grid>
                <Grid item xs={12}>
                  <Typography variant="body2" color="text.secondary">Data de Criação</Typography>
                  <Typography variant="body1">{formatDate(budget.createdAt)}</Typography>
                </Grid>
                <Grid item xs={12}>
                  <Typography variant="body2" color="text.secondary">Validade</Typography>
                  <Typography variant="body1">{budget.validUntil ? formatDate(budget.validUntil) : 'Não definida'}</Typography>
                </Grid>
                <Grid item xs={12}>
                  <Typography variant="body2" color="text.secondary">Mão de Obra</Typography>
                  <Typography variant="body1">{budget.laborHours}h × R$ {budget.laborRate.toFixed(2)}</Typography>
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Itens */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 2 }}>Itens do Orçamento</Typography>
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Tipo</TableCell>
                  <TableCell>Item</TableCell>
                  <TableCell>Qtd</TableCell>
                  <TableCell align="right">Valor Unit.</TableCell>
                  <TableCell align="right">Total</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {itemRows}
              </TableBody>
            </Table>
          </TableContainer>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 2, flexWrap: 'wrap', gap: 1 }}>
            <Typography variant="h6" fontWeight={700}>Total: {formatCurrency(budget.total)}</Typography>
          </Box>
        </CardContent>
      </Card>

      {/* Equipamentos */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 2 }}>Equipamentos</Typography>
          {budget.equipment.map((eq: any, i: number) => (
            <Box key={i} sx={{ borderBottom: 1, borderColor: 'divider', py: 2, last: { borderBottom: 0 } }}>
              <Grid container spacing={2}>
                <Grid item xs={12} sm={6}>
                  <Typography variant="subtitle1" fontWeight={500}>{eq.name}</Typography>
                  <Typography variant="body2" color="text.secondary">{eq.brand} {eq.model}</Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography variant="body2" color="text.secondary">Série: {eq.serial || 'Não informado'}</Typography>
                </Grid>
                <Grid item xs={12}>
                  <Typography variant="body2" color="text.secondary">Defeito: {budget.defect}</Typography>
                </Grid>
              </Grid>
            </Box>
          ))}
        </CardContent>
      </Card>

      {/* Observações */}
      {budget.notes && (
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Typography variant="h6" sx={{ mb: 1 }}>Observações</Typography>
            <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>{budget.notes}</Typography>
          </CardContent>
        </Card>
      )}
    </Box>
  );
}
