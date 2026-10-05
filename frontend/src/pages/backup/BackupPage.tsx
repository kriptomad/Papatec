import { Box, Card, CardContent, Typography, Button, Alert, CircularProgress, TableContainer, Table, TableHead, TableRow, TableCell, TableBody, IconButton, Divider, Grid } from '@mui/material';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { backupApi } from '../../services/api';
import { PrimaryButton, SecondaryButton, DangerButton } from '../../components/ui/Buttons';
import { formatBytes } from '../../utils/formatters';
import { Restore, Delete, CloudUpload, CloudDownload, Sync, ContentCopy } from '@mui/icons-material';
import { Tooltip } from '@mui/material';

export function BackupPage() {
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const { data: backups, isLoading, refetch } = useQuery({
    queryKey: ['backups'],
    queryFn: () => backupApi.list(),
  });

  const { data: backupConfig } = useQuery({
    queryKey: ['backupConfig'],
    queryFn: () => backupApi.getConfig(),
  });

  const createMutation = useMutation({
    mutationFn: () => backupApi.create(),
    onSuccess: (result: any) => { setSuccess(`Backup criado: ${result.file}`); refetch(); },
    onError: (err: any) => setError(err.response?.data?.message || 'Erro ao criar backup'),
  });

  const restoreMutation = useMutation({
    mutationFn: (file: string) => backupApi.restore(file),
    onSuccess: () => { setSuccess('Backup restaurado com sucesso!'); refetch(); },
    onError: (err: any) => setError(err.response?.data?.message || 'Erro ao restaurar'),
  });

  const deleteMutation = useMutation({
    mutationFn: (file: string) => backupApi.delete(file),
    onSuccess: () => { setSuccess('Backup excluído'); refetch(); },
    onError: (err: any) => setError(err.response?.data?.message || 'Erro ao excluir'),
  });

  const syncMutation = useMutation({
    mutationFn: (file: string) => backupApi.sync(file),
    onSuccess: (result) => { 
      const msg = (result as any).syncedTo
        ? `Sincronizado para: ${(result as any).syncedTo}`
        : 'Nenhum destino configurado';
      setSuccess(msg);
      if (!(result as any).syncedTo) setError('Sincronização não concluída. Verifique o caminho de rede configurado.');
    },
    onError: (err: any) => setError(err.response?.data?.message || 'Erro ao sincronizar'),
  });

  const cleanupMutation = useMutation({
    mutationFn: (days: number) => backupApi.cleanup(days),
    onSuccess: (result: any) => { setSuccess(`${result.removed} backups antigos removidos`); refetch(); },
    onError: (err: any) => setError(err.response?.data?.message || 'Erro na limpeza'),
  });

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3, flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography variant="h4" fontWeight={700} sx={{ mb: 0.5 }}>Backup & Sincronização</Typography>
          <Typography variant="body1" color="text.secondary">Gerencie backups automáticos e redundância entre máquinas</Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <PrimaryButton startIcon={<CloudUpload />} onClick={() => createMutation.mutate()} loading={createMutation.isPending}>
            Criar Backup Agora
          </PrimaryButton>
        </Box>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 3 }} onClose={() => setSuccess('')}>{success}</Alert>}

      {/* Info Cards */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        <Grid item xs={12} sm={6} lg={3}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Box sx={{ p: 1.5, borderRadius: 2, backgroundColor: 'primary.light', color: 'primary.main' }}>
                  <CloudDownload fontSize="large" />
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">Total Backups</Typography>
                  <Typography variant="h6" fontWeight={700}>{backups?.length || 0}</Typography>
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} lg={3}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Box sx={{ p: 1.5, borderRadius: 2, backgroundColor: 'success.light', color: 'success.main' }}>
                  <Sync fontSize="large" />
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">Último Backup</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {backups?.[0] ? new Date(backups[0].createdAt).toLocaleString('pt-BR') : 'Nenhum'}
                  </Typography>
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} lg={3}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Box sx={{ p: 1.5, borderRadius: 2, backgroundColor: 'info.light', color: 'info.main' }}>
                  <ContentCopy fontSize="large" />
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">Tamanho Total</Typography>
                  <Typography variant="h6" fontWeight={700}>
                    {backups?.reduce((sum: number, b: any) => sum + b.size, 0) || 0 > 0 
                      ? formatBytes(backups.reduce((sum: number, b: any) => sum + b.size, 0)) 
                      : '0 B'}
                  </Typography>
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} lg={3}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Box sx={{ p: 1.5, borderRadius: 2, backgroundColor: 'warning.light', color: 'warning.main' }}>
                  <CloudUpload fontSize="large" />
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">Destino dos Backups</Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ wordBreak: 'break-all' }}>
                    {backupConfig?.path || backupConfig?.backup_path || 'Padrão (BACKUP_NETWORK_PATH)'}
                    {backupConfig?.schedule ? ` · ${backupConfig.schedule}` : ''}
                  </Typography>
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Lista de Backups */}
      <Card>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 2 }}>Histórico de Backups</Typography>
          {isLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>
          ) : backups && backups.length > 0 ? (
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Arquivo</TableCell>
                    <TableCell align="right">Tamanho</TableCell>
                    <TableCell align="right">Data de Criação</TableCell>
                    <TableCell align="center">Ações</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {backups.map((b: any) => (
                    <TableRow key={b.name} hover>
                      <TableCell>
                        <Box>
                          <Typography variant="body2" fontFamily="monospace" fontSize="0.85rem">{b.name}</Typography>
                        </Box>
                      </TableCell>
                      <TableCell align="right">{formatBytes(b.size)}</TableCell>
                      <TableCell align="right">{new Date(b.createdAt).toLocaleString('pt-BR')}</TableCell>
                      <TableCell align="center">
                        <Tooltip title="Restaurar (CUIDADO: sobrescreve dados)">
                          <IconButton size="small" color="primary" onClick={() => { 
                            if(window.confirm(`Restaurar backup ${b.name}?\n\nATENÇÃO: Isso vai SOBRESCREVER todos os dados atuais!`)) 
                              restoreMutation.mutate(b.name); 
                          }}>
                            <Restore fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Sincronizar para máquinas remotas">
                          <IconButton size="small" color="info" onClick={() => syncMutation.mutate(b.name)} disabled={syncMutation.isPending}>
                            <Sync fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Excluir">
                          <IconButton size="small" color="error" onClick={() => { 
                            if(window.confirm(`Excluir backup ${b.name}?`)) deleteMutation.mutate(b.name); 
                          }}>
                            <Delete fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          ) : (
            <Box sx={{ textAlign: 'center', py: 4 }}>
              <Typography variant="body1" color="text.secondary">Nenhum backup encontrado</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                Clique em "Criar Backup Agora" para gerar o primeiro backup
              </Typography>
            </Box>
          )}

          <Divider sx={{ my: 3 }} />
          
          {/* Limpeza */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
            <Typography variant="body2" color="text.secondary">
              Limpeza automática: remove backups com mais de 30 dias (configurável no .env)
            </Typography>
            <SecondaryButton onClick={() => { 
              const days = parseInt(prompt('Remover backups com mais de quantos dias?', '30') || '30');
              if(days > 0) cleanupMutation.mutate(days);
            }}>
              Limpar Backups Antigos
            </SecondaryButton>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}