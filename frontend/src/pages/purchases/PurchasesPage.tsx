import { Box, Card, CardContent, TextField, IconButton, TableContainer, Table, TableHead, TableBody, TableRow, TableCell, TablePagination, CircularProgress, Tooltip, Typography, MenuItem, Chip } from '@mui/material';
import { Add, Search, Visibility } from '@mui/icons-material';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { purchasesApi, suppliersApi } from '../../services/api';
import { PrimaryButton } from '../../components/ui/Buttons';
import { formatCurrency, formatDate } from '../../utils/formatters';
import { Purchase } from '../../types';
import { useNavigate } from 'react-router-dom';

export function PurchasesPage() {
  const navigate = useNavigate();

  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [supplierId, setSupplierId] = useState('');

  const { data: suppliers } = useQuery({
    queryKey: ['suppliers-options'],
    queryFn: () => suppliersApi.options(),
  });

  const { data, isLoading } = useQuery({
    queryKey: ['purchases', page, pageSize, search, supplierId],
    queryFn: () =>
      purchasesApi.list({
        skip: page * pageSize,
        take: pageSize,
        search: search || undefined,
        supplierId: supplierId || undefined,
      }),
  });

  const columns: any[] = [
    { field: 'code', headerName: 'Código', width: 120, renderCell: (row: Purchase) => <Chip size="small" label={row.code || '—'} variant="outlined" /> },
    { field: 'purchaseDate', headerName: 'Data', width: 120, renderCell: (row: Purchase) => formatDate(row.purchaseDate) },
    { field: 'supplier', headerName: 'Fornecedor', flex: 1, renderCell: (row: Purchase) => row.supplier?.name || '-' },
    { field: '_count', headerName: 'Itens', width: 80, align: 'right' as const, renderCell: (row: Purchase) => row._count?.items ?? '-' },
    { field: 'paymentMethod', headerName: 'Pagamento', width: 150, renderCell: (row: Purchase) => row.paymentMethod || '-' },
    { field: 'nfNumber', headerName: 'NF Compra', width: 130, renderCell: (row: Purchase) => row.nfNumber || '-' },
    { field: 'user', headerName: 'Lançado por', width: 150, renderCell: (row: Purchase) => row.user?.name || '-' },
    { field: 'total', headerName: 'Total', width: 130, align: 'right' as const, renderCell: (row: Purchase) => (
        <Typography variant="body2" fontWeight={600}>{formatCurrency(row.total)}</Typography>
      ) },
    { field: 'actions', headerName: 'Ações', width: 90, renderCell: (row: Purchase) => (
        <Tooltip title="Ver detalhe">
          <IconButton size="small" onClick={() => navigate(`/purchases/${row.id}`)}>
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
          <Typography variant="h4" fontWeight={700} sx={{ mb: 0.5 }}>Compras (Entrada de Mercadoria)</Typography>
          <Typography variant="body1" color="text.secondary">Entradas com frete, imposto e desconto rateados no custo</Typography>
        </Box>
        <PrimaryButton startIcon={<Add />} onClick={() => navigate('/purchases/new')}>Nova Compra</PrimaryButton>
      </Box>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
            <TextField
              placeholder="Buscar por código, fornecedor, NF..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              size="small"
              sx={{ minWidth: 300 }}
              InputProps={{ startAdornment: <Search sx={{ color: 'text.secondary', mr: 1 }} /> }}
            />
            <TextField
              select
              label="Fornecedor"
              size="small"
              value={supplierId}
              onChange={(e) => { setSupplierId(e.target.value); setPage(0); }}
              sx={{ minWidth: 260 }}
            >
              <MenuItem value="">Todos</MenuItem>
              {(suppliers || []).map((s: any) => (
                <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>
              ))}
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
              {data?.data.map((row: Purchase) => (
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
                    Nenhuma compra registrada ainda.
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
