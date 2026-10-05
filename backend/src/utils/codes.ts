import { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

/**
 * Contadores transacionais para códigos únicos de exibição
 * (CLI-0001, FUN-0001, FOR-0001, COM-0001...).
 *
 * O incremento acontece via upsert atômico (INSERT..ON CONFLICT DO UPDATE),
 * então duas criações simultâneas nunca recebem o mesmo número.
 * As linhas são semeadas na migração da Fase 1 a partir dos registros
 * já existentes, garantindo continuidade da sequência.
 */
export async function nextSequence(tx: Tx, key: string): Promise<number> {
  const seq = await tx.sequence.upsert({
    where: { key },
    create: { key, value: 1 },
    update: { value: { increment: 1 } },
  });
  return seq.value;
}

/** Formata o número da sequência: formatCode('CLI', 7) => "CLI-0007". */
export function formatCode(prefix: string, value: number): string {
  return `${prefix}-${String(value).padStart(4, '0')}`;
}
