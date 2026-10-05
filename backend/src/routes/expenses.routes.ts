import { Router } from 'express';
import { prisma } from '../db/prisma';
import { ok, created, badRequest, notFound } from '../http/envelope';
import { handler } from '../http/errors';
import { requireAuth, requireRole } from '../middleware/auth';

export const expensesRouter = Router();

expensesRouter.use(requireAuth);

const CATEGORIES = ['RENT', 'ENERGY', 'SALARIES', 'MATERIALS', 'MARKETING', 'TAXES', 'OTHER'];

function parseDate(value: any): Date | null {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function validate(body: any) {
  const description = String(body?.description || '').trim();
  if (!description) throw badRequest('Descrição é obrigatória.');
  const amount = Number(body?.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw badRequest('Valor deve ser maior que zero.');
  const category = CATEGORIES.includes(body?.category) ? body.category : 'OTHER';
  const date = parseDate(body?.date) || new Date();
  return { description, amount, category, date, notes: body?.notes ? String(body.notes) : null };
}

// GET /api/expenses/summary/monthly
expensesRouter.get(
  '/summary/monthly',
  handler(async (req, res) => {
    const now = new Date();
    const year = Number(req.query.year) || now.getFullYear();
    const month = Number(req.query.month) || now.getMonth() + 1;
    const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
    const end = new Date(Date.UTC(year, month, 1, 0, 0, 0));

    const expenses = await prisma.expense.findMany({ where: { date: { gte: start, lt: end } } });
    const byCategory: Record<string, { total: number; count: number }> = {};
    let total = 0;

    for (const expense of expenses) {
      total += expense.amount;
      byCategory[expense.category] ||= { total: 0, count: 0 };
      byCategory[expense.category].total += expense.amount;
      byCategory[expense.category].count += 1;
    }

    ok(res, { year, month, total: Math.round(total * 100) / 100, byCategory, count: expenses.length, expenses });
  })
);

// GET /api/expenses/summary/yearly
expensesRouter.get(
  '/summary/yearly',
  handler(async (req, res) => {
    const year = Number(req.query.year) || new Date().getFullYear();
    const start = new Date(Date.UTC(year, 0, 1));
    const end = new Date(Date.UTC(year + 1, 0, 1));

    const expenses = await prisma.expense.findMany({ where: { date: { gte: start, lt: end } } });
    const monthly = Array.from({ length: 12 }, (_, index) => {
      const monthStart = new Date(Date.UTC(year, index, 1));
      const monthEnd = new Date(Date.UTC(year, index + 1, 1));
      const monthExpenses = expenses.filter((e) => e.date >= monthStart && e.date < monthEnd);
      return {
        month: index + 1,
        total: Math.round(monthExpenses.reduce((sum, e) => sum + e.amount, 0) * 100) / 100,
        count: monthExpenses.length,
      };
    });

    ok(res, {
      year,
      total: Math.round(monthly.reduce((sum, m) => sum + m.total, 0) * 100) / 100,
      monthly,
    });
  })
);

// GET /api/expenses/summary/by-category
expensesRouter.get(
  '/summary/by-category',
  handler(async (req, res) => {
    const startDate = parseDate(req.query.startDate);
    const endDate = parseDate(req.query.endDate);
    const where: any = {};
    if (startDate) where.date = { ...(where.date || {}), gte: startDate };
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      where.date = { ...(where.date || {}), lte: end };
    }

    const expenses = await prisma.expense.findMany({ where });
    const total = expenses.reduce((sum, e) => sum + e.amount, 0);

    const breakdown = CATEGORIES.map((category) => {
      const list = expenses.filter((e) => e.category === category);
      const sum = list.reduce((acc, e) => acc + e.amount, 0);
      return {
        category,
        total: Math.round(sum * 100) / 100,
        count: list.length,
        percentage: total > 0 ? Math.round((sum / total) * 10000) / 100 : 0,
      };
    }).filter((b) => b.count > 0);

    ok(res, { total: Math.round(total * 100) / 100, breakdown });
  })
);

// GET /api/expenses
expensesRouter.get(
  '/',
  handler(async (req, res) => {
    const pageSize = Math.max(1, Math.min(200, Number(req.query.limit) || 20));
    const page = Math.max(1, Number(req.query.page) || 1);

    const where: any = {};
    if (req.query.category) where.category = String(req.query.category) as any;
    const startDate = parseDate(req.query.startDate);
    const endDate = parseDate(req.query.endDate);
    if (startDate) where.date = { ...(where.date || {}), gte: startDate };
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      where.date = { ...(where.date || {}), lte: end };
    }

    const [data, total] = await Promise.all([
      prisma.expense.findMany({ where, orderBy: { date: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      prisma.expense.count({ where }),
    ]);

    ok(res, { data, total, page, pageSize });
  })
);

// GET /api/expenses/:id
expensesRouter.get(
  '/:id',
  handler(async (req, res) => {
    const expense = await prisma.expense.findUnique({ where: { id: req.params.id } });
    if (!expense) throw notFound('Despesa não encontrada');
    ok(res, expense);
  })
);

// POST /api/expenses (ADMIN)
expensesRouter.post(
  '/',
  requireRole('ADMIN'),
  handler(async (req, res) => {
    const data = validate(req.body);
    const expense = await prisma.expense.create({ data });
    created(res, expense);
  })
);

// PUT /api/expenses/:id (ADMIN)
expensesRouter.put(
  '/:id',
  requireRole('ADMIN'),
  handler(async (req, res) => {
    const existing = await prisma.expense.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound('Despesa não encontrada');
    const data = validate({ ...existing, ...req.body, date: req.body?.date ?? existing.date });
    const expense = await prisma.expense.update({ where: { id: existing.id }, data });
    ok(res, expense);
  })
);

// DELETE /api/expenses/:id (ADMIN)
expensesRouter.delete(
  '/:id',
  requireRole('ADMIN'),
  handler(async (req, res) => {
    const existing = await prisma.expense.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound('Despesa não encontrada');
    await prisma.expense.delete({ where: { id: existing.id } });
    ok(res, { message: 'Despesa excluída' });
  })
);
