import { Box, Grid, Card, CardContent, Typography, CircularProgress, Table, TableHead, TableBody, TableRow, TableCell, TableContainer, Chip, MenuItem, TextField } from '@mui/material';
import type { ChipProps } from '@mui/material';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { reportsApi } from '../../services/api';
import FormErrors from '../../components/ui/FormErrors';
import { formatCurrency, formatDate } from '../../utils/formatters';
import { AttachMoney, TrendingUp, Inventory, Layers, AssignmentTurnedIn, Payments, CallReceived, CallMade, SwapVert } from '@mui/icons-material';

// ---------------------------------------------------------------------------
// Formatos de resposta (envelope já desembrulhado pelo helper `get`)
// ---------------------------------------------------------------------------
interface ValuationReport {
  totalItems: number;
  costValue: number;
  saleValue: number;
  potentialProfit: number;
  byCategory: Record<string, { items: number; costValue: number; saleValue: number; profit: number }>;
  lowStockItems: number;
  outOfStockItems: number;
}

interface PnlMonth {
  year: number;
  month: number;
  revenue: { parts: number; services: number; labor: number; total: number };
  costs: { parts: number; expenses: number; total: number };
  profit: { gross: number; net: number; margin: number };
  ordersCount: number;
  avgTicket: number;
}

interface YearlyReport {
  year: number;
  monthly: Array<{ month: number; revenue: number; costs: number; profit: number; margin: number; orders: number }>;
  totals: { revenue: number; costs: number; profit: number; orders: number };
}

interface MovementsReport {
  year: number;
  month: number;
  entries: { count: number; qty: number; costValue: number };
  exits: { count: number; qty: number; costValue: number };
  adjustments: { count: number; qty: number };
  movements: any[];
}

interface TopEntry {
  id?: string | null;
  name: string;
  sku?: string;
  category?: string;
  quantitySold: number;
  revenue: number;
  profit?: number;
}

const MONTH_SHORT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const MONTH_FULL = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

const MOVEMENT_TYPE: Record<string, { label: string; color: ChipProps['color'] }> = {
  IN: { label: 'Entrada', color: 'success' },
  OUT: { label: 'Saída', color: 'error' },
  ADJUSTMENT: { label: 'Ajuste', color: 'warning' },
};

// ---------------------------------------------------------------------------
// Componentes locais (mapas sempre extraídos antes do return)
// ---------------------------------------------------------------------------
interface ReportColumn {
  header: string;
  width?: number;
  align?: 'left' | 'right' | 'center';
  render: (row: any, index: number) => ReactNode;
}

function ReportTable({ columns, rows, emptyText }: { columns: ReportColumn[]; rows: any[]; emptyText: string }) {
  const headerCells = columns.map((col) => (
    <TableCell key={col.header} align={col.align} style={{ width: col.width }}>
      {col.header}
    </TableCell>
  ));
  const bodyRows = rows.map((row, index) => (
    <TableRow key={row.id || row.name || index} hover>
      {columns.map((col) => (
        <TableCell key={col.header} align={col.align}>
          {col.render(row, index)}
        </TableCell>
      ))}
    </TableRow>
  ));
  const emptyRow = rows.length === 0 ? (
    <TableRow>
      <TableCell colSpan={columns.length} align="center" sx={{ py: 5, color: 'text.secondary' }}>
        {emptyText}
      </TableCell>
    </TableRow>
  ) : null;

  return (
    <TableContainer>
      <Table>
        <TableHead>
          <TableRow>{headerCells}</TableRow>
        </TableHead>
        <TableBody>
          {bodyRows}
          {emptyRow}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function StatCard({ title, value, subtitle, icon, color }: {
  title: string;
  value: ReactNode;
  subtitle?: string;
  icon?: ReactNode;
  color?: string;
}) {
  return (
    <Card sx={{ height: '100%' }}>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h5" fontWeight={700} sx={{ mb: 0.5 }}>{value}</Typography>
            <Typography variant="body2" color="text.secondary">{subtitle}</Typography>
          </Box>
          {icon ? (
            <Box
              sx={{
                p: 1,
                borderRadius: 2,
                flexShrink: 0,
                backgroundColor: `${color || 'primary'}.light`,
                color: `${color || 'primary'}.main`,
              }}
            >
              {icon}
            </Box>
          ) : null}
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          {title}
        </Typography>
      </CardContent>
    </Card>
  );
}

const loadingBox = (
  <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
    <CircularProgress />
  </Box>
);

// ---------------------------------------------------------------------------
// Tela
// ---------------------------------------------------------------------------
export function ReportsPage() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [month, setMonth] = useState(new Date().getMonth() + 1);

  const valuationQ = useQuery({
    queryKey: ['reports-inventory-valuation'],
    queryFn: () => reportsApi.inventoryValuation() as Promise<ValuationReport>,
  });

  // 12 chamadas (uma por mês) montam a tabela mensal do ano selecionado
  const pnlQ = useQuery({
    queryKey: ['reports-profit-loss-months', year],
    queryFn: async () => {
      const results = await Promise.all(
        Array.from({ length: 12 }, (_unused, index) => reportsApi.profitLossMonthly({ year, month: index + 1 }))
      );
      return results as PnlMonth[];
    },
  });

  const yearlyQ = useQuery({
    queryKey: ['reports-profit-loss-yearly', year],
    queryFn: () => reportsApi.profitLossYearly({ year }) as Promise<YearlyReport>,
  });

  const movementsQ = useQuery({
    queryKey: ['reports-movements-monthly', year, month],
    queryFn: () => reportsApi.monthlyMovements({ year, month }) as Promise<MovementsReport>,
  });

  const topItemsQ = useQuery({
    queryKey: ['reports-top-items'],
    queryFn: () => reportsApi.topItems({ limit: 10 }) as Promise<TopEntry[]>,
  });

  const topServicesQ = useQuery({
    queryKey: ['reports-top-services'],
    queryFn: () => reportsApi.topServices({ limit: 10 }) as Promise<TopEntry[]>,
  });

  const allLoading =
    valuationQ.isLoading && pnlQ.isLoading && yearlyQ.isLoading &&
    movementsQ.isLoading && topItemsQ.isLoading && topServicesQ.isLoading;

  if (allLoading) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;
  }

  // -------------------------------------------------------------------------
  // Dados derivados (todos antes do return)
  // -------------------------------------------------------------------------
  const valuation = valuationQ.data;
  const pnlMonths = pnlQ.data || [];
  const yearly = yearlyQ.data;
  const movements = movementsQ.data;
  const topItems = topItemsQ.data || [];
  const topServices = topServicesQ.data || [];

  const yearMenuItems = Array.from({ length: 5 }, (_unused, index) => currentYear - index).map((option) => (
    <MenuItem key={option} value={option}>{option}</MenuItem>
  ));
  const monthMenuItems = MONTH_FULL.map((label, index) => (
    <MenuItem key={index + 1} value={index + 1}>{label}</MenuItem>
  ));

  const errorSources: Array<[string, any]> = [
    ['Valoração do estoque', valuationQ.error],
    ['Lucro/Prejuízo mensal', pnlQ.error],
    ['Lucro/Prejuízo anual', yearlyQ.error],
    ['Movimentos mensais', movementsQ.error],
    ['Top itens', topItemsQ.error],
    ['Top serviços', topServicesQ.error],
  ];
  const errorAlerts = errorSources
    .filter((entry) => !!entry[1])
    .map(([title, err]) => <FormErrors key={title} error={err} title={`Erro ao carregar: ${title}`} />);

  // --- Valoração do estoque -------------------------------------------------
  const valuationStats = [
    { key: 'cost', title: 'Valor de custo', value: formatCurrency(valuation?.costValue), subtitle: 'Estoque pelo preço de custo', icon: <Inventory />, color: 'info' },
    { key: 'sale', title: 'Valor de venda', value: formatCurrency(valuation?.saleValue), subtitle: 'Soma dos preços de venda', icon: <AttachMoney />, color: 'primary' },
    { key: 'profit', title: 'Lucro potencial', value: formatCurrency(valuation?.potentialProfit), subtitle: 'Venda − custo', icon: <TrendingUp />, color: 'success' },
    {
      key: 'items',
      title: 'Unidades em estoque',
      value: valuation?.totalItems ?? 0,
      subtitle: `${valuation?.lowStockItems ?? 0} em estoque baixo · ${valuation?.outOfStockItems ?? 0} sem estoque`,
      icon: <Layers />,
      color: 'warning',
    },
  ];
  const valuationCards = valuationStats.map((item) => (
    <Grid item xs={12} sm={6} lg={3} key={item.key}>
      <StatCard title={item.title} value={item.value} subtitle={item.subtitle} icon={item.icon} color={item.color} />
    </Grid>
  ));

  const categoryRows = Object.entries(valuation?.byCategory || {})
    .map(([name, data]) => ({ name, ...data }))
    .sort((a, b) => (b.saleValue || 0) - (a.saleValue || 0));
  const categoryColumns: ReportColumn[] = [
    { header: 'Categoria', render: (row) => row.name },
    { header: 'Unidades', width: 110, align: 'right', render: (row) => row.items ?? 0 },
    { header: 'Valor de custo', width: 150, align: 'right', render: (row) => formatCurrency(row.costValue) },
    { header: 'Valor de venda', width: 150, align: 'right', render: (row) => formatCurrency(row.saleValue) },
    {
      header: 'Lucro potencial',
      width: 150,
      align: 'right',
      render: (row) => (
        <Typography variant="body2" fontWeight={600} color={row.profit >= 0 ? 'success.main' : 'error.main'}>
          {formatCurrency(row.profit)}
        </Typography>
      ),
    },
  ];

  // --- Lucro/Prejuízo mensal ------------------------------------------------
  const pnlRows = pnlMonths.map((entry, index) => ({
    month: index + 1,
    label: MONTH_SHORT[index] || `M${index + 1}`,
    revenue: entry?.revenue?.total || 0,
    costs: entry?.costs?.total || 0,
    profit: entry?.profit?.net || 0,
    margin: entry?.profit?.margin || 0,
    orders: entry?.ordersCount || 0,
  }));
  const maxRevenue = Math.max(1, ...pnlRows.map((row) => row.revenue));
  const pnlColumns: ReportColumn[] = [
    { header: 'Mês', width: 90, render: (row) => row.label },
    { header: 'Receita', width: 140, align: 'right', render: (row) => formatCurrency(row.revenue) },
    { header: 'Custos', width: 140, align: 'right', render: (row) => formatCurrency(row.costs) },
    {
      header: 'Lucro / (Prejuízo)',
      width: 160,
      align: 'right',
      render: (row) => (
        <Typography variant="body2" fontWeight={600} color={row.profit >= 0 ? 'success.main' : 'error.main'}>
          {formatCurrency(row.profit)}
        </Typography>
      ),
    },
    { header: 'Margem', width: 90, align: 'right', render: (row) => `${Number(row.margin).toFixed(1)}%` },
    { header: 'O.S.', width: 70, align: 'right', render: (row) => row.orders },
    {
      header: 'Receita (barra)',
      width: 220,
      render: (row) => (
        <Box sx={{ height: 10, borderRadius: 1, bgcolor: 'grey.200', overflow: 'hidden' }}>
          <Box
            sx={{
              height: '100%',
              width: `${Math.min(100, Math.max(0, (row.revenue / maxRevenue) * 100))}%`,
              bgcolor: row.profit >= 0 ? 'primary.main' : 'error.main',
            }}
          />
        </Box>
      ),
    },
  ];

  // --- Resumo anual ---------------------------------------------------------
  const totals = yearly?.totals;
  const annualMargin = totals && totals.revenue > 0 ? (totals.profit / totals.revenue) * 100 : 0;
  const annualTicket = totals && totals.orders > 0 ? totals.revenue / totals.orders : 0;
  const yearlyStats = [
    { key: 'revenue', title: `Receita ${year}`, value: formatCurrency(totals?.revenue), subtitle: `${totals?.orders ?? 0} O.S. entregues`, icon: <AttachMoney />, color: 'primary' },
    { key: 'costs', title: `Custos ${year}`, value: formatCurrency(totals?.costs), subtitle: 'Peças + despesas do ano', icon: <Payments />, color: 'warning' },
    { key: 'profit', title: `Lucro ${year}`, value: formatCurrency(totals?.profit), subtitle: `Margem ${annualMargin.toFixed(1)}%`, icon: <TrendingUp />, color: 'success' },
    {
      key: 'orders',
      title: 'O.S. entregues',
      value: totals?.orders ?? 0,
      subtitle: `Ticket médio ${formatCurrency(annualTicket)}`,
      icon: <AssignmentTurnedIn />,
      color: 'info',
    },
  ];
  const yearlyCards = yearlyStats.map((item) => (
    <Grid item xs={12} sm={6} lg={3} key={item.key}>
      <StatCard title={item.title} value={item.value} subtitle={item.subtitle} icon={item.icon} color={item.color} />
    </Grid>
  ));

  // --- Top itens / Top serviços --------------------------------------------
  const topItemColumns: ReportColumn[] = [
    { header: '#', width: 50, align: 'center', render: (_row, index) => index + 1 },
    {
      header: 'Produto',
      render: (row) => (
        <Box>
          <Typography variant="body2" fontWeight={500}>{row.name || '—'}</Typography>
          {row.sku ? <Typography variant="caption" color="text.secondary">{row.sku}</Typography> : null}
        </Box>
      ),
    },
    { header: 'Qtd. vendida', width: 110, align: 'right', render: (row) => row.quantitySold ?? 0 },
    { header: 'Receita', width: 130, align: 'right', render: (row) => formatCurrency(row.revenue) },
    {
      header: 'Lucro',
      width: 130,
      align: 'right',
      render: (row) => (
        <Typography variant="body2" fontWeight={600} color={(row.profit || 0) >= 0 ? 'success.main' : 'error.main'}>
          {formatCurrency(row.profit || 0)}
        </Typography>
      ),
    },
  ];

  const topServiceColumns: ReportColumn[] = [
    { header: '#', width: 50, align: 'center', render: (_row, index) => index + 1 },
    {
      header: 'Serviço',
      render: (row) => (
        <Box>
          <Typography variant="body2" fontWeight={500}>{row.name || '—'}</Typography>
          <Chip size="small" variant="outlined" label={row.category || 'GERAL'} sx={{ mt: 0.5 }} />
        </Box>
      ),
    },
    { header: 'Qtd. executada', width: 120, align: 'right', render: (row) => row.quantitySold ?? 0 },
    { header: 'Receita', width: 130, align: 'right', render: (row) => formatCurrency(row.revenue) },
  ];

  // --- Movimentos mensais ---------------------------------------------------
  const movementStats = [
    {
      key: 'entries',
      title: 'Entradas',
      value: movements?.entries?.count ?? 0,
      subtitle: `${movements?.entries?.qty ?? 0} un. · ${formatCurrency(movements?.entries?.costValue)} de custo`,
      icon: <CallReceived />,
      color: 'success',
    },
    {
      key: 'exits',
      title: 'Saídas',
      value: movements?.exits?.count ?? 0,
      subtitle: `${movements?.exits?.qty ?? 0} un. · ${formatCurrency(movements?.exits?.costValue)} de custo`,
      icon: <CallMade />,
      color: 'error',
    },
    {
      key: 'adjustments',
      title: 'Ajustes',
      value: movements?.adjustments?.count ?? 0,
      subtitle: `${movements?.adjustments?.qty ?? 0} un. ajustadas`,
      icon: <SwapVert />,
      color: 'warning',
    },
  ];
  const movementCards = movementStats.map((item) => (
    <Grid item xs={12} sm={4} key={item.key}>
      <StatCard title={item.title} value={item.value} subtitle={item.subtitle} icon={item.icon} color={item.color} />
    </Grid>
  ));

  const recentMovements = (movements?.movements || []).slice(0, 10);
  const movementColumns: ReportColumn[] = [
    { header: 'Data', width: 150, render: (row) => (row.createdAt ? formatDate(row.createdAt, true) : '—') },
    {
      header: 'Tipo',
      width: 110,
      render: (row) => {
        const config = MOVEMENT_TYPE[row.type] || { label: row.type || '—', color: 'default' as ChipProps['color'] };
        return <Chip size="small" variant="outlined" label={config.label} color={config.color} />;
      },
    },
    {
      header: 'Peça',
      render: (row) => (
        <Box>
          <Typography variant="body2">{row.part?.name || row.reason || '—'}</Typography>
          {row.part?.code ? <Typography variant="caption" color="text.secondary">{row.part.code}</Typography> : null}
        </Box>
      ),
    },
    { header: 'Qtd.', width: 80, align: 'right', render: (row) => row.qty ?? 0 },
    { header: 'Usuário', width: 180, render: (row) => row.user?.name || '—' },
  ];

  // -------------------------------------------------------------------------
  // Seções (sem .map inline — tudo pré-calculado acima)
  // -------------------------------------------------------------------------
  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3, flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography variant="h4" fontWeight={700} sx={{ mb: 0.5 }}>Relatórios</Typography>
          <Typography variant="body1" color="text.secondary">Indicadores financeiros, estoque e desempenho</Typography>
        </Box>
        <TextField
          select
          label="Ano"
          size="small"
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          sx={{ minWidth: 120 }}
        >
          {yearMenuItems}
        </TextField>
      </Box>

      {errorAlerts.length > 0 ? <Box sx={{ mb: 3 }}>{errorAlerts}</Box> : null}

      {/* Valoração do estoque */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="h6" fontWeight={600} sx={{ mb: 2 }}>Valoração do Estoque</Typography>
        {valuationQ.isLoading ? (
          loadingBox
        ) : (
          <>
            <Grid container spacing={3} sx={{ mb: 2 }}>
              {valuationCards}
            </Grid>
            <Card>
              <CardContent>
                <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1.5 }}>Por categoria</Typography>
                <ReportTable
                  columns={categoryColumns}
                  rows={categoryRows}
                  emptyText="Nenhuma categoria com estoque ativo."
                />
              </CardContent>
            </Card>
          </>
        )}
      </Box>

      {/* Lucro / Prejuízo mensal */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="h6" fontWeight={600} sx={{ mb: 2 }}>Lucro / Prejuízo Mensal — {year}</Typography>
        {pnlQ.isLoading ? (
          loadingBox
        ) : (
          <Card>
            <ReportTable columns={pnlColumns} rows={pnlRows} emptyText="Sem dados de lucro/prejuízo para o ano selecionado." />
          </Card>
        )}
      </Box>

      {/* Resumo anual */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="h6" fontWeight={600} sx={{ mb: 2 }}>Resumo Anual — {year}</Typography>
        {yearlyQ.isLoading ? (
          loadingBox
        ) : (
          <Grid container spacing={3}>
            {yearlyCards}
          </Grid>
        )}
      </Box>

      {/* Top itens e Top serviços */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        <Grid item xs={12} lg={6}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" fontWeight={600} sx={{ mb: 2 }}>Top 10 Itens</Typography>
              {topItemsQ.isLoading ? (
                loadingBox
              ) : (
                <ReportTable columns={topItemColumns} rows={topItems} emptyText="Nenhum item vendido no período." />
              )}
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} lg={6}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" fontWeight={600} sx={{ mb: 2 }}>Top 10 Serviços</Typography>
              {topServicesQ.isLoading ? (
                loadingBox
              ) : (
                <ReportTable columns={topServiceColumns} rows={topServices} emptyText="Nenhum serviço executado no período." />
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Movimentos mensais */}
      <Box sx={{ mb: 4 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 2 }}>
          <Typography variant="h6" fontWeight={600}>Movimentos Mensais do Estoque</Typography>
          <TextField
            select
            label="Mês"
            size="small"
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
            sx={{ minWidth: 160 }}
          >
            {monthMenuItems}
          </TextField>
        </Box>
        {movementsQ.isLoading ? (
          loadingBox
        ) : (
          <>
            <Grid container spacing={3} sx={{ mb: 2 }}>
              {movementCards}
            </Grid>
            <Card>
              <CardContent>
                <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1.5 }}>
                  Últimas movimentações — {MONTH_FULL[month - 1]} / {year}
                </Typography>
                <ReportTable
                  columns={movementColumns}
                  rows={recentMovements}
                  emptyText="Nenhuma movimentação no mês selecionado."
                />
              </CardContent>
            </Card>
          </>
        )}
      </Box>
    </Box>
  );
}

export default ReportsPage;
