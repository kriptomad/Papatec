import { Box, Card, CardContent, TextField, IconButton, TableContainer, Table, TableHead, TableBody, TableRow, TableCell, TablePagination, CircularProgress, Tooltip, Typography, Chip, MenuItem } from '@mui/material';
import { Add, Search, Edit, Visibility } from '@mui/icons-material';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { suppliersApi } from '../../services/api';
import { PrimaryButton } from '../../components/ui/Buttons';
import { formatPhone, formatCpf, formatCnpj } from '../../utils/formatters';
import { Supplier } from '../../types';
import { useNavigate } from 'react-router-dom';

export function SuppliersPage() {
  const navigate = useNavigate();

  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['suppliers', page, pageSize, search, activeFilter],
    queryFn: () =>
      suppliersApi.list({
        skip: page * pageSize,
        take: pageSize,
        search: search || undefined,
        active: activeFilter || undefined,
      }),
  });

  const columns: any[] = [
    { field: 'code', headerName: 'Código', width: 110, renderCell: (row: Supplier) => row.code || '-' },
    { field: 'name', headerName: 'Nome', flex: 1 },
    { field: 'doc', headerName: 'CPF/CNPJ', width: 170, renderCell: (row: Supplier) =>
        row.type === 'PJ' ? (row.cnpj ? formatCnpj(row.cnpj) : '-') : (row.cpf ? formatCpf(row.cpf) : '-') },
    { field: 'phone', headerName: 'Telefone', width: 150, renderCell: (row: Supplier) => (row.phone ? formatPhone(row.phone) : '-') },
    { field: 'city', headerName: 'Cidade', width: 160, renderCell: (row: Supplier) => [row.city, row.state].filter(Boolean).join('/') || '-' },
    { field: 'active', headerName: 'Status', width: 110, renderCell: (row: Supplier) => (
        <Chip size="small" label={row.active ? 'Ativo' : 'Inativo'} color={row.active ? 'success' : 'default'} variant="outlined" />
      ) },
    { field: '_count', headerName: 'Compras', width: 90, align: 'right' as const, renderCell: (row: Supplier) => row._count?.purchases || 0 },
    { field: 'actions', headerName: 'Ações', width: 100, renderCell: (row: Supplier) => (
        <Tooltip title="Ver/Editar">
          <IconButton size="small" onClick={() => navigate(`/suppliers/${row.id}`)}>
            <Visibility fontSize="small" />
          </IconButton>
        </Tooltip>
      ) },
  ];

  if (isLoading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>;

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3, flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography variant="h4" fontWeight={700} sx={{ mb: 0.5 }}>Fornecedores</Typography>
          <Typography variant="body1" color="text.secondary">Cadastro completo e histórico de compras</Typography>
        </Box>
        <PrimaryButton startIcon={<Add />} onClick={() => navigate('/suppliers/new')}>Novo Fornecedor</PrimaryButton>
      </Box>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
            <TextField
              placeholder="Buscar por nome, CPF/CNPJ, código, contato..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              size="small"
              sx={{ minWidth: 320 }}
              InputProps={{ startAdornment: <Search sx={{ color: 'text.secondary', mr: 1 }} /> }}
            />
            <TextField
              select
              label="Status"
              size="small"
              value={activeFilter}
              onChange={(e) => { setActiveFilter(e.target.value); setPage(0); }}
              sx={{ minWidth: 140 }}
            >
              <MenuItem value="">Todos</MenuItem>
              <MenuItem value="true">Ativos</MenuItem>
              <MenuItem value="false">Inativos</MenuItem>
            </TextField>
          </Box>
        </CardContent>
      </Card>

      <Card>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                {columns.map((col) => (
                  <TableCell key={col.field} align={col.align} style={{ width: col.width }}>
                    {col.headerName}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {data?.data.map((row: Supplier) => (
                <TableRow key={row.id} hover>
                  {columns.map((col) => (
                    <TableCell key={col.field} align={col.align}>
                      {col.renderCell ? col.renderCell(row) : (row as any)[col.field]}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
              {data?.data?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={columns.length} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                    Nenhum fornecedor cadastrado ainda.
                  </TableCell>
                </TableRow>
              )}
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
