import { Router, Request, Response } from 'express';
import { prisma } from '../db/prisma';
import { requireAuth } from '../middleware/auth';
import { handler } from '../http/errors';
import { ok, notFound, badRequest } from '../http/envelope';

// Store active SSE connections per OS
const sseConnections = new Map<string, Set<Response>>();

function addConnection(osId: string, res: Response) {
  if (!sseConnections.has(osId)) sseConnections.set(osId, new Set());
  sseConnections.get(osId)!.add(res);
}

function removeConnection(osId: string, res: Response) {
  sseConnections.get(osId)?.delete(res);
  if (sseConnections.get(osId)?.size === 0) sseConnections.delete(osId);
}

function broadcast(osId: string, data: any) {
  const conns = sseConnections.get(osId);
  if (!conns) return;
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of conns) {
    try { res.write(payload); } catch { removeConnection(osId, res); }
  }
}

export const osRealtimeRouter = Router();

// SSE endpoint: GET /api/os/:id/realtime
osRealtimeRouter.get(
  '/:id/realtime',
  requireAuth,
  handler(async (req: Request, res: Response) => {
    const os = await prisma.serviceOrder.findUnique({ where: { id: req.params.id } });
    if (!os) throw notFound('O.S. não encontrada');

    // SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Send initial connection event
    res.write(`data: ${JSON.stringify({ type: 'connected', osId: os.id })}\n\n`);

    addConnection(os.id, res);

    // Heartbeat every 30s
    const interval = setInterval(() => {
      res.write(`: heartbeat\n\n`);
    }, 30000);

    req.on('close', () => {
      clearInterval(interval);
      removeConnection(os.id, res);
    });
  })
);

// POST /api/os/:id/realtime/note - técnico adiciona nota em tempo real (qualquer status, sem unlock)
osRealtimeRouter.post(
  '/:id/realtime/note',
  requireAuth,
  handler(async (req: Request, res: Response) => {
    const { note } = req.body;
    if (!note?.trim()) throw badRequest('Nota não pode ser vazia');

    const os = await prisma.serviceOrder.findUnique({ where: { id: req.params.id } });
    if (!os) throw notFound('O.S. não encontrada');

    // Cria movement com fromStatus === toStatus (nota técnica)
    const movement = await prisma.osMovement.create({
      data: {
        osId: os.id,
        userId: req.user!.id,
        fromStatus: os.status,
        toStatus: os.status,
        note: `[Técnico ${req.user!.name}]: ${note}`,
      },
      include: { user: { select: { id: true, name: true, role: true } } },
    });

    // Broadcast para todos conectados nesta OS
    broadcast(os.id, {
      type: 'note',
      movement: {
        id: movement.id,
        note: movement.note,
        createdAt: movement.createdAt,
        user: movement.user,
      },
    });

    ok(res, movement);
  })
);

// POST /api/os/:id/realtime/typing - indicador "digitando..."
osRealtimeRouter.post(
  '/:id/realtime/typing',
  requireAuth,
  handler(async (req: Request, res: Response) => {
    const { isTyping } = req.body;
    broadcast(req.params.id, {
      type: 'typing',
      userId: req.user!.id,
      userName: req.user!.name,
      isTyping: !!isTyping,
    });
    ok(res, { ok: true });
  })
);

// Export broadcast function for use in other routes (e.g., status changes)
export function broadcastOsUpdate(osId: string, event: any) {
  broadcast(osId, event);
}