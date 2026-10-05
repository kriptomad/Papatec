import type { ChipProps } from '@mui/material';
import type { UserRole } from '../../types';
import { formatCpf, formatCnpj } from '../../utils/formatters';

/** Opções de cargo (papéis) exibidas nos formulários e filtros. */
export const ROLE_OPTIONS: Array<{ value: UserRole; label: string }> = [
  { value: 'ADMIN', label: 'Administrador' },
  { value: 'TECHNICIAN', label: 'Técnico' },
  { value: 'RECEPTIONIST', label: 'Recepção' },
];

/** Cor do chip de cargo (padrão visual das listas). */
export const ROLE_COLORS: Record<UserRole, ChipProps['color']> = {
  ADMIN: 'error',
  TECHNICIAN: 'info',
  RECEPTIONIST: 'secondary',
};

/** Rótulo pt-BR do cargo. */
export function roleLabel(role?: UserRole | string | null): string {
  const found = ROLE_OPTIONS.find((option) => option.value === role);
  if (found) return found.label;
  return role ? String(role) : '—';
}

/** CPF ou CNPJ formatado — prioriza CNPJ quando existir. */
export function primaryDoc(doc: { cpf?: string | null; cnpj?: string | null }): string {
  if (doc.cnpj) return formatCnpj(doc.cnpj);
  if (doc.cpf) return formatCpf(doc.cpf);
  return '—';
}

/** Exibe '—' quando o valor está vazio (evita mostrar 0/undefined errado). */
export function display(value: any): any {
  if (value === undefined || value === null || value === '') return '—';
  return value;
}
