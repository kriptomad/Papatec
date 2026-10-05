import { Component, ReactNode } from 'react';
import { Box, Button, Typography, Alert, AlertTitle } from '@mui/material';
import { Refresh } from '@mui/icons-material';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ErrorBoundary] Error caught:', error, errorInfo);
    // Aqui poderia enviar para serviço de monitoramento (Sentry, etc.)
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div style={{ padding: 24, textAlign: 'center' }}>
          <div style={{ color: '#d32f2f', marginBottom: 16 }}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
            </svg>
          </div>
          <Typography variant="h6" gutterBottom>Algo deu errado</Typography>
          <Typography color="text.secondary" paragraph>
            Ocorreu um erro inesperado. Tente recarregar a página ou entre em contato com o suporte se o problema persistir.
          </Typography>
          <details style={{ textAlign: 'left', marginTop: 16, maxWidth: 600, margin: '16px auto 0' }}>
            <summary style={{ cursor: 'pointer', color: 'text.secondary' }}>Detalhes técnicos</summary>
            <pre style={{ marginTop: 8, padding: 12, background: '#f5f5f5', borderRadius: 4, overflow: 'auto', textAlign: 'left', fontSize: 12 }}>
              {this.state.error?.message}
              <br />
              {this.state.error?.stack}
            </pre>
          </details>
          <button
            onClick={this.handleRetry}
            style={{
              marginTop: 24,
              padding: '10px 24px',
              background: '#1976d2',
              color: 'white',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 14
            }}
          >
            Tentar Novamente
          </button>
        </div>
      );
    }

    // SEM ESTE RETURN a render() devolve `undefined` quando NAO ha erro.
    // O React 18 trata undefined como "renderizar nada" e a raiz inteira fica
    // vazia (root.innerHTML === '') -> tela em branco permanente, sem nenhum
    // erro no console. E exatamente o sintoma "so o banner verde + fundo azul".
    return this.props.children;
  }
}

export default ErrorBoundary;