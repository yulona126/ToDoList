import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { toApiError } from '../../lib/api';
import { focusIfVisible, registerSearchFocusHandler } from '../../lib/focusBus';
import { cn, getInitials, workspaceIdFromPath } from '../../lib/utils';
import { useAuth } from '../../stores/AuthContext';
import { useUI } from '../../stores/UIContext';
import { Button } from '../ui/Button';
import { DropdownMenu, type DropdownMenuItem } from '../ui/DropdownMenu';
import { Icon } from '../ui/Icon';
import { IconButton } from '../ui/IconButton';
import { Input } from '../ui/Input';
import { WorkspaceSwitcher } from '../workspace/WorkspaceSwitcher';

export interface TopbarProps {
  onOpenSidebar: () => void;
}

export function Topbar({ onOpenSidebar }: TopbarProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const { theme, toggleTheme, language, toggleLanguage, push } = useUI();
  const { user, logout } = useAuth();

  const inWorkspace = workspaceIdFromPath(location.pathname) !== null;
  const search = searchParams.get('q') ?? '';

  /* `/` focuses this input — see lib/focusBus.ts. The compact search in the
     filter bar registers too; only the visible one wins. */
  useEffect(
    () =>
      registerSearchFocusHandler(() => focusIfVisible(searchInputRef.current)),
    [],
  );

  const updateSearch = (value: string): void => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set('q', value);
    else next.delete('q');
    setSearchParams(next, { replace: true });
  };

  const handleLogout = async (): Promise<void> => {
    try {
      await logout();
    } catch (error) {
      // The local session is already cleared; just report the server failure.
      push({ type: 'error', message: toApiError(error).detail });
    }
  };

  const menuItems: DropdownMenuItem[] = [
    {
      id: 'settings',
      label: t('nav.settings'),
      icon: 'settings',
      onSelect: () => navigate('/settings'),
    },
    {
      id: 'logout',
      label: t('nav.signOut'),
      icon: 'logout',
      separatorBefore: true,
      onSelect: () => {
        void handleLogout();
      },
    },
  ];

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-bg px-3 md:px-6">
      <IconButton
        label={t('nav.openMenu')}
        onClick={onOpenSidebar}
        className="md:hidden"
      >
        <Icon name="menu" size={16} />
      </IconButton>

      <WorkspaceSwitcher />

      {inWorkspace ? (
        <div className="mx-1 hidden min-w-0 flex-1 justify-end sm:flex">
          <Input
            ref={searchInputRef}
            type="search"
            value={search}
            onChange={(event) => updateSearch(event.target.value)}
            placeholder={t('nav.searchPlaceholder')}
            aria-label={t('common.search')}
            containerClassName="max-w-[280px]"
            leadingIcon={<Icon name="search" size={14} />}
          />
        </div>
      ) : (
        <div className="flex-1" />
      )}

      <div className="ml-auto flex items-center gap-1">
        <IconButton label={t('nav.toggleTheme')} onClick={toggleTheme}>
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16} />
        </IconButton>

        <Button
          variant="ghost"
          size="sm"
          onClick={toggleLanguage}
          aria-label={t('nav.toggleLanguage')}
          title={t('nav.toggleLanguage')}
          iconLeft={<Icon name="globe" size={14} />}
          className="px-1.5"
        >
          {language === 'zh-CN' ? 'EN' : '中'}
        </Button>

        <DropdownMenu
          triggerLabel={t('nav.userMenu')}
          items={menuItems}
          trigger={
            <span
              className={cn(
                'flex h-6 w-6 items-center justify-center rounded-pill',
                'border border-border bg-surface-muted text-meta font-medium text-fg',
              )}
            >
              {getInitials(user?.name ?? '?')}
            </span>
          }
          triggerClassName="ml-1 p-0.5"
        />
      </div>
    </header>
  );
}
