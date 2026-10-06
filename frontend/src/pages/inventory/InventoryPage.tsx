import { Box, Card, CardContent, TextField, IconButton, TableContainer, Table, TableHead, TableBody, TableRow, TableCell, TablePagination, Chip, CircularProgress, Tooltip, TableSortLabel, Select, MenuItem, Alert, Typography } from '@mui/material';
import { Add, Search, Edit, Delete, Visibility, Warning, Refresh } from '@mui/icons-material';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { inventoryApi } from '../../services/api';
import { PrimaryButton, SecondaryButton } from '../../components/ui/Buttons';
import { PartStatusChip } from '../../components/ui/StatusChips';
import { PartStatus } from '../../types';
import { formatCurrency } from '../../utils/formatters';
import { useNavigate } from 'react-router-dom';

export function InventoryPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<PartStatus | ''>('');
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [sortModel, setSortModel] = useState<{ field: string; sort: 'asc' | 'desc' }[]>([]);

  const { data, isLoading } = useQuery({
    queryKey: ['inventory', page, pageSize, search, categoryFilter, statusFilter, lowStockOnly, sortModel],
    queryFn: () => inventoryApi.list({ 
      skip: page * pageSize, 
      take: pageSize, 
      search: search || undefined,
      category: categoryFilter || undefined,
      status: statusFilter || undefined,
      lowStock: lowStockOnly,
    }),
  });

  const { data: categories } = useQuery({ queryKey: ['categories'], queryFn: () => inventoryApi.getCategories() });
  const { data: stats } = useQuery({ queryKey: ['inventoryStats'], queryFn: () => inventoryApi.getStats() });
  const { data: lowStockData } = useQuery({ queryKey: ['lowStock'], queryFn: () => inventoryApi.getLowStock() });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => inventoryApi.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['inventory'] }),
  });

  const toggleMutation = useMutation({
    mutationFn: (id: string) => inventoryApi.toggleStatus(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['inventory'] }),
  });

  const adjustMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => inventoryApi.adjustStock(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['inventory'] }),
  });

  if (isLoading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>;

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3, flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography variant="h4" fontWeight={700} sx={{ mb: 0.5 }}>Estoque de Peças</Typography>
          <Typography variant="body1" color="text.secondary">Gerencie peças, reposição e movimentações</Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <SecondaryButton startIcon={<Refresh />} onClick={() => queryClient.invalidateQueries({ queryKey: ['inventory'] })}>
            Atualizar
          </SecondaryButton>
          <PrimaryButton startIcon={<Add />} onClick={() => navigate('/inventory/new')}>Nova Peça</PrimaryButton>
        </Box>
      </Box>

      {/* Stats Cards */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={3}>
          <Card><CardContent><Typography variant="caption" color="text.secondary">Total Peças</Typography><Typography variant="h6" fontWeight={700}>{stats?.data?.total || 0}</Typography></CardContent></Card>
        </Grid>
        <Grid item xs={12} sm={3}>
          <Card><CardContent><Typography variant="caption" color="text.secondary">Ativas</Typography><Typography variant="h6" fontWeight={700} color="success.main">{stats?.data?.active || 0}</Typography></CardContent></Card>
        </Grid>
        <Grid item xs={12} sm={3}>
          <Card><CardContent><Typography variant="caption" color="text.secondary">Inativas</Typography><Typography variant="h6" fontWeight={700} color="text.secondary">{stats?.data?.inactive || 0}</Typography></CardContent></Card>
        </Grid>
        <Grid item xs={12} sm={3}>
          <Card><CardContent><Typography variant="caption" color="text.secondary">Estoque Baixo</Typography><Typography variant="h6" fontWeight={700} color="warning.main">{stats?.data?.lowStock || 0}</Typography></CardContent></Card>
        </Grid>
      </Grid>

      {/* Alerta estoque baixo */}
      {(lowStockData?.length || 0) > 0 && (
        <Alert severity="warning" sx={{ mb: 3 }} icon={<Warning />}>
          <strong>{lowStockData.length} peça(s) precisam de reposição!</strong>
          <Box sx={{ mt: 1, display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {lowStockData.slice(0, 8).map((part: any) => (
              <Chip key={part.id} label={`${part.name} (${part.quantity}/${part.minStock})`} size="small" variant="outlined" color="warning" />
            ))}
            {lowStockData.length > 8 && <Chip label={`+${lowStockData.length - 8} mais...`} size="small" variant="outlined" />}
          </Box>
        </Alert>
      )}

      {/* Filtros */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
            <TextField
              placeholder="Buscar por nome, código, código de barra, categoria..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              size="small"
              sx={{ minWidth: 300 }}
              InputProps={{ startAdornment: <Search sx={{ color: 'text.secondary' }} /> }}
            />
            <Select
              value={categoryFilter}
              onChange={(e) => { setCategoryFilter(e.target.value); setPage(0); }}
              size="small"
              sx={{ minWidth: 180 }}
              label="Categoria"
            >
              <MenuItem value="">Todas</MenuItem>
              {categories?.map(c => <MenuItem key={c} value={c}>{c}</MenuItem>)}
            </Select>
            <Select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value as PartStatus); setPage(0); }}
              size="small"
              sx={{ minWidth: 140 }}
              label="Status"
            >
              <MenuItem value="">Todos</MenuItem>
              <MenuItem value="ACTIVE">Ativa</MenuItem>
              <MenuItem value="INACTIVE">Inativa</MenuItem>
            </Select>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <input type="checkbox" checked={lowStockOnly} onChange={(e) => { setLowStockOnly(e.target.checked); setPage(0); }} />
              <Typography variant="body2">Apenas estoque baixo</Typography>
            </Box>
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
                <TableCell>Nome</TableCell>
                <TableCell>Categoria</TableCell>
                <TableCell align="right">Custo</TableCell>
                <TableCell align="right">Venda</TableCell>
                <TableCell align="center">Estoque</TableCell>
                <TableCell align="center">Mín.</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="center">Ações</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data?.data.map((row: any) => (
                /* #fff8e1 (warning.light do MUI) é um âmbar CLARO. Numa tabela de tema
                   escuro ele estoura: o texto da linha é #e6edf3 (quase branco) e
                   some sobre o creme - o cliente via a peça "desaparecida" e só
                   percebia passando o mouse. Agora é o mesmo tom com alpha, que
                   funciona em fundo claro e escuro (como as demais destaques de
                   MainLayout.css). */
                <TableRow key={row.id} hover sx={{ backgroundColor: row.needsRestock ? 'rgba(255, 193, 7, 0.14)' : undefined }}>
                  <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                    {row.code}
                    {row.barcode && (
                      <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', fontFamily: 'monospace' }}>
                        {row.barcode}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell sx={{ fontWeight: 500 }}>{row.name}</TableCell>
                  <TableCell>{row.category || '-'}</TableCell>
                  <TableCell align="right">{formatCurrency(row.costPrice)}</TableCell>
                  <TableCell align="right">{formatCurrency(row.salePrice)}</TableCell>
                  <TableCell align="center" sx={{ fontWeight: row.needsRestock ? 700 : 400, color: row.needsRestock ? 'warning.main' : undefined }}>
                    {row.quantity}
                  </TableCell>
                  <TableCell align="center">{row.minStock}</TableCell>
                  <TableCell><PartStatusChip status={row.status as PartStatus} /></TableCell>
                  <TableCell align="center">
                    <Tooltip title="Ver"><IconButton size="small" onClick={() => navigate(`/inventory/${row.id}/edit`)}><Visibility fontSize="small" /></IconButton></Tooltip>
                    <Tooltip title="Editar"><IconButton size="small" onClick={() => navigate(`/inventory/${row.id}/edit`)}><Edit fontSize="small" /></IconButton></Tooltip>
                    <Tooltip title={row.status === 'ACTIVE' ? 'Desativar' : 'Ativar'}><IconButton size="small" color={row.status === 'ACTIVE' ? 'warning' : 'success'} onClick={() => toggleMutation.mutate(row.id)}>
                      {row.status === 'ACTIVE' ? <Visibility fontSize="small" /> : <Visibility fontSize="small" />}
                    </IconButton></Tooltip>
                    {row.movements === 0 && (
                      <Tooltip title="Excluir"><IconButton size="small" color="error" onClick={() => { if(window.confirm('Excluir peça?')) deleteMutation.mutate(row.id); }}><Delete fontSize="small" /></IconButton></Tooltip>
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

      {/* Quick Adjust Modal would go here - simplified for now */}
    </Box>
  );
}

import { Grid } from '@mui/material';