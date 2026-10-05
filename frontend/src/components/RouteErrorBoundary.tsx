import { Component, ReactNode, ErrorInfo } from 'react';
import { Box, Button, Typography, Alert, AlertTitle, IconButton } from '@mui/material';
import { Refresh, ErrorOutline } from '@mui/icons-material';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Error Boundary a nível de rota.
 * Captura erros em subárvores da rota e permite recuperação sem derrubar a app toda.
 */
export class RouteErrorBoundary extends Component<{ children: ReactNode; fallback?: ReactNode }, { hasError: boolean; error: Error | null }> {
  state: { hasError: boolean; error: Error | null } = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error) {
    console.error('[RouteErrorBoundary] Caught error:', error);
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[RouteErrorBoundary] Error caught:', error, errorInfo);
    // Aqui poderia enviar para serviço de monitoramento (Sentry, etc.)
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
    // Força re-render da subárvore
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      // Se tiver fallback customizado, usa ele
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <Box sx={{ p: 3, textAlign: 'center', minHeight: 300, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <ErrorOutline sx={{ fontSize: 64, color: 'error.main', mb: 2 }} />
          <Typography variant="h5" gutterBottom color="error">
            Erro ao carregar esta seção
          </Typography>
          <Typography color="text.secondary" paragraph>
            Ocorreu um erro ao carregar esta seção. O resto da aplicação continua funcionando.
          </Typography>
          <Alert severity="warning" sx={{ mt: 3, maxWidth: 600, mx: 'auto' }}>
            <AlertTitle>Erro detectado</AlertTitle>
            <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.8rem', whiteSpace: 'pre-wrap' }}>
              {this.state.error?.message}
            </Typography>
          </Alert>
          <Box sx={{ mt: 3, display: 'flex', gap: 2, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Button
              variant="contained"
              startIcon={<Refresh />}
              onClick={() => window.location.reload()}
            >
              Recarregar Página
            </Button>
            <Button
              variant="outlined"
              onClick={() => window.history.back()}
            >
              Voltar
            </Button>
          </Box>
        </Box>
      );
    }

    return this.props.children;
  }
}

export default function withRouteErrorBoundary(children: ReactNode) {
  return <RouteErrorBoundary>{children}</RouteErrorBoundary>;
}