import { Box, Grid, Card, CardContent, TextField, IconButton, TableContainer, Table, TableHead, TableBody, TableRow, TableCell, TablePagination, CircularProgress, Tooltip, Typography, Chip, MenuItem } from '@mui/material';
import { Add, Search, Edit, Delete, Visibility, PowerSettingsNew, People, CheckCircleOutline, Build, AdminPanelSettings } from '@mui/icons-material';
import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usersApi } from '../../services/api';
import { PrimaryButton } from '../../components/ui/Buttons';
import FormErrors from '../../components/ui/FormErrors';
import EmployeeFormDialog from './EmployeeFormDialog';
import { ROLE_COLORS, ROLE_OPTIONS, roleLabel, primaryDoc } from './employeeMeta';
import { formatPhone } from '../../utils/formatters';
import type { User } from '../../types';

export function EmployeesPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  // '' = todos | 'active' = ativos | 'inactive' = inativos (filtro local:
  // o endpoint /users não recebe parâmetro de status)
  const [statusFilter, setStatusFilter] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [actionError, setActionError] = useState<any>(null);

  const clientMode = statusFilter !== '';

  // Busca e cargo filtrados pelo servidor (backend suporta `search` e `role`)
  const { data: pageData, isLoading: loadingPage, error: listError } = useQuery({
    queryKey: ['users', page, pageSize, search, roleFilter],
    queryFn: () =>
      usersApi.list({
        page: page + 1,
        limit: pageSize,
        search: search || undefined,
        role: roleFilter || undefined,
      }),
    enabled: !clientMode,
  });

  // Base completa (limite 200) para estatísticas e filtro de status
  const { data: allData, isLoading: loadingAll } = useQuery({
    queryKey: ['users-all'],
    queryFn: () => usersApi.list({ limit: 200 }),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['users'] });
    queryClient.invalidateQueries({ queryKey: ['users-all'] });
    // ['technicians'] é a chave usada no seletor de técnico (OS/orçamento/visitas)
    queryClient.invalidateQueries({ queryKey: ['technicians'] });
  };

  const toggleMutation = useMutation({
    mutationFn: (id: string) => usersApi.toggleActive(id),
    onSuccess: invalidate,
    onError: (err: any) => setActionError(err),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => usersApi.delete(id),
    onSuccess: invalidate,
    onError: (err: any) => setActionError(err),
  });

  const handleDelete = (user: User) => {
    if (window.confirm(`Excluir o funcionário "${user.name}"? Esta ação não pode ser desfeita.`)) {
      deleteMutation.mutate(user.id);
    }
  };

  const openNew = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (user: User) => {
    setEditing(user);
    setFormOpen(true);
  };

  // -------------------------------------------------------------------------
  // Dados derivados
  // -------------------------------------------------------------------------
  const allUsers: User[] = useMemo(() => allData?.data || [], [allData]);

  const clientRows = useMemo(() => {
    if (!clientMode) return null;
    const term = search.trim().toLowerCase();
    return allUsers.filter((user) => {
      if (statusFilter === 'active' && user.active === false) return false;
      if (statusFilter === 'inactive' && user.active !== false) return false;
      if (roleFilter && user.role !== roleFilter) return false;
      if (term) {
        const haystack = [user.name, user.email, user.code, user.cpf, user.cnpj, user.phone]
          .map((value) => (value || '').toLowerCase())
          .join(' ');
        if (!haystack.includes(term)) return false;
      }
      return true;
    });
  }, [clientMode, allUsers, statusFilter, roleFilter, search]);

  const rows: User[] = clientMode
    ? (clientRows || []).slice(page * pageSize, page * pageSize + pageSize)
    : (pageData?.data as User[]) || [];
  const totalCount = clientMode ? (clientRows || []).length : pageData?.total || 0;

  const activeCount = allUsers.filter((user) => user.active !== false).length;
  const techCount = allUsers.filter((user) => user.role === 'TECHNICIAN').length;
  const adminCount = allUsers.filter((user) => user.role === 'ADMIN').length;

  // -------------------------------------------------------------------------
  // Estatísticas
  // -------------------------------------------------------------------------
  const stats = [
    { title: 'Total de funcionários', value: allData?.total ?? allUsers.length, subtitle: 'Equipe e parceiros cadastrados', icon: <People />, color: 'primary' },
    { title: 'Ativos', value: activeCount, subtitle: `${allUsers.length - activeCount} inativo(s)`, icon: <CheckCircleOutline />, color: 'success' },
    { title: 'Técnicos', value: techCount, subtitle: 'Papel: Técnico', icon: <Build />, color: 'info' },
    { title: 'Administradores', value: adminCount, subtitle: 'Papel: Administrador', icon: <AdminPanelSettings />, color: 'error' },
  ];

  const statCards = stats.map((item) => (
    <Grid item xs={12} sm={6} lg={3} key={item.title}>
      <Card sx={{ height: '100%' }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <Box>
              <Typography variant="h3" fontWeight={700} sx={{ mb: 0.5 }}>{item.value}</Typography>
              <Typography variant="body2" color="text.secondary">{item.subtitle}</Typography>
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
  ));

  // -------------------------------------------------------------------------
  // Colunas da tabela (extraídas antes do return — regra do projeto)
  // -------------------------------------------------------------------------
  const columns: any[] = [
    { field: 'code', headerName: 'Código', width: 100, renderCell: (row: User) => row.code || '—' },
    {
      field: 'name',
      headerName: 'Nome',
      width: 220,
      renderCell: (row: User) => (
        <Typography
          variant="body2"
          fontWeight={500}
          sx={{ color: 'primary.main', cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}
          onClick={() => navigate(`/employees/${row.id}`)}
        >
          {row.name}
        </Typography>
      ),
    },
    { field: 'email', headerName: 'Email', width: 210, renderCell: (row: User) => row.email || '—' },
    {
      field: 'role',
      headerName: 'Cargo',
      width: 140,
      renderCell: (row: User) => (
        <Chip size="small" variant="outlined" label={roleLabel(row.role)} color={ROLE_COLORS[row.role] || 'default'} />
      ),
    },
    { field: 'doc', headerName: 'CPF/CNPJ', width: 160, renderCell: (row: User) => primaryDoc(row) },
    { field: 'phone', headerName: 'Telefone', width: 145, renderCell: (row: User) => (row.phone ? formatPhone(row.phone) : '—') },
    {
      field: 'commissionPercent',
      headerName: 'Comissão',
      width: 100,
      align: 'right' as const,
      renderCell: (row: User) => (row.commissionPercent != null ? `${row.commissionPercent}%` : '—'),
    },
    {
      field: 'active',
      headerName: 'Status',
      width: 100,
      renderCell: (row: User) => (
        <Chip
          size="small"
          variant="outlined"
          label={row.active !== false ? 'Ativo' : 'Inativo'}
          color={row.active !== false ? 'success' : 'default'}
        />
      ),
    },
    {
      field: 'actions',
      headerName: 'Ações',
      width: 160,
      renderCell: (row: User) => (
        <Box sx={{ display: 'flex', gap: 0.5 }}>
          <Tooltip title="Ver detalhes">
            <IconButton size="small" onClick={() => navigate(`/employees/${row.id}`)}>
              <Visibility fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Editar">
            <IconButton size="small" onClick={() => openEdit(row)}>
              <Edit fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title={row.active !== false ? 'Desativar' : 'Ativar'}>
            <IconButton size="small" onClick={() => toggleMutation.mutate(row.id)}>
              <PowerSettingsNew fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Excluir">
            <IconButton size="small" color="error" onClick={() => handleDelete(row)}>
              <Delete fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      ),
    },
  ];

  const headerCells = columns.map((col) => (
    <TableCell key={col.field} align={col.align} style={{ width: col.width }}>
      {col.headerName}
    </TableCell>
  ));

  const bodyRows = rows.map((row) => (
    <TableRow key={row.id} hover>
      {columns.map((col) => (
        <TableCell key={col.field} align={col.align}>
          {col.renderCell ? col.renderCell(row) : (row as any)[col.field]}
        </TableCell>
      ))}
    </TableRow>
  ));

  const emptyRow = rows.length === 0 ? (
    <TableRow>
      <TableCell colSpan={columns.length} align="center" sx={{ py: 6, color: 'text.secondary' }}>
        Nenhum funcionário encontrado.
      </TableCell>
    </TableRow>
  ) : null;

  const roleMenuItems = [
    <MenuItem key="all" value="">Todos os cargos</MenuItem>,
    ...ROLE_OPTIONS.map((option) => (
      <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
    )),
  ];

  const statusMenuItems = [
    <MenuItem key="all" value="">Todos</MenuItem>,
    <MenuItem key="active" value="active">Ativos</MenuItem>,
    <MenuItem key="inactive" value="inactive">Inativos</MenuItem>,
  ];

  const listErrorAlert = listError ? <FormErrors error={listError} title="Erro ao carregar funcionários" /> : null;
  const actionErrorAlert = actionError ? (
    <FormErrors error={actionError} onClose={() => setActionError(null)} title="Erro na operação" />
  ) : null;

  const pageLoading = loadingPage || loadingAll;

  if (pageLoading) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>;
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3, flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography variant="h4" fontWeight={700} sx={{ mb: 0.5 }}>Funcionários / Parceiros</Typography>
          <Typography variant="body1" color="text.secondary">Equipe, parceiros e seus cadastros completos</Typography>
        </Box>
        <PrimaryButton startIcon={<Add />} onClick={openNew}>Novo Funcionário</PrimaryButton>
      </Box>

      {/* Estatísticas */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        {statCards}
      </Grid>

      {/* Filtros */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
            <TextField
              placeholder="Buscar por nome, email, código, CPF/CNPJ..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              size="small"
              sx={{ minWidth: 320 }}
              InputProps={{ startAdornment: <Search sx={{ color: 'text.secondary', mr: 1 }} /> }}
            />
            <TextField
              select
              label="Cargo"
              size="small"
              value={roleFilter}
              onChange={(e) => { setRoleFilter(e.target.value); setPage(0); }}
              sx={{ minWidth: 180 }}
            >
              {roleMenuItems}
            </TextField>
            <TextField
              select
              label="Status"
              size="small"
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}
              sx={{ minWidth: 140 }}
            >
              {statusMenuItems}
            </TextField>
          </Box>
        </CardContent>
      </Card>

      {actionErrorAlert}
      {listErrorAlert}

      {/* Tabela */}
      <Card>
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

      {formOpen && (
        <EmployeeFormDialog open={formOpen} employee={editing} onClose={() => setFormOpen(false)} />
      )}
    </Box>
  );
}

export default EmployeesPage;
