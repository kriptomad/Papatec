import { Box, Container, useMediaQuery, useTheme } from '@mui/material';
import { Outlet, useNavigate } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { useAuth } from '../../store/auth';
import { useEffect } from 'react';
import { SidebarProvider, useSidebar } from './SidebarContext';
import './MainLayout.css';

function MainContent() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const { collapsed } = useSidebar();
  const { isAuthenticated, license } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (isAuthenticated && license && license.active === false) {
      navigate('/license', { replace: true });
    }
  }, [isAuthenticated, license, navigate]);

  const drawerWidth = collapsed ? 72 : 280;

  // Use a plain <main> element with inline styles to avoid CSS conflicts
  // The key trick: use a unique key based on collapsed state to force re-render
  return (
    <main
      style={{
        marginLeft: isMobile ? 0 : drawerWidth,
        transition: 'margin-left 0.25s ease',
        flexGrow: 1,
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        minHeight: '100vh',
        backgroundColor: theme.palette.background.default,
      }}
      key={collapsed ? 'collapsed' : 'expanded'}
    >
      <Header />
      <Container maxWidth="xl" sx={{ flexGrow: 1, p: 3, width: '100%' }}>
        <Outlet />
      </Container>
    </main>
  );
}

export function MainLayout() {
  return (
    <SidebarProvider>
      <Box sx={{ display: 'flex', minHeight: '100vh', backgroundColor: 'background.default' }}>
        <Sidebar />
        <MainContent />
      </Box>
    </SidebarProvider>
  );
}