import { Route, Routes } from 'react-router-dom';
import { AuthProvider } from '@/features/auth/AuthContext';
import { ProtectedRoute } from '@/features/auth/guards';
import { LoginPage } from '@/features/auth/LoginPage';
import { ForgotPasswordPage } from '@/features/auth/ForgotPasswordPage';
import { ResetPasswordPage } from '@/features/auth/ResetPasswordPage';
import { RegisterPage } from '@/features/auth/RegisterPage';
import { ForbiddenPage } from '@/features/auth/ForbiddenPage';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { UsersPage } from '@/features/users/UsersPage';
import { ProductsPage } from '@/features/products/ProductsPage';
import { ReceiptsPage } from '@/features/stock/ReceiptsPage';
import { StockSheetPage } from '@/features/stock/StockSheetPage';
import { StockValuationPage } from '@/features/stock/StockValuationPage';
import { PointOfSalePage } from '@/features/sales/PointOfSalePage';
import { DailySummaryPage } from '@/features/sales/DailySummaryPage';
import { OutstandingChitPage } from '@/features/treasurer/OutstandingChitPage';
import { ChitPaymentsPage } from '@/features/treasurer/ChitPaymentsPage';
import { ExpensesAdminPage } from '@/features/treasurer/ExpensesAdminPage';
import { MembersPage } from '@/features/treasurer/MembersPage';
import { MemberStatementPage } from '@/features/treasurer/MemberStatementPage';
import { CashAtHandPage } from '@/features/treasurer/CashAtHandPage';
import { ProfitLossPage } from '@/features/reports/ProfitLossPage';
import { CashClosingPage } from '@/features/reports/CashClosingPage';
import { MemberPortalPage } from '@/features/member/MemberPortalPage';
import { MemberStatementPage as PortalStatementPage } from '@/features/member/MemberStatementPage';
import { MemberPurchasesPage } from '@/features/member/MemberPurchasesPage';
import { MemberPaymentsPage } from '@/features/member/MemberPaymentsPage';
import { MemberProfilePage } from '@/features/member/MemberProfilePage';
import { AuthorizeChitPage } from '@/features/member/AuthorizeChitPage';
import { AppShell } from '@/components/layout/AppShell';
import { AuditLogPage } from '@/features/admin/AuditLogPage';
import { AuditLogExportPage } from '@/features/admin/AuditLogExportPage';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { SecurityPage } from '@/features/security/SecurityPage';
import { SessionsListPage } from '@/features/security/SessionsListPage';
import { BackupHealthPage } from '@/features/admin/BackupHealthPage';
import { AuditSummaryPage } from '@/features/admin/AuditSummaryPage';
import { MembersDirectoryPage } from '@/features/treasurer/MembersDirectoryPage';
import { ProductsLowStockPage } from '@/features/products/ProductsLowStockPage';
import { Toaster } from '@/components/ui/toaster';
import { ConfirmProvider } from '@/hooks/useConfirm';

function App() {
  return (
    <AuthProvider>
      <ConfirmProvider>
      <Toaster>
        <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/forbidden" element={<ForbiddenPage />} />
        <Route path="/portal/authorize/:requestId" element={<AuthorizeChitPage />} />

        <Route
          element={
            <ProtectedRoute>
              <AppShell />
            </ProtectedRoute>
          }
        >
          <Route path="/" element={<DashboardPage />} />
          <Route path="/products" element={
            <ProtectedRoute allow={['administrator','treasurer','barman']}>
              <ProductsPage />
            </ProtectedRoute>
          } />
          <Route path="/stock-receipts" element={
            <ProtectedRoute allow={['administrator','treasurer','barman']}>
              <ReceiptsPage />
            </ProtectedRoute>
          } />
          <Route path="/stock-sheet" element={
            <ProtectedRoute allow={['administrator','treasurer','barman']}>
              <StockSheetPage />
            </ProtectedRoute>
          } />
          <Route path="/stock-valuation" element={
            <ProtectedRoute allow={['administrator','treasurer']}>
              <StockValuationPage />
            </ProtectedRoute>
          } />
          <Route path="/pos" element={
            <ProtectedRoute allow={['administrator','treasurer','barman']}>
              <PointOfSalePage />
            </ProtectedRoute>
          } />
          <Route path="/daily-summary" element={
            <ProtectedRoute allow={['administrator','treasurer','barman']}>
              <DailySummaryPage />
            </ProtectedRoute>
          } />
          <Route path="/products/low-stock" element={
            <ProtectedRoute allow={['administrator','treasurer','barman']}>
              <ProductsLowStockPage />
            </ProtectedRoute>
          } />
          <Route
            path="/users"
            element={
              <ProtectedRoute allow={['administrator']}>
                <UsersPage />
              </ProtectedRoute>
            }
          />
          <Route path="/outstanding-chit" element={<ProtectedRoute allow={['administrator','treasurer']}><OutstandingChitPage /></ProtectedRoute>} />
          <Route path="/chit-payments" element={<ProtectedRoute allow={['administrator','treasurer']}><ChitPaymentsPage /></ProtectedRoute>} />
          <Route path="/expenses-admin" element={<ProtectedRoute allow={['administrator','treasurer']}><ExpensesAdminPage /></ProtectedRoute>} />
          <Route path="/members" element={<ProtectedRoute allow={['administrator','treasurer']}><MembersPage /></ProtectedRoute>} />
          <Route path="/members/:id/statement" element={<ProtectedRoute allow={['administrator','treasurer']}><MemberStatementPage /></ProtectedRoute>} />
          <Route path="/cash-at-hand" element={<ProtectedRoute allow={['administrator','treasurer']}><CashAtHandPage /></ProtectedRoute>} />
          <Route path="/reports/pnl" element={<ProtectedRoute allow={['administrator','treasurer']}><ProfitLossPage /></ProtectedRoute>} />
          <Route path="/reports/cash-closing" element={<ProtectedRoute allow={['administrator','treasurer','barman']}><CashClosingPage /></ProtectedRoute>} />

          <Route path="/portal" element={<ProtectedRoute allow={['member']}><MemberPortalPage /></ProtectedRoute>} />
          <Route path="/admin/audit" element={<ProtectedRoute allow={['administrator']}><AuditLogPage /></ProtectedRoute>} />
          <Route path="/admin/audit/summary" element={<ProtectedRoute allow={['administrator']}><AuditSummaryPage /></ProtectedRoute>} />
          <Route path="/admin/audit/export" element={<ProtectedRoute allow={['administrator']}><AuditLogExportPage /></ProtectedRoute>} />
          <Route path="/admin/backups" element={<ProtectedRoute allow={['administrator','treasurer']}><BackupHealthPage /></ProtectedRoute>} />
          <Route path="/admin/settings" element={<ProtectedRoute allow={['administrator']}><SettingsPage /></ProtectedRoute>} />
          <Route path="/security" element={<ProtectedRoute><SecurityPage /></ProtectedRoute>} />
          <Route path="/admin/sessions" element={<ProtectedRoute allow={['administrator']}><SessionsListPage /></ProtectedRoute>} />
          <Route path="/members-directory" element={<ProtectedRoute allow={['administrator','treasurer']}><MembersDirectoryPage /></ProtectedRoute>} />
          <Route path="/portal/statement" element={<ProtectedRoute allow={['member']}><PortalStatementPage /></ProtectedRoute>} />
          <Route path="/portal/purchases" element={<ProtectedRoute allow={['member']}><MemberPurchasesPage /></ProtectedRoute>} />
          <Route path="/portal/payments" element={<ProtectedRoute allow={['member']}><MemberPaymentsPage /></ProtectedRoute>} />
          <Route path="/portal/profile" element={<ProtectedRoute allow={['member']}><MemberProfilePage /></ProtectedRoute>} />
        </Route>

        <Route path="*" element={<ForbiddenPage />} />
      </Routes>
      </Toaster>
      </ConfirmProvider>
    </AuthProvider>
  );
}

export default App;
