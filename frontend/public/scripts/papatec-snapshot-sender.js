// ============================================================================
// PapaTec ERP - Client-side Snapshot Sender
// ============================================================================
// Este script roda no navegador das máquinas dos usuários/vendedores/técnicos
// Envia snapshot do estado local para o servidor a cada 1 minuto
//
// Como usar:
// 1. Inclua este script na página (ex: no layout principal)
// 2. Configure: window.PAPATEC_SNAPSHOT_CONFIG = { apiBase, token, machineId }
// 3. O script coleta dados locais e envia para /api/backup/snapshot a cada 1 min
// ============================================================================

(function() {
  'use strict';
  
  // Configuração (definida pelo servidor via template ou variável global)
  const config = window.PAPATEC_SNAPSHOT_CONFIG || {};
  
  // Estado interno
  let isRunning = false;
  let lastSentData = null;
  let retryCount = 0;
  const MAX_RETRIES = 3;
  
  // Coleta dados do estado local da aplicação
  function collectLocalState() {
    const state = {
      timestamp: new Date().toISOString(),
      url: window.location.href,
      userAgent: navigator.userAgent,
      screen: { width: screen.width, height: screen.height },
      // Dados do localStorage/sessionStorage relevantes
      localStorage: collectStorage(localStorage),
      sessionStorage: collectStorage(sessionStorage),
      // Estado da aplicação (se exposto globalmente)
      appState: collectAppState(),
      // Conectividade
      online: navigator.onLine,
      // Performance
      memory: getMemoryInfo()
    };
    
    return state;
  }
  
  function collectStorage(storage) {
    const data = {};
    try {
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (key && (key.startsWith('papatec_') || key.startsWith('token') || key.startsWith('user_') || key.startsWith('settings_'))) {
          data[key] = storage.getItem(key);
        }
      }
    } catch (e) {
      console.warn('[Papatec Snapshot] Erro ao ler storage:', e);
    }
    return data;
  }
  
  function collectAppState() {
    const state = {};
    
    // Tenta coletar estado do React/Redux se disponível
    if (window.__REDUX_DEVTOOLS_EXTENSION__) {
      // Redux DevTools disponível
    }
    
    // Tenta acessar stores globais comuns
    if (window.store) state.redux = window.store.getState?.();
    if (window.queryClient) state.queryCache = window.queryClient.getQueryCache?.();
    
    // Estado do PapaTec se exposto
    if (window.PAPATEC_STATE) state.papatec = window.PAPATEC_STATE;
    
    return state;
  }
  
  function getMemoryInfo() {
    if (performance.memory) {
      return {
        usedJSHeapSize: performance.memory.usedJSHeapSize,
        totalJSHeapSize: performance.memory.totalJSHeapSize,
        jsHeapSizeLimit: performance.memory.jsHeapSizeLimit
      };
    }
    return null;
  }
  
  // Verifica se os dados mudaram significativamente
  function hasSignificantChanges(newData, oldData) {
    if (!oldData) return true;
    if (!newData) return false;
    
    // Compara timestamps (se mudou mais de 30 segundos)
    const timeDiff = Math.abs(new Date(newData.timestamp).getTime() - new Date(oldData.timestamp).getTime());
    if (timeDiff < 30000) return false;
    
    // Compara URLs
    if (newData.url !== oldData.url) return true;
    
    // Compara online/offline
    if (newData.online !== oldData.online) return true;
    
    return false;
  }
  
  async function sendSnapshot() {
    if (!config.apiBase || !config.token || !config.machineId) {
      console.warn('[Papatec Snapshot] Configuração incompleta:', config);
      return;
    }
    
    if (isRunning) return;
    isRunning = true;
    
    try {
      const data = collectLocalState();
      
      // Só envia se houve mudança significativa
      if (!hasSignificantChanges(data, lastSentData)) {
        console.log('[Papatec Snapshot] Sem mudanças significativas, pulando envio');
        return;
      }
      
      const payload = {
        machineId: config.machineId,
        data
      };
      
      const response = await fetch(`${config.apiBase}/api/backup/snapshot`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.token}`
        },
        body: JSON.stringify(payload)
      });
      
      if (response.ok) {
        lastSentData = data;
        retryCount = 0;
        console.log('[Papatec Snapshot] Enviado com sucesso:', new Date().toISOString());
      } else {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (error) {
      console.error('[Papatec Snapshot] Erro ao enviar:', error);
      retryCount++;
      if (retryCount >= MAX_RETRIES) {
        console.error('[Papatec Snapshot] Max retries atingido, parando');
        stop();
      }
    } finally {
      isRunning = false;
    }
  }
  
  // Inicia o loop de envio
  function start() {
    if (isRunning) return;
    
    if (!config.apiBase || !config.token || !config.machineId) {
      console.warn('[Papatec Snapshot] Configuração não definida. Defina window.PAPATEC_SNAPSHOT_CONFIG');
      return;
    }
    
    console.log('[Papatec Snapshot] Iniciando envio automático a cada 1 minuto');
    
    // Envio imediato
    sendSnapshot();
    
    // Loop a cada 1 minuto
    const interval = setInterval(sendSnapshot, 60000);
    
    // Guarda referência para poder parar
    window.PAPATEC_SNAPSHOT_INTERVAL = interval;
    
    // Listener para online/offline
    window.addEventListener('online', sendSnapshot);
    window.addEventListener('beforeunload', sendSnapshot);
  }
  
  function stop() {
    if (window.PAPATEC_SNAPSHOT_INTERVAL) {
      clearInterval(window.PAPATEC_SNAPSHOT_INTERVAL);
      window.PAPATEC_SNAPSHOT_INTERVAL = null;
    }
    window.removeEventListener('online', sendSnapshot);
    window.removeEventListener('beforeunload', sendSnapshot);
    console.log('[Papatec Snapshot] Parado');
  }
  
  // Auto-inicia se configuração já estiver definida
  if (config.apiBase && config.token && config.machineId) {
    // Aguarda DOM carregar
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start);
    } else {
      start();
    }
  }
  
  // Expõe API pública
  window.PapatecSnapshot = {
    start,
    stop,
    sendNow: sendSnapshot,
    config: (newConfig) => { Object.assign(config, newConfig); },
    getLastSent: () => lastSentData
  };
  
})();