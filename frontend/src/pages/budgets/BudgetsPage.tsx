import { Box, Card, CardContent, TextField, IconButton, TableContainer, Table, TableHead, TableBody, TableRow, TableCell, TablePagination, Chip, CircularProgress, Tooltip, TableSortLabel, Select, MenuItem, Typography } from '@mui/material';
import { Add, Search, Edit, Delete, Visibility, ContentCopy, ContentPaste, CheckCircle, Cancel } from '@mui/icons-material';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { budgetsApi } from '../../services/api';
import { PrimaryButton, SecondaryButton } from '../../components/ui/Buttons';
import { BudgetStatusChip } from '../../components/ui/StatusChips';
import { BudgetStatus } from '../../types';
import { formatCurrency, formatDate } from '../../utils/formatters';
import { useNavigate } from 'react-router-dom';

const statusOptions: { value: BudgetStatus; label: string }[] = [
  { value: 'DRAFT', label: 'Rascunho' },
  { value: 'SENT', label: 'Enviado' },
  { value: 'APPROVED', label: 'Aprovado' },
  { value: 'REJECTED', label: 'Rejeitado' },
  { value: 'EXPIRED', label: 'Expirado' },
  { value: 'CONVERTED_TO_OS', label: 'Convertido em OS' },
];

export function BudgetsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<BudgetStatus | ''>('');
  const [sortModel, setSortModel] = useState<{ field: string; sort: 'asc' | 'desc' }[]>([]);

  const { data, isLoading } = useQuery({
    queryKey: ['budgets', page, pageSize, search, statusFilter, sortModel],
    queryFn: () => budgetsApi.list({ 
      skip: page * pageSize, 
      take: pageSize, 
      search: search || undefined,
      status: statusFilter || undefined,
    }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => budgetsApi.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['budgets'] }),
  });

  if (isLoading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>;

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3, flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography variant="h4" fontWeight={700} sx={{ mb: 0.5 }}>Orçamentos</Typography>
          <Typography variant="body1" color="text.secondary">Gerencie orçamentos e converta em OS</Typography>
        </Box>
        <PrimaryButton startIcon={<Add />} onClick={() => navigate('/budgets/new')}>Novo Orçamento</PrimaryButton>
      </Box>

      {/* Filtros */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
            <TextField
              placeholder="Buscar cliente, equipamento, defeito..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              size="small"
              sx={{ minWidth: 300 }}
              InputProps={{ startAdornment: <Search sx={{ color: 'text.secondary' }} /> }}
            />
            <Select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value as BudgetStatus); setPage(0); }}
              size="small"
              sx={{ minWidth: 180 }}
              label="Status"
            >
              <MenuItem value="">Todos</MenuItem>
              {statusOptions.map(opt => <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>)}
            </Select>
          </Box>
        </CardContent>
      </Card>

      {/* Tabela */}
      <Card>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>ID</TableCell>
                <TableCell>Cliente</TableCell>
                <TableCell>Data</TableCell>
                <TableCell>Equipamento</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Total</TableCell>
                <TableCell align="center">Ações</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data?.data.map((row: any) => (
                <TableRow key={row.id} hover>
                  <TableCell>{row.id.slice(0,8).toUpperCase()}</TableCell>
                  <TableCell>{row.client?.name}</TableCell>
                  <TableCell>{formatDate(row.createdAt)}</TableCell>
                  <TableCell>{row.equipment?.[0]?.name || 'N/A'}</TableCell>
                  <TableCell><BudgetStatusChip status={row.status as BudgetStatus} /></TableCell>
                  <TableCell align="right" sx={{ fontWeight: 500 }}>{formatCurrency(row.total)}</TableCell>
                  <TableCell align="center">
                    <Tooltip title="Ver"><IconButton size="small" onClick={() => navigate(`/budgets/${row.id}`)}><Visibility fontSize="small" /></IconButton></Tooltip>
                    <Tooltip title="Editar"><IconButton size="small" onClick={() => navigate(`/budgets/${row.id}/edit`)}><Edit fontSize="small" /></IconButton></Tooltip>
                    {row.status === 'APPROVED' && !row.serviceOrder && (
                      <Tooltip title="Converter em OS"><IconButton size="small" color="success" onClick={() => navigate(`/service-orders/from-budget/${row.id}`)}><CheckCircle fontSize="small" /></IconButton></Tooltip>
                    )}
                    <Tooltip title="Duplicar"><IconButton size="small" onClick={() => navigate(`/budgets/new?copy=${row.id}`)}><ContentCopy fontSize="small" /></IconButton></Tooltip>
                    {row.status === 'DRAFT' && (
                      <Tooltip title="Excluir"><IconButton size="small" color="error" onClick={() => { if(window.confirm('Excluir orçamento?')) deleteMutation.mutate(row.id); }}><Delete fontSize="small" /></IconButton></Tooltip>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination
          rowsPerPageOptions={[10, 20, 50, 100]}
          component="div"
          count={data?.total || 0}
          rowsPerPage={pageSize}
          page={page}
          onPageChange={(_: any, newPage: number) => setPage(newPage)}
          onRowsPerPageChange={(e: any) => { setPageSize(e.target.value); setPage(0); }}
        />
      </Card>
    </Box>
  );
}