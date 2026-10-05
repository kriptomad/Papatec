import { createContext, useContext, useState, useEffect, ReactNode, useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { User, LicenseInfo, AuthState } from '../types';
import { authApi } from '../services/api';

interface AuthContextType extends AuthState {
  /** true quando a restauração inicial da sessão terminou (rotas devem esperar). */
  hydrated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  setupAdmin: (data: { email: string; password: string; name: string }) => Promise<void>;
  refreshLicense: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/**
 * Normaliza as DUAS formas de licença que o backend devolve:
 *  - /auth/login           -> { active, daysRemaining, ... }   (achatada)
 *  - /auth/license/status  -> { isLicensed, hardwareId, license: {...} } (envelope)
 * Sem isto, após o refresh em background `license.active` virava `undefined` e
 * MainLayout (`license.active === false`) deixava de redirecionar para /license.
 */
function unwrapLicense(raw: any): LicenseInfo | null {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.license && typeof raw.license === 'object') {
    return { ...raw, ...raw.license, isLicensed: raw.isLicensed ?? raw.license.active };
  }
  return raw as LicenseInfo;
}

/**
 * Restauração síncrona da sessão a partir do localStorage.
 * Cada chave é parseada no seu próprio try: antes um `license` corrompido
 * derrubava o `JSON.parse(user)` no mesmo bloco e a SESSÃO INTEIRA era
 * descartada por um dado não relacionado.
 */
function loadStoredAuthSync(): { user: User | null; token: string | null; license: LicenseInfo | null; isAuthenticated: boolean } {
  const readJson = <T,>(key: string): T | null => {
    try {
      const raw = localStorage.getItem(key);
      return raw && raw.trim() ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  };

  const token = localStorage.getItem('token')?.trim() || null;
  const user = readJson<User>('user');
  const license = readJson<LicenseInfo>('license');

  if (token && user) {
    return { user, token, license, isAuthenticated: true };
  }

  // Limpeza defensiva (só roda no caminho sem sessão)
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  localStorage.removeItem('license');
  return { user: null, token: null, license: null, isAuthenticated: false };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // Lazy initializer: loadStoredAuthSync() tem EFEITOS COLATERAIS (removeItem).
  // Chamada direto no corpo do componente ela rodava a cada render e, sob
  // StrictMode (render duplo), apagava chaves que outra feature pudesse ter
  // escrito entre renders.
  const [state, setState] = useState<AuthState>(() => loadStoredAuthSync());
  const [hydrated, setHydrated] = useState(true); // Hidratação é síncrona
  const refreshTriggered = useRef(false);
  const queryClient = useQueryClient();

  // isAuthenticated DERIVADO: um snapshot salvo em state fica `true` mesmo
  // após o interceptor do axios limpar o storage sem recarregar a página,
  // deixando o usuário "dentro" com todas as chamadas 401.
  const isAuthenticated = !!(state.token && state.user);

  // Background license refresh (non-blocking)
  useEffect(() => {
    if (isAuthenticated && state.license && !refreshTriggered.current) {
      refreshTriggered.current = true;
      authApi
        .getLicenseStatus()
        .then((fresh) => {
          if (fresh) {
            const normalized = unwrapLicense(fresh);
            if (normalized) {
              localStorage.setItem('license', JSON.stringify(normalized));
              setState((prev) => ({ ...prev, license: normalized }));
            }
          }
        })
        .catch(() => {
          /* mantém a licença em cache */
        });
    }
  }, [isAuthenticated, state.license]);

  const login = useCallback(
    async (email: string, password: string) => {
      const { access_token, user, license } = await authApi.login({ email, password });
      const normalized = unwrapLicense(license);

      localStorage.setItem('token', access_token);
      localStorage.setItem('user', JSON.stringify(user));
      if (normalized) localStorage.setItem('license', JSON.stringify(normalized));
      else localStorage.removeItem('license');

      setState({ user, token: access_token, license: normalized, isAuthenticated: true });
    },
    [],
  );

  const logout = useCallback(() => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('license');
    // CRÍTICO: sem limpar o cache do React Query, o PRÓXIMO usuário que fizar
    // login na mesma aba via os orçamentos/clientes/OS já em cache (staleTime
    // de 30s) — vazamento de dados entre usuários.
    queryClient.clear();
    setState({ user: null, token: null, license: null, isAuthenticated: false });
  }, [queryClient]);

  const setupAdmin = useCallback(
    async (data: { email: string; password: string; name: string }) => {
      const { access_token, user, license } = await authApi.setupAdmin(data);
      const normalized = unwrapLicense(license);

      localStorage.setItem('token', access_token);
      localStorage.setItem('user', JSON.stringify(user));
      if (normalized) localStorage.setItem('license', JSON.stringify(normalized));
      else localStorage.removeItem('license');

      setState({ user, token: access_token, license: normalized, isAuthenticated: true });
    },
    [],
  );

  const refreshLicense = useCallback(async () => {
    const status = await authApi.getLicenseStatus();
    if (status) {
      const normalized = unwrapLicense(status);
      if (normalized) {
        localStorage.setItem('license', JSON.stringify(normalized));
        setState((prev) => ({ ...prev, license: normalized }));
      }
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{ ...state, isAuthenticated, hydrated, login, logout, setupAdmin, refreshLicense }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth deve ser usado dentro de AuthProvider');
  return context;
}
