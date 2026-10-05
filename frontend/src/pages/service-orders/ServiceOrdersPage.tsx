import { Box, Card, CardContent, TextField, IconButton, TableContainer, Table, TableHead, TableBody, TableRow, TableCell, TablePagination, Chip, CircularProgress, Tooltip, TableSortLabel, Select, MenuItem, Typography } from '@mui/material';
import { Add, Search, Edit, Delete, Visibility, CheckCircle, Build } from '@mui/icons-material';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { serviceOrdersApi } from '../../services/api';
import { PrimaryButton, SecondaryButton } from '../../components/ui/Buttons';
import { OSStatusChip } from '../../components/ui/StatusChips';
import { OSStatus } from '../../types';
import { formatCurrency, formatDate } from '../../utils/formatters';
import { useNavigate } from 'react-router-dom';

const statusOptions: { value: OSStatus; label: string }[] = [
  { value: 'OPEN', label: 'Aberta' },
  { value: 'IN_PROGRESS', label: 'Em Andamento' },
  { value: 'WAITING_PARTS', label: 'Aguardando Peças' },
  { value: 'READY', label: 'Pronta' },
  { value: 'DELIVERED', label: 'Entregue' },
  { value: 'CANCELLED', label: 'Cancelada' },
];

export function ServiceOrdersPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<OSStatus | ''>('');
  const [sortModel, setSortModel] = useState<{ field: string; sort: 'asc' | 'desc' }[]>([]);

  const { data, isLoading } = useQuery({
    queryKey: ['serviceOrders', page, pageSize, search, statusFilter, sortModel],
    queryFn: () => serviceOrdersApi.list({ 
      skip: page * pageSize, 
      take: pageSize, 
      search: search || undefined,
      status: statusFilter || undefined,
    }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => serviceOrdersApi.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['serviceOrders'] }),
  });

  if (isLoading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>;

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3, flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography variant="h4" fontWeight={700} sx={{ mb: 0.5 }}>Ordens de Serviço</Typography>
          <Typography variant="body1" color="text.secondary">Gerencie o fluxo de reparos</Typography>
        </Box>
        <PrimaryButton startIcon={<Add />} onClick={() => navigate('/service-orders/new')}>Nova OS</PrimaryButton>
      </Box>

      {/* Filtros */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
            <TextField
              placeholder="Buscar cliente, equipamento, defeito, ID..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              size="small"
              sx={{ minWidth: 300 }}
              InputProps={{ startAdornment: <Search sx={{ color: 'text.secondary' }} /> }}
            />
            <Select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value as OSStatus); setPage(0); }}
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
                <TableCell>Técnico</TableCell>
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
                  <TableCell>{row.technician?.name || '-'}</TableCell>
                  <TableCell><OSStatusChip status={row.status as OSStatus} /></TableCell>
                  <TableCell align="right" sx={{ fontWeight: 500 }}>{formatCurrency(row.total)}</TableCell>
                  <TableCell align="center">
                    <Tooltip title="Ver"><IconButton size="small" onClick={() => navigate(`/service-orders/${row.id}`)}><Visibility fontSize="small" /></IconButton></Tooltip>
                    <Tooltip title="Editar"><IconButton size="small" onClick={() => navigate(`/service-orders/${row.id}/edit`)}><Edit fontSize="small" /></IconButton></Tooltip>
                    {['OPEN', 'IN_PROGRESS', 'WAITING_PARTS'].includes(row.status) && (
                      <>
                        <Tooltip title="Mover para Em Andamento"><IconButton size="small" color="primary" onClick={() => navigate(`/service-orders/${row.id}?status=IN_PROGRESS`)}><Build fontSize="small" /></IconButton></Tooltip>
                        <Tooltip title="Mover para Aguardando Peças"><IconButton size="small" color="warning" onClick={() => navigate(`/service-orders/${row.id}?status=WAITING_PARTS`)}><Build fontSize="small" /></IconButton></Tooltip>
                        <Tooltip title="Mover para Pronta"><IconButton size="small" color="success" onClick={() => navigate(`/service-orders/${row.id}?status=READY`)}><CheckCircle fontSize="small" /></IconButton></Tooltip>
                      </>
                    )}
                    {row.status === 'READY' && (
                      <Tooltip title="Entregar"><IconButton size="small" color="success" onClick={() => navigate(`/service-orders/${row.id}?status=DELIVERED`)}><CheckCircle fontSize="small" /></IconButton></Tooltip>
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