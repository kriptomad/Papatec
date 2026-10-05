import { Box, Grid, Card, CardContent, Typography, Chip, CircularProgress, Alert } from '@mui/material';
import { Assignment, Build, People, Inventory, TrendingUp, Warning } from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import { budgetsApi, serviceOrdersApi, clientsApi, inventoryApi } from '../services/api';
import { formatCurrency } from '../utils/formatters';
import { BudgetStatus, OSStatus } from '../types';
import { BudgetStatusChip, OSStatusChip } from '../components/ui/StatusChips';
import { PrimaryButton } from '../components/ui/Buttons';

const statCards = [
  { title: 'Orçamentos (30d)', icon: <Assignment />, color: 'primary', key: 'budgets' },
  { title: 'OS Entregues (30d)', icon: <Build />, color: 'success', key: 'osDelivered' },
  { title: 'Clientes Ativos', icon: <People />, color: 'info', key: 'activeClients' },
  { title: 'Peças c/ Estoque Baixo', icon: <Inventory />, color: 'warning', key: 'lowStock' },
];

export function DashboardPage() {
  const { data: budgetsStats, isLoading: loadingBudgets } = useQuery({
    queryKey: ['budgetsStats'],
    queryFn: () => budgetsApi.getStats(),
  });
  const { data: osStats, isLoading: loadingOS } = useQuery({
    queryKey: ['osStats'],
    queryFn: () => serviceOrdersApi.getStats(),
  });
  const { data: clientsData } = useQuery({
    queryKey: ['activeClients'],
    queryFn: () => clientsApi.list({ hasActiveOs: true, limit: 1 }),
  });
  const { data: inventoryStats } = useQuery({
    queryKey: ['inventoryStats'],
    queryFn: () => inventoryApi.getStats(),
  });
  const { data: lowStock } = useQuery({
    queryKey: ['lowStock'],
    queryFn: () => inventoryApi.getLowStock(),
  });

  const loading = loadingBudgets || loadingOS;

  const stats = [
    { value: budgetsStats?.last30Days?.count || 0, subtitle: `${formatCurrency(budgetsStats?.last30Days?.total || 0)} em orçamentos` },
    { value: osStats?.delivered?.count || 0, subtitle: `${formatCurrency(osStats?.delivered?.total || 0)} faturado` },
    { value: clientsData?.total || 0, subtitle: 'Com OS ativa' },
    { value: inventoryStats?.lowStock || 0, subtitle: 'Precisam reposição' },
  ];

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '400px' }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" fontWeight={700} sx={{ mb: 0.5 }}>Dashboard</Typography>
        <Typography variant="body1" color="text.secondary">Visão geral da assistência técnica</Typography>
      </Box>

      {/* Cards de estatísticas */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        {statCards.map((item, index) => (
          <Grid item xs={12} sm={6} lg={3} key={item.key}>
            <Card sx={{ height: '100%' }}>
              <CardContent>
                <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                  <Box>
                    <Typography variant="h3" fontWeight={700} sx={{ mb: 0.5 }}>{stats[index].value}</Typography>
                    <Typography variant="body2" color="text.secondary">{stats[index].subtitle}</Typography>
                  </Box>
                  <Box sx={{ p: 1, borderRadius: 2, backgroundColor: `${item.color}.light`, color: `${item.color}.main` }}>
                    {item.icon}
                  </Box>
                </Box>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                  {item.title}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      {/* Alertas */}
      {(lowStock?.length || 0) > 0 && (
        <Alert severity="warning" sx={{ mb: 3 }} icon={<Warning />}>
          <strong>{lowStock.length} peça(s) com estoque abaixo do mínimo!</strong>
          <Box sx={{ mt: 1, display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {lowStock.slice(0, 5).map((part: any) => (
              <Chip key={part.id} label={`${part.name} (${part.quantity}/${part.minStock})`} size="small" variant="outlined" color="warning" />
            ))}
            {lowStock.length > 5 && <Chip label={`+${lowStock.length - 5} mais...`} size="small" variant="outlined" />}
          </Box>
        </Alert>
      )}

      {/* Status de Orçamentos */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} lg={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" fontWeight={600} sx={{ mb: 2 }}>Orçamentos por Status</Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {Object.entries((budgetsStats?.byStatus || {}) as Record<string, number>).map(([status, count]) => (
                  <Box key={status} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <BudgetStatusChip status={status as BudgetStatus} />
                    <Typography variant="body2" fontWeight={500}>{count}</Typography>
                  </Box>
                ))}
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Status de OS */}
        <Grid item xs={12} lg={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" fontWeight={600} sx={{ mb: 2 }}>OS por Status</Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {Object.entries((osStats?.byStatus || {}) as Record<string, number>).map(([status, count]) => (
                  <Box key={status} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <OSStatusChip status={status as OSStatus} />
                    <Typography variant="body2" fontWeight={500}>{count}</Typography>
                  </Box>
                ))}
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Ações rápidas */}
      <Card>
        <CardContent>
          <Typography variant="h6" fontWeight={600} sx={{ mb: 2 }}>Ações Rápidas</Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
            <PrimaryButton startIcon={<Assignment />} href="/budgets/new">Novo Orçamento</PrimaryButton>
            <PrimaryButton startIcon={<Build />} href="/service-orders/new">Nova OS</PrimaryButton>
            <PrimaryButton startIcon={<People />} href="/clients/new">Novo Cliente</PrimaryButton>
            <PrimaryButton startIcon={<Inventory />} href="/inventory/new">Nova Peça</PrimaryButton>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}