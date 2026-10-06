import axios, { AxiosError, InternalAxiosRequestConfig, AxiosResponse } from 'axios';
import type { ApiResponse, PaginatedResponse } from '../types';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

export const api = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' },
  timeout: 60000,
});

// ---------------------------------------------------------------------------
// Interceptors
// ---------------------------------------------------------------------------
api.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = localStorage.getItem('token');
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
  },
  (error) => Promise.reject(error)
);

api.interceptors.response.use(
  (response: AxiosResponse) => response,
  (error: AxiosError) => {
    const status = error.response?.status;
    const body = error.response?.data as any;

    // Normaliza o envelope de erro para as telas: data.message
    if (error.response && body?.error?.message && typeof body.message !== 'string') {
      (error.response.data as any).message = body.error.message;
    }
    // Briefing: campos específicos com erro (validação campo a campo)
    if (error.response && body?.error?.fields) {
      (error.response.data as any).fields = body.error.fields;
    }

    if (status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      localStorage.removeItem('license');
      if (!window.location.pathname.startsWith('/login')) {
        window.location.href = '/login';
      }
    }

    if (status === 403) {
      const code = body?.error?.code;
      if (code === 'SYSTEM_LOCKED_DRM_VIOLATION' || code === 'LICENSE_EXPIRED' || code === 'DRM_CONFIG_ERROR') {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        localStorage.removeItem('license');
        // Sistema bloqueado: leva para a tela pública de (re)ativação,
        // onde basta colar um novo token - não exige login.
        if (!window.location.pathname.startsWith('/activate')) {
          window.location.href = '/activate';
        }
      }
    }

    return Promise.reject(error);
  }
);

// ---------------------------------------------------------------------------
// Helpers - TODAS as chamadas devolvem já o payload (envelope desembrulhado)
// ---------------------------------------------------------------------------
async function request<T>(promise: Promise<AxiosResponse<any>>): Promise<T> {
  const response = await promise;
  return response.data?.data as T;
}

export const get = <T = any>(url: string, params?: any) => request<T>(api.get(url, { params }));
export const post = <T = any>(url: string, data?: any, config?: any) => request<T>(api.post(url, data, config));
export const put = <T = any>(url: string, data?: any, config?: any) => request<T>(api.put(url, data, config));
export const del = <T = any>(url: string, config?: any) => request<T>(api.delete(url, config));

/** Envelope completo (quando a tela precisa de success/error). */
export const raw = {
  get: (url: string, params?: any) => api.get(url, { params }),
  post: (url: string, data?: any, config?: any) => api.post(url, data, config),
};

export const unwrap = <T>(response: { data: ApiResponse<T> }): T => response.data.data;
export const unwrapPaginated = <T>(response: { data: ApiResponse<PaginatedResponse<T>> }): PaginatedResponse<T> =>
  response.data.data;

type FormDataPayload = FormData | Record<string, any>;

/** Header multipart apenas quando o payload é FormData (senão axios serializa JSON). */
const formConfig = (data: any) =>
  typeof FormData !== 'undefined' && data instanceof FormData
    ? { headers: { 'Content-Type': 'multipart/form-data' } }
    : undefined;

// ---------------------------------------------------------------------------
// Auth / Licença
// ---------------------------------------------------------------------------
export interface LicenseSummary {
  clientName?: string;
  issuedAt?: string | null;
  expiresAt?: string | null;
  daysRemaining?: number;
  features?: string[];
  maxUsers?: number;
  active?: boolean;
}

export interface LicenseStatus {
  isLicensed: boolean;
  hardwareId: string;
  license: LicenseSummary | null;
}

export const authApi = {
  login: (data: { email: string; password: string }) =>
    post<{ access_token: string; user: any; license: LicenseSummary | null }>('/auth/login', data),
  register: (data: any) => post<any>('/auth/register', data),
  setupAdmin: (data: { email: string; password: string; name: string }) =>
    post<{ access_token: string; user: any; license: LicenseSummary | null }>('/auth/setup-admin', data),
  setupStatus: () => get<{ needsSetup: boolean; userCount: number }>('/auth/setup-status'),
  getProfile: () => get<any>('/auth/profile'),
  changePassword: (data: { currentPassword: string; newPassword: string }) =>
    put<any>('/auth/password', data),
  getLicenseStatus: () => get<any>('/auth/license/status'),
  installLicense: (licenseJson: string) => post<any>('/auth/license/install', { licenseJson }),
  deactivateLicense: () => post<any>('/auth/license/deactivate'),
  license: {
    challenge: () => get<{ hardwareId: string }>('/license/challenge'),
    status: () => get<LicenseStatus>('/license/status'),
    activate: (token: string) => post<any>('/license/activate', { token }),
  },
};

// ---------------------------------------------------------------------------
// Usuários
// ---------------------------------------------------------------------------
export const usersApi = {
  list: (params?: { page?: number; limit?: number; search?: string; role?: string }) =>
    get<PaginatedResponse<any>>('/users', params),
  get: (id: string) => get<any>(`/users/${id}`),
  getTechnicians: () => get<any[]>('/users/technicians'),
  create: (data: any) => post<any>('/users', data),
  update: (id: string, data: any) => put<any>(`/users/${id}`, data),
  toggleActive: (id: string) => put<any>(`/users/${id}/toggle-active`),
  delete: (id: string) => del<any>(`/users/${id}`),
};

// ---------------------------------------------------------------------------
// Clientes
// ---------------------------------------------------------------------------
export const clientsApi = {
  list: (params?: {
    page?: number;
    limit?: number;
    skip?: number;
    take?: number;
    search?: string;
    hasActiveOs?: boolean;
  }) => get<PaginatedResponse<any>>('/clients', params),
  get: (id: string) => get<any>(`/clients/${id}`),
  getHistory: (id: string) => get<any>(`/clients/${id}/history`),
  create: (data: any) => post<any>('/clients', data),
  update: (id: string, data: any) => put<any>(`/clients/${id}`, data),
  delete: (id: string) => del<any>(`/clients/${id}`),
  // Briefing D3/D1: endereços e equipamentos do cliente
  listAddresses: (id: string) => get<any>(`/clients/${id}/addresses`),
  createAddress: (id: string, data: any) => post<any>(`/clients/${id}/addresses`, data),
  updateAddress: (id: string, addrId: string, data: any) => put<any>(`/clients/${id}/addresses/${addrId}`, data),
  deleteAddress: (id: string, addrId: string) => del<any>(`/clients/${id}/addresses/${addrId}`),
  listEquipment: (id: string) => get<any>(`/clients/${id}/equipment`),
  createEquipment: (id: string, data: any) => post<any>(`/clients/${id}/equipment`, data),
  updateEquipment: (id: string, eqId: string, data: any) => put<any>(`/clients/${id}/equipment/${eqId}`, data),
  deleteEquipment: (id: string, eqId: string) => del<any>(`/clients/${id}/equipment/${eqId}`),
};

// ---------------------------------------------------------------------------
// Fornecedores
// ---------------------------------------------------------------------------
export const suppliersApi = {
  list: (params?: {
    page?: number;
    limit?: number;
    skip?: number;
    take?: number;
    search?: string;
    active?: string;
  }) => get<PaginatedResponse<any>>('/suppliers', params),
  options: () => get<any[]>('/suppliers/options'),
  get: (id: string) => get<any>(`/suppliers/${id}`),
  create: (data: any) => post<any>('/suppliers', data),
  update: (id: string, data: any) => put<any>(`/suppliers/${id}`, data),
  toggleActive: (id: string) => put<any>(`/suppliers/${id}/toggle-active`),
  delete: (id: string) => del<any>(`/suppliers/${id}`),
};

// ---------------------------------------------------------------------------
// Entrada de Mercadoria (Compras)
// ---------------------------------------------------------------------------
export const purchasesApi = {
  list: (params?: {
    page?: number;
    limit?: number;
    skip?: number;
    take?: number;
    search?: string;
    supplierId?: string;
    startDate?: string;
    endDate?: string;
  }) => get<PaginatedResponse<any>>('/purchases', params),
  get: (id: string) => get<any>(`/purchases/${id}`),
  create: (data: any) => post<any>('/purchases', data),
  delete: (id: string) => del<any>(`/purchases/${id}`),
};

// ---------------------------------------------------------------------------
// Orçamentos (Budget)
// ---------------------------------------------------------------------------
export const budgetsApi = {
  list: (params?: {
    page?: number;
    limit?: number;
    skip?: number;
    take?: number;
    search?: string;
    status?: string;
    clientId?: string;
    startDate?: string;
    endDate?: string;
  }) => get<PaginatedResponse<any>>('/budgets', params),
  get: (id: string) => get<any>(`/budgets/${id}`),
  getStats: () => get<any>('/budgets/stats'),
  create: (data: FormDataPayload) => post<any>('/budgets', data, formConfig(data)),
  update: (id: string, data: FormDataPayload) => put<any>(`/budgets/${id}`, data, formConfig(data)),
  updateStatus: (id: string, status: string) => put<any>(`/budgets/${id}/status`, { status }),
  convertToOs: (id: string, data: { technicianId?: string; warrantyDays?: number }) =>
    post<any>(`/budgets/${id}/convert-to-os`, data),
  delete: (id: string) => del<any>(`/budgets/${id}`),
};

// ---------------------------------------------------------------------------
// Ordens de Serviço
// ---------------------------------------------------------------------------
export const serviceOrdersApi = {
  list: (params?: {
    page?: number;
    limit?: number;
    skip?: number;
    take?: number;
    search?: string;
    status?: string;
    clientId?: string;
    technicianId?: string;
    startDate?: string;
    endDate?: string;
  }) => get<PaginatedResponse<any>>('/service-orders', params),
  get: (id: string) => get<any>(`/service-orders/${id}`),
  getTimeline: (id: string) => get<any[]>(`/service-orders/${id}/timeline`),
  getStats: () => get<any>('/service-orders/stats'),
  create: (data: FormDataPayload) => post<any>('/service-orders', data, formConfig(data)),
  update: (id: string, data: FormDataPayload) => put<any>(`/service-orders/${id}`, data, formConfig(data)),
  updateStatus: (id: string, status: string, _unused?: string, note?: string) =>
    put<any>(`/service-orders/${id}/status`, { status, note }),
  assign: (id: string, technicianId: string) => put<any>(`/service-orders/${id}/assign`, { technicianId }),
  addItem: (id: string, data: any) => post<any>(`/service-orders/${id}/items`, data),
  // Briefing B1: remover item de O.S. entregue envia a senha no corpo
  removeItem: (id: string, itemId: string, unlockPassword?: string) =>
    del<any>(`/service-orders/${id}/items/${itemId}`, unlockPassword ? { data: { unlockPassword } } : undefined),
  // Briefing B1: valida senha de admin/vendedor p/ O.S. entregue
  unlock: (id: string, unlockPassword: string) => post<any>(`/service-orders/${id}/unlock`, { unlockPassword }),
  // PDF p.6/7 - fechamento: forma de pagamento combinada, contato com
  // cliente (aprovação/desconto) e "resumo p/ cliente" (gerar -> salvar)
  closing: (id: string, data: {
    paymentMethod?: string | null;
    clientApproved?: boolean | null;
    clientContactNotes?: string | null;
    clientSummary?: string | null;
    diagnosis?: string | null;
    solution?: string | null;
  }) => put<any>(`/service-orders/${id}/closing`, data),
  // Briefing B2: observação em tempo real (sem mudar status)
  addNote: (id: string, note: string) => post<any>(`/service-orders/${id}/notes`, { note }),
  // Briefing B2: indicador "digitando..." em tempo real.
  // O realtime é servido pelo osRealtimeRouter montado em `/api/os`
  // (POST /api/os/:id/realtime/typing). O path anterior
  // `/service-orders/${id}/realtime/typing` retornava 404 ROUTE_NOT_FOUND.
  setTyping: (id: string, isTyping: boolean) => post<any>(`/os/${id}/realtime/typing`, { isTyping }),
  // Briefing B8: checklist (itens vindos dos serviços no cadastro)
  updateChecklist: (id: string, checklist: Array<{ label: string; done: boolean }>) =>
    put<any>(`/service-orders/${id}/checklist`, { checklist }),
  // Briefing B6: token de 15min p/ upload direto da câmera do celular
  getPhotoToken: (id: string) => post<any>(`/service-orders/${id}/photos/token`, {}),
  uploadMobilePhoto: async (id: string, token: string, file: File) => {
    const formData = new FormData();
    formData.append('photo', file);
    return post<any>(`/os-mobile/${id}/photos?token=${encodeURIComponent(token)}`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  addPhoto: (id: string, file: File, caption?: string) => {
    const formData = new FormData();
    formData.append('photo', file);
    if (caption) formData.append('caption', caption);
    return post<any>(`/service-orders/${id}/photos`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  deletePhoto: (photoId: string) => del<any>(`/service-orders/photos/${photoId}`),
  delete: (id: string) => del<any>(`/service-orders/${id}`),
};

// ---------------------------------------------------------------------------
// Briefing C1: registro de horas / visitas do técnico
// ---------------------------------------------------------------------------
export const serviceVisitsApi = {
  list: (params?: { osId?: string; techId?: string; date?: string }) => get<any[]>('/service-visits', params),
  create: (data: any) => post<any>('/service-visits', data),
  update: (id: string, data: any) => put<any>(`/service-visits/${id}`, data),
  remove: (id: string) => del<any>(`/service-visits/${id}`),
  // Briefing C1: registro de horas com um clique (chegar/sair)
  arrive: (id: string) => post<any>(`/service-visits/${id}/arrive`),
  depart: (id: string) => post<any>(`/service-visits/${id}/depart`),
  calendar: (params?: { start?: string; end?: string }) => get<any[]>('/service-visits/calendar/range', params),
  // Briefing: aprovação do técnico sobre o agendamento
  pending: () => get<any[]>('/service-visits/pending'),
  approve: (id: string, data?: any) => post<any>(`/service-visits/${id}/approve`, data || {}),
  reject: (id: string, data?: any) => post<any>(`/service-visits/${id}/reject`, data || {}),
  reschedule: (id: string, data: any) => post<any>(`/service-visits/${id}/reschedule`, data),
};

// ---------------------------------------------------------------------------
// Maquininha / gateway de cartão
//
// Regra do domínio: `paymentMethod` é a FORMA escolhida no cadastro e
// `paymentStatus` é o ESTADO do pagamento. Cobrar exige `paymentStatus`
// diferente de PAID — por isso a API barra a segunda cobrança.
// ---------------------------------------------------------------------------
export type PaymentKind = 'CREDIT' | 'DEBIT' | 'PIX';
export type CardTransactionStatus = 'PENDING' | 'APPROVED' | 'DECLINED' | 'CANCELLED' | 'ERROR';

export interface CardMachine {
  id: string;
  name: string;
  type: 'POS' | 'TEF' | 'SMARTPOS';
  connectionType: 'BLUETOOTH' | 'USB' | 'NETWORK' | 'WIFI';
  deviceIdentifier?: string;
  ipAddress?: string;
  port?: number;
  isActive: boolean;
  supportedTypes: PaymentKind[];
  maxInstallments: number;
  gateway?: {
    driver?: 'CIELO' | 'TEF_IP' | 'SIMULATED';
    baseUrl?: string;
    merchantId?: string;
    merchantKey?: string;
    terminal?: string;
    sandbox?: boolean;
    autoApprove?: boolean;
    authorizePath?: string;
    cancelPath?: string;
    healthPath?: string;
    authHeader?: { name?: string; value?: string };
  };
}

export interface CardChargeResult {
  transactionId: string;
  machineId: string;
  gateway: string;
  status: CardTransactionStatus;
  externalId?: string;
  authorizationCode?: string;
  nsu?: string;
  qrCode?: string;
  message?: string;
  /** true = resultado definitivo; false = aguardando callback do gateway. */
  synchronous: boolean;
  createdAt: string;
}

export const cardMachinesApi = {
  list: () => get<CardMachine[]>('/card-machines'),
  get: (id: string) => get<CardMachine>(`/card-machines/${id}`),
  create: (data: Partial<CardMachine>) => post<CardMachine>('/card-machines', data),
  update: (id: string, data: Partial<CardMachine>) => put<CardMachine>(`/card-machines/${id}`, data),
  remove: (id: string) => del<any>(`/card-machines/${id}`),
  /** Checa credenciais / ligação do gateway. */
  test: (id: string) => post<{ success: boolean; message: string }>(`/card-machines/${id}/test`, {}),

  pending: () => get<{ transactionId: string; saleId: string; machineId: string; age: number }[]>(
    '/card-machines/transactions/pending'
  ),
  history: (saleId: string) => get<any[]>(`/card-machines/sales/${saleId}/transactions`),
  cancel: (transactionId: string) => post<any>(`/card-machines/transaction/${transactionId}/cancel`, {}),

  /** Cobra o TOTAL da venda. Retorna PENDING quando o gateway é assíncrono. */
  chargeSale: (saleId: string, payload: { type: PaymentKind; installments?: number; cardBrand?: string; machineId?: string }) =>
    post<CardChargeResult>(`/card-machines/sales/${saleId}/process-payment`, payload),
  /** Cobra um valor arbitrário em centavos. */
  charge: (payload: { saleId: string; amountCents: number; type: PaymentKind; installments?: number; cardBrand?: string; machineId?: string }) =>
    post<CardChargeResult>('/card-machines/transaction', payload),
};

// ---------------------------------------------------------------------------
// Briefing: CALENDÁRIO do sistema (feriados, dias especiais, almoço, horário
// comercial, agendamentos visíveis para todos)
// ---------------------------------------------------------------------------
export const calendarApi = {
  list: (params?: { start?: string; end?: string; type?: string; techId?: string }) =>
    get<any[]>('/calendar', params),
  get: (id: string) => get<any>(`/calendar/${id}`),
  create: (data: any) => post<any>('/calendar', data),
  update: (id: string, data: any) => put<any>(`/calendar/${id}`, data),
  remove: (id: string) => del<any>(`/calendar/${id}`),
};

// ---------------------------------------------------------------------------
// Inventário
// ---------------------------------------------------------------------------
export const inventoryApi = {
  list: (params?: {
    page?: number;
    limit?: number;
    skip?: number;
    take?: number;
    search?: string;
    category?: string;
    status?: string;
    lowStock?: boolean;
  }) => get<PaginatedResponse<any>>('/inventory', params),
  get: (id: string) => get<any>(`/inventory/${id}`),
  getStats: () => get<any>('/inventory/stats'),
  getLowStock: () => get<any[]>('/inventory/low-stock'),
  getCategories: () => get<string[]>('/inventory/categories'),
  getMovements: (id: string, params?: { page?: number; limit?: number }) =>
    get<PaginatedResponse<any>>(`/inventory/${id}/movements`, params),
  getMonthlyMovement: (params?: { year?: number; month?: number }) =>
    get<any>('/inventory/movements/monthly', params),
  create: (data: any) => post<any>('/inventory', data),
  update: (id: string, data: any) => put<any>(`/inventory/${id}`, data),
  toggleStatus: (id: string) => put<any>(`/inventory/${id}/toggle-status`),
  adjustStock: (id: string, data: { type: string; qty: number; reason?: string }) =>
    post<any>(`/inventory/${id}/stock`, data),
  delete: (id: string) => del<any>(`/inventory/${id}`),
};

// ---------------------------------------------------------------------------
// Catálogo de serviços
// ---------------------------------------------------------------------------
export const servicesApi = {
  list: (params?: { category?: string; isActive?: boolean }) => get<any[]>('/services', params),
  byCategory: () => get<Record<string, any[]>>('/services/by-category'),
  get: (id: string) => get<any>(`/services/${id}`),
  create: (data: any) => post<any>('/services', data),
  update: (id: string, data: any) => put<any>(`/services/${id}`, data),
  toggle: (id: string) => put<any>(`/services/${id}/toggle`),
  remove: (id: string) => del<any>(`/services/${id}`),
  initDefaults: () => post<any>('/services/init'),
};

// ---------------------------------------------------------------------------
// Financeiro - despesas
// ---------------------------------------------------------------------------
export const expensesApi = {
  list: (params?: { page?: number; limit?: number; category?: string; startDate?: string; endDate?: string }) =>
    get<PaginatedResponse<any>>('/expenses', params),
  get: (id: string) => get<any>(`/expenses/${id}`),
  create: (data: any) => post<any>('/expenses', data),
  update: (id: string, data: any) => put<any>(`/expenses/${id}`, data),
  remove: (id: string) => del<any>(`/expenses/${id}`),
  monthlySummary: (params?: { year?: number; month?: number }) => get<any>('/expenses/summary/monthly', params),
  yearlySummary: (params?: { year?: number }) => get<any>('/expenses/summary/yearly', params),
  byCategory: (params?: { startDate?: string; endDate?: string }) =>
    get<any>('/expenses/summary/by-category', params),
};

// ---------------------------------------------------------------------------
// Relatórios / indicadores
// ---------------------------------------------------------------------------
export const reportsApi = {
  inventoryValuation: () => get<any>('/reports/inventory-valuation'),
  profitLossMonthly: (params?: { year?: number; month?: number }) =>
    get<any>('/reports/profit-loss/monthly', params),
  profitLossYearly: (params?: { year?: number }) => get<any>('/reports/profit-loss/yearly', params),
  monthlyMovements: (params?: { year?: number; month?: number }) =>
    get<any>('/reports/movements/monthly', params),
  topItems: (params?: { limit?: number }) => get<any[]>('/reports/top-items', params),
  topServices: (params?: { limit?: number }) => get<any[]>('/reports/top-services', params),
};

// ---------------------------------------------------------------------------
// Configurações
// ---------------------------------------------------------------------------
export const settingsApi = {
  getAll: () => get<Record<string, any>>('/settings'),
  getByCategory: (category: string) => get<Record<string, any>>(`/settings/category/${category}`),
  getCatalog: () => get<any[]>('/settings/catalog'),
  update: (key: string, value: any) => put<any>('/settings/' + key, { value }),
  updateMany: (settings: Record<string, any>) => put<any>('/settings', { settings }),
  initDefaults: () => post<any>('/settings/init'),
};

// ---------------------------------------------------------------------------
// Backup
// ---------------------------------------------------------------------------
export const backupApi = {
  list: () => get<{ files: any[]; path: string; schedule: string }>('/backup/list').then((r) => r.files || []),
  getConfig: () => get<Record<string, any>>('/backup/config'),
  create: () => post<any>('/backup/create'),
  restore: (file: string) => post<any>(`/backup/restore/${encodeURIComponent(file)}`),
  delete: (file: string) => del<any>(`/backup/${encodeURIComponent(file)}`),
  cleanup: (retentionDays?: number) =>
    post<any>('/backup/cleanup', null, { params: retentionDays ? { retentionDays } : {} }),
  sync: (file: string) => post<any>(`/backup/sync/${encodeURIComponent(file)}`),
  // --- Recuperação do Sistema / tempo real ---------------------------------
  status: () =>
    get<{
      schedule: string;
      path: string;
      realtime: boolean;
      dirty: boolean;
      lastRunAt: string | null;
      lastFile: string | null;
      lastSize: number | null;
    }>('/backup/status'),
  inspect: (file: string) =>
    get<{ name: string; generatedAt: string | null; tables: number; rows: number; size: number }>(
      `/backup/inspect/${encodeURIComponent(file)}`
    ),
  getToken: () => get<{ token: string }>('/backup/token'),
  regenerateToken: () => post<{ token: string }>('/backup/token'),
  upload: async (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    const res = await api.post('/backup/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
    return res.data.data as { file: string; name: string; generatedAt: string | null; tables: number; rows: number; size: number };
  },
  // Baixa um .bkp como Blob (axios + Authorization; link simples não manda o token)
  downloadBlob: async (file: string): Promise<{ blob: Blob; name: string }> => {
    const res = await api.get(`/backup/download/${encodeURIComponent(file)}`, { responseType: 'blob' });
    const disposition = String(res.headers['content-disposition'] || '');
    const match = disposition.match(/filename="?([^"]+)"?/i);
    return { blob: res.data as Blob, name: match ? match[1] : file };
  },
};

export const osRealtimeApi = {
  connect: (osId: string, token?: string) => {
    const url = `/api/os/${osId}/realtime${token ? `?token=${encodeURIComponent(token)}` : ''}`;
    return new EventSource(url);
  },
  addNote: (osId: string, note: string) => post<any>(`/service-orders/${osId}/notes`, { note }),
  // Rota real: POST /api/os/:id/realtime/typing (ver comentário em
  // serviceOrdersApi.setTyping). O path antigo `/service-orders/:id/typing`
  // nao existe e retornava 404 ROUTE_NOT_FOUND.
  setTyping: (osId: string, isTyping: boolean) => post<any>(`/os/${osId}/realtime/typing`, { isTyping }),
  getTimeline: (osId: string) => get<any[]>(`/service-orders/${osId}/timeline`),
};

// ---------------------------------------------------------------------------
// Briefing: VENDA DE MERCADORIA (separada de O.S.)
// ---------------------------------------------------------------------------
export const salesApi = {
  list: (params?: {
    page?: number;
    limit?: number;
    clientId?: string;
    userId?: string;
    startDate?: string;
    endDate?: string;
    saleType?: string;
    search?: string;
  }) => get<PaginatedResponse<any>>('/sales', params),
  get: (id: string) => get<any>(`/sales/${id}`),
  create: (data: any) => post<any>('/sales', data),
  update: (id: string, data: any) => put<any>(`/sales/${id}`, data),
  remove: (id: string) => del<any>(`/sales/${id}`),
  fromOs: (osId: string, data?: any) => post<any>(`/sales/from-os/${osId}`, data || {}),
  // Briefing: devolução/troca gera documento e devolve estoque
  returns: (saleId: string) => get<any[]>(`/sales/${saleId}/returns`),
  createReturn: (saleId: string, data: any) => post<any>(`/sales/${saleId}/returns`, data),
  // Comissão: o único lugar onde ela aparece (não sai em O.S., venda, nota).
  // `days` é a janela padrão (90); startDate/endDate sobrescrevem para um
  // intervalo fechado. `userId` só é aceito para ADMIN — o vendedor comum é
  // filtrado no servidor e vê apenas as próprias vendas.
  commission: (params?: { days?: number; startDate?: string; endDate?: string; userId?: string }) =>
    get<any>('/sales/commission', params),
  // Lista de vendedores para o filtro da tela de comissão (uso do ADMIN).
  listSellers: () => get<any[]>('/users?role=RECEPTIONIST&limit=200'),
};
