import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { Icon } from '../components/ui/Icon';
import { Spinner } from '../components/ui/Spinner';
import { WorkspaceFormModal } from '../components/workspace/WorkspaceFormModal';
import { useWorkspaces } from '../hooks/useWorkspaces';

/**
 * `/` — "重定向到最近工作区，无则空态引导" (architecture §8.3).
 * "Most recent" is the workspace with the newest `updated_at`.
 */
export function HomeRedirect() {
  const { t } = useTranslation();
  const [modalOpen, setModalOpen] = useState(false);
  const workspacesQuery = useWorkspaces();

  if (workspacesQuery.isPending) {
    return (
      <div
        className="flex min-h-[40vh] items-center justify-center text-fg-subtle"
        role="status"
      >
        <Spinner size={20} />
      </div>
    );
  }

  if (workspacesQuery.isError) {
    return (
      <EmptyState
        icon="alert"
        title={t('errors.server')}
        action={
          <Button onClick={() => void workspacesQuery.refetch()}>
            {t('common.retry')}
          </Button>
        }
      />
    );
  }

  const workspaces = workspacesQuery.data?.results ?? [];

  if (workspaces.length === 0) {
    return (
      <>
        <EmptyState
          icon="compass"
          title={t('workspace.onboardingTitle')}
          description={t('workspace.onboardingBody')}
          action={
            <Button
              variant="primary"
              iconLeft={<Icon name="plus" size={14} />}
              onClick={() => setModalOpen(true)}
            >
              {t('workspace.emptyAction')}
            </Button>
          }
        />
        <WorkspaceFormModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
        />
      </>
    );
  }

  const mostRecent = [...workspaces].sort((a, b) =>
    b.updated_at.localeCompare(a.updated_at),
  )[0];

  return <Navigate to={`/w/${mostRecent.id}`} replace />;
}
