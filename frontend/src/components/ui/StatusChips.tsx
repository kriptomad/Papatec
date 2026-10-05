import { Chip, ChipProps } from '@mui/material';
import { BudgetStatus, OSStatus, PartStatus } from '../../types';

const budgetStatusConfig: Record<BudgetStatus, { color: 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning'; label: string }> = {
  DRAFT: { color: 'default', label: 'Rascunho' },
  SENT: { color: 'info', label: 'Enviado' },
  APPROVED: { color: 'success', label: 'Aprovado' },
  REJECTED: { color: 'error', label: 'Rejeitado' },
  EXPIRED: { color: 'warning', label: 'Expirado' },
  CONVERTED_TO_OS: { color: 'primary', label: 'Convertido em OS' },
};

const osStatusConfig: Record<OSStatus, { color: 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning'; label: string }> = {
  OPEN: { color: 'info', label: 'Aberta' },
  IN_PROGRESS: { color: 'primary', label: 'Em Andamento' },
  WAITING_PARTS: { color: 'warning', label: 'Aguardando Peças' },
  READY: { color: 'success', label: 'Pronta' },
  DELIVERED: { color: 'secondary', label: 'Entregue' },
  CANCELLED: { color: 'error', label: 'Cancelada' },
};

const partStatusConfig: Record<PartStatus, { color: 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning'; label: string }> = {
  ACTIVE: { color: 'success', label: 'Ativa' },
  INACTIVE: { color: 'default', label: 'Inativa' },
};

export function BudgetStatusChip({ status, ...props }: { status: BudgetStatus } & ChipProps) {
  const config = budgetStatusConfig[status];
  return <Chip label={config.label} color={config.color} size="small" variant="outlined" {...props} />;
}

export function OSStatusChip({ status, ...props }: { status: OSStatus } & ChipProps) {
  const config = osStatusConfig[status];
  return <Chip label={config.label} color={config.color} size="small" variant="outlined" {...props} />;
}

export function PartStatusChip({ status, ...props }: { status: PartStatus } & ChipProps) {
  const config = partStatusConfig[status];
  return <Chip label={config.label} color={config.color} size="small" variant="outlined" {...props} />;
}

export function GenericStatusChip({ status, type }: { status: string; type: 'budget' | 'os' | 'part' }) {
  switch (type) {
    case 'budget': return <BudgetStatusChip status={status as BudgetStatus} />;
    case 'os': return <OSStatusChip status={status as OSStatus} />;
    case 'part': return <PartStatusChip status={status as PartStatus} />;
  }
}