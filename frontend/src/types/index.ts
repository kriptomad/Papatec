export type UserRole = 'ADMIN' | 'TECHNICIAN' | 'RECEPTIONIST';
export type BudgetStatus = 'DRAFT' | 'SENT' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'CONVERTED_TO_OS';
export type OSStatus = 'OPEN' | 'IN_PROGRESS' | 'WAITING_PARTS' | 'READY' | 'DELIVERED' | 'CANCELLED';
export type PartStatus = 'ACTIVE' | 'INACTIVE';
export type StockMovementType = 'IN' | 'OUT' | 'ADJUSTMENT';
export type PartyType = 'PF' | 'PJ';
export type ProductType = 'NEW' | 'USED' | 'DIGITAL';

export interface User {
  id: string;
  code?: string | null;
  email: string;
  name: string;
  role: UserRole;
  active: boolean;
  avatar?: string;
  // Cadastro de funcionário/parceiro (PDF p.4)
  phone?: string | null;
  ramal?: string | null;
  cpf?: string | null;
  rg?: string | null;
  cnpj?: string | null;
  ie?: string | null;
  im?: string | null;
  street?: string | null;
  number?: string | null;
  complement?: string | null;
  district?: string | null;
  zip?: string | null;
  city?: string | null;
  state?: string | null;
  site?: string | null;
  notes?: string | null;
  commissionPercent?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface Client {
  id: string;
  code?: string | null;
  type: PartyType;
  active: boolean;
  name: string;
  phone: string;
  ramal?: string | null;
  email?: string;
  site?: string | null;
  address?: string;
  street?: string | null;
  number?: string | null;
  complement?: string | null;
  district?: string | null;
  zip?: string | null;
  city?: string | null;
  state?: string | null;
  cpf?: string;
  rg?: string | null;
  cnpj?: string | null;
  ie?: string | null;
  im?: string | null;
  responsibleId?: string | null;
  responsible?: { id: string; name: string } | null;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  _count?: { budgets: number; serviceOrders: number };
  // Briefing D3/D1: vários endereços e equipamentos do cliente
  addresses?: ClientAddress[];
  equipments?: ClientEquipment[];
}

// Briefing D3/B.2.1: um cliente pode ter VÁRIOS endereços
export interface ClientAddress {
  id: string;
  clientId: string;
  label?: string | null;
  street: string;
  number?: string | null;
  complement?: string | null;
  district?: string | null;
  zip?: string | null;
  city?: string | null;
  state?: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

// Briefing D1: equipamento com ID único atrelado ao cliente
export interface ClientEquipment {
  id: string;
  clientId: string;
  name: string;
  brand?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Supplier {
  id: string;
  code?: string | null;
  type: PartyType;
  active: boolean;
  name: string;
  contact?: string | null;
  phone?: string | null;
  ramal?: string | null;
  email?: string | null;
  site?: string | null;
  street?: string | null;
  number?: string | null;
  complement?: string | null;
  district?: string | null;
  zip?: string | null;
  city?: string | null;
  state?: string | null;
  cpf?: string | null;
  rg?: string | null;
  cnpj?: string | null;
  ie?: string | null;
  im?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: { purchases: number };
  purchases?: Purchase[];
}

export interface PurchaseItem {
  id: string;
  purchaseId: string;
  partId?: string | null;
  part?: Part | null;
  name: string;
  code?: string | null;
  qty: number;
  unitPrice: number;
  unitCost: number;
  total: number;
}

export interface Purchase {
  id: string;
  code?: string | null;
  supplierId: string;
  supplier?: Supplier;
  purchaseDate: string;
  itemsTotal: number;
  freight: number;
  tax: number;
  discountType: 'VALUE' | 'PERCENT';
  discount: number;
  total: number;
  paymentMethod?: string | null;
  nfNumber?: string | null;
  nfTransport?: string | null;
  notes?: string | null;
  userId: string;
  user?: { id: string; name: string };
  createdAt: string;
  updatedAt: string;
  items?: PurchaseItem[];
  _count?: { items: number };
}

export interface BudgetItem {
  id: string;
  budgetId: string;
  partId?: string;
  part?: Part;
  name: string;
  qty: number;
  unitPrice: number;
  total: number;
  // Briefing B3: desconto por item (% ou R$)
  discount?: number;
  discountType?: 'VALUE' | 'PERCENT';
  type: 'PART' | 'SERVICE';
}

// Briefing B2.2: endereço do serviço (snapshot do cadastro ou manual)
export interface ServiceAddress {
  label?: string;
  street: string;
  number?: string;
  complement?: string;
  district?: string;
  zip?: string;
  city?: string;
  state?: string;
}

export interface Budget {
  id: string;
  clientId: string;
  client: Client;
  creatorId: string;
  creator: User;
  status: BudgetStatus;
  equipment: Equipment[];
  defect: string;
  laborHours: number;
  laborRate: number;
  totalParts: number;
  totalLabor: number;
  total: number;
  notes?: string;
  validUntil?: string;
  // Briefing B2.2: serviço local × externo + endereço do serviço
  serviceType?: 'LOCAL' | 'EXTERNAL';
  serviceAddress?: ServiceAddress | null;
  createdAt: string;
  updatedAt: string;
  items: BudgetItem[];
  serviceOrder?: ServiceOrder;
}

export interface Equipment {
  name: string;
  brand?: string;
  model?: string;
  serial?: string;
  photos?: string[];
  notes?: string;
}

export interface ServiceOrder {
  id: string;
  budgetId?: string;
  budget?: Budget;
  clientId: string;
  client: Client;
  creatorId: string;
  creator: User;
  technicianId?: string;
  technician?: User;
  status: OSStatus;
  equipment: Equipment[];
  defect: string;
  diagnosis?: string;
  solution?: string;
  laborHours: number;
  laborRate: number;
  totalParts: number;
  totalLabor: number;
  total: number;
  startedAt?: string;
  finishedAt?: string;
  deliveredAt?: string;
  warrantyDays: number;
  // Briefing B.2/C: serviço externo, endereço do serviço, fonte da mão de obra
  // (MANUAL = digitada | VISITS = soma do registro de horas) e checklist
  serviceType?: 'LOCAL' | 'EXTERNAL';
  serviceAddress?: ServiceAddress | null;
  laborSource?: 'MANUAL' | 'VISITS';
  checklist?: Array<{ label: string; done: boolean }> | null;
  createdAt: string;
  updatedAt: string;
  items: OSItem[];
  movements: OSMovement[];
  photos: OSPhoto[];
  visits?: ServiceVisit[];
}

export interface OSItem {
  id: string;
  osId: string;
  partId?: string;
  part?: Part;
  name: string;
  qty: number;
  unitPrice: number;
  total: number;
  // Briefing B3: desconto por item (% ou R$)
  discount?: number;
  discountType?: 'VALUE' | 'PERCENT';
  type: 'PART' | 'LABOR' | 'SERVICE';
}

// Briefing B2.3/C1: visita agendada + registro de horas do técnico
export interface ServiceVisit {
  id: string;
  osId: string;
  os?: { id: string; osNumber?: string; status?: OSStatus; client?: { name: string } };
  date: string;
  scheduledAt?: string | null;
  address?: ServiceAddress | null;
  arrival?: string | null;
  departure?: string | null;
  needsSecondVisit: boolean;
  notes?: string | null;
  techId?: string | null;
  tech?: { id: string; name: string } | null;
  // Briefing: aprovação do agendamento pelo técnico
  appointmentStatus?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  createdAt: string;
  updatedAt: string;
}

// Calendar / Agendamentos
export type CalendarEventType = 'APPOINTMENT' | 'HOLIDAY' | 'SPECIAL_DATE' | 'LUNCH_BREAK' | 'BUSINESS_HOURS' | 'CUSTOM';

export interface CalendarEvent {
  id: string;
  title: string;
  description?: string;
  type: CalendarEventType;
  startAt: string;
  endAt: string;
  allDay: boolean;
  color?: string;
  recurrence?: string;
  techId?: string | null;
  tech?: { id: string; name: string } | null;
  osId?: string | null;
  visitId?: string | null;
  isPublic: boolean;
  createdById: string;
  createdBy?: { id: string; name: string };
  createdAt: string;
  updatedAt: string;
}

// Venda de Produto (PDV Lite)
export type SaleType = 'PRODUCT_ONLY' | 'FROM_OS';

export interface Sale {
  id: string;
  code: string;
  clientId?: string | null;
  client?: Client | null;
  userId: string;
  user: User;
  saleType: SaleType;
  osId?: string | null;
  total: number;
  discount: number;
  discountType: 'VALUE' | 'PERCENT';
  paymentMethod?: string | null;
  notes?: string | null;
  totalCommission: number;
  createdAt: string;
  updatedAt: string;
  items: SaleItem[];
}

export interface SaleItem {
  id: string;
  saleId: string;
  partId?: string | null;
  part?: Part | null;
  name: string;
  code?: string | null;
  qty: number;
  unitPrice: number;
  total: number;
  discount: number;
  discountType: 'VALUE' | 'PERCENT';
  commissionPercent: number;
  commissionValue: number;
  commissionType: 'PERCENT' | 'VALUE';
  createdAt: string;
  updatedAt: string;
}

export interface OSMovement {
  id: string;
  osId: string;
  userId: string;
  user: User;
  fromStatus?: OSStatus;
  toStatus: OSStatus;
  note?: string;
  createdAt: string;
}

export interface OSPhoto {
  id: string;
  osId: string;
  url: string;
  caption?: string;
  createdAt: string;
}

export interface Part {
  id: string;
  code: string;
  name: string;
  description?: string;
  category?: string;
  unit: string;
  costPrice: number;
  salePrice: number;
  minStock: number;
  quantity: number;
  status: PartStatus;
  // PDF p.3: Tipo (Novo/Usado/Digital), NCM e % de comissão específica
  productType?: ProductType | null;
  ncm?: string | null;
  commissionPercent?: number | null;
  // Briefing A: busca por fabricante/característica, desconto e alerta por item
  manufacturer?: string | null;
  characteristics?: string | null;
  maxDiscountPercent?: number | null;
  maxDiscountValue?: number | null;
  alertEnabled?: boolean;
  supplier?: string;
  location?: string;
  createdAt: string;
  updatedAt: string;
  needsRestock?: boolean;
  _count?: { movements: number };
}

export interface StockMovement {
  id: string;
  partId: string;
  part: Part;
  type: StockMovementType;
  qty: number;
  reason?: string;
  userId: string;
  user: User;
  createdAt: string;
}

/**
 * Formato REAL enviado pelo backend:
 *  - login: { clientName, issuedAt, expiresAt, daysRemaining, features, maxUsers, active }
 *  - /auth/license/status e /license/status: { isLicensed, hardwareId, license: {...} }
 * Campos legados (cnpj, isValid, ...) ficam opcionais para não quebrar telas
 * antigas - NUNCA confie em `isValid` para decidir redirecionamento.
 */
export interface LicenseInfo {
  isLicensed?: boolean;
  hardwareId?: string;
  clientName?: string;
  issuedAt?: string | number | null;
  expiresAt?: string | number | null;
  features?: string[];
  maxUsers?: number;
  maxEmployees?: number | null;
  active?: boolean;
  daysRemaining?: number | null;
  license?: LicenseInfo | null;
  // legados
  cnpj?: string;
  companyName?: string;
  isValid?: boolean;
  signature?: string;
  publicKey?: string;
  activatedAt?: string;
  [key: string]: unknown;
}

export interface AuthState {
  user: User | null;
  token: string | null;
  license: LicenseInfo | null;
  isAuthenticated: boolean;
}

export interface LoginDto { email: string; password: string; }
export interface RegisterDto { name: string; email: string; password: string; role?: UserRole; }

export interface CreateClientDto {
  name: string;
  phone: string;
  email?: string;
  address?: string;
  cpf?: string;
  notes?: string;
}

export interface CreateBudgetDto {
  clientId: string;
  equipment: Equipment[];
  defect: string;
  laborHours: number;
  laborRate: number;
  items: Omit<BudgetItem, 'id' | 'budgetId' | 'total'>[];
  notes?: string;
  validUntil?: string;
}

export interface CreateOsDto {
  clientId: string;
  technicianId?: string;
  equipment: Equipment[];
  defect: string;
  laborHours: number;
  laborRate: number;
  warrantyDays?: number;
  items: Omit<OSItem, 'id' | 'osId' | 'total'>[];
}

export interface CreatePartDto {
  code: string;
  name: string;
  description?: string;
  category?: string;
  unit?: string;
  costPrice?: number;
  salePrice: number;
  minStock?: number;
  quantity?: number;
  supplier?: string;
  location?: string;
}

export interface ApiResponse<T> {
  success: true;
  data: T;
  timestamp: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Stats {
  budgets: { total: number; byStatus: Record<BudgetStatus, number>; last30Days: { total: number; count: number } };
  serviceOrders: { total: number; byStatus: Record<OSStatus, number>; delivered: { total: number; count: number } };
  inventory: { total: number; active: number; inactive: number; lowStock: number; totalItems: number };
}