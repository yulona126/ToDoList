import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router-dom';
import { useWorkspaces } from '../../hooks/useWorkspaces';
import { cn } from '../../lib/utils';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Spinner } from '../ui/Spinner';
import { Tooltip } from '../ui/Tooltip';
import { WorkspaceFormModal } from '../workspace/WorkspaceFormModal';

export interface SidebarProps {
  /** Drawer state; ignored from 768px up. */
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const { t } = useTranslation();
  const [modalOpen, setModalOpen] = useState(false);
  const workspacesQuery = useWorkspaces();
  const workspaces = workspacesQuery.data?.results ?? [];

  return (
    <>
      {open ? (
        <div
          className="fixed inset-0 z-30 bg-overlay md:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      ) : null}

      <aside
        aria-label={t('nav.workspaces')}
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-[240px] shrink-0 flex-col',
          'border-r border-border bg-surface motion-safe-150',
          'md:static md:h-full md:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-12 items-center gap-2 border-b border-border px-3">
          <span className="flex h-6 w-6 items-center justify-center rounded-control bg-accent text-fg-inverse">
            <Icon name="check" size={13} strokeWidth={2.5} />
          </span>
          <span className="text-card-title font-semibold">
            {t('common.appName')}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('nav.closeMenu')}
            className="ml-auto rounded-control p-1 text-fg-muted hover:bg-surface-muted md:hidden"
          >
            <Icon name="close" size={14} />
          </button>
        </div>

        <div className="p-3">
          <Button
            block
            variant="secondary"
            size="md"
            iconLeft={<Icon name="plus" size={14} />}
            onClick={() => setModalOpen(true)}
          >
            {t('nav.newWorkspace')}
          </Button>
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          <p className="px-2 py-1 text-meta text-fg-subtle">
            {t('workspace.listHeading')}
          </p>

          {workspacesQuery.isPending ? (
            <div className="flex items-center gap-2 px-2 py-2 text-meta text-fg-subtle">
              <Spinner size={12} />
              {t('common.loading')}
            </div>
          ) : null}

          {workspaces.map((workspace) => (
            <NavLink
              key={workspace.id}
              to={`/w/${workspace.id}`}
              onClick={onClose}
              className={({ isActive }) =>
                cn(
                  'group flex items-center gap-2 rounded-control px-2 py-1.5',
                  'text-secondary motion-safe-150',
                  isActive
                    ? 'bg-surface-muted font-medium text-fg'
                    : 'text-fg-muted hover:bg-surface-muted hover:text-fg',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    aria-hidden="true"
                    className={cn(
                      'h-1.5 w-1.5 shrink-0 rounded-pill',
                      isActive
                        ? 'bg-fg'
                        : 'border border-fg-subtle bg-transparent',
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {workspace.name}
                  </span>
                  {workspace.stats.overdue > 0 ? (
                    <Tooltip
                      label={t('workspace.overdueBadge', {
                        total: workspace.stats.overdue,
                      })}
                    >
                      <span className="text-meta text-fg-muted">⌛</span>
                    </Tooltip>
                  ) : null}
                  {workspace.stats.todo > 0 ? (
                    <Badge variant={isActive ? 'solid' : 'muted'}>
                      {workspace.stats.todo}
                    </Badge>
                  ) : null}
                </>
              )}
            </NavLink>
          ))}

          {!workspacesQuery.isPending && workspaces.length === 0 ? (
            <p className="px-2 py-2 text-meta text-fg-subtle">
              {t('workspace.empty')}
            </p>
          ) : null}
        </nav>

        <div className="border-t border-border p-2">
          <NavLink
            to="/settings"
            onClick={onClose}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2 rounded-control px-2 py-1.5 text-secondary motion-safe-150',
                isActive
                  ? 'bg-surface-muted font-medium text-fg'
                  : 'text-fg-muted hover:bg-surface-muted hover:text-fg',
              )
            }
          >
            <Icon name="settings" size={14} />
            {t('nav.settings')}
          </NavLink>
        </div>
      </aside>

      <WorkspaceFormModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  );
}
