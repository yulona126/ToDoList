import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { useWorkspaces } from '../../hooks/useWorkspaces';
import { workspaceIdFromPath } from '../../lib/utils';
import { DropdownMenu, type DropdownMenuItem } from '../ui/DropdownMenu';
import { Icon } from '../ui/Icon';
import { WorkspaceFormModal } from './WorkspaceFormModal';

/**
 * Workspace switcher in the Topbar: current name + a menu with every workspace,
 * the active one marked with a check (monochrome, per design-system §2).
 */
export function WorkspaceSwitcher() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [modalOpen, setModalOpen] = useState(false);
  const workspacesQuery = useWorkspaces();

  const currentId = workspaceIdFromPath(location.pathname);
  const workspaces = workspacesQuery.data?.results ?? [];
  const current = workspaces.find((workspace) => workspace.id === currentId);

  const items: DropdownMenuItem[] = [
    ...workspaces.map<DropdownMenuItem>((workspace) => ({
      id: `workspace-${workspace.id}`,
      label: workspace.name,
      icon: workspace.id === currentId ? 'check' : 'inbox',
      onSelect: () => navigate(`/w/${workspace.id}`),
    })),
    {
      id: 'new-workspace',
      label: t('workspace.new'),
      icon: 'plus',
      separatorBefore: workspaces.length > 0,
      onSelect: () => setModalOpen(true),
    },
  ];

  return (
    <>
      <DropdownMenu
        align="start"
        triggerLabel={t('workspace.switchLabel')}
        items={items}
        triggerClassName="max-w-[180px] gap-1 px-1.5 py-1 hover:bg-surface-muted"
        trigger={
          <>
            <span className="truncate text-body font-medium text-fg">
              {current?.name ?? t('workspace.title')}
            </span>
            <Icon name="chevron-down" size={12} />
          </>
        }
      />

      <WorkspaceFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
      />
    </>
  );
}
