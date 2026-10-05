import { Box, Card, CardContent, TextField, Button, Typography, Alert, CircularProgress, Grid, Chip, Divider } from '@mui/material';
import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { authApi } from '../../services/api';
import { PrimaryButton, SecondaryButton } from '../../components/ui/Buttons';
import { formatDate } from '../../utils/formatters';

export function LicensePage() {
  const [licenseJson, setLicenseJson] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const { data: license, isLoading, refetch } = useQuery({
    queryKey: ['license'],
    queryFn: () => authApi.getLicenseStatus(),
  });

  const installMutation = useMutation({
    mutationFn: (json: string) => authApi.installLicense(json),
    onSuccess: (result: any) => { 
      setSuccess(result?.message || 'Licença instalada com sucesso'); 
      setLicenseJson(''); 
      refetch(); 
    },
    onError: (err: any) => setError(err.response?.data?.message || 'Erro ao instalar licença'),
  });

  const handleInstall = () => {
    if (!licenseJson.trim()) {
      setError('Cole o JSON da licença');
      return;
    }
    try {
      JSON.parse(licenseJson);
      installMutation.mutate(licenseJson);
    } catch {
      setError('JSON inválido');
    }
  };

  if (isLoading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>;

  // Resposta real de /auth/license/status: { isLicensed, hardwareId, license:{...} }
  // (o backend NUNCA envia `isValid`/`cnpj`/`companyName` - campos legados).
  const status: any = license;
  const inner: any = status?.license || {};
  const isValid = status?.isLicensed === true || inner?.active === true;
  const daysRemaining = inner?.daysRemaining ?? null;

  return (
    <Box>
      <Typography variant="h4" fontWeight={700} sx={{ mb: 3 }}>Gerenciamento de Licença</Typography>

      {error && <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 3 }} onClose={() => setSuccess('')}>{success}</Alert>}

      {/* Status da Licença */}
      <Card sx={{ mb: 3, borderLeft: isValid ? '4px solid #4caf50' : '4px solid #f44336' }}>
        <CardContent>
          <Grid container spacing={3} alignItems="center">
            <Grid item xs={12} sm={4}>
              <Typography variant="h6" color={isValid ? 'success.main' : 'error.main'} fontWeight={700}>
                {isValid ? '✓ Licença Válida' : '✗ Licença Inválida/Expirada'}
              </Typography>
              {daysRemaining !== null && daysRemaining >= 0 && (
                <Typography variant="body2" color="text.secondary">
                  {daysRemaining === 0 ? 'Vitalícia' : `${daysRemaining} dia(s) restante(s)`}
                </Typography>
              )}
            </Grid>
            <Grid item xs={12} sm={4}>
              <Typography variant="body2" color="text.secondary">Hardware ID</Typography>
              <Typography variant="h6" fontWeight={500} fontFamily="monospace">{status?.hardwareId || 'N/A'}</Typography>
            </Grid>
            <Grid item xs={12} sm={4}>
              <Typography variant="body2" color="text.secondary">Cliente</Typography>
              <Typography variant="h6" fontWeight={500}>{inner?.clientName || 'N/A'}</Typography>
            </Grid>
            <Grid item xs={12} sm={4}>
              <Typography variant="body2" color="text.secondary">Emitida em</Typography>
              <Typography variant="body1">{inner?.issuedAt ? formatDate(new Date(inner.issuedAt).toISOString()) : '-'}</Typography>
            </Grid>
            <Grid item xs={12} sm={4}>
              <Typography variant="body2" color="text.secondary">Expira em</Typography>
              <Typography variant="body1">
                {inner?.expiresAt
                  ? formatDate(new Date(inner.expiresAt).toISOString())
                  : 'Vitalícia'}
              </Typography>
            </Grid>
            <Grid item xs={12} sm={4}>
              <Typography variant="body2" color="text.secondary">Máx. Usuários</Typography>
              <Typography variant="body1">{inner?.maxUsers ?? 'Ilimitado'}</Typography>
            </Grid>
            <Grid item xs={12}>
              <Typography variant="body2" color="text.secondary">Funcionalidades</Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1 }}>
                {inner?.features?.map((f: string) => (
                  <Chip key={f} label={f} size="small" color="primary" variant="outlined" />
                ))}
              </Box>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {/* Instalar Nova Licença */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 3 }}>Instalar/Atualizar Licença</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2, display: 'block' }}>
            Cole o token JWT (linha única) emitido pela Filitech. Também aceita
            um objeto JSON no formato {'{"token":"eyJhbGciOiJSUzI1NiIs..."}'}:
          </Typography>
          <TextField
            fullWidth
            multiline
            rows={10}
            label="Token JWT da Licença"
            placeholder="eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJod2lkIjoiRThBLTdCMkMtNTlEOS1QMDAyIn0...."
            value={licenseJson}
            onChange={(e) => setLicenseJson(e.target.value)}
            sx={{ mb: 2, fontFamily: 'monospace', fontSize: '0.8rem' }}
          />
          <Box sx={{ display: 'flex', gap: 2 }}>
            <PrimaryButton onClick={handleInstall} loading={installMutation.isPending}>
              Instalar Licença
            </PrimaryButton>
            <SecondaryButton onClick={() => setLicenseJson('')}>Limpar</SecondaryButton>
          </Box>
        </CardContent>
      </Card>

      {/* Instruções */}
      <Card>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 2 }}>Como obter uma licença</Typography>
          <Box sx={{ lineHeight: 1.8 }}>
            <Typography variant="body1" sx={{ mb: 1 }}>
              <strong>1.</strong> Entre em contato com a <strong>Filitech</strong> para adquirir sua licença.
            </Typography>
            <Typography variant="body1" sx={{ mb: 1 }}>
              <strong>2.</strong> Você receberá um arquivo <code>license.json</code> ou o JSON por email.
            </Typography>
            <Typography variant="body1" sx={{ mb: 1 }}>
              <strong>3.</strong> Cole o conteúdo JSON completo na área acima e clique em "Instalar Licença".
            </Typography>
            <Typography variant="body1" sx={{ mb: 1 }}>
              <strong>4.</strong> O sistema validará a assinatura digital e ativará as funcionalidades.
            </Typography>
            <Divider sx={{ my: 2 }} />
            <Typography variant="body2" color="text.secondary">
              <strong>Nota:</strong> A licença é vinculada ao CNPJ da empresa. Para servidores com múltiplas máquinas,
              a licença deve ser instalada apenas no servidor principal (host). As máquinas clientes acessam via navegador.
            </Typography>
          </Box>
        </CardContent>
      </Card>

      {/* Debug info para admin */}
      {license && (
        <Card sx={{ mt: 3 }}>
          <CardContent>
            <Typography variant="h6" sx={{ mb: 2 }}>Dados Brutos (Debug)</Typography>
            <TextField
              fullWidth
              multiline
              rows={8}
              value={JSON.stringify(license, null, 2)}
              InputProps={{ readOnly: true, style: { fontFamily: 'monospace', fontSize: '0.75rem' } }}
            />
          </CardContent>
        </Card>
      )}
    </Box>
  );
}