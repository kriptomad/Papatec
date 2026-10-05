import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authApi } from '../services/api';
import { Button, Textarea, Card, CardContent, CardHeader, CardTitle, Alert, AlertDescription, Input } from '@/components/ui';
import { Copy, Loader2, AlertCircle, CheckCircle } from 'lucide-react';

export function LicenseActivation() {
  const navigate = useNavigate();
  const [hardwareId, setHardwareId] = useState('');
  const [licenseToken, setLicenseToken] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const fetchChallenge = async () => {
      try {
        const res: any = await authApi.license.challenge();
        setHardwareId(res?.hardwareId || '');
      } catch {
        setErrorMessage('Não foi possível conectar ao servidor. Verifique se o backend está rodando.');
        setStatus('error');
      }
    };
    fetchChallenge();
  }, []);

  const handleCopyHardwareId = () => {
    navigator.clipboard.writeText(hardwareId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleActivate = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('loading');
    setErrorMessage('');

    try {
      await authApi.license.activate(licenseToken.trim());
      setStatus('success');
      setTimeout(() => navigate('/login'), 2000);
    } catch (err: any) {
      setStatus('error');
      const msg =
        err.response?.data?.error?.message ||
        err.response?.data?.message ||
        'Erro desconhecido ao ativar';
      setErrorMessage(msg);
    }
  };

  useEffect(() => {
    const check = async () => {
      try {
        const res: any = await authApi.license.status();
        // Já existe licença ativa nesta máquina: segue direto para o login.
        if (res?.isLicensed) navigate('/login');
      } catch {
        /* sem licença - permanece na tela de ativação */
      }
    };
    check();
  }, [navigate]);

  return (
    <div className="min-h-screen w-screen flex items-center justify-center bg-gray-900/50 backdrop-blur-sm p-4">
      <Card className="w-full max-w-2xl border-gray-700 bg-gray-900/80 shadow-2xl">
        <CardHeader className="text-center border-b border-gray-700">
          <div className="mx-auto mb-4 flex justify-center">
            <div className="rounded-2xl bg-white px-6 py-4 shadow-xl">
              <img
                src="/logo-papatec.png"
                alt="Papatec"
                className="h-12 w-auto sm:h-14"
              />
            </div>
          </div>
          <CardTitle className="text-2xl font-bold text-white">Ativação da Licença</CardTitle>
          <p className="text-muted-foreground mt-1">
            PapaTec — Sistema de Gestão para Assistência Técnica ·{' '}
            <span className="font-medium text-blue-400">Filitech</span>
          </p>
        </CardHeader>

        <CardContent className="space-y-6">
          <div className="bg-amber-900/30 border border-amber-500/50 rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 text-amber-300">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <span className="font-medium text-lg">Passo 1: Seu Hardware ID (Desafio)</span>
              </div>
            </div>
            <p className="text-sm text-amber-200 mb-3">Copie o código abaixo e envie para a <strong className="text-white">Filitech</strong> para gerar sua licença.</p>
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <Input
                  value={hardwareId}
                  readOnly
                  className="font-mono text-sm bg-amber-900/50 border-amber-500/50 cursor-default text-white placeholder-amber-500"
                  placeholder="Carregando Hardware ID..."
                />
              </div>
              <Button 
                variant="outline" 
                onClick={handleCopyHardwareId}
                disabled={!hardwareId}
                className="h-20 whitespace-nowrap shrink-0 bg-amber-500/20 hover:bg-amber-500/30 border-amber-500/50 text-amber-300"
              >
                {copied ? (
                  <>
                    <svg className="w-4 h-4 mr-1 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    Copiado!
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4 mr-1" />
                    Copiar HWID
                  </>
                )}
              </Button>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center gap-2 text-gray-300">
              <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              <span className="font-medium text-lg">Passo 2: Cole a Licença Recebida</span>
            </div>
            <p className="text-sm text-muted-foreground">A Filitech enviará um token JWT (texto longo começando com <code className="bg-gray-800 px-1 rounded text-blue-400">eyJ...</code>). Cole abaixo:</p>

            <form onSubmit={handleActivate}>
              <Textarea
                value={licenseToken}
                onChange={(e) => setLicenseToken(e.target.value)}
                placeholder="Cole aqui o token JWT da licença..."
                rows={4}
                className="font-mono text-sm bg-gray-800 border-gray-600 text-white placeholder-gray-500 focus:border-blue-500 focus:ring-blue-500/20"
                disabled={status === 'loading' || status === 'success'}
                required
              />
              
              {status === 'error' && (
                <Alert variant="destructive" className="border-red-500/50 bg-red-900/30">
                  <svg className="w-4 h-4 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <AlertDescription className="text-red-200">{errorMessage}</AlertDescription>
                </Alert>
              )}

              {status === 'success' && (
                <Alert className="border-green-500/50 bg-green-900/30">
                  <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  <AlertDescription className="flex items-center justify-between text-green-200">
                    <span>Licença validada! Redirecionando para o dashboard...</span>
                    <svg className="w-4 h-4 animate-spin text-green-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                  </AlertDescription>
                </Alert>
              )}

              <Button 
                type="submit" 
                className="w-full mt-2 py-3 text-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={status === 'loading' || status === 'success' || !licenseToken.trim()}
              >
                {status === 'loading' ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="w-5 h-5 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Validando Assinatura...
                  </span>
                ) : (
                  'Ativar Sistema'
                )}
              </Button>
            </form>
          </div>

          <div className="border-t border-gray-700 pt-4 text-center text-sm text-muted-foreground space-y-1">
            <p>Desenvolvido por <strong className="text-white">Filitech</strong> — Todos os direitos reservados</p>
            <p>Suporte: <a href="mailto:licenca@filitech.com.br" className="text-blue-400 hover:underline">licenca@filitech.com.br</a></p>
            <p className="text-xs text-gray-500">Versão 1.0.0 | RSA-2048 | Offline Challenge-Response</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}