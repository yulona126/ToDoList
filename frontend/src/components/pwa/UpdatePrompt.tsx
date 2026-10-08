import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';

/**
 * `registerType: 'autoUpdate'` installs the new worker silently; the prompt only
 * asks the user to reload so the freshly precached shell is picked up
 * (architecture §8.4).
 */
export function UpdatePrompt() {
  const { t } = useTranslation();
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  if (!needRefresh) return null;

  return (
    <div className="mb-4 flex items-start gap-3 rounded-card border border-border bg-surface px-3 py-2.5">
      <Icon name="refresh" size={16} className="mt-0.5 text-fg-muted" />
      <div className="min-w-0 flex-1">
        <p className="text-secondary font-medium text-fg">
          {t('pwa.updateTitle')}
        </p>
        <p className="text-meta text-fg-muted">{t('pwa.updateBody')}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button
          size="sm"
          variant="primary"
          onClick={() => {
            void updateServiceWorker(true);
          }}
        >
          {t('pwa.updateAction')}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setNeedRefresh(false)}>
          {t('common.dismiss')}
        </Button>
      </div>
    </div>
  );
}

/**
 * Offline read-only notice. V1 has no offline write queue (architecture §2.2),
 * so writes will fail loudly — this banner explains why the app still works.
 */
export function OfflineNotice() {
  const { t } = useTranslation();
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );

  useEffect(() => {
    const goOnline = (): void => setOnline(true);
    const goOffline = (): void => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  if (online) return null;

  return (
    <div
      role="status"
      className="mb-4 flex items-center gap-2 rounded-card border border-border bg-surface-muted px-3 py-2 text-meta text-fg-muted"
    >
      <Icon name="alert" size={14} />
      {t('pwa.offline')}
    </div>
  );
}
