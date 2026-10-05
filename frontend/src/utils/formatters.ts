export function formatCurrency(value: number | undefined | null): string {
  if (value === undefined || value === null) return 'R$ 0,00';
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
  }).format(value);
}

export function formatDate(dateString: string | Date, withTime = false): string {
  // Campos de data apenas (Prisma serializa como UTC midnight) precisam ser
  // interpretados/formatados em UTC para não voltar um dia em UTC-3.
  const isUtcMidnight = typeof dateString === 'string' && /T00:00:00\.000Z$/.test(dateString);
  const isDayOnly = typeof dateString === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateString);
  const date = typeof dateString === 'string' ? new Date(dateString) : dateString;
  if (isNaN(date.getTime())) return 'Data inválida';

  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    ...(withTime && !isUtcMidnight && !isDayOnly ? { hour: '2-digit', minute: '2-digit' } : {}),
    ...(isUtcMidnight ? { timeZone: 'UTC' } : {}),
  }).format(date);
}

export function formatDateTime(dateString: string | Date): string {
  return formatDate(dateString, true);
}

export function formatPhone(phone: string | undefined | null): string {
  if (!phone) return '';
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length === 11) {
    return cleaned.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
  }
  if (cleaned.length === 10) {
    return cleaned.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
  }
  return phone;
}

export function formatCpf(cpf: string): string {
  const cleaned = cpf.replace(/\D/g, '');
  if (cleaned.length === 11) {
    return cleaned.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  }
  return cpf;
}

export function formatCnpj(cnpj: string): string {
  const cleaned = cnpj.replace(/\D/g, '');
  if (cleaned.length === 14) {
    return cleaned.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  }
  return cnpj;
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function generateId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

export function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}

export function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export function truncate(str: string, length: number): string {
  if (str.length <= length) return str;
  return str.slice(0, length) + '...';
}

export function calculateMargin(costPrice: number, salePrice: number): string {
  if (costPrice <= 0) return '-';
  return (((salePrice - costPrice) / costPrice) * 100).toFixed(1) + '%';
}

export function isLowStock(quantity: number, minStock: number): boolean {
  return quantity <= minStock;
}

export function getStatusColor(status: string): 'success' | 'warning' | 'error' | 'info' | 'default' {
  const colors: Record<string, any> = {
    APPROVED: 'success',
    DELIVERED: 'success',
    ACTIVE: 'success',
    READY: 'success',
    SENT: 'info',
    IN_PROGRESS: 'primary',
    OPEN: 'info',
    WAITING_PARTS: 'warning',
    REJECTED: 'error',
    CANCELLED: 'error',
    EXPIRED: 'warning',
    INACTIVE: 'default',
    DRAFT: 'default',
    CONVERTED_TO_OS: 'primary',
  };
  return colors[status] || 'default';
}