/**
 * Impressão da Ordem de Serviço — 6 vias, no formato dos modelos em PDF.
 *
 * Modelos de referência (enviados pelo cliente):
 *   "modelo os.pdf"        -> ABERTURA, 2 páginas A4, 2 vias por página:
 *                              p1: DECLARAÇÃO + COMPROVANTE PARA RETIRADA
 *                              p2: PRESTAÇÃO DE SERVIÇO + COMPROVANTE DE
 *                                  SERVIÇO PRESTADO
 *   "Modelo Os fechada.pdf" -> FECHAMENTO, 1 página A4, 2 vias:
 *                              SERVIÇO PRESTADO (técnico) + COMPROVANTE DE
 *                              SERVIÇO (cliente)
 *
 * Os textos das vias (declaração, observação de retirada) e os dados da
 * empresa vêm das Configurações (categoria COMPANY), para não ficarem
 * hardcoded aqui — inclusive o CNPJ e o telefone, que hoje só existiam
 * dentro dos PDFs.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Typography, Button, CircularProgress, Tabs, Tab, Divider } from '@mui/material';
import { Print, Close } from '@mui/icons-material';
import { useParams, useNavigate } from 'react-router-dom';
import { serviceOrdersApi, settingsApi } from '../../services/api';
import { formatCurrency, formatDate } from '../../utils/formatters';

type Grupo = 'abertura' | 'fechamento';

const EMPRESA_PADRAO = {
  nome: 'PAPATEC INFORMÁTICA E TECNOLOGIA LTDA',
  telefone: '',
  whatsapp: '',
  email: '',
  emailsExtra: '',
  site: '',
  endereco: '',
  cnpj: '',
  declaracao: 'Declaro assumir qualquer responsabilidade, Fiscal, Software e Propriedade sobre o equipamento nas condições acima descrito. Orçamento aprovado ou reprovado deverá ser retirado no prazo máximo de 90 dias ou será vendido para cobrir os devidos custos.',
  observacaoRetirada: 'OBSERVAÇÃO: O Equipamento deverá ser retirado no prazo máximo de 90 dias, caso contrário o mesmo será vendido p/ cobrir as despesas.',
  termoRetirada: 'Declaro que o meu equipamento foi testado em minha presença e que o retirei com os mesmos Acessórios e Conservação acima descrito.',
};

/* ------------------------------------------------------------------ */
/*  Blocos reutilizados pelas vias                                      */
/* ------------------------------------------------------------------ */

function Cabecalho({ emp }: { emp: typeof EMPRESA_PADRAO }) {
  return (
    <Box sx={{ border: '1.5px solid #000', px: 1.5, py: 0.75, mb: 0.75, display: 'flex', alignItems: 'center', gap: 2, color: '#000' }}>
      <Box sx={{ flex: '0 0 auto' }}>
        <Typography sx={{ fontWeight: 900, fontSize: 20, letterSpacing: -0.5, lineHeight: 1 }}>
          Papa<span style={{ color: '#1e88e5' }}>tec</span>
        </Typography>
      </Box>
      <Box sx={{ display: 'flex', flexDirection: 'column', fontSize: 9.5, lineHeight: 1.35, flex: '0 0 auto' }}>
        {emp.whatsapp && <span>WhatsApp {emp.whatsapp}</span>}
        {emp.telefone && <span>Tel {emp.telefone}</span>}
      </Box>
      <Box sx={{ flex: 1, textAlign: 'right', fontSize: 9.5, lineHeight: 1.35 }}>
        {emp.endereco && <div style={{ fontWeight: 600 }}>{emp.endereco}</div>}
        {emp.site && <div style={{ color: '#1e88e5', fontWeight: 700 }}>{emp.site}</div>}
      </Box>
    </Box>
  );
}

function Linha({ rotulo, valor, grande, larguraRotulo }: { rotulo: string; valor?: any; grande?: boolean; larguraRotulo?: number }) {
  return (
    <Box sx={{ display: 'flex', gap: 0.5, fontSize: grande ? 11 : 10, lineHeight: 1.45, alignItems: 'baseline' }}>
      {/* `whiteSpace: nowrap` + `width` (e nao `minWidth`): sem isso o
          rotulo mais longo ("Defeito reclamado") quebrava em duas linhas e
          empurrava o valor para a linha de baixo. */}
      <Typography component="span" sx={{ fontWeight: 700, fontSize: 'inherit', width: larguraRotulo || (grande ? 108 : 78), flexShrink: 0, color: '#000', whiteSpace: 'nowrap' }}>
        {rotulo}
      </Typography>
      <Typography component="span" sx={{ fontSize: 'inherit', color: '#000', wordBreak: 'break-word', flex: 1 }}>
        {valor || '—'}
      </Typography>
    </Box>
  );
}

function Assinatura({ papel, linha = true }: { papel: string; linha?: boolean }) {
  return (
    <Box sx={{ mt: 1.25, textAlign: 'center' }}>
      {linha && <Box sx={{ borderBottom: '1px solid #000', mx: 'auto', mb: 0.4, width: '78%' }} />}
      <Typography sx={{ fontSize: 9.5, color: '#000' }}>{papel}</Typography>
    </Box>
  );
}

/**
 * Identificação do serviço — é praticamente igual em todas as vias dos
 * modelos (OS nº, cliente, endereço, equipamento, defeito, acessórios).
 */
function Identificacao({ os, emp, mostrarChamado = true }: { os: any; emp: typeof EMPRESA_PADRAO; mostrarChamado?: boolean }) {
  const cli = os.client || {};
  const end = os.serviceAddress || {};
  const eq = Array.isArray(os.equipment) ? os.equipment : [];

  return (
    <Box sx={{ fontSize: 10, color: '#000' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', mb: 0.3 }}>
        <Typography sx={{ fontSize: 15, fontWeight: 800, color: '#000' }}>OS nº{' '}
          <span style={{ fontWeight: 400 }}>OS-{os.osNumber}</span>
        </Typography>
        <Typography sx={{ fontSize: 10, color: '#000' }}>Data <b>{formatDate(os.createdAt)}</b></Typography>
        <Typography sx={{ fontSize: 10, color: '#000' }}>Hora <b>{os.visits?.[0]?.scheduledAt ? new Date(os.visits[0].scheduledAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'}</b></Typography>
      </Box>

      <Linha rotulo="Cliente" valor={`${cli.code ? cli.code + ' ' : ''}${cli.name || ''}`} />
      <Linha rotulo="Tel. Com." valor={cli.phone} />
      <Box sx={{ display: 'flex', gap: 3, flexWrap: 'nowrap' }}>
        <Linha rotulo="C.P.F." valor={cli.cpf} larguraRotulo={52} />
        <Linha rotulo="R.G." valor={cli.rg} larguraRotulo={46} />
      </Box>
      <Linha rotulo="Endereço" valor={[end.street, end.number].filter(Boolean).join(', ')} />
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
        {end.district && <Linha rotulo="Bairro" valor={end.district} />}
        {end.city && <Linha rotulo="Cidade" valor={end.city} />}
        {end.state && <Linha rotulo="Estado" valor={end.state} />}
        {end.zip && <Linha rotulo="CEP" valor={end.zip} />}
      </Box>
      {mostrarChamado && <Linha rotulo="Chamado" valor={os.ticketNumber} />}
      <Linha rotulo="Tipo" valor={os.serviceType === 'EXTERNAL' ? 'ASSISTENCIA TECNICA' : 'EXTERNO'} />
      <Linha rotulo="Local" valor={os.serviceType === 'EXTERNAL' ? 'EXTERNO' : 'INTERNO'} />
      {eq.length > 0 && (
        <Box sx={{ mt: 0.4 }}>
          {eq.map((e: any, i: number) => (
            <Linha key={i} rotulo="Equipamento" valor={[e.name, e.brand, e.model, e.serialNumber].filter(Boolean).join(' / ')} />
          ))}
        </Box>
      )}
      {os.condition && <Linha rotulo="Estado de Conservação" valor={os.condition} />}
      {os.defect && <Linha rotulo="Defeito reclamado" valor={os.defect} grande />}
      {os.accessories && <Linha rotulo="Acessórios" valor={os.accessories} />}
    </Box>
  );
}

function Totais({ os }: { os: any }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.2, mt: 0.5 }}>
      <Linha rotulo="Vl Serviço" valor={formatCurrency(Number(os.totalServices) || 0)} />
      <Linha rotulo="Vl Peças" valor={formatCurrency(Number(os.totalParts) || 0)} />
      <Linha rotulo="Vl Total" valor={formatCurrency(Number(os.total) || 0)} />
    </Box>
  );
}

/* ------------------------------------------------------------------ */
/*  As 6 vias                                                          */
/* ------------------------------------------------------------------ */

/** Via 1 — DECLARAÇÃO (abertura). Assina o cliente. */
function ViaDeclaracao({ os, emp }: { os: any; emp: typeof EMPRESA_PADRAO }) {
  return (
    <Box sx={{ mb: 2 }}>
      <Cabecalho emp={emp} />
      <Typography sx={{ textAlign: 'center', fontWeight: 800, fontSize: 14, color: '#000', mb: 0.5 }}>DECLARAÇÃO</Typography>
      <Identificacao os={os} emp={emp} />
      <Typography sx={{ fontSize: 8, mt: 0.8, lineHeight: 1.35, color: '#000', textAlign: 'justify' }}>{emp.declaracao}</Typography>
      <Box sx={{ display: 'flex', gap: 2, mt: 1, alignItems: 'flex-end' }}>
        <Box sx={{ flex: '0 0 120px' }}>
          <Typography sx={{ fontSize: 9, color: '#000' }}>Data ____ / ____ / ______</Typography>
        </Box>
        <Assinatura papel={os.client?.name || ''} />
      </Box>
    </Box>
  );
}

/** Via 2 — COMPROVANTE PARA RETIRADA (equipamento). Assina a Papatec. */
function ViaRetirada({ os, emp }: { os: any; emp: typeof EMPRESA_PADRAO }) {
  return (
    <Box sx={{ mb: 2 }}>
      <Cabecalho emp={emp} />
      <Typography sx={{ textAlign: 'center', fontWeight: 800, fontSize: 14, color: '#000', mb: 0.5 }}>COMPROVANTE PARA RETIRADA</Typography>
      <Identificacao os={os} emp={emp} />
      <Typography sx={{ fontSize: 8, mt: 0.8, lineHeight: 1.35, color: '#000', textAlign: 'justify' }}>{emp.observacaoRetirada}</Typography>
      <Assinatura papel={emp.nome} />
    </Box>
  );
}

/** Via 3 — PRESTAÇÃO DE SERVIÇO: tabelas de Peças e Apontamento. */
function ViaPrestacao({ os, emp }: { os: any; emp: typeof EMPRESA_PADRAO }) {
  const itens = Array.isArray(os.items) ? os.items : [];
  const pecas = itens.filter((i: any) => i.type === 'PART');
  const servicos = itens.filter((i: any) => i.type !== 'PART');

  return (
    <Box sx={{ mb: 2 }}>
      <Cabecalho emp={emp} />
      <Typography sx={{ textAlign: 'center', fontWeight: 800, fontSize: 14, color: '#000', mb: 0.5 }}>PRESTAÇÃO DE SERVIÇO</Typography>
      <Identificacao os={os} emp={emp} mostrarChamado={false} />

      <Typography sx={{ fontSize: 9.5, fontWeight: 700, color: '#000', mt: 0.6, borderBottom: '1px solid #000' }}>Peça(s)</Typography>
      <Box sx={{ display: 'flex', fontSize: 9, fontWeight: 700, color: '#000', borderBottom: '1px solid #888', py: 0.2 }}>
        <span style={{ width: 44 }}>Qtde.</span><span style={{ width: 70 }}>Código</span>
        <span style={{ flex: 1 }}>Descrição</span><span style={{ width: 64, textAlign: 'right' }}>Vl Unit.</span>
        <span style={{ width: 64, textAlign: 'right' }}>Vl Total</span>
      </Box>
      {pecas.length === 0 && <Typography sx={{ fontSize: 9, color: '#666', py: 0.3 }}>—</Typography>}
      {pecas.map((i: any) => (
        <Box key={i.id} sx={{ display: 'flex', fontSize: 9, color: '#000', borderBottom: '1px dotted #aaa', py: 0.2 }}>
          <span style={{ width: 44 }}>{i.qty}</span><span style={{ width: 70 }}>{i.code || ''}</span>
          <span style={{ flex: 1 }}>{i.name}</span>
          <span style={{ width: 64, textAlign: 'right' }}>{formatCurrency(i.unitPrice)}</span>
          <span style={{ width: 64, textAlign: 'right' }}>{formatCurrency(i.total)}</span>
        </Box>
      ))}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 0.3 }}>
        <Linha rotulo="Total" valor={formatCurrency(Number(os.totalParts) || 0)} />
      </Box>

      <Typography sx={{ fontSize: 9.5, fontWeight: 700, color: '#000', mt: 0.8, borderBottom: '1px solid #000' }}>Apontamento</Typography>
      <Box sx={{ display: 'flex', fontSize: 9, fontWeight: 700, color: '#000', borderBottom: '1px solid #888', py: 0.2 }}>
        <span style={{ flex: 1 }}>Serviço</span><span style={{ width: 44 }}>Qtde</span>
        <span style={{ width: 58, textAlign: 'right' }}>Hs. Inicial</span>
        <span style={{ width: 58, textAlign: 'right' }}>Hs. Final</span>
        <span style={{ width: 64, textAlign: 'right' }}>Total</span>
      </Box>
      {servicos.length === 0 && <Typography sx={{ fontSize: 9, color: '#666', py: 0.3 }}>—</Typography>}
      {servicos.map((i: any) => (
        <Box key={i.id} sx={{ display: 'flex', fontSize: 9, color: '#000', borderBottom: '1px dotted #aaa', py: 0.2 }}>
          <span style={{ flex: 1 }}>{i.name}</span><span style={{ width: 44 }}>{i.qty}</span>
          <span style={{ width: 58, textAlign: 'right' }}>—</span>
          <span style={{ width: 58, textAlign: 'right' }}>—</span>
          <span style={{ width: 64, textAlign: 'right' }}>{formatCurrency(i.total)}</span>
        </Box>
      ))}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 0.3 }}>
        <Linha rotulo="Total Geral" valor={formatCurrency(Number(os.total) || 0)} />
      </Box>

      <Box sx={{ display: 'flex', gap: 2, mt: 0.8, alignItems: 'flex-end' }}>
        <Box sx={{ flex: '0 0 130px' }}>
          <Typography sx={{ fontSize: 9, color: '#000' }}>Data ____ / ____ / ______</Typography>
        </Box>
        <Assinatura papel={os.technician?.name || 'Técnico responsável'} />
      </Box>
    </Box>
  );
}

/** Via 4 — COMPROVANTE DE SERVIÇO PRESTADO (linhas para o técnico escrever). */
function ViaPrestada({ os, emp }: { os: any; emp: typeof EMPRESA_PADRAO }) {
  const linha = (rotulo: string) => (
    <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 1, mt: 0.55 }}>
      <Typography sx={{ fontSize: 9, fontWeight: 700, color: '#000', minWidth: 150 }}>{rotulo}</Typography>
      <Box sx={{ flex: 1, borderBottom: '1px dotted #666', minHeight: 13 }} />
    </Box>
  );

  return (
    <Box sx={{ mb: 2 }}>
      <Cabecalho emp={emp} />
      <Typography sx={{ textAlign: 'center', fontWeight: 800, fontSize: 14, color: '#000', mb: 0.5 }}>COMPROVANTE DE SERVIÇO PRESTADO</Typography>
      <Identificacao os={os} emp={emp} mostrarChamado={false} />
      {linha('Serviço(s) Efetuado(s)')}
      {linha('Peça(s) Substituída(s)')}
      <Assinatura papel={os.technician?.name || 'Técnico responsável'} />
      <Totais os={os} />
    </Box>
  );
}

/** Via 5 — SERVIÇO PRESTADO (fechamento, técnico). */
function ViaServicoPrestado({ os, emp }: { os: any; emp: typeof EMPRESA_PADRAO }) {
  const linha = (rotulo: string) => (
    <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 1, mt: 0.75 }}>
      <Typography sx={{ fontSize: 9, fontWeight: 700, color: '#000', minWidth: 160 }}>{rotulo}</Typography>
      <Box sx={{ flex: 1, borderBottom: '1px dotted #666', minHeight: 16 }} />
    </Box>
  );

  return (
    <Box sx={{ mb: 2 }}>
      <Cabecalho emp={emp} />
      <Typography sx={{ textAlign: 'center', fontWeight: 800, fontSize: 14, color: '#000', mb: 0.5 }}>SERVIÇO PRESTADO</Typography>
      <Identificacao os={os} emp={emp} mostrarChamado={false} />
      <Box sx={{ display: 'flex', gap: 4, mt: 0.6 }}>
        <Box sx={{ flex: 1 }}>{linha('Serviço(s) Efetuado(s)')}{linha('Peça(s) Substituída(s)')}</Box>
        <Box sx={{ flex: 1, fontSize: 9.5, color: '#000' }}>
          {/* `larguraRotulo` maior que o padrao de 78px: com `nowrap` no rotulo,
            um rotulo como "Total Custo Km Rodado(s)" transbordava da caixa
            e o valor ficava por CIMA do texto. */}
          <Linha rotulo="Total de Horas Técnicas" valor={formatCurrency(Number(os.laborHours) || 0)} larguraRotulo={142} />
          <Linha rotulo="Vl Total Peça(s) Subst." valor={formatCurrency(Number(os.totalParts) || 0)} larguraRotulo={142} />
          <Linha rotulo="Vl Total Manutenção" valor={formatCurrency(Number(os.total) || 0)} larguraRotulo={142} />
          <Linha rotulo="Km Inicial" valor="—" larguraRotulo={142} />
          <Linha rotulo="Km Final" valor="—" larguraRotulo={142} />
          <Linha rotulo="Custo Km" valor={formatCurrency(0)} larguraRotulo={142} />
          <Linha rotulo="Total Custo Km Rodado(s)" valor={formatCurrency(0)} larguraRotulo={142} />
        </Box>
      </Box>
      {linha('Observação para o Cliente')}
      <Assinatura papel={`Funcionário — ${os.technician?.name || ''}`} />
    </Box>
  );
}

/** Via 6 — COMPROVANTE DE SERVIÇO (fechamento, cliente). */
function ViaComprovanteServico({ os, emp }: { os: any; emp: typeof EMPRESA_PADRAO }) {
  const linha = (rotulo: string) => (
    <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 1, mt: 0.6 }}>
      <Typography sx={{ fontSize: 9, fontWeight: 700, color: '#000', minWidth: 160 }}>{rotulo}</Typography>
      <Box sx={{ flex: 1, borderBottom: '1px dotted #666', minHeight: 16 }} />
    </Box>
  );

  return (
    <Box sx={{ mb: 2 }}>
      <Cabecalho emp={emp} />
      <Typography sx={{ textAlign: 'center', fontWeight: 800, fontSize: 14, color: '#000', mb: 0.5 }}>COMPROVANTE DE SERVIÇO</Typography>
      <Identificacao os={os} emp={emp} mostrarChamado={false} />
      <Box sx={{ display: 'flex', gap: 4 }}>
        <Box sx={{ flex: 1 }}>{linha('Serviço(s) Efetuado(s)')}{linha('Peça(s) Substituída(s)')}{linha('Observação para o Cliente')}</Box>
        <Box sx={{ flex: 1, fontSize: 9.5, color: '#000' }}>
          {/* `larguraRotulo` maior que o padrao de 78px: com `nowrap` no rotulo,
            um rotulo como "Total Custo Km Rodado(s)" transbordava da caixa
            e o valor ficava por CIMA do texto. */}
          <Linha rotulo="Total de Horas Técnicas" valor={formatCurrency(Number(os.laborHours) || 0)} larguraRotulo={142} />
          <Linha rotulo="Vl Total Peça(s) Subst." valor={formatCurrency(Number(os.totalParts) || 0)} larguraRotulo={142} />
          <Linha rotulo="Vl Total Manutenção" valor={formatCurrency(Number(os.total) || 0)} larguraRotulo={142} />
          <Linha rotulo="Km Inicial" valor="—" larguraRotulo={142} />
          <Linha rotulo="Km Final" valor="—" larguraRotulo={142} />
          <Linha rotulo="Custo Km" valor={formatCurrency(0)} larguraRotulo={142} />
          <Linha rotulo="Total Custo Km Rodado(s)" valor={formatCurrency(0)} larguraRotulo={142} />
        </Box>
      </Box>
      <Box sx={{ display: 'flex', gap: 3, alignItems: 'flex-end', mt: 0.8 }}>
        <Box sx={{ flex: '0 0 96px' }}>
          <Typography sx={{ fontSize: 8.5, color: '#000', lineHeight: 1.3 }}>{emp.termoRetirada}</Typography>
        </Box>
        <Assinatura papel="Cliente" />
      </Box>
    </Box>
  );
}

/* ------------------------------------------------------------------ */

export function ServiceOrderPrintPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [os, setOs] = useState<any>(null);
  const [emp, setEmp] = useState(EMPRESA_PADRAO);
  const [grupo, setGrupo] = useState<Grupo>('abertura');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    Promise.all([
      serviceOrdersApi.get(id).then((d: any) => d.data || d).catch(() => null),
      // Dados da empresa + textos das vias vêm das Configurações.
      settingsApi.getAll().catch(() => null),
    ]).then(([osData, settingsMap]: any[]) => {
      setOs(osData);
      // getAll() devolve um mapa { chave: valor }, não uma lista.
      const mapa = settingsMap && typeof settingsMap === 'object' && !Array.isArray(settingsMap)
        ? settingsMap
        : null;
      if (mapa) {
        const v = (k: string) => {
          const val = mapa[k];
          if (val == null) return '';
          return typeof val === 'object' && 'value' in val ? String(val.value) : String(val);
        };
        setEmp((e) => ({
          nome: v('company_name') || e.nome,
          telefone: v('company_phone') || e.telefone,
          whatsapp: v('company_whatsapp') || e.whatsapp,
          email: v('company_email') || e.email,
          emailsExtra: v('company_emails_extra') || e.emailsExtra,
          site: v('company_site') || e.site,
          endereco: v('company_address') || e.endereco,
          cnpj: v('company_document') || e.cnpj,
          declaracao: v('os_declaration_text') || e.declaracao,
          observacaoRetirada: v('os_pickup_note') || e.observacaoRetirada,
          termoRetirada: v('os_pickup_terms') || e.termoRetirada,
        }));
      }
      setLoading(false);
    });
  }, [id]);

  useEffect(() => {
    if (os?.osNumber) document.title = `OS-${os.osNumber} - Papatec`;
  }, [os?.osNumber]);

  const eLocais = useMemo(() => os?.client?.addresses || [], [os]);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
        <CircularProgress />
      </Box>
    );
  }
  if (!os) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
        <Typography>Ordem de Serviço não encontrada</Typography>
      </Box>
    );
  }

  const vias = grupo === 'abertura'
    ? [<ViaDeclaracao key="d" os={os} emp={emp} />, <ViaRetirada key="r" os={os} emp={emp} />,
       <ViaPrestacao key="p" os={os} emp={emp} />, <ViaPrestada key="pp" os={os} emp={emp} />]
    : [<ViaServicoPrestado key="s" os={os} emp={emp} />, <ViaComprovanteServico key="c" os={os} emp={emp} />];

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', py: 2 }}>
      {/* Barra de tools — fora da área impressa */}
      <Box className="no-print" sx={{ width: '210mm', maxWidth: '100%', mx: 'auto', mb: 2, px: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
          <Typography variant="h6" fontWeight={700}>OS-{os.osNumber} — vias</Typography>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button variant="contained" startIcon={<Print />} onClick={() => window.print()}>
              Imprimir / Salvar PDF
            </Button>
            <Button onClick={() => navigate(-1)} startIcon={<Close />}>Voltar</Button>
          </Box>
        </Box>
        <Tabs value={grupo} onChange={(_e, v) => setGrupo(v)} sx={{ mb: 1 }}>
          <Tab value="abertura" label="Abertura (4 vias)" />
          <Tab value="fechamento" label="Fechamento (2 vias)" />
        </Tabs>
        {eLocais.length > 0 && (
          <Typography variant="caption" color="text.secondary">
            O cliente tem {eLocais.length} endereço(s) cadastrado(s); a via usa o endereço de serviço da O.S.
          </Typography>
        )}
      </Box>

      {/* Área impressa */}
      {/* maxWidth precisa de unidade explícita: no `sx` do MUI um número puro
          entra na escala de espaçamento (x8) e 210 virava 210px — a folha
          saía estreita e o cabeçalho se sobrepunha. */}
      <Box
        className="print-area"
        sx={{
          width: '210mm',
          maxWidth: '100%',
          mx: 'auto',
          bgcolor: '#fff',
          color: '#000',
          p: '8mm',
          minHeight: '297mm',
          '@media print': {
            p: 0,
            width: 'auto',
            minHeight: 0,
            pageBreakAfter: 'always',
            '&:last-of-type': { pageBreakAfter: 'auto' },
          },
        }}
      >
        {vias}
        {emp.cnpj && (
          <Box sx={{ mt: 1, pt: 0.75, borderTop: '1px solid #000', fontSize: 7.5, color: '#000', textAlign: 'center', lineHeight: 1.4 }}>
            <div>{emp.nome} — CNPJ {emp.cnpj}</div>
            {emp.endereco && <div>{emp.endereco}</div>}
            <div>{[emp.email, emp.emailsExtra].filter(Boolean).join(' | ')}</div>
          </Box>
        )}
      </Box>
    </Box>
  );
}