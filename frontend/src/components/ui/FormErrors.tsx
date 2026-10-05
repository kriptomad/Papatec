import { Alert, AlertTitle, Box, Chip, List, ListItem, ListItemText, Typography } from '@mui/material';

/**
 * Briefing: o usuário precisa saber EXATAMENTE quais campos estão faltando.
 * O backend devolve error.fields = { "campo": "mensagem" } no envelope.
 */

export function getApiError(err: any): { message: string; fields?: Record<string, string> | null } {
  const data = err?.response?.data;
  const message =
    data?.error?.message ||
    data?.message ||
    (typeof data === 'string' ? data : '') ||
    err?.message ||
    'Erro inesperado';
  const fields = data?.error?.fields || data?.fields || null;
  return { message, fields };
}

interface FormErrorsProps {
  /** Erro capturado no catch (axios error) OU string já formatada */
  error: any;
  onClose?: () => void;
  /** Mapa extra de erros locais (react-hook-form) campo -> mensagem */
  localFields?: Record<string, string>;
  title?: string;
}

export default function FormErrors({ error, onClose, localFields, title }: FormErrorsProps) {
  if (!error && (!localFields || Object.keys(localFields).length === 0)) return null;

  let message = '';
  let fields: Record<string, string> = {};
  if (error) {
    if (typeof error === 'string') {
      message = error;
    } else {
      const parsed = getApiError(error);
      message = parsed.message;
      fields = parsed.fields || {};
    }
  }
  if (localFields) fields = { ...fields, ...localFields };
  const fieldEntries = Object.entries(fields);

  if (!message && fieldEntries.length === 0) return null;

  return (
    <Alert severity="error" sx={{ mb: 3 }} onClose={onClose}>
      {title ? <AlertTitle>{title}</AlertTitle> : null}
      {message ? <Typography variant="body2">{message}</Typography> : null}
      {fieldEntries.length > 0 ? (
        <Box sx={{ mt: 1 }}>
          <Typography variant="caption" sx={{ fontWeight: 'bold' }}>
            Campos com problema:
          </Typography>
          <List dense sx={{ py: 0 }}>
            {fieldEntries.map(([field, msg]) => (
              <ListItem key={field} sx={{ py: 0, px: 0 }}>
                <Chip size="small" color="error" variant="outlined" label={field} sx={{ mr: 1 }} />
                <ListItemText primary={msg} primaryTypographyProps={{ variant: 'body2' }} />
              </ListItem>
            ))}
          </List>
        </Box>
      ) : null}
    </Alert>
  );
}
