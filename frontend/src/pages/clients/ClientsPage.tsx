import { Box, Grid, Card, CardContent, TextField, IconButton, TableContainer, Table, TableHead, TableBody, TableRow, TableCell, TablePagination, Chip, CircularProgress, Tooltip, TableSortLabel, Typography } from '@mui/material';
import { Add, Search, Edit, Delete, Visibility, ArrowUpward, ArrowDownward } from '@mui/icons-material';
import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { clientsApi } from '../../services/api';
import FormErrors from '../../components/ui/FormErrors';
import { PrimaryButton } from '../../components/ui/Buttons';
import { OSStatusChip } from '../../components/ui/StatusChips';
import { formatPhone, formatCpf, formatCnpj } from '../../utils/formatters';
import { Client } from '../../types';
import { useNavigate } from 'react-router-dom';

export function ClientsPage() {
  const navigate = useNavigate();

  const columns: any[] = [
    { field: 'code', headerName: 'Código', width: 110, sortable: true, renderCell: (row: Client) => row.code || '-' },
    { field: 'name', headerName: 'Nome', flex: 1, sortable: true },
    { field: 'type', headerName: 'Tipo', width: 90, sortable: false, renderCell: (row: Client) => (
        <Chip size="small" label={row.type === 'PJ' ? 'Jurídica' : 'Física'} variant="outlined" />
      ) },
    { field: 'phone', headerName: 'Telefone', width: 150, sortable: false, renderCell: (row: Client) => formatPhone(row.phone) },
    { field: 'email', headerName: 'Email', width: 200, sortable: false },
    { field: 'doc', headerName: 'CPF/CNPJ', width: 170, sortable: false, renderCell: (row: Client) =>
        row.type === 'PJ'
          ? (row.cnpj ? formatCnpj(row.cnpj) : '-')
          : (row.cpf ? formatCpf(row.cpf) : '-') },
    { field: 'active', headerName: 'Status', width: 100, sortable: false, renderCell: (row: Client) => (
        <Chip size="small" label={row.active === false ? 'Inativo' : 'Ativo'} color={row.active === false ? 'default' : 'success'} variant="outlined" />
      ) },
    { field: '_count', headerName: 'Orçamentos / OS', width: 150, sortable: false, renderCell: (row: Client) => `${row._count?.budgets || 0} / ${row._count?.serviceOrders || 0}` },
    { field: 'actions', headerName: 'Ações', width: 120, sortable: false, renderCell: (row: Client) => (
      <Box sx={{ display: 'flex', gap: 0.5 }}>
        <Tooltip title="Ver"><IconButton size="small" onClick={() => navigate(`/clients/${row.id}`)}><Visibility fontSize="small" /></IconButton></Tooltip>
        <Tooltip title="Editar"><IconButton size="small" onClick={() => navigate(`/clients/${row.id}`)}><Edit fontSize="small" /></IconButton></Tooltip>
      </Box>
    )},
  ];

  const queryClient = useQueryClient();
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [sortModel, setSortModel] = useState<{ field: string; sort: 'asc' | 'desc' }[]>([]);

  const { data, isLoading, error } = useQuery({
    queryKey: ['clients', page, pageSize, search, sortModel],
    queryFn: () => clientsApi.list({ skip: page * pageSize, take: pageSize, search: search || undefined }),
  });

  // Briefing A: erro cru do axios (error.fields) para o FormErrors
  const [apiError, setApiError] = useState<any>(null);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => clientsApi.delete(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['clients'] }); queryClient.invalidateQueries({ queryKey: ['clientsAll'] }); },
    onError: (err: any) => setApiError(err),
  });

  const handleDelete = (id: string, name: string) => {
    if (window.confirm(`Excluir cliente "${name}"?`)) {
      deleteMutation.mutate(id);
    }
  };

  if (isLoading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>;

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3, flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography variant="h4" fontWeight={700} sx={{ mb: 0.5 }}>Clientes</Typography>
          <Typography variant="body1" color="text.secondary">Gerencie seus clientes</Typography>
        </Box>
        <PrimaryButton startIcon={<Add />} onClick={() => navigate('/clients/new')}>Novo Cliente</PrimaryButton>
      </Box>

      {/* Busca */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
            <TextField
              placeholder="Buscar por nome, telefone, email, CPF/CNPJ ou código..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              size="small"
              sx={{ minWidth: 300 }}
              InputProps={{ startAdornment: <Search sx={{ color: 'text.secondary' }} /> }}
            />
          </Box>
        </CardContent>
      </Card>

      {/* Briefing A: falha na operação com campos detalhados (error.fields) */}
      <FormErrors error={apiError} onClose={() => setApiError(null)} />

      {/* Tabela */}
      <Card>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                {columns.map(col => (
                  <TableCell key={col.field} align={col.align} style={{ width: col.width }}>
                    {col.sortable ? (
                      <TableSortLabel
                        active={sortModel[0]?.field === col.field}
                        direction={sortModel[0]?.sort || 'asc'}
                        onClick={() => setSortModel([{ field: col.field, sort: sortModel[0]?.field === col.field && sortModel[0]?.sort === 'asc' ? 'desc' : 'asc' }])}
                      >
                        {col.headerName}
                      </TableSortLabel>
                    ) : (
                      col.headerName
                    )}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {data?.data.map((row: Client) => (
                <TableRow key={row.id} hover>
                  {columns.map(col => (
                    <TableCell key={col.field} align={col.align}>
                      {col.renderCell ? col.renderCell(row) : (row as any)[col.field]}
                    </TableCell>
                  ))}
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