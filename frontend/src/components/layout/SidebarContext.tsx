import { createContext, useContext, useState, ReactNode, useEffect, useCallback } from 'react';

interface SidebarContextType {
  collapsed: boolean;
  toggle: () => void;
  setCollapsed: (v: boolean) => void;
  // For mobile
  mobileOpen: boolean;
  setMobileOpen: (v: boolean) => void;
}

const SidebarContext = createContext<SidebarContextType | null>(null);

// Synchronous read from localStorage for initial state
function getInitialCollapsed(): boolean {
  try {
    const saved = localStorage.getItem('sidebarCollapsed');
    if (saved !== null) return JSON.parse(saved);
  } catch { /* ignore */ }
  return false;
}

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(getInitialCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);

  const setCollapsedLogged = useCallback((val: boolean | ((prev: boolean) => boolean)) => {
    setCollapsed(val);
  }, []);

  useEffect(() => {
    localStorage.setItem('sidebarCollapsed', JSON.stringify(collapsed));
  }, [collapsed]);

  const toggle = useCallback(() => setCollapsed(c => !c), []);

  const value = {
    collapsed,
    toggle,
    setCollapsed: setCollapsedLogged,
    mobileOpen,
    setMobileOpen,
  };

  return (
    <SidebarContext.Provider value={value}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  const ctx = useContext(SidebarContext);
  if (!ctx) throw new Error('useSidebar must be used within SidebarProvider');
  return ctx;
}