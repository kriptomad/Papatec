import { useEffect, useState, useCallback, useRef } from 'react';
import { osRealtimeApi } from '../services/api';
import type { OSMovement } from '../types';

interface UseOSRealtimeOptions {
  osId: string;
  enabled?: boolean;
  onNote?: (movement: OSMovement) => void;
  onStatusChange?: (movement: OSMovement) => void;
  onTyping?: (userId: string, userName: string, isTyping: boolean) => void;
}

const RECONNECT_DELAY_MS = 3000;

export function useOSRealtime({
  osId,
  enabled = true,
  onNote,
  onStatusChange,
  onTyping,
}: UseOSRealtimeOptions) {
  const [connected, setConnected] = useState(false);
  const [movements, setMovements] = useState<OSMovement[]>([]);
  const [typingUsers, setTypingUsers] = useState<Record<string, { name: string; isTyping: boolean }>>({});
  const [error, setError] = useState<string | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aliveRef = useRef(true);

  // Callbacks guardados em ref: mantém identidade ESTÁVEL no `connect` (evita
  // reabrir o SSE a cada render) continuando sempre chamando a versão mais
  // recente. Antes os callbacks estavam nas deps do useCallback e os callers
  // passam setas inline => o efeito derrubava e reabria a conexão em CADA
  // render — e cada evento SSE gera um render, num ciclo de reconexão.
  const callbacksRef = useRef({ onNote, onStatusChange, onTyping });
  callbacksRef.current = { onNote, onStatusChange, onTyping };

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    if (!enabled || !osId) return;

    // Fecha conexão e timer anteriores antes de abrir outro
    eventSourceRef.current?.close();
    clearReconnectTimer();

    const token = localStorage.getItem('token');
    const url = `/api/os/${osId}/realtime${token ? `?token=${encodeURIComponent(token)}` : ''}`;

    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.onopen = () => {
      setConnected(true);
      setError(null);
    };

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        switch (data.type) {
          case 'connected':
            break;

          case 'note': {
            const noteMovement = data.movement as OSMovement;
            setMovements((prev) => [...prev, noteMovement]);
            callbacksRef.current.onNote?.(noteMovement);
            break;
          }

          case 'status_change': {
            const statusMovement = data.movement as OSMovement;
            setMovements((prev) => [...prev, statusMovement]);
            callbacksRef.current.onStatusChange?.(statusMovement);
            break;
          }

          case 'typing':
            setTypingUsers((prev) => ({
              ...prev,
              [data.userId]: { name: data.userName, isTyping: data.isTyping },
            }));
            callbacksRef.current.onTyping?.(data.userId, data.userName, data.isTyping);
            break;
        }
      } catch (e) {
        console.error('[OS Realtime] Parse error:', e);
      }
    };

    es.onerror = () => {
      setConnected(false);
      setError('Conexão perdida. Tentando reconectar...');

      // O EventSource JÁ reconecta sozinho enquanto readyState === CONNECTING.
      // Agendar um setTimeout SEMPRE (como antes) empilhava uma segunda camada
      // de reconexão: a cada 3s um ES novo, para sempre.
      // Só fazemos retry manual quando o browser desistiu (CLOSED).
      if (es.readyState === EventSource.CLOSED && aliveRef.current && !reconnectTimerRef.current) {
        reconnectTimerRef.current = setTimeout(() => {
          reconnectTimerRef.current = null;
          if (aliveRef.current) connect();
        }, RECONNECT_DELAY_MS);
      }
    };
  }, [osId, enabled, clearReconnectTimer]);

  useEffect(() => {
    aliveRef.current = true;
    connect();

    return () => {
      // Sem isto o timer pendente disparava DEPOIS do unmount e criava um
      // EventSource novo apontando para um ref já nulo => conexão órfã que
      // reconectava para sempre até fechar a aba.
      aliveRef.current = false;
      clearReconnectTimer();
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
    };
  }, [connect, clearReconnectTimer]);

  // Enviar nota em tempo real (identidade estável: os callers usam em deps)
  const sendNote = useCallback(
    async (note: string) => {
      await osRealtimeApi.addNote(osId, note);
    },
    [osId],
  );

  // Indicar "digitando..."
  const setTyping = useCallback(
    async (isTyping: boolean) => {
      try {
        await osRealtimeApi.setTyping(osId, isTyping);
      } catch (e) {
        console.error('[OS Realtime] Failed to send typing:', e);
      }
    },
    [osId],
  );

  // Buscar histórico inicial. Antes era recriada a cada render, e os callers
  // faziam useEffect(..., [loadHistory]) => loop infinito de GET /timeline.
  const loadHistory = useCallback(async () => {
    try {
      const data = await osRealtimeApi.getTimeline(osId);
      setMovements(data || []);
    } catch (e) {
      console.error('[OS Realtime] Failed to load history:', e);
    }
  }, [osId]);

  return {
    connected,
    movements,
    typingUsers,
    error,
    sendNote,
    setTyping,
    loadHistory,
    reconnect: connect,
  };
}
