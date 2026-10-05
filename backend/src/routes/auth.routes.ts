import { Router } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { prisma } from '../db/prisma';
import { ok, created, badRequest, unauthorized, conflict, notFound } from '../http/envelope';
import { handler } from '../http/errors';
import { requireAuth, sanitizeUser } from '../middleware/auth';
import { licenseService } from '../services/license.service';
import { settingsService } from '../services/settings.service';
import { logger } from '../utils/logger';
import { loadPrivateKey, assertKeys } from '../utils/jwtKeys';

export const authRouter = Router();

async function signToken(userId: string): Promise<string> {
  const { privateKey } = assertKeys();
  const days = Number(await settingsService.get<number>('session_days')) || 7;
  return jwt.sign({ sub: userId }, privateKey, { algorithm: 'RS256', expiresIn: `${days}d` });
}

// POST /api/auth/login
authRouter.post(
  '/login',
  handler(async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) throw badRequest('E-mail e senha são obrigatórios.');

    const user = await prisma.user.findUnique({ where: { email: String(email).toLowerCase().trim() } });
    if (!user) throw unauthorized('Credenciais inválidas');

    const valid = await bcrypt.compare(String(password), user.password);
    if (!valid) {
      logger.warn('Tentativa de login inválida', { email });
      throw unauthorized('Credenciais inválidas');
    }
    if (!user.active) throw unauthorized('Usuário desativado', 'USER_DISABLED');

    const license = await licenseService.getStatus();
    const token = await signToken(user.id);

    logger.info('Login realizado', { userId: user.id, email: user.email });

    ok(res, { access_token: token, user: sanitizeUser(user), license: license.license });
  })
);

// GET /api/auth/setup-status - público: informa se ainda não existe nenhum usuário
authRouter.get(
  '/setup-status',
  handler(async (_req, res) => {
    const count = await prisma.user.count();
    ok(res, { needsSetup: count === 0, userCount: count });
  })
);

// POST /api/auth/setup-admin - cria o primeiro administrador (apenas se não houver usuários)
authRouter.post(
  '/setup-admin',
  handler(async (req, res) => {
    const { email, password, name } = req.body || {};
    if (!email || !password || !name) throw badRequest('Nome, e-mail e senha são obrigatórios.');
    if (String(password).length < 6) throw badRequest('A senha deve ter no mínimo 6 caracteres.');

    const count = await prisma.user.count();
    if (count > 0) throw conflict('Já existe um usuário configurado. Faça login.', 'ADMIN_ALREADY_EXISTS');

    const user = await prisma.user.create({
      data: {
        name: String(name).trim(),
        email: String(email).toLowerCase().trim(),
        password: await bcrypt.hash(String(password), 10),
        role: 'ADMIN',
        active: true,
      },
    });

    logger.info('Primeiro administrador criado', { email: user.email });
    const token = await signToken(user.id);
    created(res, { access_token: token, user: sanitizeUser(user), license: null });
  })
);

// POST /api/auth/register - cria funcionário (respeita limite de usuários da licença)
authRouter.post(
  '/register',
  requireAuth,
  handler(async (req, res) => {
    const { name, email, password, role } = req.body || {};
    if (!name || !email || !password) throw badRequest('Nome, e-mail e senha são obrigatórios.');
    if (String(password).length < 6) throw badRequest('A senha deve ter no mínimo 6 caracteres.');
    if (req.user!.role !== 'ADMIN') throw badRequest('Apenas administradores podem criar usuários.', 'ADMIN_ONLY');

    const normalizedEmail = String(email).toLowerCase().trim();

    const exists = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (exists) throw conflict('E-mail já cadastrado', 'EMAIL_IN_USE');

    // Limite de usuários definido na licença (maxUsers)
    const licensePayload = await licenseService.getPayload();
    const maxUsers = Number(licensePayload?.maxUsers) || 0;
    if (maxUsers > 0) {
      const total = await prisma.user.count();
      if (total >= maxUsers) {
        throw conflict(
          `Limite de usuários atingido (${maxUsers}) conforme licença contratada.`,
          'LICENSE_USER_LIMIT'
        );
      }
    }

    const allowedRoles = ['ADMIN', 'TECHNICIAN', 'RECEPTIONIST'];
    const finalRole = allowedRoles.includes(role) ? role : 'TECHNICIAN';

    const user = await prisma.user.create({
      data: {
        name: String(name).trim(),
        email: normalizedEmail,
        password: await bcrypt.hash(String(password), 10),
        role: finalRole as any,
        active: true,
      },
    });

    created(res, sanitizeUser(user));
  })
);

// GET /api/auth/profile
authRouter.get(
  '/profile',
  requireAuth,
  handler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) throw notFound('Usuário não encontrado');
    ok(res, sanitizeUser(user));
  })
);

// PUT /api/auth/password
authRouter.put(
  '/password',
  requireAuth,
  handler(async (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) throw badRequest('Senha atual e nova senha são obrigatórias.');
    if (String(newPassword).length < 6) throw badRequest('A nova senha deve ter no mínimo 6 caracteres.');

    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) throw notFound('Usuário não encontrado');

    const valid = await bcrypt.compare(String(currentPassword), user.password);
    if (!valid) throw unauthorized('Senha atual incorreta');

    await prisma.user.update({
      where: { id: user.id },
      data: { password: await bcrypt.hash(String(newPassword), 10) },
    });

    ok(res, { message: 'Senha alterada com sucesso' });
  })
);

// GET /api/auth/license/status
authRouter.get(
  '/license/status',
  handler(async (_req, res) => {
    ok(res, await licenseService.getStatus());
  })
);

// POST /api/auth/license/install - recebe o JWT (ou JSON da licença) e ativa
authRouter.post(
  '/license/install',
  handler(async (req, res) => {
    const raw = req.body?.licenseJson ?? req.body?.token ?? req.body?.license;
    if (!raw) throw badRequest('Token de licença ausente.');

    let token = String(raw).trim();
    // Aceita também um objeto { token: "..." } serializado
    if (token.startsWith('{')) {
      try {
        const parsed = JSON.parse(token);
        token = parsed.token || parsed.license || parsed.jwt;
      } catch {
        /* mantém como está */
      }
    }
    if (!token) throw badRequest('Token de licença ausente.');

    const result = await licenseService.activate(token);
    ok(res, { ...result, ...(await licenseService.getStatus()) });
  })
);

// POST /api/auth/license/deactivate
authRouter.post(
  '/license/deactivate',
  requireAuth,
  handler(async (_req, res) => {
    await licenseService.deactivate();
    ok(res, { message: 'Licença desativada nesta máquina.' });
  })
);
