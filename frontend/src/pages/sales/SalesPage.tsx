import { Box, Card, CardContent, TextField, IconButton, TableContainer, Table, TableHead, TableBody, TableRow, TableCell, TablePagination, CircularProgress, Tooltip, Typography, Chip, MenuItem, Grid } from '@mui/material';
import { Add, Search, Visibility } from '@mui/icons-material';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { salesApi } from '../../services/api';
import { PrimaryButton } from '../../components/ui/Buttons';
import { formatCurrency, formatDateTime } from '../../utils/formatters';
import { useNavigate } from 'react-router-dom';

// ---------------------------------------------------------------------------
// Helpers locais
// ---------------------------------------------------------------------------
const PAYMENT_LABELS: Record<string, string> = {
  DINHEIRO: 'Dinheiro',
  PIX: 'PIX',
  CARTAO_CREDITO: 'Cartão de Crédito',
  CARTAO_DEBITO: 'Cartão de Débito',
  BOLETO: 'Boleto',
  TRANSFERENCIA: 'Transferência',
  OUTRO: 'Outro',
};

const paymentLabel = (value?: string | null): string => {
  if (!value) return '—';
  return PAYMENT_LABELS[value] || value;
};

const pad = (n: number) => String(n).padStart(2, '0');

/** Data local (AAAA-MM-DD) de um ISO string — evita o deslocamento do toISOString. */
const localDay = (iso: string): string => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export function SalesPage() {
  const navigate = useNavigate();

  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [saleType, setSaleType] = useState('');

  const searchActive = search.trim().length > 0;
  const today = localDay(new Date().toISOString());
  const monthStart = `${today.slice(0, 7)}-01`;

  // Lista paginada no servidor. Quando há busca textual, traz uma janela maior
  // e filtra por código/cliente também no cliente (o backend não possui o
  // parâmetro `search` em /sales — enviamos mesmo assim por compatibilidade).
  const { data, isLoading } = useQuery({
    queryKey: ['sales', page, pageSize, search, startDate, endDate, saleType],
    queryFn: () =>
      salesApi.list({
        page: searchActive ? 1 : page + 1,
        limit: searchActive ? 500 : pageSize,
        search: searchActive ? search.trim() : undefined,
        startDate: startDate ? `${startDate}T00:00:00` : undefined,
        endDate: endDate ? `${endDate}T23:59:59` : undefined,
        saleType: saleType || undefined,
      }),
  });

  // Cards de indicadores: faturamento/contagem de hoje e do mês corrente
  const { data: statsRes } = useQuery({
    queryKey: ['sales-stats', monthStart],
    queryFn: () =>
      salesApi.list({
        page: 1,
        limit: 500,
        startDate: `${monthStart}T00:00:00`,
        endDate: `${today}T23:59:59`,
      }),
    refetchOnWindowFocus: false,
  });

  const monthRows: any[] = statsRes?.data || [];
  const todayRows = monthRows.filter((s: any) => localDay(s.createdAt) === today);
  const totalToday = todayRows.reduce((sum: number, s: any) => sum + (Number(s.total) || 0), 0);
  const totalMonth = monthRows.reduce((sum: number, s: any) => sum + (Number(s.total) || 0), 0);
  const countToday = todayRows.length;
  const countMonth = statsRes?.total ?? monthRows.length;

  const serverRows: any[] = data?.data || [];
  const filteredRows = searchActive
    ? serverRows.filter((s: any) => {
        const q = search.trim().toLowerCase();
        const code = (s.code || '').toLowerCase();
        const client = (s.client?.name || '').toLowerCase();
        return code.includes(q) || client.includes(q);
      })
    : serverRows;
  const rows: any[] = searchActive
    ? filteredRows.slice(page * pageSize, page * pageSize + pageSize)
    : filteredRows;
  const totalCount = searchActive ? filteredRows.length : (data?.total || 0);

  const handleSearch = (value: string) => {
    setSearch(value);
    setPage(0);
  };

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  // Extract map results to variable (TS7 parser rule: nunca .map() JSX direto no return)
  const rowItems = rows.map((row: any) => (
    <TableRow
      key={row.id}
      hover
      sx={{ cursor: 'pointer' }}
      onClick={() => navigate(`/sales/${row.id}`)}
    >
      <TableCell>
        <Typography variant="body2" fontWeight={600}>{row.code || '—'}</Typography>
      </TableCell>
      <TableCell>{formatDateTime(row.createdAt)}</TableCell>
      <TableCell>{row.client?.name || 'Consumidor'}</TableCell>
      <TableCell>{row.user?.name || '—'}</TableCell>
      <TableCell align="center">{row.items?.length ?? row._count?.items ?? 0}</TableCell>
      <TableCell>{paymentLabel(row.paymentMethod)}</TableCell>
      <TableCell align="right" sx={{ fontWeight: 600 }}>{formatCurrency(row.total)}</TableCell>
      <TableCell align="center" onClick={(e) => e.stopPropagation()}>
        <Tooltip title="Ver detalhes">
          <IconButton size="small" onClick={() => navigate(`/sales/${row.id}`)}>
            <Visibility fontSize="small" />
          </IconButton>
        </Tooltip>
      </TableCell>
    </TableRow>
  ));

  const emptyRow = (
    <TableRow>
      <TableCell colSpan={9} align="center" sx={{ py: 6, color: 'text.secondary' }}>
        {searchActive || startDate || endDate || saleType
          ? 'Nenhuma venda encontrada com os filtros informados.'
          : 'Nenhuma venda registrada ainda. Clique em "Nova Venda" para começar.'}
      </TableCell>
    </TableRow>
  );

  const statCards = [
    { label: 'Faturamento hoje', value: formatCurrency(totalToday), color: 'primary.main' },
    { label: 'Vendas hoje', value: String(countToday), color: 'text.primary' },
    { label: 'Faturamento no mês', value: formatCurrency(totalMonth), color: 'success.main' },
    { label: 'Vendas no mês', value: String(countMonth), color: 'text.primary' },
  ].map((card, idx) => (
    <Grid item xs={12} sm={6} md={3} key={card.label}>
      <Card>
        <CardContent>
          <Typography variant="caption" color="text.secondary">{card.label}</Typography>
          <Typography variant="h6" fontWeight={700} color={card.color as any}>{card.value}</Typography>
        </CardContent>
      </Card>
    </Grid>
  ));

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3, flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography variant="h4" fontWeight={700} sx={{ mb: 0.5 }}>Vendas</Typography>
          <Typography variant="body1" color="text.secondary">Venda de mercadoria — notas VDA e devoluções</Typography>
        </Box>
        <PrimaryButton startIcon={<Add />} onClick={() => navigate('/sales/new')}>Nova Venda</PrimaryButton>
      </Box>

      {/* Stats */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        {statCards}
      </Grid>

      {/* Filtros */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
            <TextField
              placeholder="Buscar por código (VDA-...) ou cliente..."
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
              size="small"
              sx={{ minWidth: 300 }}
              InputProps={{ startAdornment: <Search sx={{ color: 'text.secondary', mr: 1 }} /> }}
            />
            <TextField
              label="Início"
              type="date"
              size="small"
              value={startDate}
              onChange={(e) => { setStartDate(e.target.value); setPage(0); }}
              sx={{ minWidth: 150 }}
              InputLabelProps={{ shrink: true }}
            />
            <TextField
              label="Fim"
              type="date"
              size="small"
              value={endDate}
              onChange={(e) => { setEndDate(e.target.value); setPage(0); }}
              sx={{ minWidth: 150 }}
              InputLabelProps={{ shrink: true }}
            />
            <TextField
              select
              label="Tipo"
              size="small"
              value={saleType}
              onChange={(e) => { setSaleType(e.target.value); setPage(0); }}
              sx={{ minWidth: 180 }}
            >
              <MenuItem value="">Todos</MenuItem>
              <MenuItem value="PRODUCT_ONLY">Venda de produto</MenuItem>
              <MenuItem value="FROM_OS">Gerada da O.S.</MenuItem>
            </TextField>
          </Box>
        </CardContent>
      </Card>

      {/* Tabela */}
      <Card>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Código</TableCell>
                <TableCell>Data</TableCell>
                <TableCell>Cliente</TableCell>
                <TableCell>Vendedor</TableCell>
                <TableCell align="center">Itens</TableCell>
                <TableCell>Pagamento</TableCell>
                <TableCell align="right">Total</TableCell>
                <TableCell align="center">Ações</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.length > 0 ? rowItems : emptyRow}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination
          rowsPerPageOptions={[10, 20, 50, 100]}
          component="div"
          count={totalCount}
          rowsPerPage={pageSize}
          page={page}
          onPageChange={(_: any, newPage: number) => setPage(newPage)}
          onRowsPerPageChange={(e: any) => { setPageSize(Number(e.target.value)); setPage(0); }}
        />
      </Card>
    </Box>
  );
}

export default SalesPage;
