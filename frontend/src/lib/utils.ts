import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(value)
}

export function formatDate(date: string | Date): string {
  const isUtcMidnight = typeof date === 'string' && /T00:00:00\.000Z$/.test(date);
  const isDayOnly = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date);
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    ...(!isUtcMidnight && !isDayOnly ? { hour: '2-digit', minute: '2-digit' } : {}),
    ...(isUtcMidnight ? { timeZone: 'UTC' } : {}),
  }).format(new Date(date))
}