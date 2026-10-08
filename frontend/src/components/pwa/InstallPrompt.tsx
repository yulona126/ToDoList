import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { STORAGE_KEYS } from '../../lib/constants';
import { Icon } from '../ui/Icon';
import { Button } from '../ui/Button';

/** Chrome-only event (not in lib.dom); typed locally instead of reaching for any. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

function isInstallPromptEvent(event: Event): event is BeforeInstallPromptEvent {
  return (
    'prompt' in event &&
    typeof (event as { prompt?: unknown }).prompt === 'function'
  );
}

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEYS.installDismissed) === '1';
  } catch {
    return false;
  }
}

/**
 * `beforeinstallprompt` banner: dismissible, and the dismissal is persisted so
 * the app never nags twice.
 */
export function InstallPrompt() {
  const { t } = useTranslation();
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(
    null,
  );
  const [dismissed, setDismissed] = useState(readDismissed);

  useEffect(() => {
    const handlePrompt = (event: Event): void => {
      event.preventDefault();
      if (isInstallPromptEvent(event)) setDeferred(event);
    };
    const handleInstalled = (): void => {
      setDeferred(null);
      setDismissed(true);
      try {
        window.localStorage.setItem(STORAGE_KEYS.installDismissed, '1');
      } catch {
        /* storage unavailable — the banner simply reappears next session */
      }
    };

    window.addEventListener('beforeinstallprompt', handlePrompt);
    window.addEventListener('appinstalled', handleInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handlePrompt);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, []);

  if (!deferred || dismissed) return null;

  const dismiss = (): void => {
    setDismissed(true);
    try {
      window.localStorage.setItem(STORAGE_KEYS.installDismissed, '1');
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="mb-4 flex items-start gap-3 rounded-card border border-border bg-surface px-3 py-2.5">
      <Icon name="download" size={16} className="mt-0.5 text-fg-muted" />
      <div className="min-w-0 flex-1">
        <p className="text-secondary font-medium text-fg">
          {t('pwa.installTitle')}
        </p>
        <p className="text-meta text-fg-muted">{t('pwa.installBody')}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button
          size="sm"
          variant="primary"
          onClick={() => {
            void deferred.prompt();
            void deferred.userChoice.then(() => setDeferred(null));
          }}
        >
          {t('pwa.installAction')}
        </Button>
        <Button size="sm" variant="ghost" onClick={dismiss}>
          {t('pwa.installLater')}
        </Button>
      </div>
    </div>
  );
}
