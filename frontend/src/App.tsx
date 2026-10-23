import { useTranslation } from 'react-i18next';
import { Route, Routes } from 'react-router-dom';
import {
  ProtectedRoute,
  PublicOnlyRoute,
} from './components/auth/ProtectedRoute';
import { AppShell } from './components/layout/AppShell';
import { PageLoader } from './components/ui/Spinner';
import { HomeRedirect } from './pages/HomeRedirect';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { RegisterPage } from './pages/RegisterPage';
import { SettingsPage } from './pages/SettingsPage';
import { ArchitecturePage } from './pages/ArchitecturePage';
import { DocumentsPage } from './pages/DocumentsPage';
import { WorkspacePage } from './pages/WorkspacePage';
import { useAuth } from './stores/AuthContext';

/**
 * Route table — architecture §8.3.
 *
 *   /login /register        public (signed-in users bounce to /)
 *   /                       most recent workspace, else onboarding empty state
 *   /w/:workspaceId         task board
 *   /w/:workspaceId/l/:listId  focused list
 *   /w/:workspaceId/docs[/:docId]  workspace documents
 *   /w/:workspaceId/architecture   one architecture diagram
 *   /settings               account, theme, language, password
 *   *                       404
 */
export default function App() {
  const { t } = useTranslation();
  const { isBootstrapping } = useAuth();

  /* Full-screen loader while the stored refresh token is exchanged (AuthContext). */
  if (isBootstrapping) {
    return <PageLoader label={t('auth.loadingSession')} />;
  }

  return (
    <Routes>
      <Route element={<PublicOnlyRoute />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
      </Route>

      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route path="/" element={<HomeRedirect />} />
          <Route path="/w/:workspaceId" element={<WorkspacePage />} />
          <Route path="/w/:workspaceId/l/:listId" element={<WorkspacePage />} />
          <Route path="/w/:workspaceId/docs" element={<DocumentsPage />} />
          <Route
            path="/w/:workspaceId/docs/:docId"
            element={<DocumentsPage />}
          />
          <Route
            path="/w/:workspaceId/architecture"
            element={<ArchitecturePage />}
          />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
