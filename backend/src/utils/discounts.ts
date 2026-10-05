import { prisma } from '../db/prisma';
import { badRequest } from '../http/envelope';
import { settingsService } from '../services/settings.service';

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Briefing B3/A1: valor do desconto de um item (% ou R$), limitado à base.
 * @param base      valor bruto do item (qty * unitPrice)
 * @param discount  valor informado (percentual ou reais)
 * @param discountType 'PERCENT' | 'VALUE'
 */
export function discountValueFor(base: number, discount: number, discountType: string): number {
  const raw = Math.max(0, Number(discount) || 0);
  const value = discountType === 'PERCENT' ? (base * raw) / 100 : raw;
  return round2(Math.min(value, Math.max(0, base)));
}

/**
 * Briefing B3: valida o desconto de um item contra as regras do admin.
 *
 * Teto por item (Part.maxDiscountPercent e/ou Part.maxDiscountValue — o mais
 * restritivo quando os dois existem) e teto global `max_discount_pct` (% do
 * valor do item, definido nas configurações — 100 = sem restrição).
 *
 * @returns o valor de desconto aprovado (R$)
 */
export async function assertDiscountAllowed(opts: {
  partId?: string | null;
  base: number;
  discount: number;
  discountType: string;
  label: string;
}): Promise<number> {
  const { partId, base, discount, discountType, label } = opts;
  const value = discountValueFor(base, discount, discountType);
  if (value <= 0) return 0;

  let max = Math.max(0, base);

  // Teto global (% do valor do item) — default 100 = liberado
  const globalPct = Number(await settingsService.get<number>('max_discount_pct'));
  if (Number.isFinite(globalPct)) {
    max = Math.min(max, round2((base * Math.min(100, Math.max(0, globalPct))) / 100));
  }

  // Teto do item (peça de estoque) — % e/ou R$
  if (partId) {
    const part = await prisma.part.findUnique({ where: { id: partId } });
    if (part) {
      const caps: number[] = [];
      if (part.maxDiscountPercent !== null && part.maxDiscountPercent !== undefined) {
        caps.push(round2((base * part.maxDiscountPercent) / 100));
      }
      if (part.maxDiscountValue !== null && part.maxDiscountValue !== undefined) {
        caps.push(round2(part.maxDiscountValue));
      }
      if (caps.length) max = Math.min(max, ...caps);
    }
  }

  if (value > max + 0.009) {
    throw badRequest(
      `Desconto de R$ ${value.toFixed(2)} para "${label}" excede o máximo permitido de R$ ${max.toFixed(2)}.`,
      'DISCOUNT_LIMIT_EXCEEDED'
    );
  }
  return value;
}
