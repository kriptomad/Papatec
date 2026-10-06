import { useMemo, useState } from 'react';
import {
  Box, Card, CardContent, Typography, Table, TableHead, TableRow, TableCell,
  TableBody, TableContainer, TextField, MenuItem, Stack, Chip, Tooltip as MuiTooltip,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { Assessment } from '@mui/icons-material';
import { salesApi } from '../../services/api';
import { formatCurrency, formatDate } from '../../utils/formatters';
import { useAuth } from '../../store/auth';

/**
 * Comissão — o ÚNICO lugar onde a comissão aparece.
 *
 * Ela deixou de ser digitada e sumiu da O.S., da venda, do orçamento e da nota
 * (ver sales.routes.ts / serviceOrders.routes.ts). O percentual vem do cadastro
 * do produto (Part.commissionPercent) e o cálculo é sempre feito pelo backend.
 *
 * Janela padrão: 90 dias, por DATA DA VENDA. O cliente ajusta em "Período".
 *
 * ADMIN vê todos os vendedores e pode filtrar por um. RECEPTIONIST (vendedor)
 * vê somente as próprias vendas — e isso é aplicado no servidor, não aqui.
 */
const JANELAS = [
  { valor: 30, rotulo: '30 dias' },
  { valor: 60, rotulo: '60 dias' },
  { valor: 90, rotulo: '90 dias' },
  { valor: 180, rotulo: '180 dias' },
  { valor: 365, rotulo: '1 ano' },
  { valor: 0, rotulo: 'Tudo' },
];

export function CommissionPage() {
  const { user } = useAuth() as any;
  const isAdmin = user?.role === 'ADMIN';

  const [dias, setDias] = useState<number>(90);
  const [de, setDe] = useState('');
  const [ate, setAte] = useState('');
  const [vendedor, setVendedor] = useState('');

  const intervaloManual = !!(de || ate);

  const { data, isLoading, isFetching, error } = useQuery({
    // A chave inclui todos os filtros: trocar a janela precisa refazer a consulta.
    queryKey: ['commission', dias, de, ate, vendedor],
    queryFn: () =>
      salesApi.commission({
        ...(intervaloManual ? { startDate: de, endDate: ate } : { days: dias }),
        ...(vendedor ? { userId: vendedor } : {}),
      }),
  });

  const payload = (data as any)?.data || data || null;
  const porProduto: any[] = payload?.porProduto || [];
  const totais = payload?.totais || { vendas: 0, comissao: 0, itens: 0 };
  const periodo = payload?.periodo;

  const vendedores = useQuery({
    queryKey: ['employees', 'commission-filter'],
    queryFn: () => salesApi.listSellers(),
    enabled: isAdmin,
  });

  // /api/users responde paginado ({ data: [...], total }). O `get` do api.ts
  // desembrulha um nivel, mas o formato pode variar; normalizo aqui em vez de
  // assumir - um `.map` em objeto quebraria a tela inteira do filtro.
  const listaVendedores: any[] = (() => {
    const d: any = (vendedores.data as any);
    if (Array.isArray(d)) return d;
    if (Array.isArray(d?.data)) return d.data;
    if (Array.isArray(d?.data?.data)) return d.data.data;
    return [];
  })();

  const textoPeriodo = useMemo(() => {
    if (!periodo) return '';
    return `${formatDate(new Date(periodo.de))} até ${formatDate(new Date(periodo.ate))}`;
  }, [periodo]);

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }} flexWrap="wrap" gap={2}>
        <Box>
          <Typography variant="h4" fontWeight={700}>Comissão</Typography>
          <Typography variant="body1" color="text.secondary">
            Produtos vendidos no período, com o valor de venda e o valor de comissão
          </Typography>
        </Box>
      </Stack>

      {/* Filtro de período */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }} flexWrap="wrap" useFlexGap>
            {!intervaloManual && (
              <TextField
                select size="small" label="Período" value={dias} sx={{ minWidth: 150 }}
                onChange={(e) => setDias(Number(e.target.value))}
              >
                {JANELAS.map((j) => (
                  <MenuItem key={j.valor} value={j.valor}>{j.rotulo}</MenuItem>
                ))}
              </TextField>
            )}

            <TextField
              type="date" size="small" label="De"
              value={de}
              onChange={(e) => setDe(e.target.value)}
              InputLabelProps={{ shrink: true }}
            />
            <TextField
              type="date" size="small" label="Até"
              value={ate}
              onChange={(e) => setAte(e.target.value)}
              InputLabelProps={{ shrink: true }}
            />

            {intervaloManual && (
              <Chip
                label="Intervalo personalizado"
                size="small"
                onDelete={() => { setDe(''); setAte(''); }}
              />
            )}

            {isAdmin && (
              <TextField
                select size="small" label="Vendedor" value={vendedor} sx={{ minWidth: 200 }}
                onChange={(e) => setVendedor(e.target.value)}
              >
                <MenuItem value="">Todos os vendedores</MenuItem>
                {listaVendedores.map((u) => (
                  <MenuItem key={u.id} value={u.id}>{u.name}</MenuItem>
                ))}
              </TextField>
            )}

            {isFetching && <Typography variant="caption" color="text.secondary">Carregando…</Typography>}
          </Stack>

          {textoPeriodo && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
              {textoPeriodo}
            </Typography>
          )}
        </CardContent>
      </Card>

      {/* Totais */}
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 3 }}>
        <Card sx={{ flex: 1 }}><CardContent>
          <Typography variant="body2" color="text.secondary">Valor Venda</Typography>
          <Typography variant="h5" fontWeight={700}>{formatCurrency(totais.vendas || 0)}</Typography>
        </CardContent></Card>
        <Card sx={{ flex: 1 }}><CardContent>
          <Typography variant="body2" color="text.secondary">Valor Comissão</Typography>
          <Typography variant="h5" fontWeight={700} color="success.main">
            {formatCurrency(totais.comissao || 0)}
          </Typography>
        </CardContent></Card>
        <Card sx={{ flex: 1 }}><CardContent>
          <Typography variant="body2" color="text.secondary">Itens vendidos</Typography>
          <Typography variant="h5" fontWeight={700}>{totais.itens || 0}</Typography>
        </CardContent></Card>
      </Stack>

      {error && (
        <Card sx={{ mb: 3 }}><CardContent>
          <Typography color="error">Não foi possível carregar a comissão.</Typography>
        </CardContent></Card>
      )}

      {/* Por produto */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
            <Assessment fontSize="small" />
            <Typography variant="h6" fontWeight={600}>Por produto</Typography>
          </Stack>

          {isLoading ? (
            <Typography color="text.secondary">Carregando…</Typography>
          ) : porProduto.length === 0 ? (
            <Typography color="text.secondary">
              Nenhum produto vendido no período selecionado.
            </Typography>
          ) : (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Produto</TableCell>
                    <TableCell align="right">Qtd</TableCell>
                    <TableCell align="right">%</TableCell>
                    <TableCell align="right">Valor Venda</TableCell>
                    <TableCell align="right">Valor Comissão</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {porProduto.map((p, i) => (
                    <TableRow key={p.codigo || `${p.produto}-${i}`}>
                      <TableCell>
                        <Typography variant="body2" fontWeight={600}>{p.produto}</Typography>
                        {p.codigo && (
                          <Typography variant="caption" color="text.secondary">{p.codigo}</Typography>
                        )}
                      </TableCell>
                      <TableCell align="right">{p.qtd}</TableCell>
                      <TableCell align="right">
                        <MuiTooltip title="Percentual definido no cadastro do produto">
                          <span>{p.percentual}%</span>
                        </MuiTooltip>
                      </TableCell>
                      <TableCell align="right">{formatCurrency(p.valorVenda)}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 700, color: 'success.main' }}>
                        {formatCurrency(p.comissao)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </CardContent>
      </Card>

      {/* Detalhamento por venda */}
      {payload?.linhas?.length > 0 && (
        <Card>
          <CardContent>
            <Typography variant="h6" fontWeight={600} sx={{ mb: 2 }}>Detalhamento</Typography>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Data</TableCell>
                    <TableCell>Venda</TableCell>
                    <TableCell>Vendedor</TableCell>
                    <TableCell>Cliente</TableCell>
                    <TableCell>Produto</TableCell>
                    <TableCell align="right">Qtd</TableCell>
                    <TableCell align="right">Valor Venda</TableCell>
                    <TableCell align="right">Valor Comissão</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {payload.linhas.map((l: any) => (
                    <TableRow key={l.id}>
                      <TableCell>{formatDate(new Date(l.data))}</TableCell>
                      <TableCell>{l.venda}</TableCell>
                      <TableCell>{l.vendedor}</TableCell>
                      <TableCell>{l.cliente}</TableCell>
                      <TableCell>{l.produto}</TableCell>
                      <TableCell align="right">{l.qtd}</TableCell>
                      <TableCell align="right">{formatCurrency(l.valorVenda)}</TableCell>
                      <TableCell align="right" sx={{ color: 'success.main' }}>
                        {formatCurrency(l.comissao)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>
      )}
    </Box>
  );
}