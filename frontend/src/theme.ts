import { createTheme } from '@mui/material/styles';

export const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#1e88e5',
      light: '#64b5f6',
      dark: '#1565c0',
      contrastText: '#ffffff',
    },
    secondary: {
      main: '#ff6d00',
      light: '#ffab40',
      dark: '#c43c00',
      contrastText: '#ffffff',
    },
    background: {
      default: '#0d1117',
      paper: '#161b22',
    },
    success: {
      main: '#3fb950',
      light: '#56d364',
      dark: '#2ea043',
    },
    warning: {
      main: '#d29922',
      light: '#e3b341',
      dark: '#9e6a03',
    },
    error: {
      main: '#f85149',
      light: '#ff7b72',
      dark: '#cf222e',
    },
    info: {
      main: '#58a6ff',
      light: '#79b8ff',
      dark: '#388bfd',
    },
    divider: 'rgba(255,255,255,0.12)',
    text: {
      primary: '#e6edf3',
      secondary: '#8b949e',
      disabled: '#484f58',
    },
    action: {
      active: '#e6edf3',
      hover: 'rgba(255,255,255,0.08)',
      selected: 'rgba(30,136,229,0.16)',
      disabled: 'rgba(255,255,255,0.26)',
      disabledBackground: 'rgba(255,255,255,0.12)',
    },
  },
  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
    h1: { fontWeight: 700, fontSize: '2.5rem' },
    h2: { fontWeight: 600, fontSize: '2rem' },
    h3: { fontWeight: 600, fontSize: '1.75rem' },
    h4: { fontWeight: 600, fontSize: '1.5rem' },
    h5: { fontWeight: 600, fontSize: '1.25rem' },
    h6: { fontWeight: 600, fontSize: '1rem' },
    button: { textTransform: 'none', fontWeight: 500 },
  },
  shape: {
    borderRadius: 8,
  },
  shadows: [
    'none',
    '0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.06)',
    '0 4px 6px rgba(0,0,0,0.07), 0 2px 4px rgba(0,0,0,0.06)',
    '0 10px 15px rgba(0,0,0,0.08), 0 4px 6px rgba(0,0,0,0.05)',
    '0 20px 25px rgba(0,0,0,0.09), 0 10px 10px rgba(0,0,0,0.04)',
    ...Array(20).fill('0 25px 50px rgba(0,0,0,0.1)'),
  ] as any,
  components: {
    MuiButton: {
      styleOverrides: {
        root: { borderRadius: 8, padding: '8px 16px' },
        contained: { boxShadow: 'none', '&:hover': { boxShadow: '0 2px 8px rgba(0,0,0,0.15)' } },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: { boxShadow: '0 1px 3px rgba(0,0,0,0.08)', border: '1px solid rgba(0,0,0,0.04)' },
      },
    },
    MuiTextField: {
      defaultProps: { variant: 'outlined', size: 'small' },
    },
    MuiTableCell: {
      styleOverrides: {
        head: { fontWeight: 600, // era '#f8f9fa' (resto de tema CLARO): texto
            // text.primary (#e6edf3, quase branco) sobre fundo quase branco =>
            // todo cabecalho de tabela do ERP ficava ilegivel no tema dark.
            backgroundColor: '#1c2128', color: 'text.primary' },
      },
    },
    MuiChip: {
      styleOverrides: { root: { fontWeight: 500 } },
    },
  },
});