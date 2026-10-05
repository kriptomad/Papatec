import { Box, TextField, Button, List, ListItem, ListItemText, ListItemAvatar, Avatar, Typography, Divider, Chip } from '@mui/material';
import { Send, Visibility, VisibilityOff, Schedule } from '@mui/icons-material';
import { useState, useEffect, useRef } from 'react';
import { useOSRealtime } from '../../hooks/useOSRealtime';
import type { OSMovement } from '../../types';
import { formatDateTime } from '../../utils/formatters';

interface OSRealtimeNotesProps { osId: string; currentUserId: string; currentUserName: string; movements?: any[]; onMovementsChange?: (movements: any[]) => void; }

/** Remove duplicatas preservando a ordem (mesmo id = mesmo movimento). */
function dedupeMovements(list: any[]): any[] {
  const seen = new Set<string>();
  const out: any[] = [];
  for (const m of list) {
    if (!m) continue;
    if (m.id) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
    }
    out.push(m);
  }
  return out;
}

export function OSRealtimeNotes({ osId, currentUserId, currentUserName, movements: initialMovements, onMovementsChange }: OSRealtimeNotesProps) {
  const [noteText, setNoteText] = useState('');
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  // Ref com a lista já mesclada: se duas notas chegarem antes do pai
  // re-renderizar, a segunda não sobrescreve a primeira (initialMovements
  // continuaria desatualizado).
  const allMovementsRef = useRef<any[]>([]);

  const { movements, connected, typingUsers, sendNote, setTyping, loadHistory } = useOSRealtime({
    osId, enabled: true,
    // CORREÇÃO: antes era `onMovementsChange([...(onMovementsChange) || [], movement])`
    // — abria a FUNÇÃO em vez da lista. Como função é truthy, o `|| []` nunca
    // valia e o spread lançava `TypeError: onMovementsChange is not iterable`
    // em CADA nota recebida; o erro era engolido pelo catch do parse e o cache
    // do pai nunca atualizava (falha silenciosa).
    onNote: (movement: any) => { if (onMovementsChange) onMovementsChange(dedupeMovements([...allMovementsRef.current, movement])); },
    onStatusChange: (movement: any) => { if (onMovementsChange) onMovementsChange(dedupeMovements([...allMovementsRef.current, movement])); },
  });

  // Dedup por id: `initialMovements` vem do cache do pai E `movements` é
  // repreenchido por loadHistory() com o MESMO timeline => cada movimento
  // aparecia duas vezes (o sufixo '-index' na key mascarava o duplicado).
  const allMovements = dedupeMovements([...(initialMovements ?? []), ...movements]);
  allMovementsRef.current = allMovements;
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [allMovements.length]);
  useEffect(() => { loadHistory(); }, [loadHistory]);

  // Limpa o timer de "digitando" ao desmontar (senão dispara setState órfão)
  useEffect(() => () => { if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current); }, []);

  const handleTyping = (isTyping: boolean) => { setTyping(isTyping); if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current); if (isTyping) typingTimeoutRef.current = setTimeout(() => setTyping(false), 2000); };
  const handleSend = async () => { if (!noteText.trim() || sending) return; setSending(true); try { await sendNote(noteText.trim()); setNoteText(''); } catch (e) { console.error('Erro ao enviar nota:', e); } finally { setSending(false); } };
  const handleKeyDown = (e: React.KeyboardEvent) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } };
  const formatMovementTime = (dateStr: string) => { try { return formatDateTime(dateStr); } catch { return dateStr; } };
  const isCurrentUser = (userId: string) => userId === currentUserId;
  const getTypingText = () => { const typing = Object.entries(typingUsers).filter(([_, v]: any) => v.isTyping).map(([_, v]: any) => v.name); if (typing.length === 0) return null; if (typing.length === 1) return typing[0] + ' está digitando...'; return typing.join(', ') + ' estão digitando...'; };

  const movementItems = allMovements.map((movement: any, index: number) => (
    <ListItem key={movement.id + '-' + index} sx={{ py: 1 }} disablePadding>
      <ListItemAvatar><Avatar sx={{ width: 32, height: 32, bgcolor: isCurrentUser(movement.userId) ? 'primary.main' : 'secondary.main' }}>{movement.user?.name?.charAt(0).toUpperCase() || '?'}</Avatar></ListItemAvatar>
      <ListItemText primary={
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>{movement.user?.name || 'Usuário'}{isCurrentUser(movement.userId) && <Chip label="Você" size="small" color="primary" variant="outlined" sx={{ ml: 1, height: 20, fontSize: '0.65rem' }} />}</Typography>
          <Typography variant="caption" color="text.secondary">{formatDateTime(movement.createdAt)}</Typography>
          {(movement.fromStatus || movement.toStatus) && movement.fromStatus !== movement.toStatus && <Chip label={movement.fromStatus + ' → ' + movement.toStatus} size="small" color="info" variant="outlined" sx={{ mt: 0.5 }} />}
        </Box>
      } secondary={<Typography variant="body1" sx={{ whiteSpace: 'pre-wrap', bgcolor: isCurrentUser(movement.userId) ? 'primary.light' : 'action.hover', p: 1, borderRadius: 1, maxWidth: '100%' }}>{movement.note || '—'}</Typography>} />
    </ListItem>
  ));

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 400 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1, mb: 1, borderBottom: 1, borderColor: 'divider' }}>
        <Chip label={connected ? 'Conectado' : 'Desconectado'} icon={connected ? <Visibility /> : <VisibilityOff />} color={connected ? 'success' : 'default'} size="small" variant={connected ? 'filled' : 'outlined'} />
        <Typography variant="caption" color="text.secondary">Observações em tempo real — todos veem instantaneamente</Typography>
      </Box>
      {getTypingText() && <Box sx={{ px: 1, py: 0.5, color: 'primary.main', fontStyle: 'italic', fontSize: '0.75rem' }}>{getTypingText()}</Box>}
      <Box sx={{ flex: 1, overflow: 'auto', p: 1, border: 1, borderColor: 'divider', borderRadius: 1, bgcolor: 'background.default' }} role="log" aria-live="polite" aria-label="Observações da OS">
        {allMovements.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 4, color: 'text.secondary' }}><Typography variant="body2">Nenhuma observação ainda</Typography><Typography variant="caption">Digite abaixo para adicionar a primeira nota</Typography></Box>
        ) : (
          <List dense>{movementItems}<div ref={messagesEndRef} /></List>
        )}
      </Box>
      <Divider sx={{ my: 1 }} />
      <Box sx={{ display: 'flex', gap: 1, p: 1 }}>
        <TextField fullWidth multiline rows={2} placeholder="Digite uma observação técnica... (Enter para enviar, Shift+Enter para nova linha)" value={noteText} onChange={(e) => { setNoteText(e.target.value); handleTyping(true); }} onKeyDown={handleKeyDown} variant="outlined" size="small" />
        <Button variant="contained" onClick={handleSend} disabled={!noteText.trim() || sending} startIcon={sending ? <Schedule fontSize="small" /> : <Send />} sx={{ alignSelf: 'flex-end', height: 'fit-content' }}>{sending ? 'Enviando...' : 'Enviar'}</Button>
      </Box>
    </Box>
  );
}