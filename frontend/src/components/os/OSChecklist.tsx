import { Box, Checkbox, Typography, Chip, IconButton, Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, List, ListItem, ListItemText } from '@mui/material';
import { Add, Edit, Delete, CheckCircle } from '@mui/icons-material';
import { useState, useEffect } from 'react';

interface ChecklistItem { label: string; done: boolean; }

export function OSChecklist({ checklist, onChange, editable = true, title = 'Checklist do Servico' }: { checklist: ChecklistItem[] | null | undefined; onChange: (checklist: ChecklistItem[]) => void; editable?: boolean; title?: string; }) {
  const [items, setItems] = useState<ChecklistItem[]>(checklist || []);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [newLabel, setNewLabel] = useState('');

  useEffect(() => { setItems(checklist || []); }, [checklist]);

  const handleToggle = (index: number) => { const newItems = [...items]; newItems[index] = { ...newItems[index], done: !newItems[index].done }; setItems(newItems); onChange(newItems); };
  const handleAdd = () => { if (!newLabel.trim()) return; const newItems = [...items, { label: newLabel.trim(), done: false }]; setItems(newItems); onChange(newItems); setNewLabel(''); };
  const handleEdit = (index: number) => { setEditingIndex(index); setNewLabel(items[index].label); setDialogOpen(true); };
  const handleSaveEdit = () => { if (!newLabel.trim() || editingIndex === null) return; const newItems = [...items]; newItems[editingIndex] = { ...newItems[editingIndex], label: newLabel.trim() }; setItems(newItems); onChange(newItems); setEditingIndex(null); setNewLabel(''); setDialogOpen(false); };
  const handleDelete = (index: number) => { const newItems = items.filter((_, i) => i !== index); setItems(newItems); onChange(newItems); };
  const openAddDialog = () => { setEditingIndex(null); setNewLabel(''); setDialogOpen(true); };

  const itemRows = items.map((item, index) => (
    <ListItem key={index} sx={{ py: 1 }} disablePadding>
      <ListItemText primary={
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Checkbox checked={item.done} onChange={() => handleToggle(index)} disabled={!editable} color="primary" />
          <Typography variant="body1" sx={{ textDecoration: item.done ? 'line-through' : 'none', color: item.done ? 'text.secondary' : 'text.primary', flex: 1 }}>{item.label}</Typography>
          {editable && (
            <Box>
              <IconButton size="small" onClick={() => handleEdit(index)} aria-label="Editar"><Edit fontSize="small" /></IconButton>
              <IconButton size="small" onClick={() => handleDelete(index)} aria-label="Excluir" color="error"><Delete fontSize="small" /></IconButton>
            </Box>
          )}
        </Box>
      } secondary={<Chip label={item.done ? 'Concluido' : 'Pendente'} icon={item.done ? <CheckCircle fontSize="small" /> : undefined} color={item.done ? 'success' : 'default'} size="small" variant={item.done ? 'filled' : 'outlined'} />} />
    </ListItem>
  ));

  return (
    <Box sx={{ p: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6">{title}</Typography>
        {editable && <Button startIcon={<Add />} variant="outlined" size="small" onClick={openAddDialog}>Adicionar Item</Button>}
      </Box>
      {items.length === 0 ? (
        <Box sx={{ textAlign: 'center', py: 4, color: 'text.secondary' }}>
          <Typography>Nenhum item no checklist</Typography>
          {editable && <Typography variant="caption">Clique em "Adicionar Item" para comecar</Typography>}
        </Box>
      ) : (
        <List dense>{itemRows}</List>
      )}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editingIndex !== null ? 'Editar Item' : 'Novo Item do Checklist'}</DialogTitle>
        <DialogContent><TextField fullWidth label="Descricao do Item" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} autoFocus multiline rows={2} /></DialogContent>
        <DialogActions><Button onClick={() => setDialogOpen(false)}>Cancelar</Button><Button variant="contained" onClick={editingIndex !== null ? handleSaveEdit : handleAdd}>{editingIndex !== null ? 'Salvar' : 'Adicionar'}</Button></DialogActions>
      </Dialog>
    </Box>
  );
}