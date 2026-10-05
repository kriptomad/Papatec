import { Router } from 'express';
import bcrypt from 'bcrypt';
import { prisma } from '../db/prisma';
import { ok, created, badRequest, conflict, notFound, forbidden } from '../http/envelope';
import { handler } from '../http/errors';
import { requireAuth, requireRole, sanitizeUser } from '../middleware/auth';
import { licenseService } from '../services/license.service';
import { nextSequence, formatCode } from '../utils/codes';

export const usersRouter = Router();

usersRouter.use(requireAuth);

function parsePagination(query: any) {
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.max(1, Math.min(200, Number(query.limit ?? query.take) || 20));
  const skip = Number.isFinite(Number(query.skip)) && query.skip !== undefined ? Number(query.skip) : (page - 1) * pageSize;
  const take = pageSize;
  return { page, pageSize, skip, take };
}

const str = (v: any) => (v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim());
const numOrNull = (v: any) => (v === '' || v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v));

// Campos do cadastro de Funcionário/Parceiro (PDF p.4): endereço completo,
// documentos (RG/CPF, CNPJ/IE/IM), telefone/ramal, site, observações e
// percentual de comissão.
const EMPLOYEE_KEYS = [
  'phone', 'ramal', 'cpf', 'rg', 'cnpj', 'ie', 'im',
  'street', 'number', 'complement', 'district', 'zip', 'city', 'state',
  'site', 'notes', 'commissionPercent',
] as const;

function employeeData(body: any) {
  return {
    phone: str(body?.phone),
    ramal: str(body?.ramal),
    cpf: str(body?.cpf),
    rg: str(body?.rg),
    cnpj: str(body?.cnpj),
    ie: str(body?.ie),
    im: str(body?.im),
    street: str(body?.street),
    number: str(body?.number),
    complement: str(body?.complement),
    district: str(body?.district),
    zip: str(body?.zip),
    city: str(body?.city),
    state: str(body?.state),
    site: str(body?.site),
    notes: str(body?.notes),
    commissionPercent: numOrNull(body?.commissionPercent),
  };
}

async function assertEmployeeDoc(cpf: string | null, id?: string) {
  if (!cpf) return;
  const dup = await prisma.user.findUnique({ where: { cpf } });
  if (dup && dup.id !== id) throw conflict('Já existe um funcionário com este CPF.', 'DUPLICATE_CPF');
}

// GET /api/users/technicians (deve vir antes de /:id)
usersRouter.get(
  '/technicians',
  handler(async (_req, res) => {
    const users = await prisma.user.findMany({
      where: { active: true, role: { in: ['TECHNICIAN', 'ADMIN'] } },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, email: true, role: true },
    });
    ok(res, users);
  })
);

// GET /api/users
usersRouter.get(
  '/',
  handler(async (req, res) => {
    const { page, pageSize, skip, take } = parsePagination(req.query);
    const search = String(req.query.search || '').trim();
    const role = String(req.query.role || '').trim();

    const where: any = {};
    if (search) {
      // Pesquisa por nome, e-mail, CPF/CNPJ e código único (PDF p.4)
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { cpf: { contains: search } },
        { cnpj: { contains: search } },
        { code: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
      ];
    }
    if (role) where.role = role as any;

    const [data, total] = await Promise.all([
      prisma.user.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
      prisma.user.count({ where }),
    ]);

    ok(res, { data: data.map(sanitizeUser), total, page, pageSize });
  })
);

// GET /api/users/:id
usersRouter.get(
  '/:id',
  handler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) throw notFound('Usuário não encontrado');
    ok(res, sanitizeUser(user));
  })
);

// POST /api/users (ADMIN)
usersRouter.post(
  '/',
  requireRole('ADMIN'),
  handler(async (req, res) => {
    const { name, email, password, role } = req.body || {};
    if (!name || !email || !password) throw badRequest('Nome, e-mail e senha são obrigatórios.');
    if (String(password).length < 6) throw badRequest('A senha deve ter no mínimo 6 caracteres.');

    const normalizedEmail = String(email).toLowerCase().trim();
    if (await prisma.user.findUnique({ where: { email: normalizedEmail } })) {
      throw conflict('E-mail já cadastrado', 'EMAIL_IN_USE');
    }

    const licensePayload = await licenseService.getPayload();
    const maxUsers = Number(licensePayload?.maxUsers) || 0;
    if (maxUsers > 0 && (await prisma.user.count()) >= maxUsers) {
      throw conflict(`Limite de usuários da licença atingido (${maxUsers}).`, 'LICENSE_USER_LIMIT');
    }

    const allowed = ['ADMIN', 'TECHNICIAN', 'RECEPTIONIST'];
    const emp = employeeData(req.body);
    await assertEmployeeDoc(emp.cpf);

    const user = await prisma.$transaction(async (tx) => {
      const code = formatCode('FUN', await nextSequence(tx, 'user'));
      return tx.user.create({
        data: {
          name: String(name).trim(),
          email: normalizedEmail,
          password: await bcrypt.hash(String(password), 10),
          role: allowed.includes(role) ? role : 'TECHNICIAN',
          active: true,
          code,
          ...emp,
        },
      });
    });

    created(res, sanitizeUser(user));
  })
);

// PUT /api/users/:id (ADMIN)
usersRouter.put(
  '/:id',
  requireRole('ADMIN'),
  handler(async (req, res) => {
    const { name, email, password, role, active } = req.body || {};
    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target) throw notFound('Usuário não encontrado');

    if (email) {
      const normalizedEmail = String(email).toLowerCase().trim();
      const inUse = await prisma.user.findUnique({ where: { email: normalizedEmail } });
      if (inUse && inUse.id !== target.id) throw conflict('E-mail já cadastrado', 'EMAIL_IN_USE');
    }

    const data: any = {};
    if (name) data.name = String(name).trim();
    if (email) data.email = String(email).toLowerCase().trim();
    if (password) {
      if (String(password).length < 6) throw badRequest('A senha deve ter no mínimo 6 caracteres.');
      data.password = await bcrypt.hash(String(password), 10);
    }
    if (role) {
      const allowed = ['ADMIN', 'TECHNICIAN', 'RECEPTIONIST'];
      if (!allowed.includes(role)) throw badRequest('Papel inválido.');
      data.role = role;
    }
    if (typeof active === 'boolean') data.active = active;

    // Campos do cadastro de funcionário (PDF p.4) - só aplicados quando o
    // corpo da requisição os traz (evita zerar dados em PUTs parciais).
    const body = req.body || {};
    if (EMPLOYEE_KEYS.some((k) => k in body)) {
      const emp = employeeData(body);
      await assertEmployeeDoc(emp.cpf, target.id);
      Object.assign(data, emp);
    }

    // Impede que o próprio admin se desative/promova para TECHNICIAN
    if (target.id === req.user!.id && (data.role === 'TECHNICIAN' || data.role === 'RECEPTIONIST' || data.active === false)) {
      throw forbidden('Você não pode alterar o seu próprio acesso.', 'SELF_LOCKOUT');
    }

    const user = await prisma.user.update({ where: { id: target.id }, data });
    ok(res, sanitizeUser(user));
  })
);

// PUT /api/users/:id/toggle-active (ADMIN)
usersRouter.put(
  '/:id/toggle-active',
  requireRole('ADMIN'),
  handler(async (req, res) => {
    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target) throw notFound('Usuário não encontrado');
    if (target.id === req.user!.id) throw forbidden('Você não pode desativar a si mesmo.', 'SELF_LOCKOUT');

    const user = await prisma.user.update({
      where: { id: target.id },
      data: { active: !target.active },
    });
    ok(res, sanitizeUser(user));
  })
);

// DELETE /api/users/:id (ADMIN)
usersRouter.delete(
  '/:id',
  requireRole('ADMIN'),
  handler(async (req, res) => {
    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target) throw notFound('Usuário não encontrado');
    if (target.id === req.user!.id) throw forbidden('Você não pode excluir a si mesmo.', 'SELF_LOCKOUT');

    if (target.role === 'ADMIN') {
      const admins = await prisma.user.count({ where: { role: 'ADMIN', active: true } });
      if (admins <= 1) throw forbidden('Não é possível excluir o último administrador.', 'LAST_ADMIN');
    }

    // Mantém histórico: reatribui registros para o usuário removido não quebrar FK
    const fallback = await prisma.user.findFirst({ where: { role: 'ADMIN', active: true, id: { not: target.id } } });

    await prisma.$transaction(async (tx) => {
      if (fallback) {
        await tx.budget.updateMany({ where: { creatorId: target.id }, data: { creatorId: fallback.id } });
        await tx.serviceOrder.updateMany({ where: { creatorId: target.id }, data: { creatorId: fallback.id } });
        await tx.serviceOrder.updateMany({ where: { technicianId: target.id }, data: { technicianId: fallback.id } });
        await tx.stockMovement.updateMany({ where: { userId: target.id }, data: { userId: fallback.id } });
        await tx.osMovement.updateMany({ where: { userId: target.id }, data: { userId: fallback.id } });
        // Compras (Entrada de Mercadoria) também referenciam o usuário
        await tx.purchase.updateMany({ where: { userId: target.id }, data: { userId: fallback.id } });
        // Clientes com este responsável perdem o vínculo
        await tx.client.updateMany({ where: { responsibleId: target.id }, data: { responsibleId: null } });
      }
      await tx.user.delete({ where: { id: target.id } });
    });

    ok(res, { message: 'Usuário excluído' });
  })
);
