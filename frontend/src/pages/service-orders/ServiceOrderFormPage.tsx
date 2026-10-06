import { Box, Card, CardContent, TextField, Button, Typography, Grid, Alert, CircularProgress, Tabs, Tab, TableContainer, Table, TableHead, TableBody, TableRow, TableCell, Chip, IconButton, Divider, Autocomplete, ToggleButtonGroup, ToggleButton, FormControlLabel, Checkbox, Tooltip } from '@mui/material';
import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { serviceOrdersApi, clientsApi, inventoryApi, usersApi } from '../../services/api';
import FormErrors from '../../components/ui/FormErrors';
import { PrimaryButton, SecondaryButton, DangerButton } from '../../components/ui/Buttons';
import { OSStatusChip } from '../../components/ui/StatusChips';
import { formatCurrency, formatDate } from '../../utils/formatters';
import { Add, Delete, CheckCircle, Build } from '@mui/icons-material';

const itemSchema = z.object({
  // A API devolve `null` (e não `undefined`) para peça não vinculada.
  // `.optional()` no Zod v3 aceita só `undefined` e REJEITA `null`
  // ("Expected string, received null") — travando a edição da O.S.
  partId: z.string().nullish(),
  name: z.string().min(1, 'Nome obrigatório'),
  qty: z.number().min(1, 'Mínimo 1'),
  unitPrice: z.number().min(0, 'Preço inválido'),
  // Briefing B3: desconto por item (% ou R$) — validado no backend
  discount: z.number().min(0),
  discountType: z.enum(['VALUE', 'PERCENT']),
  type: z.enum(['PART', 'LABOR', 'SERVICE']),
  // Briefing C: comissão personalizada por item (% ou R$)
  commissionPercent: z.number().min(0),
  commissionValue: z.number().min(0),
  commissionType: z.enum(['PERCENT', 'VALUE']),
});

// Todos os opcionais usam `.nullish()` (null | undefined): os campos `String?`
// do Prisma voltam como `null` quando vazios, e `.optional()` sozinho quebrava
// a edição de uma O.S. existente com "Expected string, received null".
const osSchema = z.object({
  clientId: z.string().min(1, 'Cliente obrigatório'),
  technicianId: z.string().nullish(),
  equipment: z.array(z.object({
    name: z.string(),
    brand: z.string().nullish(),
    model: z.string().nullish(),
    serial: z.string().nullish(),
    photos: z.array(z.string()).nullish(),
    notes: z.string().nullish(),
  })).min(1, 'Pelo menos um equipamento'),
  defect: z.string().min(5, 'Descreva o defeito'),
  laborHours: z.number().min(0),
  laborRate: z.number().min(0),
  warrantyDays: z.number().min(0).max(365).nullish(),
  notes: z.string().nullish(),
  diagnosis: z.string().nullish(),
  solution: z.string().nullish(),
  items: z.array(itemSchema).min(1, 'Pelo menos um item'),
  // Briefing B2.2: Serviço local × externo × acesso remoto + endereço do Serviço
  serviceType: z.enum(['LOCAL', 'EXTERNAL', 'REMOTE']),
  serviceAddress: z.any().optional().nullable(),
  // Endereços extras para o mesmo Serviço externo (residência + escritório).
  // Só usado quando serviceType === 'EXTERNAL'. Cada entrada vira visita.
  extraAddresses: z.array(z.object({
    street: z.string().optional(),
    number: z.string().optional(),
    complement: z.string().optional(),
    district: z.string().optional(),
    zip: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
  })).optional(),
  // Briefing C2: origem da Mão de obra (digitada ou soma das visitas)
  laborSource: z.enum(['MANUAL', 'VISITS']),
  // Briefing O.S.: equipamento - entrega (acessórios, estado, senha, quem deixou)
  accessories: z.string().nullish(),
  condition: z.string().nullish(),
  devicePassword: z.string().nullish(),
  droppedOffBy: z.string().nullish(),
  // Briefing O.S.: Observações internas × externas (a externa é impressa)
  internalNotes: z.string().nullish(),
  externalNotes: z.string().nullish(),
  // Briefing PDF p.6/7: forma de pagamento combinada com o cliente
  paymentMethod: z.string().nullish(),
  // Briefing: delivery — retirado/levado ao cliente com valor automático
  deliveryType: z.enum(['NONE', 'PICKUP', 'DELIVERY']),
  deliveryValue: z.number({ invalid_type_error: 'Valor inválido' }).min(0, 'Valor inválido'),
  deliveryDone: z.boolean(),
}).superRefine((val, ctx) => {
  // Briefing A: Serviço externo exige endereço (mesma validação do backend)
  if (val.serviceType === 'EXTERNAL' && !(val.serviceAddress as any)?.street) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['serviceAddress'],
      message: 'Serviço externo requer o endereço do Serviço (rua obrigatória)',
    });
  }
  // Valida endereços extras: se o usuário começou a preencher um, a rua é obrigatória
  if (val.serviceType === 'EXTERNAL' && Array.isArray(val.extraAddresses)) {
    val.extraAddresses.forEach((addr: any, i: number) => {
      const touched = addr && Object.values(addr).some((v) => String(v ?? '').trim());
      if (touched && !addr.street?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['extraAddresses', i, 'street'],
          message: `Endereço extra ${i + 1}: a rua é obrigatória`,
        });
      }
    });
  }
});

type OsForm = z.infer<typeof osSchema>;
type ItemForm = z.infer<typeof itemSchema>;

// Briefing PDF p.6/7: opções da "forma de pagamento combinada" (usadas no form e no fechamento)
const PAYMENT_METHOD_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'DINHEIRO', label: 'Dinheiro' },
  { value: 'PIX', label: 'PIX' },
  { value: 'CARTAO_CREDITO', label: 'Cartão de Crédito' },
  { value: 'CARTAO_DEBITO', label: 'Cartão Débito' },
  { value: 'BOLETO', label: 'Boleto' },
  { value: 'TRANSFERENCIA', label: 'Transferência' },
  { value: 'A_PRAZO', label: 'A Prazo' },
  { value: 'OUTRO', label: 'Outro' },
];

// ---------------------------------------------------------------------------
// FEEDBACK DE VALIDACAO
//
// BUG: as abas sao renderizadas condicionalmente ({activeTab === n && ...}).
// Quando o zod bloqueava o submit (ex.: `items.min(1)` sem item cadastrado),
// o erro era gravado em `formState.errors`, mas o campo que deveria exibir o
// `helperText` estava na aba 2 e POR ISSO NAO EXISTIA no DOM. Resultado: o
// usuario clicava em "Criar OS", o `handleSubmit` devolvia sem chamar o
// onSubmit, e NENHUMA mensagem aparecia — "clico e nao faz nada".
//
// Estas estruturas mapeiam cada campo do formulario para a aba onde ele mora
// e para um rotulo legivel, permitindo mostrar um resumo e saltar ate o erro.
// ---------------------------------------------------------------------------
interface ValidationIssue {
  path: string;
  message: string;
  tab: number;
  label: string;
}

const FIELD_LABELS: Record<string, string> = {
  clientId: 'Cliente',
  technicianId: 'Técnico Responsável',
  defect: 'Defeito Relatado',
  serviceType: 'Tipo de Serviço',
  serviceAddress: 'Endereço do Serviço',
  laborSource: 'Origem da Mão de Obra',
  laborHours: 'Horas de Mão de Obra',
  laborRate: 'Valor/Hora (R$)',
  warrantyDays: 'Garantia (dias)',
  items: 'Ao menos um item',
  equipment: 'Ao menos um equipamento',
  diagnosis: 'Diagnóstico',
  solution: 'Solução',
  accessories: 'Acessórios',
  condition: 'Estado do Equipamento',
  devicePassword: 'Senha do Equipamento',
  droppedOffBy: 'Quem deixou o equipamento',
  internalNotes: 'Observações Internas',
  externalNotes: 'Observações Externas',
  paymentMethod: 'Forma de Pagamento',
  deliveryType: 'Entrega',
  deliveryValue: 'Valor de Entrega',
  deliveryDone: 'Entrega concluída',
  notes: 'Observações',
};

// Campo -> indice da aba (0 Dados · 1 Itens · 2 Equipamentos · 3 Diagnóstico · 4 Entrega)
const FIELD_TAB: Record<string, number> = {
  items: 1,
  equipment: 2,
  diagnosis: 3,
  solution: 3,
  accessories: 4,
  condition: 4,
  devicePassword: 4,
  droppedOffBy: 4,
  externalNotes: 4,
  paymentMethod: 4,
  deliveryType: 4,
  deliveryValue: 4,
  deliveryDone: 4,
  notes: 4,
};

const ITEM_FIELD_LABELS: Record<string, string> = {
  name: 'Descrição',
  partId: 'Peça',
  qty: 'Quantidade',
  unitPrice: 'Valor Unitário',
  discount: 'Desconto',
  type: 'Tipo',
};

const EQUIPMENT_FIELD_LABELS: Record<string, string> = {
  name: 'Nome',
  brand: 'Marca',
  model: 'Modelo',
  serial: 'Número de Série',
};

const tabForField = (path: string): number => FIELD_TAB[path.split('.')[0]] ?? 0;

function labelForField(path: string): string {
  const item = path.match(/^items\.(\d+)\.(.+)$/);
  if (item) return `Item ${Number(item[1]) + 1} — ${ITEM_FIELD_LABELS[item[2]] || item[2]}`;
  const eq = path.match(/^equipment\.(\d+)\.(.+)$/);
  if (eq) return `Equipamento ${Number(eq[1]) + 1} — ${EQUIPMENT_FIELD_LABELS[eq[2]] || eq[2]}`;
  const root = path.split('.')[0];
  return FIELD_LABELS[root] || root;
}

/** Achata o objeto de erros do RHF ({ items: { 0: { name: { message } } } }) numa lista plana. */
function flattenErrors(value: any, path = ''): ValidationIssue[] {
  if (!value || typeof value !== 'object') return [];
  if (typeof value.message === 'string' && value.message) {
    return [{ path, message: value.message, tab: tabForField(path), label: labelForField(path) }];
  }
  return Object.entries(value).flatMap(([key, child]) =>
    flattenErrors(child, path ? `${path}.${key}` : key),
  );
}

export function ServiceOrderFormPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const statusFromUrl = searchParams.get('status');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isNew = !id || id === 'new';
  // Guarda o erro cru do axios (err.response.data.error.fields) p/ o FormErrors
  const [error, setError] = useState<any>(null);
  const [activeTab, setActiveTab] = useState(0);
  // Resumo visivel dos campos que impediram o submit (ver flattenErrors acima)
  const [validationErrors, setValidationErrors] = useState<ValidationIssue[]>([]);
  const [photos, setPhotos] = useState<File[]>([]);
  // Briefing B1: destravamento de O.S. entregue (senha de admin ou vendedor)
  const [needsUnlock, setNeedsUnlock] = useState(false);
  const [unlockPassword, setUnlockPassword] = useState<string | null>(null);
  const [passwordInput, setPasswordInput] = useState('');
  const [unlockError, setUnlockError] = useState('');

  const { register, control, handleSubmit, watch, setValue, getValues, formState: { errors, isSubmitting }, reset } = useForm<OsForm>({
    resolver: zodResolver(osSchema),
    defaultValues: {
      clientId: '', technicianId: '', equipment: [{ name: '', brand: '', model: '', serial: '', photos: [], notes: '' }],
      defect: '', laborHours: 0, laborRate: 80, warrantyDays: 90, items: [],
      serviceType: 'LOCAL', serviceAddress: null, extraAddresses: [], laborSource: 'MANUAL',
      accessories: '', condition: '', devicePassword: '', droppedOffBy: '',
      internalNotes: '', externalNotes: '',
      paymentMethod: '',
      deliveryType: 'NONE', deliveryValue: 0, deliveryDone: false,
    },
  });

  const { fields: equipmentFields, append: appendEquipment, remove: removeEquipment } = useFieldArray({ control, name: 'equipment' });
  const { fields: itemFields, append: appendItem, remove: removeItem } = useFieldArray({ control, name: 'items' });

  // Briefing: endereços adicionais para o mesmo Serviço externo
  // (residência + escritório, etc.). O 1º endereço fica em `serviceAddress`
  // (já existia) e os demais entram no array `extraAddresses`. Ao submeter,
  // o payload monta `serviceAddresses = [serviceAddress, ...extraAddresses]`.
  const { fields: extraAddrFields, append: appendExtraAddr, remove: removeExtraAddr } = useFieldArray({
    control,
    name: 'extraAddresses',
  });

  const laborHours = watch('laborHours');
  const laborRate = watch('laborRate');
  const items = watch('items');
  const clientId = watch('clientId');
  const serviceType = watch('serviceType');
  const serviceAddress = watch('serviceAddress');
  const laborSource = watch('laborSource');
  const deliveryType = watch('deliveryType');
  const deliveryDone = watch('deliveryDone');

  /** Briefing B3: valor líquido do item (bruto − desconto %/R$). */
  const itemNetVal = (i: { qty?: number; unitPrice?: number; discount?: number; discountType?: string }) => {
    const base = (i.qty || 0) * (i.unitPrice || 0);
    const d = i.discountType === 'PERCENT' ? (base * (i.discount || 0)) / 100 : i.discount || 0;
    return base - Math.min(Math.max(0, d), base);
  };

  /** Briefing C: comissão do item — líquido × % ou valor fixo em R$. */
  const itemCommission = (i: { qty?: number; unitPrice?: number; discount?: number; discountType?: string; commissionType?: string; commissionPercent?: number; commissionValue?: number }) => {
    if (i.commissionType === 'VALUE') return i.commissionValue || 0;
    return (itemNetVal(i) * (i.commissionPercent || 0)) / 100;
  };

  const totals = useMemo(() => {
    const totalParts = items.filter(i => i.type === 'PART').reduce((sum, i) => sum + itemNetVal(i), 0);
    const totalServices = items.filter(i => i.type === 'SERVICE').reduce((sum, i) => sum + itemNetVal(i), 0);
    const totalLabor = items.filter(i => i.type === 'LABOR').reduce((sum, i) => sum + itemNetVal(i), 0) + (laborHours * laborRate);
    const gross = items.reduce((sum, i) => sum + (i.qty || 0) * (i.unitPrice || 0), 0);
    const liquido = items.reduce((sum, i) => sum + itemNetVal(i), 0);
    return {
      totalParts, totalServices, totalLabor,
      descontos: gross - liquido,
      total: totalParts + totalServices + totalLabor,
    };
  }, [items, laborHours, laborRate]);

  // Briefing B2/D3: dados do cliente (endereços + Equipamentos) p/ seleção rápida
  const clientDetailQuery = useQuery({
    queryKey: ['client', clientId],
    queryFn: () => clientsApi.get(clientId),
    enabled: !!clientId,
  });
  const clientAddresses: any[] = clientDetailQuery.data?.addresses || [];
  const clientEquipments: any[] = clientDetailQuery.data?.equipments || [];

  // Briefing PDF p.6/7: Equipamentos cadastrados do cliente (picker "Usar" na aba de Equipamentos)
  const clientEquipmentQuery = useQuery({
    queryKey: ['clientEquipment', clientId],
    queryFn: () => clientsApi.listEquipment(clientId),
    enabled: !!clientId,
  });
  const clientEquipmentList: any[] = Array.isArray(clientEquipmentQuery.data)
    ? clientEquipmentQuery.data
    : clientEquipmentQuery.data?.data || [];

  // Briefing B2.2: ao ligar "externo", pré-seleciona o endereço padrão do cliente
  useEffect(() => {
    if (serviceType === 'EXTERNAL' && !serviceAddress && clientAddresses.length) {
      const padrao = clientAddresses.find((a) => a.isDefault) || clientAddresses[0];
      setValue('serviceAddress', padrao, { shouldDirty: true });
    }
  }, [serviceType, serviceAddress, clientAddresses]);

  const clientsQuery = useQuery({ queryKey: ['clientsAll'], queryFn: () => clientsApi.list({ limit: 1000 }) });
  const partsQuery = useQuery({ queryKey: ['partsActive'], queryFn: () => inventoryApi.list({ status: 'ACTIVE', limit: 1000 }) });
  const techQuery = useQuery({ queryKey: ['technicians'], queryFn: () => usersApi.getTechnicians() });

  const clientData: any[] = Array.isArray(clientsQuery.data) ? clientsQuery.data : clientsQuery.data?.data || [];
  const partsData: any[] = Array.isArray(partsQuery.data) ? partsQuery.data : partsQuery.data?.data || [];
  const techData: any[] = Array.isArray(techQuery.data) ? techQuery.data : techQuery.data || [];

  const saveMutation = useMutation({
    mutationFn: async (data: OsForm) => {
      const formData = new FormData();
      formData.append('data', JSON.stringify(data));
      photos.forEach((photo, i) => formData.append('photos', photo));
      return isNew ? serviceOrdersApi.create(formData) : serviceOrdersApi.update(id!, formData);
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['serviceOrders'] }); navigate('/service-orders'); },
    onError: (err: any) => setError(err),
  });

  const statusMutation = useMutation({
    mutationFn: (data: { status: string; note?: string }) => serviceOrdersApi.updateStatus(id!, data.status, '', data.note),
    // A chave antiga `['serviceOrders', id]` não casava com NENHUMA query: a
    // lista usa ['serviceOrders', page, pageSize, ...] e o detalhe usa a
    // chave SINGULAR ['serviceOrder', id] => nada era atualizado após a mutação.
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['serviceOrder', id] }); queryClient.invalidateQueries({ queryKey: ['serviceOrders'] }); },
  });

  const addItemMutation = useMutation({
    mutationFn: (data: ItemForm) => serviceOrdersApi.addItem(id!, data),
    // A chave antiga `['serviceOrders', id]` não casava com NENHUMA query: a
    // lista usa ['serviceOrders', page, pageSize, ...] e o detalhe usa a
    // chave SINGULAR ['serviceOrder', id] => nada era atualizado após a mutação.
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['serviceOrder', id] }); queryClient.invalidateQueries({ queryKey: ['serviceOrders'] }); },
  });

  const removeItemMutation = useMutation({
    mutationFn: (itemId: string) => serviceOrdersApi.removeItem(id!, itemId),
    // A chave antiga `['serviceOrders', id]` não casava com NENHUMA query: a
    // lista usa ['serviceOrders', page, pageSize, ...] e o detalhe usa a
    // chave SINGULAR ['serviceOrder', id] => nada era atualizado após a mutação.
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['serviceOrder', id] }); queryClient.invalidateQueries({ queryKey: ['serviceOrders'] }); },
  });

  // Briefing B1: valida a senha de admin/vendedor antes de liberar a edição da concluída/entregue
  const unlockMutation = useMutation({
    mutationFn: (pw: string) => serviceOrdersApi.unlock(id!, pw),
    onSuccess: () => {
      // Guarda na sessão p/ a próxima abertura da edição não pedir de novo
      sessionStorage.setItem('os-unlock-' + id!, passwordInput);
      setUnlockPassword(passwordInput); setNeedsUnlock(false); setUnlockError(''); setPasswordInput('');
    },
    onError: (err: any) => setUnlockError(err.response?.data?.message || 'Senha inválida'),
  });

  const addPhotoMutation = useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData();
      formData.append('photo', file);
      return serviceOrdersApi.addPhoto(id!, file);
    },
    // A chave antiga `['serviceOrders', id]` não casava com NENHUMA query: a
    // lista usa ['serviceOrders', page, pageSize, ...] e o detalhe usa a
    // chave SINGULAR ['serviceOrder', id] => nada era atualizado após a mutação.
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['serviceOrder', id] }); queryClient.invalidateQueries({ queryKey: ['serviceOrders'] }); },
  });

  // Carrega dados se edição
  useEffect(() => {
    if (!isNew) {
      serviceOrdersApi.get(id!).then(os => {
        reset({
          clientId: os.clientId,
          technicianId: os.technicianId,
          equipment: os.equipment,
          defect: os.defect,
          diagnosis: os.diagnosis,
          solution: os.solution,
          laborHours: os.laborHours,
          laborRate: os.laborRate,
          warrantyDays: os.warrantyDays,
          items: os.items.map(i => ({
            partId: i.partId, name: i.name, qty: i.qty, unitPrice: i.unitPrice, type: i.type,
            discount: i.discount ?? 0, discountType: i.discountType ?? 'VALUE',
            commissionPercent: i.commissionPercent ?? 0, commissionValue: i.commissionValue ?? 0,
            commissionType: i.commissionType ?? 'PERCENT',
          })),
          // Briefing B2.2/C2
          serviceType: os.serviceType || 'LOCAL',
          // serviceAddresses vem do backend como [principal, extra1, extra2...].
          // Separamos: o 1º vira serviceAddress (campo existente) e o resto extraAddresses.
          serviceAddress: os.serviceAddresses?.[0] || os.serviceAddress || null,
          extraAddresses: os.serviceAddresses && os.serviceAddresses.length > 1 ? os.serviceAddresses.slice(1) : [],
          laborSource: os.laborSource || 'MANUAL',
          // Briefing O.S.: entrega + Observações internas/externas
          accessories: os.accessories || '',
          condition: os.condition || '',
          devicePassword: os.devicePassword || '',
          droppedOffBy: os.droppedOffBy || '',
          internalNotes: os.internalNotes || '',
          externalNotes: os.externalNotes || '',
          // Briefing PDF p.6/7: forma de pagamento combinada
          paymentMethod: os.paymentMethod || '',
          deliveryType: (['NONE', 'PICKUP', 'DELIVERY'].includes(os.deliveryType) ? os.deliveryType : 'NONE') as 'NONE' | 'PICKUP' | 'DELIVERY',
          deliveryValue: os.deliveryValue ?? 0,
          deliveryDone: !!os.deliveryDone,
        });
        // Briefing B1: O.S. concluída/entregue exige senha antes de qualquer edição
        if (os.status === 'DELIVERED' || os.status === 'READY') {
          // Reusa a senha já validada nesta sessão (guardada pela tela de detalhes)
          const savedUnlock = sessionStorage.getItem('os-unlock-' + id);
          if (savedUnlock) setUnlockPassword(savedUnlock);
          else setNeedsUnlock(true);
        }
      });
    }
  }, [id, isNew]);

  // Atualiza status via URL
  useEffect(() => {
    if (statusFromUrl && !isNew) {
      statusMutation.mutate({ status: statusFromUrl, note: `Alterado via lista` });
    }
  }, [statusFromUrl]);

  const onSubmit = (data: OsForm) => {
    setError(null);
    setValidationErrors([]);
    // Briefing B1: senha destravamento acompanha o payload quando a O.S. foi entregue
    // Briefing O.S./C: novos campos (entrega, Observações, comissão) vão no mesmo payload
    // Briefing PDF p.6/7: forma de pagamento combinada (null quando não escolhida)
    // Monta a lista completa de endereços: principal + extras (só EXTERNAL)
    const fullAddresses =
      data.serviceType === 'EXTERNAL' && data.serviceAddress
        ? [data.serviceAddress, ...(data.extraAddresses || []).filter((a: any) => a && a.street?.trim())]
        : null;
    saveMutation.mutate({
      ...(data as any),
      paymentMethod: data.paymentMethod || null,
      unlockPassword: unlockPassword || undefined,
      serviceAddresses: fullAddresses,
    });
  };

  /**
   * Chamado pelo `handleSubmit` quando o zod REJEITA o submit.
   *
   * Sem este handler o RHF simplesmente não chama o onSubmit e o usuário não
   * vê nada: os campos com erro ficavam em abas que não estavam renderizadas.
   * Agora montamos um resumo, saltamos até a aba do primeiro erro e deixamos o
   * `helperText` vermelho do campo lá exibido.
   */
  const onInvalid = (errs: any) => {
    const issues = flattenErrors(errs);
    setValidationErrors(issues);
    if (issues.length > 0) {
      setActiveTab(issues[0].tab);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const addItem = (type: 'PART' | 'LABOR' | 'SERVICE') => {
    appendItem({ partId: '', name: '', qty: 1, unitPrice: 0, discount: 0, discountType: 'VALUE', type, commissionPercent: 0, commissionValue: 0, commissionType: 'PERCENT' });
  };

  /** Briefing PDF: adiciona um equipamento já cadastrado no cliente à O.S. (não duplica nome + série). */
  const addClientEquipment = (eq: any) => {
    const name = String(eq?.name || '').trim();
    const serial = String(eq?.serialNumber || eq?.serial || '').trim();
    if (!name) return;
    const current: any[] = getValues('equipment') || [];
    const duplicated = current.some((e) => String(e?.name || '').trim() === name && String(e?.serial || '').trim() === serial);
    if (duplicated) return;
    // Mesmo formato dos itens de equipamento já existentes no form
    const novoEquipamento = {
      name,
      brand: eq?.brand || '',
      model: eq?.model || '',
      serial,
      photos: [],
      notes: eq?.notes || '',
      accessories: '',
      condition: '',
      password: '',
      droppedOffBy: '',
    };
    appendEquipment(novoEquipamento);
  };

  // Extraídos antes do return — bug de parse do TS 7 com .map() devolvendo JSX dentro do return
  const clientEquipmentRows = clientEquipmentList.map((eq: any) => (
    <Box
      key={eq.id || `${eq.name}-${eq.serialNumber || ''}`}
      sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, py: 1, borderBottom: 1, borderColor: 'divider', '&:last-of-type': { borderBottom: 'none' } }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" fontWeight={500}>{eq.name}</Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
          {[eq.brand, eq.model, eq.serialNumber ? `S/N ${eq.serialNumber}` : ''].filter(Boolean).join(' · ') || 'Sem detalhes cadastrados'}
        </Typography>
      </Box>
      <SecondaryButton size="small" onClick={() => addClientEquipment(eq)} disabled={!String(eq?.name || '').trim()}>Usar</SecondaryButton>
    </Box>
  ));

  const paymentMethodMenuItems = PAYMENT_METHOD_OPTIONS.map((opt) => (
    <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
  ));

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3, flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography variant="h4" fontWeight={700} sx={{ mb: 0.5 }}>{isNew ? 'Nova Ordem de Serviço' : 'Editar OS'}</Typography>
          <Typography variant="body1" color="text.secondary">{isNew ? 'Crie uma nova OS' : `ID: ${id?.slice(0,8)}...`}</Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          {!isNew && <SecondaryButton onClick={() => navigate('/service-orders')}>Voltar</SecondaryButton>}
        </Box>
      </Box>

      {/* Briefing A: erro de validação por campo (backend devolve error.fields) */}
      <FormErrors error={error} onClose={() => setError(null)} />

      {/* RESUMO DE CAMPOS FALTANTES — o submit foi bloqueado pelo zod.
          Motivo: os campos com erro ficavam em abas não renderizadas, então o
          usuário clicava em "Criar OS" e não acontecia absolutamente nada. */}
      {validationErrors.length > 0 && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setValidationErrors([])}>
          <Typography variant="subtitle2" sx={{ mb: 0.5, fontWeight: 700 }}>
            {isNew ? 'Não foi possível criar a O.S.' : 'Não foi possível salvar a O.S.'} —{' '}
            {validationErrors.length === 1
              ? 'falta 1 informação'
              : `faltam ${validationErrors.length} informações`}
          </Typography>
          <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
            {validationErrors.map((issue) => (
              <Box component="li" key={issue.path} sx={{ mb: 0.25 }}>
                <Typography variant="body2">
                  <strong>{issue.label}</strong> — {issue.message}
                  {issue.tab !== activeTab && (
                    <Button
                      size="small"
                      sx={{ ml: 1, minWidth: 0, py: 0, verticalAlign: 'baseline' }}
                      onClick={() => setActiveTab(issue.tab)}
                    >
                      ir para a aba
                    </Button>
                  )}
                </Typography>
              </Box>
            ))}
          </Box>
        </Alert>
      )}

      {/* Briefing B1: O.S. concluída/entregue só edita com senha de admin ou vendedor */}
      {!isNew && needsUnlock && !unlockPassword && (
        <Alert severity="warning" sx={{ mb: 3 }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            O.S. concluída/entregue — informe a senha de destravamento para editar
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <TextField
              size="small"
              type="password"
              label="Senha"
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && passwordInput) { e.preventDefault(); unlockMutation.mutate(passwordInput); } }}
              error={!!unlockError}
              helperText={unlockError || ' '}
              sx={{ maxWidth: 260 }}
            />
            <PrimaryButton
              type="button"
              disabled={!passwordInput || unlockMutation.isPending}
              onClick={() => unlockMutation.mutate(passwordInput)}
            >
              Destravar
            </PrimaryButton>
          </Box>
        </Alert>
      )}
      {!isNew && unlockPassword && (
        <Alert severity="success" sx={{ mb: 3 }} onClose={() => { setUnlockPassword(null); setNeedsUnlock(false); }}>
          O.S. destravada — edições liberadas nesta sessão (validada ao salvar).
        </Alert>
      )}

      <Tabs value={activeTab} onChange={(_, v) => setActiveTab(v)} sx={{ mb: 3 }}>
        <Tab label="Dados da OS" />
        <Tab label="Itens & Peças" />
        <Tab label="Equipamentos" />
        <Tab label="Diagnóstico" />
        <Tab label="Entrega & Observações" />
      </Tabs>

      {/* O 2º argumento do handleSubmit é o handler de ERROS DE VALIDACAO —
          sem ele o zod bloqueava o submit em silêncio (ver flattenErrors). */}
      <form onSubmit={handleSubmit(onSubmit, onInvalid)}>
        {/* Aba 1: Dados */}
        {activeTab === 0 && (
          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Grid container spacing={3}>
                <Grid item xs={12} sm={6}>
                  <Autocomplete
                    fullWidth
                    options={clientData || []}
                    // Antes: `${o.name} - ${o.phone}` sem guarda — quando `value`
                    // era o ID (string), o MUI chamava getOptionLabel(string) e
                    // renderizava literalmente "undefined - undefined".
                    getOptionLabel={(o: any) =>
                      o && typeof o === 'object'
                        ? `${o.name ?? ''}${o.phone ? ` - ${o.phone}` : ''}`
                        : ''
                    }
                    isOptionEqualToValue={(o: any, v: any) => o?.id === v?.id}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label="Cliente *"
                        error={!!errors.clientId}
                        helperText={errors.clientId?.message}
                      />
                    )}
                    // BUG: `value` recebia o ID (string) e não a opção. Precisa do
                    // OBJETO — era exatamente o que o Autocomplete do Técnico abaixo
                    // já fazia corretamente com .find().
                    value={clientData?.find((c: any) => c?.id === watch('clientId')) || null}
                    onChange={(_, v) =>
                      setValue('clientId', v?.id || '', { shouldDirty: true, shouldValidate: true })
                    }
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Autocomplete
                    fullWidth
                    options={techData || []}
                    getOptionLabel={(o: any) => (o && typeof o === 'object' ? o.name || '' : '')}
                    isOptionEqualToValue={(o: any, v: any) => o?.id === v?.id}
                    renderInput={(params) => <TextField {...params} label="Técnico Responsável" />}
                    value={techData?.find((t: any) => t?.id === watch('technicianId')) || null}
                    onChange={(_, v) => setValue('technicianId', v?.id || '', { shouldDirty: true })}
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField fullWidth label="Defeito Relatado *" multiline rows={3} {...register('defect')} error={!!errors.defect} helperText={errors.defect?.message} />
                </Grid>
                {/* Briefing B2.2: Serviço local × externo */}
                <Grid item xs={12} sm={6}>
                  <Typography variant="caption" color="text.secondary">Tipo de Serviço</Typography>
                  <ToggleButtonGroup
                    exclusive
                    size="small"
                    fullWidth
                    value={serviceType}
                    onChange={(_, v) => {
                      if (!v) return;
                      setValue('serviceType', v, { shouldDirty: true });
                      // LOCAL e Acesso Remoto não têm endereço de Serviço
                      if (v === 'LOCAL' || v === 'REMOTE') setValue('serviceAddress', null, { shouldDirty: true });
                    }}
                    sx={{ mt: 0.5 }}
                  >
                    <ToggleButton value="LOCAL">Local (na loja)</ToggleButton>
                    <ToggleButton value="EXTERNAL">Externo (no cliente)</ToggleButton>
                    <ToggleButton value="REMOTE">Acesso Remoto</ToggleButton>
                  </ToggleButtonGroup>
                </Grid>
                {serviceType === 'EXTERNAL' && (
                  <Grid item xs={12}>
                    <Alert severity="info" sx={{ mb: 1.5 }}>
                      <b>Endereço Para Serviço</b> — escolha um endereço do cliente ou digite outro.
                    </Alert>
                    <Grid container spacing={2} alignItems="center">
                      <Grid item xs={12} md={5}>
                        <Autocomplete
                          fullWidth
                          size="small"
                          options={clientAddresses as any[]}
                          getOptionLabel={(a: any) => (a ? `${a.label || 'Endereço'} — ${a.street}${a.number ? ', ' + a.number : ''}${a.city ? ' · ' + a.city : ''}` : '')}
                          isOptionEqualToValue={(a: any, b: any) => a?.id === b?.id}
                          value={serviceAddress && serviceAddress.street ? serviceAddress : null}
                          onChange={(_, v) => setValue('serviceAddress', v, { shouldDirty: true })}
                          renderInput={(params) => <TextField {...params} label="Endereços do cliente" placeholder="Selecionar..." error={!!errors.serviceAddress} helperText={(errors.serviceAddress as any)?.message} />}
                          noOptionsText={clientId ? 'Sem endereços cadastrados - digite abaixo' : 'Escolha o cliente primeiro'}
                        />
                      </Grid>
                      {(['street', 'number', 'district', 'city', 'state', 'zip', 'complement'] as const).map((f) => (
                        <Grid item xs={12} sm={f === 'street' ? 6 : f === 'complement' ? 6 : f === 'number' ? 2 : 3} md={f === 'street' ? 4 : f === 'complement' ? 4 : 2} key={f}>
                          <TextField
                            fullWidth
                            size="small"
                            label={f === 'street' ? 'Rua *' : f === 'number' ? 'Nº' : f === 'district' ? 'Bairro' : f === 'city' ? 'Cidade' : f === 'state' ? 'UF' : f === 'zip' ? 'CEP' : 'Complemento'}
                            value={(serviceAddress && serviceAddress[f]) || ''}
                            onChange={(e) => setValue('serviceAddress', { ...(serviceAddress || {}), street: serviceAddress?.street || '', [f]: e.target.value }, { shouldDirty: true })}
                            error={f === 'street' && !!errors.serviceAddress}
                            helperText={f === 'street' ? (errors.serviceAddress as any)?.message : undefined}
                          />
                        </Grid>
                      ))}
                    </Grid>
                  </Grid>
                )}
                  {/* Endereços adicionais — o cliente pode pedir para ir em mais de um lugar */}
                  {serviceType === 'EXTERNAL' && (
                    <Grid item xs={12}>
                      <Box sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography variant="subtitle2" sx={{ mb: 0, fontWeight: 600 }}>
                          Endereços adicionais
                        </Typography>
                        <SecondaryButton size="small" startIcon={<Add />} onClick={() => appendExtraAddr({})}>
                          + Adicionar endereço
                        </SecondaryButton>
                        <Typography variant="caption" color="text.secondary">
                          Cada endereço vira uma visita separada no agendamento.
                        </Typography>
                      </Box>
                      <Box sx={{ mt: 1 }}>
                        {extraAddrFields.map((field, index) => (
                          <Box key={field.id} sx={{ mb: 2, p: 1.5, border: 1, borderColor: 'divider', borderRadius: 1 }}>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                              <Typography variant="body2" fontWeight={500}>
                                Endereço extra {index + 1}
                              </Typography>
                              <IconButton size="small" onClick={() => removeExtraAddr(index)} color="error">
                                <Delete />
                              </IconButton>
                            </Box>
                            <Grid container spacing={2}>
                              {(['street', 'number', 'district', 'city', 'state', 'zip', 'complement'] as const).map((f) => (
                                <Grid item xs={12} sm={f === 'street' ? 6 : f === 'complement' ? 6 : f === 'number' ? 2 : 3} md={f === 'street' ? 4 : f === 'complement' ? 4 : 2} key={f}>
                                  <TextField
                                    fullWidth
                                    size="small"
                                    label={f === 'street' ? 'Rua *' : f === 'number' ? 'Nº' : f === 'district' ? 'Bairro' : f === 'city' ? 'Cidade' : f === 'state' ? 'UF' : f === 'zip' ? 'CEP' : 'Complemento'}
                                    placeholder={f === 'street' ? 'Obrigatório se preencher este endereço' : ''}
                                    {...register(`extraAddresses.${index}.${f}`)}
                                    error={f === 'street' && !!(errors as any)?.extraAddresses?.[index]?.street}
                                    helperText={f === 'street' ? (errors as any)?.extraAddresses?.[index]?.street?.message : undefined}
                                  />
                                </Grid>
                              ))}
                            </Grid>
                          </Box>
                        ))}
                      </Box>
                    </Grid>
                )}
                {/* Briefing C2: origem da Mão de obra (digitada × soma do registro) */}
                <Grid item xs={12} sm={3}>
                  <TextField
                    select
                    fullWidth
                    size="small"
                    label="Origem Mão de Obra"
                    value={laborSource}
                    onChange={(e) => setValue('laborSource', e.target.value as 'MANUAL' | 'VISITS', { shouldDirty: true })}
                    helperText={laborSource === 'VISITS' ? 'Soma das visitas (read-only)' : 'Digitada manualmente'}
                  >
                    <MenuItem value="MANUAL">Digitada</MenuItem>
                    <MenuItem value="VISITS">Registro de horas</MenuItem>
                  </TextField>
                </Grid>
                <Grid item xs={12} sm={3}>
                  <TextField
                    fullWidth
                    label="Horas Mão de Obra"
                    type="number"
                    inputProps={{ step: 0.5, readOnly: laborSource === 'VISITS' }}
                    {...register('laborHours', { valueAsNumber: true })}
                    helperText={laborSource === 'VISITS' ? 'Calculado pelo registro de visitas' : undefined}
                  />
                </Grid>
                <Grid item xs={12} sm={3}>
                  <TextField fullWidth label="Valor/Hora (R$)" type="number" inputProps={{ step: 0.01 }} {...register('laborRate', { valueAsNumber: true })} />
                </Grid>
                <Grid item xs={12} sm={3}>
                  <TextField fullWidth label="Garantia (dias)" type="number" {...register('warrantyDays', { valueAsNumber: true })} />
                </Grid>
                <Grid item xs={12}>
                  <TextField fullWidth label="Observações Internas" multiline rows={2} {...register('notes')} />
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        )}

        {/* Aba 2: Itens */}
        {activeTab === 1 && (
          <>
            <Card sx={{ mb: 3 }}>
              <CardContent>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                  <Typography variant="h6">Itens da OS</Typography>
                  <Box sx={{ display: 'flex', gap: 1 }}>
                    <SecondaryButton startIcon={<Add />} onClick={() => addItem('PART')}>Adicionar Peça</SecondaryButton>
                    <SecondaryButton startIcon={<Add />} onClick={() => addItem('LABOR')}>Adicionar Mão de Obra</SecondaryButton>
                    <SecondaryButton startIcon={<Add />} onClick={() => addItem('SERVICE')}>Adicionar Serviço</SecondaryButton>
                  </Box>
                </Box>
                <TableContainer>
                  <Table>
                    <TableHead>
                      <TableRow>
                        <TableCell>Tipo</TableCell>
                        <TableCell>Item</TableCell>
                        <TableCell>Qtd</TableCell>
                        <TableCell>Valor Unit.</TableCell>
                        <TableCell>Desconto</TableCell>
                        <TableCell>Total</TableCell>
                        <TableCell>Ações</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {itemFields.map((field, index) => (
                          <TableRow key={field.id}>
                            <TableCell>
                              <FormControl fullWidth sx={{ minWidth: 120 }}>
                                <Select
                                  value={watch(`items.${index}.type`)}
                                  onChange={(e) => setValue(`items.${index}.type`, e.target.value as 'PART' | 'LABOR' | 'SERVICE')}
                                  size="small"
                                >
                                  <MenuItem value="PART">Peça</MenuItem>
                                  <MenuItem value="LABOR">Mão de Obra</MenuItem>
                                  <MenuItem value="SERVICE">Serviço</MenuItem>
                                </Select>
                              </FormControl>
                            </TableCell>
                            <TableCell>
                              {/* BUG (bloqueio permanente): o campo `name` só era renderizado
                                  no ramo ELSE — ou seja, para itens NÃO-PART. Como o tipo
                                  padrão de "Adicionar Peça" é PART, o input `items.N.name`
                                  NÃO EXISTIA no DOM, o zod exigia "Nome obrigatório" e não
                                  havia onde digitar: a criação nunca saía do lugar.
                                  Pior com Estoque vazio (única fonte do nome era o
                                  Autocomplete de Peças, sem opções). Agora a descrição é
                                  sempre digitável e o Autocomplete virou apenas um atalho. */}
                              {watch(`items.${index}.type`) === 'PART' && (
                                <Autocomplete
                                  fullWidth
                                  sx={{ mb: 0.75 }}
                                  options={partsData || []}
                                  getOptionLabel={(o: any) =>
                                    o && typeof o === 'object'
                                      ? `${o.name} (${o.code}) - ${formatCurrency(o.salePrice)} | Est: ${o.quantity}`
                                      : ''
                                  }
                                  isOptionEqualToValue={(o: any, v: any) => o?.id === v?.id}
                                  renderInput={(params) => (
                                    <TextField {...params} size="small" placeholder="Buscar peça no Estoque..." />
                                  )}
                                  value={watch(`items.${index}.partId`) ? partsData?.find((p: any) => p.id === watch(`items.${index}.partId`)) : null}
                                  onChange={(_, v) => {
                                    setValue(`items.${index}.partId`, v?.id || null, { shouldDirty: true });
                                    if (v?.name) setValue(`items.${index}.name`, v.name, { shouldDirty: true, shouldValidate: true });
                                    if (typeof v?.salePrice === 'number') setValue(`items.${index}.unitPrice`, v.salePrice, { shouldDirty: true });
                                  }}
                                  noOptionsText="Nenhuma peça no Estoque — digite a descrição abaixo"
                                />
                              )}
                              <TextField
                                fullWidth
                                size="small"
                                {...register(`items.${index}.name`)}
                                placeholder="Descrição"
                                error={!!(errors.items as any)?.[index]?.name}
                                helperText={(errors.items as any)?.[index]?.name?.message}
                              />
                            </TableCell>
                            <TableCell>
                              <TextField size="small" type="number" {...register(`items.${index}.qty`, { valueAsNumber: true })} sx={{ width: 80 }} />
                            </TableCell>
                            <TableCell>
                              <TextField size="small" type="number" inputProps={{ step: 0.01 }} {...register(`items.${index}.unitPrice`, { valueAsNumber: true })} sx={{ width: 110 }} />
                            </TableCell>
                            <TableCell>
                              {/* Briefing B3: desconto por item (% ou R$) — limite validado no backend */}
                              <Box sx={{ display: 'flex', gap: 0.5 }}>
                                <TextField
                                  size="small"
                                  type="number"
                                  inputProps={{ step: 0.01, min: 0 }}
                                  sx={{ width: 80 }}
                                  {...register(`items.${index}.discount`, { valueAsNumber: true })}
                                />
                                <FormControl size="small" sx={{ width: 72 }}>
                                  <Select
                                    value={watch(`items.${index}.discountType`) || 'VALUE'}
                                    onChange={(e) => setValue(`items.${index}.discountType`, e.target.value as 'VALUE' | 'PERCENT')}
                                  >
                                    <MenuItem value="VALUE">R$</MenuItem>
                                    <MenuItem value="PERCENT">%</MenuItem>
                                  </Select>
                                </FormControl>
                              </Box>
                            </TableCell>
                            <TableCell sx={{ fontWeight: 500 }}>
                              {formatCurrency(itemNetVal(watch(`items.${index}`) || {}))}
                            </TableCell>
                            <TableCell>
                              <IconButton size="small" onClick={() => removeItem(index)}><Delete fontSize="small" /></IconButton>
                            </TableCell>
                          </TableRow>
                        ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </CardContent>
            </Card>

            {/* Totais */}
            <Card sx={{ mb: 3, backgroundColor: 'primary.light', color: 'primary.contrastText' }}>
              <CardContent>
                <Grid container spacing={2}>
                  <Grid item xs={6} sm={2}>
                    <Typography variant="body2" color="primary.contrastText">Total Peças</Typography>
                    <Typography variant="h6" fontWeight={700}>{formatCurrency(totals.totalParts)}</Typography>
                  </Grid>
                  <Grid item xs={6} sm={2}>
                    <Typography variant="body2" color="primary.contrastText">Serviços</Typography>
                    <Typography variant="h6" fontWeight={700}>{formatCurrency(totals.totalServices)}</Typography>
                  </Grid>
                  <Grid item xs={6} sm={2}>
                    <Typography variant="body2" color="primary.contrastText">Descontos</Typography>
                    <Typography variant="h6" fontWeight={700} color={totals.descontos > 0 ? '#ffeb3b' : 'inherit'}>
                      {totals.descontos > 0 ? `− ${formatCurrency(totals.descontos)}` : formatCurrency(0)}
                    </Typography>
                  </Grid>
                  <Grid item xs={6} sm={3}>
                    <Typography variant="body2" color="primary.contrastText">Mão de Obra</Typography>
                    <Typography variant="h6" fontWeight={700}>{formatCurrency(totals.totalLabor)}</Typography>
                  </Grid>
                  <Grid item xs={12} sm={3}>
                    <Typography variant="body2" color="primary.contrastText">Total Geral</Typography>
                    <Typography variant="h5" fontWeight={700}>{formatCurrency(totals.total)}</Typography>
                  </Grid>
                </Grid>
              </CardContent>
            </Card>
          </>
        )}

        {/* Aba 3: Equipamentos */}
        {activeTab === 2 && (
          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, gap: 1, flexWrap: 'wrap' }}>
                <Typography variant="h6">Equipamentos</Typography>
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                  {/* Briefing B2.1: Equipamentos já cadastrados no cliente */}
                  <Autocomplete
                    size="small"
                    sx={{ minWidth: 300 }}
                    options={clientEquipments}
                    getOptionLabel={(e: any) => (e ? `${e.name}${e.brand ? ' · ' + e.brand : ''}${e.serialNumber ? ' · S/N ' + e.serialNumber : ''}` : '')}
                    value={null}
                    onChange={(_, v) => {
                      if (!v) return;
                      appendEquipment({ name: v.name, brand: v.brand || '', model: v.model || '', serial: v.serialNumber || '', photos: [], notes: v.notes || '' });
                    }}
                    renderInput={(params) => (
                      <TextField {...params} label="Buscar do cliente" placeholder={clientId ? 'Equipamentos cadastrados' : 'Escolha o cliente'} />
                    )}
                    disabled={!clientId}
                    noOptionsText={clientId ? 'Cliente sem Equipamentos' : 'Escolha o cliente'}
                  />
                  <SecondaryButton startIcon={<Add />} onClick={() => appendEquipment({ name: '', brand: '', model: '', serial: '', photos: [], notes: '' })}>
                    Adicionar Equipamento
                  </SecondaryButton>
                </Box>
              </Box>

              {/* Briefing PDF: Equipamentos já cadastrados do cliente — botão "Usar" p/ adicionar */}
              {clientId && clientEquipmentList.length > 0 && (
                <Box sx={{ mb: 2, border: 1, borderColor: 'divider', borderRadius: 2, p: 2, bgcolor: 'action.hover' }}>
                  <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Equipamentos do cliente</Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                    Clique em &quot;Usar&quot; para adicionar o equipamento à O.S. (nome + série já adicionados não duplicam).
                  </Typography>
                  {clientEquipmentRows}
                </Box>
              )}

              {equipmentFields.map((field, index) => (
                /* pr: 6 reserva a faixa da direita para a lixeira. Sem isso o
                   terceiro campo (xs=12 sm=4) chegava embaixo do IconButton
                   absoluto e o clique na lixeira caia no TextField — o cliente
                   relatou que "tem que clicar do lado, fora da caixa". */
                <Box key={field.id} sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 2, pr: 6, mb: 2, position: 'relative' }}>
                  <Tooltip title="Remover equipamento">
                    <IconButton
                      aria-label={`Remover equipamento ${index + 1}`}
                      size="small"
                      onClick={() => removeEquipment(index)}
                      sx={{
                        position: 'absolute',
                        top: 8,
                        right: 8,
                        zIndex: 2,
                        bgcolor: 'background.paper',
                        '&:hover': { bgcolor: 'error.main', color: 'error.contrastText' },
                      }}
                    >
                      <Delete fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Grid container spacing={2}>
                    <Grid item xs={12} sm={4}>
                      <TextField fullWidth label="Nome do Equipamento *" {...register(`equipment.${index}.name`)} />
                    </Grid>
                    <Grid item xs={12} sm={4}>
                      <TextField fullWidth label="Marca" {...register(`equipment.${index}.brand`)} />
                    </Grid>
                    <Grid item xs={12} sm={4}>
                      <TextField fullWidth label="Modelo" {...register(`equipment.${index}.model`)} />
                    </Grid>
                    <Grid item xs={12} sm={6}>
                      <TextField fullWidth label="Número de Série" {...register(`equipment.${index}.serial`)} />
                    </Grid>
                    <Grid item xs={12} sm={6}>
                      <TextField fullWidth label="Observações" {...register(`equipment.${index}.notes`)} />
                    </Grid>
                  </Grid>
                </Box>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Aba 4: Diagnóstico */}
        {activeTab === 3 && !isNew && (
          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Grid container spacing={3}>
                <Grid item xs={12}>
                  <TextField fullWidth label="Diagnóstico Técnico" multiline rows={4} {...register('diagnosis')} placeholder="Descreva o que foi encontrado..." />
                </Grid>
                <Grid item xs={12}>
                  <TextField fullWidth label="Solução Aplicada" multiline rows={4} {...register('solution')} placeholder="Descreva o que foi feito..." />
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        )}

        {/* Aba 5: Equipamento (entrega), Observações e Delivery — briefing O.S. */}
        {activeTab === 4 && (
          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Grid container spacing={3}>
                {/* Equipamento - entrega */}
                <Grid item xs={12}>
                  <Typography variant="subtitle1" fontWeight={600}>Equipamento - entrega</Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    multiline
                    rows={2}
                    label="Acessórios"
                    {...register('accessories')}
                    helperText="Ex.: carregador, capa, HD externo, cartão de memória..."
                  />
                </Grid>
                <Grid item xs={12} sm={3}>
                  <TextField
                    select
                    fullWidth
                    label="Estado de conservação"
                    value={watch('condition') || ''}
                    onChange={(e) => setValue('condition', e.target.value, { shouldDirty: true })}
                  >
                    <MenuItem value="">—</MenuItem>
                    <MenuItem value="NOVO">Novo</MenuItem>
                    <MenuItem value="OTIMO">Ótimo</MenuItem>
                    <MenuItem value="BOM">Bom</MenuItem>
                    <MenuItem value="RUIM">Ruim</MenuItem>
                    <MenuItem value="PESSIMO">Péssimo</MenuItem>
                  </TextField>
                </Grid>
                <Grid item xs={12} sm={3}>
                  <TextField
                    fullWidth
                    label="Senha do aparelho"
                    type="password"
                    autoComplete="new-password"
                    {...register('devicePassword')}
                    helperText="Uso interno - não aparece no impresso"
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    label="Quem deixou o equipamento / contato"
                    {...register('droppedOffBy')}
                    helperText="Nome e telefone de quem deixou o aparelho"
                  />
                </Grid>

                {/* Observações internas × externas */}
                <Grid item xs={12}>
                  <Divider sx={{ my: 1 }} />
                  <Typography variant="subtitle1" fontWeight={600}>Observações</Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    multiline
                    rows={3}
                    label="Observações internas - NÃO aparece impressa"
                    {...register('internalNotes')}
                    helperText="Apenas a equipe vê estas Observações"
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    multiline
                    rows={3}
                    label="Observações externas - aparece no impresso"
                    {...register('externalNotes')}
                    helperText="Impressas na via da O.S. (cliente e Técnico)"
                  />
                </Grid>

                {/* Briefing PDF p.6/7: forma de pagamento combinada com o cliente */}
                <Grid item xs={12} sm={6}>
                  <TextField
                    select
                    fullWidth
                    label="Forma de pagamento combinada"
                    value={watch('paymentMethod') || ''}
                    onChange={(e) => setValue('paymentMethod', e.target.value, { shouldDirty: true })}
                    helperText="Combinado com o cliente no fechamento da O.S."
                  >
                    <MenuItem value="">—</MenuItem>
                    {paymentMethodMenuItems}
                  </TextField>
                </Grid>

                {/* Delivery / Retirada */}
                <Grid item xs={12}>
                  <Divider sx={{ my: 1 }} />
                  <Typography variant="subtitle1" fontWeight={600}>Delivery / Retirada</Typography>
                </Grid>
                <Grid item xs={12} sm={4}>
                  <TextField
                    select
                    fullWidth
                    label="Entrega / Retirada"
                    value={deliveryType}
                    onChange={(e) => setValue('deliveryType', e.target.value as 'NONE' | 'PICKUP' | 'DELIVERY', { shouldDirty: true })}
                    helperText="Como o equipamento sai/entra da loja"
                  >
                    <MenuItem value="NONE">Não se aplica</MenuItem>
                    <MenuItem value="PICKUP">Equipamento retirado pelo cliente</MenuItem>
                    <MenuItem value="DELIVERY">Levar/entregar ao cliente</MenuItem>
                  </TextField>
                </Grid>
                <Grid item xs={12} sm={4}>
                  <TextField
                    fullWidth
                    type="number"
                    inputProps={{ step: 0.01, min: 0 }}
                    label="Valor de entrega (R$)"
                    {...register('deliveryValue', { valueAsNumber: true })}
                    error={!!errors.deliveryValue}
                    helperText={errors.deliveryValue?.message || 'valor automático de deslocamento/entrega'}
                  />
                </Grid>
                <Grid item xs={12} sm={4} sx={{ display: 'flex', alignItems: 'center' }}>
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={!!deliveryDone}
                        onChange={(_, v) => setValue('deliveryDone', v, { shouldDirty: true })}
                      />
                    }
                    label="Entrega concluída"
                  />
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        )}

        {/* Ações */}
        <Box sx={{ display: 'flex', gap: 2, justifyContent: 'flex-end', p: 2, borderTop: 1, borderColor: 'divider' }}>
          {!isNew && <SecondaryButton type="button" onClick={() => navigate('/service-orders')}>Cancelar</SecondaryButton>}
          <PrimaryButton
            type="submit"
            // Inclui o tempo da chamada à API: antes o spinner sumia no momento
            // em que a mutation partia, dando a sensação de "não clicou".
            loading={isSubmitting || saveMutation.isPending}
            disabled={(!isNew && totals.total === 0) || (!isNew && needsUnlock && !unlockPassword)}
          >
            {isNew ? 'Criar OS' : 'Salvar Alterações'}
          </PrimaryButton>
        </Box>
      </form>

      {/* Status actions para OS existentes */}
      {!isNew && (
        <Card sx={{ mt: 3 }}>
          <CardContent>
            <Typography variant="h6" sx={{ mb: 2 }}>Ações Rápidas de Status</Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              <SecondaryButton startIcon={<Build />} onClick={() => statusMutation.mutate({ status: 'IN_PROGRESS', note: 'Iniciado reparo' })}>
                Iniciar Reparo
              </SecondaryButton>
              <SecondaryButton color="warning" startIcon={<Build />} onClick={() => statusMutation.mutate({ status: 'WAITING_PARTS', note: 'Aguardando peça chegar' })}>
                Aguardando Peças
              </SecondaryButton>
              <PrimaryButton startIcon={<CheckCircle />} onClick={() => statusMutation.mutate({ status: 'READY', note: 'Reparo finalizado' })}>
                Marcar como Pronta
              </PrimaryButton>
              <SecondaryButton color="success" startIcon={<CheckCircle />} onClick={() => statusMutation.mutate({ status: 'DELIVERED', note: 'Entregue ao cliente' })}>
                Entregar
              </SecondaryButton>
              <DangerButton onClick={() => { if(window.confirm('Cancelar OS?')) statusMutation.mutate({ status: 'CANCELLED', note: 'Cancelado pelo usuário' }); }}>
                Cancelar
              </DangerButton>
            </Box>
          </CardContent>
        </Card>
      )}
    </Box>
  );
}

import { FormControl, Select, MenuItem } from '@mui/material';
