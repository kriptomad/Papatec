import { AppBar, Toolbar, Typography, Box, IconButton, Avatar, Menu, MenuItem, Divider, Badge, Tooltip } from '@mui/material';
import { Notifications, Person, Settings, Logout, Help, Close } from '@mui/icons-material';
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../store/auth';
import { budgetsApi, serviceOrdersApi, inventoryApi } from '../../services/api';

const DISMISSED_NOTIFICATIONS_KEY = 'papatec_dismissed_notifications';

function getDismissedNotifications(): Set<string> {
  try {
    const stored = localStorage.getItem(DISMISSED_NOTIFICATIONS_KEY);
    return new Set(stored ? JSON.parse(stored) : []);
  } catch {
    return new Set();
  }
}

function saveDismissedNotifications(ids: Set<string>): void {
  try {
    localStorage.setItem(DISMISSED_NOTIFICATIONS_KEY, JSON.stringify(Array.from(ids)));
  } catch {
    // ignore
  }
}

export function Header() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [notificationsAnchor, setNotificationsAnchor] = useState<null | HTMLElement>(null);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => getDismissedNotifications());

  // Sincroniza com localStorage quando muda
  useEffect(() => {
    saveDismissedNotifications(dismissedIds);
  }, [dismissedIds]);

  // ---------------------------------------------------------------------------
  // Notificações REAIS - o badge era um `3` fixo (hardcoded) e o menu sempre
  // mostrava "Nenhuma notificação nova". Agora o contador vem das mesmas
  // métricas do dashboard (chaves iguais => cache compartilhado, sem chamada
  // extra) e cada item leva para a tela correspondente.
  // ---------------------------------------------------------------------------
  const { data: bStats } = useQuery({
    queryKey: ['budgetsStats'],
    queryFn: () => budgetsApi.getStats(),
    refetchInterval: 60_000,
    retry: false,
  });
  const { data: osStats } = useQuery({
    queryKey: ['osStats'],
    queryFn: () => serviceOrdersApi.getStats(),
    refetchInterval: 60_000,
    retry: false,
  });
  const { data: invStats } = useQuery({
    queryKey: ['inventoryStats'],
    queryFn: () => inventoryApi.getStats(),
    refetchInterval: 60_000,
    retry: false,
  });

  const allNotifications: { id: string; text: string; to: string }[] = [];
  const pendingBudgets = bStats?.byStatus?.SENT || 0;
  if (pendingBudgets > 0) {
    allNotifications.push({ id: 'budgets', text: `${pendingBudgets} orçamento(s) aguardando aprovação`, to: '/budgets' });
  }
  const readyOs = osStats?.byStatus?.READY || 0;
  if (readyOs > 0) {
    allNotifications.push({ id: 'os', text: `${readyOs} OS pronta(s) para entrega`, to: '/service-orders' });
  }
  const lowStock = invStats?.lowStock || 0;
  if (lowStock > 0) {
    allNotifications.push({ id: 'stock', text: `${lowStock} peça(s) com estoque abaixo do mínimo`, to: '/inventory' });
  }

  // Filtra notificações dispensadas
  const notifications = allNotifications.filter(n => !dismissedIds.has(n.id));

  const handleProfileMenuOpen = (event: React.MouseEvent<HTMLElement>) => setAnchorEl(event.currentTarget);
  const handleNotificationsOpen = (event: React.MouseEvent<HTMLElement>) => setNotificationsAnchor(event.currentTarget);
  const handleMenuClose = () => { setAnchorEl(null); setNotificationsAnchor(null); };

  const handleLogout = () => { logout(); navigate('/login'); handleMenuClose(); };
  const handleProfile = () => { navigate('/settings'); handleMenuClose(); };

  const handleDismissNotification = (id: string, event: React.MouseEvent) => {
    event.stopPropagation();
    setDismissedIds(prev => new Set([...prev, id]));
  };

  const handleNotificationClick = (to: string) => {
    navigate(to);
    handleMenuClose();
  };

  return (
    <AppBar position="sticky" elevation={1} sx={{ 
      backgroundColor: 'background.paper', 
      borderBottom: 1, 
      borderColor: 'divider',
      color: 'text.primary',
    }}>
      <Toolbar disableGutters>
        {/* Marca PapaTec */}
        <Box
          component="img"
          src="/images/logo-papatec.png"
          alt="Papatec"
          sx={{ height: { xs: 22, sm: 26 }, width: 'auto', mr: 2, display: 'block' }}
        />
        <Box sx={{ flexGrow: 1 }} />
        
        {/* Notificações (contador real - some quando não há nada) */}
        <Tooltip title="Notificações">
          <IconButton onClick={handleNotificationsOpen} color="inherit">
            <Badge badgeContent={notifications.length} color="error">
              <Notifications fontSize="large" />
            </Badge>
          </IconButton>
        </Tooltip>

        {/* Perfil */}
        <Tooltip title="Perfil">
          <IconButton onClick={handleProfileMenuOpen} color="inherit" sx={{ ml: 1 }}>
            <Avatar 
              sx={{ width: 36, height: 36, fontSize: '0.875rem' }} 
              alt={user?.name}
            >
              {user?.name?.charAt(0).toUpperCase()}
            </Avatar>
          </IconButton>
        </Tooltip>

        {/* Menu do usuário */}
        <Menu
          anchorEl={anchorEl}
          open={Boolean(anchorEl)}
          onClose={handleMenuClose}
          transformOrigin={{ horizontal: 'right', vertical: 'top' }}
          anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
        >
          <Box sx={{ px: 2, py: 1 }}>
            <Typography variant="subtitle1" fontWeight={600}>{user?.name}</Typography>
            <Typography variant="caption" color="text.secondary">{user?.email}</Typography>
            <Typography variant="caption" sx={{ 
              display: 'inline-block', 
              mt: 0.5, 
              px: 1, 
              py: 0.25, 
              borderRadius: 1, 
              backgroundColor: 'primary.light', 
              color: 'primary.contrastText',
              textTransform: 'capitalize',
              fontSize: '0.65rem',
            }}>
              {user?.role?.toLowerCase()}
            </Typography>
          </Box>
          <Divider />
          <MenuItem onClick={handleProfile}>
            <Person fontSize="small" sx={{ mr: 1.5 }} />
            Meu Perfil
          </MenuItem>
          <MenuItem onClick={() => { navigate('/settings'); handleMenuClose(); }}>
            <Settings fontSize="small" sx={{ mr: 1.5 }} />
            Configurações
          </MenuItem>
          <Divider />
          <MenuItem onClick={handleLogout} sx={{ color: 'error.main' }}>
            <Logout fontSize="small" sx={{ mr: 1.5, color: 'error.main' }} />
            Sair
          </MenuItem>
        </Menu>

        {/* Menu notificações */}
        <Menu
          anchorEl={notificationsAnchor}
          open={Boolean(notificationsAnchor)}
          onClose={handleMenuClose}
          transformOrigin={{ horizontal: 'right', vertical: 'top' }}
          anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
          PaperProps={{ sx: { width: 320 } }}
        >
          <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }}>
            <Typography variant="subtitle1" fontWeight={600}>Notificações</Typography>
          </Box>
          <Box sx={{ maxHeight: 300, overflow: 'auto' }}>
            {notifications.length === 0 ? (
              <MenuItem disabled>
                <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 2 }}>
                  Nenhuma notificação nova
                </Typography>
              </MenuItem>
            ) : (
              notifications.map((n) => (
                <MenuItem
                  key={n.id}
                  onClick={() => { handleNotificationClick(n.to); }}
                  sx={{ whiteSpace: 'normal', alignItems: 'flex-start', lineHeight: 1.4, py: 1.2, position: 'relative' }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, width: '100%' }}>
                    <Typography variant="body2" sx={{ flex: 1, lineHeight: 1.4 }}>{n.text}</Typography>
                    <IconButton
                      size="small"
                      onClick={(e) => handleDismissNotification(n.id, e)}
                      sx={{ p: 0, ml: 1, color: 'text.secondary', opacity: 0.6 }}
                      aria-label={`Dispensar notificação ${n.id}`}
                    >
                      <Close fontSize="small" />
                    </IconButton>
                  </Box>
                </MenuItem>
              ))
            )}
          </Box>
        </Menu>
      </Toolbar>
    </AppBar>
  );
}