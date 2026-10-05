import { Drawer, List, ListItem, ListItemIcon, ListItemText, Box, Divider, Typography, IconButton, useMediaQuery, useTheme, Button, Tooltip } from '@mui/material';
import { Menu as MenuIcon, ChevronLeft, ChevronRight, Dashboard, People, Assignment, Build, Inventory, Settings, BackupTable, Key, ExitToApp, LocalShipping, ShoppingCart, PointOfSale, CalendarMonth, EventNote, Badge, Assessment } from '@mui/icons-material';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../../store/auth';
import type { UserRole } from '../../types';
import { useSidebar } from './SidebarContext';
import './Sidebar.css';

type MenuRole = Extract<UserRole, 'ADMIN' | 'TECHNICIAN' | 'RECEPTIONIST'>;

const menuItems: { path: string; label: string; icon: JSX.Element; roles: MenuRole[] }[] = [
  { path: '/dashboard', label: 'Dashboard', icon: <Dashboard />, roles: ['ADMIN', 'TECHNICIAN', 'RECEPTIONIST'] },
  { path: '/clients', label: 'Clientes', icon: <People />, roles: ['ADMIN', 'TECHNICIAN', 'RECEPTIONIST'] },
  { path: '/budgets', label: 'Orçamentos', icon: <Assignment />, roles: ['ADMIN', 'TECHNICIAN', 'RECEPTIONIST'] },
  { path: '/service-orders', label: 'Ordens de Serviço', icon: <Build />, roles: ['ADMIN', 'TECHNICIAN', 'RECEPTIONIST'] },
  { path: '/sales', label: 'Vendas', icon: <PointOfSale />, roles: ['ADMIN', 'TECHNICIAN', 'RECEPTIONIST'] },
  { path: '/calendar', label: 'Calendário', icon: <CalendarMonth />, roles: ['ADMIN', 'TECHNICIAN', 'RECEPTIONIST'] },
  { path: '/visits', label: 'Agenda / Horas', icon: <EventNote />, roles: ['ADMIN', 'TECHNICIAN', 'RECEPTIONIST'] },
  { path: '/inventory', label: 'Estoque', icon: <Inventory />, roles: ['ADMIN', 'TECHNICIAN'] },
  { path: '/suppliers', label: 'Fornecedores', icon: <LocalShipping />, roles: ['ADMIN', 'TECHNICIAN'] },
  { path: '/purchases', label: 'Compras', icon: <ShoppingCart />, roles: ['ADMIN', 'TECHNICIAN'] },
  { path: '/employees', label: 'Funcionários', icon: <Badge />, roles: ['ADMIN'] },
  { path: '/reports', label: 'Relatórios', icon: <Assessment />, roles: ['ADMIN', 'TECHNICIAN', 'RECEPTIONIST'] },
  { path: '/backup', label: 'Backup', icon: <BackupTable />, roles: ['ADMIN'] },
  { path: '/license', label: 'Licença', icon: <Key />, roles: ['ADMIN'] },
  { path: '/settings', label: 'Configurações', icon: <Settings />, roles: ['ADMIN'] },
];

export function Sidebar() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const location = useLocation();
  const { user, logout } = useAuth();
  const { collapsed, setCollapsed, mobileOpen, setMobileOpen } = useSidebar();

  const handleDrawerToggle = () => setMobileOpen(!mobileOpen);

  const filteredItems = menuItems.filter(item =>
    user && (item.roles.includes(user.role as MenuRole) || user.role === 'ADMIN')
  );

  const drawerWidth = collapsed ? 72 : 280;

  const drawer = (
    <Box
      className={`sidebar-drawer ${collapsed ? 'collapsed' : 'expanded'}`}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: drawerWidth,
        transition: 'width 0.25s ease',
        overflow: 'hidden',
      }}
    >
      <Box
        className={`sidebar-header ${collapsed ? 'collapsed' : ''}`}
        sx={{
          borderBottom: 1,
          borderColor: 'divider',
          minHeight: 72,
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'flex-start',
          px: collapsed ? 0 : 2,
        }}
      >
        {!collapsed && (
          <Box className="sidebar-logo" sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
            <Box
              component="img"
              src="/images/logo-papatec.png"
              alt="PapaTec"
              sx={{ height: 32, width: 32, display: 'block', flexShrink: 0 }}
            />
            <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <Typography
                variant="h6"
                className="sidebar-title"
                sx={{ fontWeight: 700, color: 'primary.main', lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
              >
                PapaTec
              </Typography>
              <Typography variant="caption" className="sidebar-subtitle" sx={{ color: 'text.secondary', lineHeight: 1.2 }}>
                Sistema Loja
              </Typography>
            </Box>
          </Box>
        )}
        {collapsed && (
          <Tooltip title="Papatec">
            <Box
              component="img"
              src="/images/logo-papatec.png"
              alt="PapaTec"
              sx={{ height: 28, width: 28, display: 'block' }}
            />
          </Tooltip>
        )}
      </Box>
      {!collapsed && <Divider sx={{ mx: 1 }} />}
      <List component="nav" className="sidebar-nav" sx={{ flex: 1, px: 1, py: 1, overflow: 'auto' }}>
        {filteredItems.map(item => (
          <NavLink
            key={item.path}
            to={item.path}
            onClick={handleDrawerToggle}
            style={({ isActive }) => ({
              textDecoration: 'none',
              color: 'inherit',
              borderRadius: '10px',
              mb: '0.5',
              display: 'block',
              '&:hover': { backgroundColor: 'action.hover' },
            })}
          >
            <ListItem
              button
              selected={location.pathname === item.path}
              disableRipple={false}
              sx={{
                px: 1.5,
                py: 1,
                borderRadius: '10px',
                transition: 'all 0.2s ease',
                '&.Mui-selected': {
                  backgroundColor: 'primary.main',
                  '&:hover': { backgroundColor: 'primary.dark' },
                  color: 'primary.contrastText',
                  borderLeft: '3px solid #1e88e5',
                  '& .MuiListItemIcon-root': { color: 'primary.contrastText' },
                },
                '& .MuiListItemIcon-root': {
                  minWidth: 40,
                  color: location.pathname === item.path ? 'primary.main' : 'text.secondary',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                },
              }}
            >
              <ListItemIcon>{item.icon}</ListItemIcon>
              {!collapsed && <ListItemText primary={item.label} primaryTypographyProps={{ variant: 'body2', fontWeight: 500 }} />}
            </ListItem>
          </NavLink>
        ))}
      </List>
      {!collapsed && <Divider sx={{ mx: 1 }} />}
      {!collapsed && (
        <Box className="sidebar-footer" sx={{ p: 2 }}>
          <Box className="sidebar-user-info">
            <Typography variant="body2" className="sidebar-user-name" sx={{ fontWeight: 600, color: 'text.primary' }}>
              {user?.name}
            </Typography>
            <Typography variant="caption" className="sidebar-user-email" sx={{ color: 'text.secondary' }}>
              {user?.email}
            </Typography>
          </Box>
          <Button
            fullWidth
            variant="outlined"
            color="error"
            size="small"
            startIcon={<ExitToApp />}
            onClick={logout}
            sx={{ mt: 1.5 }}
          >
            Sair
          </Button>
        </Box>
      )}
      {collapsed && (
        <Box className="sidebar-footer collapsed" sx={{ p: 1, position: 'absolute', bottom: 0, width: 72, display: 'flex', justifyContent: 'center' }}>
          <Tooltip title="Sair">
            <IconButton size="small" onClick={logout} color="error" sx={{ color: 'error.main' }}>
              <ExitToApp fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      )}
    </Box>
  );

  return (
    <>
      <IconButton
        color="inherit"
        edge="start"
        onClick={handleDrawerToggle}
        sx={{ mr: 2, display: { md: 'none' } }}
        aria-label="Abrir menu"
      >
        <MenuIcon />
      </IconButton>
      <Drawer
        variant={isMobile ? 'temporary' : 'permanent'}
        open={isMobile ? mobileOpen : true}
        onClose={handleDrawerToggle}
        ModalProps={{ keepMounted: true }}
        sx={{
          display: { xs: 'block', md: 'none' },
          '& .MuiDrawer-paper': {
            boxSizing: 'border-box',
            width: collapsed ? 72 : 280,
            borderRight: 0,
            backgroundColor: 'background.paper',
            transition: 'width 0.25s ease',
          },
        }}
      >
        {drawer}
      </Drawer>
      <Drawer
        variant="permanent"
        sx={{
          display: { xs: 'none', md: 'block' },
          '& .MuiDrawer-paper': {
            boxSizing: 'border-box',
            width: drawerWidth,
            borderRight: 0,
            backgroundColor: 'background.paper',
            transition: 'width 0.25s ease',
            overflow: 'hidden',
          },
        }}
        open
      >
        {drawer}
      </Drawer>
      {!isMobile && (
        <Tooltip title={collapsed ? 'Expandir menu' : 'Recolher menu'}>
          <IconButton
            color="inherit"
            size="small"
            onClick={() => setCollapsed(!collapsed)}
            className={`sidebar-toggle ${collapsed ? 'collapsed' : ''}`}
            sx={{
              position: 'fixed',
              left: drawerWidth,
              top: 16,
              zIndex: 1300,
              backgroundColor: 'background.paper',
              border: '1px solid',
              borderColor: 'divider',
              borderTopRightRadius: 2,
              borderBottomRightRadius: 2,
              boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
              transition: 'left 0.25s ease',
            }}
            aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
          >
            {collapsed ? <ChevronRight /> : <ChevronLeft />}
          </IconButton>
        </Tooltip>
      )}
    </>
  );
}