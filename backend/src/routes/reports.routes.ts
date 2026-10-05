import { Router } from 'express';
import { prisma } from '../db/prisma';
import { ok } from '../http/envelope';
import { handler } from '../http/errors';
import { requireAuth, requireRole } from '../middleware/auth';

export const reportsRouter = Router();

// Relatórios financeiros (lucro/prejuízo, valoração, movimentações) são
// privilégio do administrador.
reportsRouter.use(requireAuth, requireRole('ADMIN'));

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

function monthRange(year: number, month: number) {
  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
  const end = new Date(Date.UTC(year, month, 1, 0, 0, 0));
  return { start, end };
}

// GET /api/reports/inventory-valuation
reportsRouter.get(
  '/inventory-valuation',
  handler(async (_req, res) => {
    const parts = await prisma.part.findMany({ where: { status: 'ACTIVE' } });

    let totalItems = 0;
    let costValue = 0;
    let saleValue = 0;
    let lowStockItems = 0;
    let outOfStockItems = 0;
    const byCategory: Record<string, { items: number; costValue: number; saleValue: number; profit: number }> = {};

    for (const part of parts) {
      totalItems += part.quantity;
      costValue += part.quantity * part.costPrice;
      saleValue += part.quantity * part.salePrice;

      if (part.quantity === 0) outOfStockItems++;
      else if (part.quantity <= part.minStock) lowStockItems++;

      const category = part.category || 'SEM CATEGORIA';
      byCategory[category] ||= { items: 0, costValue: 0, saleValue: 0, profit: 0 };
      byCategory[category].items += part.quantity;
      byCategory[category].costValue += part.quantity * part.costPrice;
      byCategory[category].saleValue += part.quantity * part.salePrice;
      byCategory[category].profit += part.quantity * (part.salePrice - part.costPrice);
    }

    for (const key of Object.keys(byCategory)) {
      byCategory[key].costValue = round2(byCategory[key].costValue);
      byCategory[key].saleValue = round2(byCategory[key].saleValue);
      byCategory[key].profit = round2(byCategory[key].profit);
    }

    ok(res, {
      totalItems,
      costValue: round2(costValue),
      saleValue: round2(saleValue),
      potentialProfit: round2(saleValue - costValue),
      byCategory,
      lowStockItems,
      outOfStockItems,
    });
  })
);

// GET /api/reports/profit-loss/monthly?year=&month=
reportsRouter.get(
  '/profit-loss/monthly',
  handler(async (req, res) => {
    const now = new Date();
    const year = Number(req.query.year) || now.getFullYear();
    const month = Number(req.query.month) || now.getMonth() + 1;
    const { start, end } = monthRange(year, month);

    const orders = await prisma.serviceOrder.findMany({
      where: { status: 'DELIVERED', deliveredAt: { gte: start, lt: end } },
      include: { items: { include: { part: true } } },
    });

    let partsRevenue = 0;
    let servicesRevenue = 0;
    let laborRevenue = 0;
    let partsCost = 0;

    for (const order of orders) {
      for (const item of order.items) {
        if (item.type === 'PART') {
          partsRevenue += item.total;
          partsCost += (item.part?.costPrice || 0) * item.qty;
        } else {
          servicesRevenue += item.total;
        }
      }
      laborRevenue += order.totalLabor;
    }

    const expenses = await prisma.expense.findMany({ where: { date: { gte: start, lt: end } } });
    const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);

    const totalRevenue = partsRevenue + servicesRevenue + laborRevenue;
    const totalCosts = partsCost + totalExpenses;
    const netProfit = totalRevenue - totalCosts;

    ok(res, {
      year,
      month,
      revenue: {
        parts: round2(partsRevenue),
        services: round2(servicesRevenue),
        labor: round2(laborRevenue),
        total: round2(totalRevenue),
      },
      costs: { parts: round2(partsCost), expenses: round2(totalExpenses), total: round2(totalCosts) },
      profit: {
        gross: round2(totalRevenue - partsCost),
        net: round2(netProfit),
        margin: totalRevenue > 0 ? round2((netProfit / totalRevenue) * 100) : 0,
      },
      ordersCount: orders.length,
      avgTicket: orders.length > 0 ? round2(totalRevenue / orders.length) : 0,
    });
  })
);

// GET /api/reports/profit-loss/yearly?year=
reportsRouter.get(
  '/profit-loss/yearly',
  handler(async (req, res) => {
    const year = Number(req.query.year) || new Date().getFullYear();
    const monthly: any[] = [];
    const totals = { revenue: 0, costs: 0, profit: 0, orders: 0 };

    for (let month = 1; month <= 12; month++) {
      const { start, end } = monthRange(year, month);
      const [delivered, expenses] = await Promise.all([
        prisma.serviceOrder.findMany({
          where: { status: 'DELIVERED', deliveredAt: { gte: start, lt: end } },
          include: { items: { include: { part: true } } },
        }),
        prisma.expense.findMany({ where: { date: { gte: start, lt: end } } }),
      ]);

      let revenue = 0;
      let partsCost = 0;
      for (const order of delivered) {
        revenue += order.total;
        for (const item of order.items) {
          if (item.type === 'PART') partsCost += (item.part?.costPrice || 0) * item.qty;
        }
      }
      const expenseTotal = expenses.reduce((sum, e) => sum + e.amount, 0);
      const costs = partsCost + expenseTotal;

      monthly.push({
        month,
        revenue: round2(revenue),
        costs: round2(costs),
        profit: round2(revenue - costs),
        margin: revenue > 0 ? round2(((revenue - costs) / revenue) * 100) : 0,
        orders: delivered.length,
      });

      totals.revenue += revenue;
      totals.costs += costs;
      totals.profit += revenue - costs;
      totals.orders += delivered.length;
    }

    ok(res, {
      year,
      monthly,
      totals: {
        revenue: round2(totals.revenue),
        costs: round2(totals.costs),
        profit: round2(totals.profit),
        orders: totals.orders,
      },
    });
  })
);

// GET /api/reports/movements/monthly - entradas e saídas do estoque no mês
reportsRouter.get(
  '/movements/monthly',
  handler(async (req, res) => {
    const now = new Date();
    const year = Number(req.query.year) || now.getFullYear();
    const month = Number(req.query.month) || now.getMonth() + 1;
    const { start, end } = monthRange(year, month);

    const movements = await prisma.stockMovement.findMany({
      where: { createdAt: { gte: start, lt: end } },
      include: {
        part: { select: { id: true, name: true, code: true, costPrice: true, salePrice: true } },
        user: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const entries = movements.filter((m) => m.type === 'IN');
    const exits = movements.filter((m) => m.type === 'OUT');
    const adjustments = movements.filter((m) => m.type === 'ADJUSTMENT');

    const valueOf = (list: typeof movements) => list.reduce((sum, m) => sum + m.qty * (m.part?.costPrice || 0), 0);

    ok(res, {
      year,
      month,
      entries: { count: entries.length, qty: entries.reduce((s, m) => s + m.qty, 0), costValue: round2(valueOf(entries)) },
      exits: { count: exits.length, qty: exits.reduce((s, m) => s + m.qty, 0), costValue: round2(valueOf(exits)) },
      adjustments: { count: adjustments.length, qty: adjustments.reduce((s, m) => s + m.qty, 0) },
      movements,
    });
  })
);

// GET /api/reports/top-items?limit=&startDate=&endDate=
reportsRouter.get(
  '/top-items',
  handler(async (req, res) => {
    const limit = Math.max(1, Math.min(50, Number(req.query.limit) || 10));
    const startDate = req.query.startDate ? new Date(String(req.query.startDate)) : null;
    const endDate = req.query.endDate ? new Date(String(req.query.endDate)) : null;

    const where: any = { type: 'PART', partId: { not: null } };
    if (startDate || endDate) {
      where.order = { createdAt: {} };
      if (startDate && !Number.isNaN(startDate.getTime())) where.order.createdAt.gte = startDate;
      if (endDate && !Number.isNaN(endDate.getTime())) where.order.createdAt.lte = endDate;
    }

    const items = await prisma.budgetItem.findMany({
      where: { ...where, budget: { status: { in: ['APPROVED', 'CONVERTED_TO_OS'] } } },
      include: { part: true },
    });

    const aggregated = new Map<string, any>();
    for (const item of items) {
      const key = item.partId || item.name;
      const current = aggregated.get(key) || {
        id: item.partId,
        name: item.part?.name || item.name,
        sku: item.part?.code || '',
        quantitySold: 0,
        revenue: 0,
        profit: 0,
      };
      current.quantitySold += item.qty;
      current.revenue += item.total;
      current.profit += (item.unitPrice - (item.part?.costPrice || 0)) * item.qty;
      aggregated.set(key, current);
    }

    const data = [...aggregated.values()]
      .sort((a, b) => b.quantitySold - a.quantitySold)
      .slice(0, limit)
      .map((row) => ({ ...row, revenue: round2(row.revenue), profit: round2(row.profit) }));

    ok(res, data);
  })
);

// GET /api/reports/top-services?limit=
reportsRouter.get(
  '/top-services',
  handler(async (req, res) => {
    const limit = Math.max(1, Math.min(50, Number(req.query.limit) || 10));

    const items = await prisma.budgetItem.findMany({
      where: { type: 'SERVICE', budget: { status: { in: ['APPROVED', 'CONVERTED_TO_OS'] } } },
      include: { service: true },
    });

    const aggregated = new Map<string, any>();
    for (const item of items) {
      const key = item.serviceId || item.name;
      const current = aggregated.get(key) || {
        id: item.serviceId,
        name: item.service?.name || item.name,
        category: item.service?.category || 'GERAL',
        quantitySold: 0,
        revenue: 0,
      };
      current.quantitySold += item.qty;
      current.revenue += item.total;
      aggregated.set(key, current);
    }

    const data = [...aggregated.values()]
      .sort((a, b) => b.quantitySold - a.quantitySold)
      .slice(0, limit)
      .map((row) => ({ ...row, revenue: round2(row.revenue) }));

    ok(res, data);
  })
);
