import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider, keepPreviousData } from '@tanstack/react-query'
import { ThemeProvider } from '@mui/material/styles'
import { theme } from './theme'
import { AuthProvider } from './store/auth'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 401/403/404 não adianta repetir: o interceptor já trata e redireciona.
      retry: (failureCount, error: any) => {
        const status = error?.response?.status
        if (status === 401 || status === 403 || status === 404) return false
        return failureCount < 2
      },
      refetchOnWindowFocus: false,
      staleTime: 30_000,
      // Mantém os dados anteriores visíveis enquanto a nova busca roda.
      // Sem isto, cada tecla numa busca muda isLoading -> a página inteira é
      // desmontada e o TextField perde o foco depois do 1o caractere.
      placeholderData: keepPreviousData,
    },
  },
})

const root = ReactDOM.createRoot(document.getElementById('root')!)

root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <ThemeProvider theme={theme}>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <AuthProvider>
              <App />
            </AuthProvider>
          </BrowserRouter>
        </QueryClientProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </React.StrictMode>,
)

// Diagnóstico real: o try/catch em volta de root.render() NÃO captura erros de
// renderização no React 18 (a render é assíncrona e os erros vão para os
// ErrorBoundary). Estes listeners sim pegam o que escapa.
window.addEventListener('error', (e) => {
  console.error('[global] uncaught error:', e.error ?? e.message)
})
window.addEventListener('unhandledrejection', (e) => {
  console.error('[global] unhandled rejection:', e.reason)
})
