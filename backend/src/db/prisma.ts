import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';

/**
 * Singleton do PrismaClient.
 * Um único client é compartilhado por toda a aplicação (evita esgotar
 * o pool de conexões do PostgreSQL).
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'production' ? ['error', 'warn'] : ['warn', 'error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export async function connectDatabase(retries = 30, delayMs = 2000): Promise<void> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await prisma.$connect();
      logger.info('Conexão com o PostgreSQL estabelecida');
      return;
    } catch (error: any) {
      logger.warn(`Falha ao conectar no banco (tentativa ${attempt}/${retries}): ${error.message}`);
      if (attempt === retries) throw error;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
}

export default prisma;
