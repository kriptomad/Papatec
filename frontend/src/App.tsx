import { Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './store/auth';
import { MainLayout } from './components/layout/MainLayout';
import { LoginPage } from './pages/auth/LoginPage';
import { LicensePage } from './pages/license/LicensePage';
import { LicenseActivation } from './pages/LicenseActivation';
import { DashboardPage } from './pages/DashboardPage';
import { ClientsPage } from './pages/clients/ClientsPage';
import { ClientDetailPage } from './pages/clients/ClientDetailPage';
import { BudgetsPage } from './pages/budgets/BudgetsPage';
import { BudgetFormPage } from './pages/budgets/BudgetFormPage';
import { BudgetDetailPage } from './pages/budgets/BudgetDetailPage';
import { ServiceOrdersPage } from './pages/service-orders/ServiceOrdersPage';
import { ServiceOrderFormPage } from './pages/service-orders/ServiceOrderFormPage';
import { ServiceOrderDetailPage } from './pages/service-orders/ServiceOrderDetailPage';
import { ServiceOrderPrintPage } from './pages/service-orders/ServiceOrderPrintPage';
import { InventoryPage } from './pages/inventory/InventoryPage';
import { PartFormPage } from './pages/inventory/PartFormPage';
import { SuppliersPage } from './pages/suppliers/SuppliersPage';
import { SupplierDetailPage } from './pages/suppliers/SupplierDetailPage';
import { PurchasesPage } from './pages/purchases/PurchasesPage';
import { PurchaseFormPage } from './pages/purchases/PurchaseFormPage';
import { PurchaseDetailPage } from './pages/purchases/PurchaseDetailPage';
import { PurchasePrintPage } from './pages/purchases/PurchasePrintPage';
import { SalesPage } from './pages/sales/SalesPage';
import { SaleFormPage } from './pages/sales/SaleFormPage';
import { SaleDetailPage } from './pages/sales/SaleDetailPage';
import { SalePrintPage } from './pages/sales/SalePrintPage';
import { CommissionPage } from './pages/sales/CommissionPage';
import { CalendarPage } from './pages/calendar/CalendarPage';
import { VisitsPage } from './pages/visits/VisitsPage';
import { EmployeesPage } from './pages/employees/EmployeesPage';
import { EmployeeDetailPage } from './pages/employees/EmployeeDetailPage';
import { ReportsPage } from './pages/reports/ReportsPage';
import { BudgetPrintPage } from './pages/budgets/BudgetPrintPage';
import { SettingsPage } from './pages/settings/SettingsPage';
import { BackupPage } from './pages/backup/BackupPage';
import { RouteErrorBoundary } from './components/RouteErrorBoundary';


function PrivateRouteComponent({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, hydrated } = useAuth();
  if (!hydrated) return null;
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />;
}
PrivateRouteComponent.displayName = 'PrivateRouteComponent';

function AdminRouteComponent({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, user, hydrated } = useAuth();
  if (!hydrated) return null;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (user && user.role !== 'ADMIN') return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}
AdminRouteComponent.displayName = 'AdminRouteComponent';

function PublicRouteComponent({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, hydrated } = useAuth();
  if (!hydrated) return null;
  
  // Public route: allow access when NOT authenticated, redirect to dashboard when authenticated
  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }
  return <>{children}</>;
}
PublicRouteComponent.displayName = 'PublicRouteComponent';

/**
 * Layout route que aplica um ErrorBoundary por SEÇÃO.
 *
 * IMPORTANTE: <Routes> exige que todos os filhos diretos sejam <Route> ou
 * <React.Fragment>. Usar <RouteErrorBoundary> como wrapper de <Route>s dispara:
 *   "[RouteErrorBoundary] is not a <Route> component. All component children of
 *    <Routes> must be a <Route> or <React.Fragment>"
 * e derruba a app inteira. A forma correta e um layout route SEM path, que
 * renderiza <Outlet/> protegido.
 *
 * `key={location.pathname}` remonta o boundary a cada rota, para que um erro
 * capturado numa página não fique "grudado" quando o usuário navega para outra.
 */
function RouteSectionBoundary() {
  const location = useLocation();
  return (
    <RouteErrorBoundary key={location.pathname}>
      <Outlet />
    </RouteErrorBoundary>
  );
}


function App() {
  const { isAuthenticated, license } = useAuth();

  return (
    <Routes>
      <Route path="/login" element={<PublicRouteComponent><LoginPage /></PublicRouteComponent>} />
      <Route path="/activate" element={<PublicRouteComponent><LicenseActivation /></PublicRouteComponent>} />
      <Route path="/license" element={<PrivateRouteComponent><LicensePage /></PrivateRouteComponent>} />
      
      <Route element={<PrivateRouteComponent><MainLayout /></PrivateRouteComponent>}>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        
        <Route element={<RouteSectionBoundary />}>
          <Route path="/clients" element={<ClientsPage />} />
          <Route path="/clients/new" element={<ClientDetailPage />} />
          <Route path="/clients/:id" element={<ClientDetailPage />} />
        </Route>
        
        <Route element={<RouteSectionBoundary />}>
          <Route path="/budgets" element={<BudgetsPage />} />
          <Route path="/budgets/new" element={<BudgetFormPage />} />
          <Route path="/budgets/:id" element={<BudgetDetailPage />} />
          <Route path="/budgets/:id/edit" element={<BudgetFormPage />} />
          <Route path="/budgets/:id/print" element={<BudgetPrintPage />} />
        </Route>
        
        <Route element={<RouteSectionBoundary />}>
          <Route path="/sales" element={<SalesPage />} />
          <Route path="/sales/new" element={<SaleFormPage />} />
          <Route path="/sales/:id" element={<SaleDetailPage />} />
          <Route path="/sales/:id/edit" element={<SaleFormPage />} />
          <Route path="/sales/:id/print" element={<SalePrintPage />} />
        {/* Comissão: visível para vendedor (RECEPTIONIST) e ADMIN. */}
        <Route path="/commission" element={<CommissionPage />} />
        </Route>
        
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/visits" element={<VisitsPage />} />
        
        <Route element={<RouteSectionBoundary />}>
          <Route path="/employees" element={<EmployeesPage />} />
          <Route path="/employees/:id" element={<EmployeeDetailPage />} />
        </Route>
        
        <Route path="/reports" element={<ReportsPage />} />
        
        <Route element={<RouteSectionBoundary />}>
          <Route path="/service-orders" element={<ServiceOrdersPage />} />
          <Route path="/service-orders/new" element={<ServiceOrderFormPage />} />
          <Route path="/service-orders/from-budget/:budgetId" element={<ServiceOrderFormPage />} />
          <Route path="/service-orders/:id" element={<ServiceOrderDetailPage />} />
          <Route path="/service-orders/:id/edit" element={<ServiceOrderFormPage />} />
          <Route path="/service-orders/:id/print" element={<ServiceOrderPrintPage />} />
        </Route>
        
        <Route element={<RouteSectionBoundary />}>
          <Route path="/inventory" element={<InventoryPage />} />
          <Route path="/inventory/new" element={<PartFormPage />} />
          <Route path="/inventory/:id/edit" element={<PartFormPage />} />
        </Route>
        
        <Route element={<RouteSectionBoundary />}>
          <Route path="/suppliers" element={<SuppliersPage />} />
          <Route path="/suppliers/new" element={<SupplierDetailPage />} />
          <Route path="/suppliers/:id" element={<SupplierDetailPage />} />
        </Route>
        
        <Route element={<RouteSectionBoundary />}>
          <Route path="/purchases" element={<PurchasesPage />} />
          <Route path="/purchases/new" element={<PurchaseFormPage />} />
          <Route path="/purchases/:id" element={<PurchaseDetailPage />} />
          <Route path="/purchases/:id/print" element={<PurchasePrintPage />} />
        </Route>
        
        <Route path="/backup" element={<AdminRouteComponent><BackupPage /></AdminRouteComponent>} />
        <Route path="/settings" element={<AdminRouteComponent><SettingsPage /></AdminRouteComponent>} />
      </Route>
      
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
export default App;
