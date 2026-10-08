import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AiSettingsSection } from '../components/ai/AiSettingsSection';
import { AlertBanner } from '../components/auth/AlertBanner';
import { ApiTokensSection } from '../components/settings/ApiTokensSection';
import { Button } from '../components/ui/Button';
import { Icon } from '../components/ui/Icon';
import { Input } from '../components/ui/Input';
import { fieldError, toApiError } from '../lib/api';
import type { Language, Theme } from '../lib/constants';
import { useAuth } from '../stores/AuthContext';
import { useUI } from '../stores/UIContext';

/** Settings — profile / password / appearance / language (architecture §8.3). */
export function SettingsPage() {
  const { t } = useTranslation();
  const { user, updateProfile, changePassword } = useAuth();
  const { theme, setTheme, language, setLanguage, push } = useUI();

  const [username, setUsername] = useState(user?.username ?? '');
  const [displayName, setDisplayName] = useState(user?.display_name ?? '');
  const [profileErrors, setProfileErrors] = useState<
    Record<string, string | undefined>
  >({});
  const [profileBanner, setProfileBanner] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);

  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('');
  const [passwordErrors, setPasswordErrors] = useState<
    Record<string, string | undefined>
  >({});
  const [passwordBanner, setPasswordBanner] = useState<string | null>(null);
  const [savingPassword, setSavingPassword] = useState(false);

  const saveProfile = async (): Promise<void> => {
    const trimmedUsername = username.trim();
    const next: Record<string, string | undefined> = {};
    if (!trimmedUsername) next.username = t('validation.usernameRequired');
    else if (trimmedUsername.length < 2 || trimmedUsername.length > 32) {
      next.username = t('validation.usernameLength');
    }
    setProfileErrors(next);
    setProfileBanner(null);
    if (Object.values(next).some((value) => value !== undefined)) return;

    setSavingProfile(true);
    try {
      await updateProfile({
        username: trimmedUsername,
        display_name: displayName.trim(),
      });
      push({ type: 'success', message: t('settings.profileSaved') });
    } catch (caught) {
      const apiError = toApiError(caught);
      setProfileBanner(apiError.detail);
      setProfileErrors({
        username: fieldError(apiError, 'username'),
        display_name: fieldError(apiError, 'display_name'),
      });
    } finally {
      setSavingProfile(false);
    }
  };

  const savePassword = async (): Promise<void> => {
    const next: Record<string, string | undefined> = {};
    if (!oldPassword) next.old_password = t('validation.oldPasswordRequired');
    if (!newPassword) next.new_password = t('validation.newPasswordRequired');
    else if (newPassword.length < 8) {
      next.new_password = t('validation.passwordTooShort');
    } else if (/^\d+$/.test(newPassword)) {
      next.new_password = t('validation.passwordNumeric');
    }
    if (newPasswordConfirm !== newPassword) {
      next.new_password_confirm = t('validation.passwordMismatch');
    }
    setPasswordErrors(next);
    setPasswordBanner(null);
    if (Object.values(next).some((value) => value !== undefined)) return;

    setSavingPassword(true);
    try {
      await changePassword({
        old_password: oldPassword,
        new_password: newPassword,
      });
      setOldPassword('');
      setNewPassword('');
      setNewPasswordConfirm('');
      push({ type: 'success', message: t('settings.passwordChanged') });
    } catch (caught) {
      const apiError = toApiError(caught);
      setPasswordBanner(apiError.detail);
      setPasswordErrors({
        old_password: fieldError(apiError, 'old_password'),
        new_password: fieldError(apiError, 'new_password'),
      });
    } finally {
      setSavingPassword(false);
    }
  };

  const themes: Array<{ value: Theme; label: string; icon: 'sun' | 'moon' }> = [
    { value: 'light', label: t('settings.themeLight'), icon: 'sun' },
    { value: 'dark', label: t('settings.themeDark'), icon: 'moon' },
  ];

  const languages: Array<{ value: Language; label: string }> = [
    { value: 'zh-CN', label: t('settings.languageZh') },
    { value: 'en-US', label: t('settings.languageEn') },
  ];

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-page-title font-semibold">{t('settings.title')}</h1>

      <Section
        title={t('settings.profile')}
        description={t('settings.profileDescription')}
      >
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void saveProfile();
          }}
        >
          <Input
            label={t('auth.email')}
            value={user?.email ?? ''}
            disabled
            hint={t('settings.emailHelp')}
          />
          <Input
            label={t('auth.username')}
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            error={profileErrors.username}
            autoComplete="username"
          />
          <Input
            label={t('settings.displayName')}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder={t('settings.displayNamePlaceholder')}
            error={profileErrors.display_name}
          />
          {profileBanner ? <AlertBanner message={profileBanner} /> : null}
          <div className="flex justify-end">
            <Button
              type="submit"
              variant="primary"
              loading={savingProfile}
            >
              {t('settings.saveProfile')}
            </Button>
          </div>
        </form>
      </Section>

      <Section
        title={t('settings.password')}
        description={t('settings.passwordDescription')}
      >
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void savePassword();
          }}
        >
          <Input
            type="password"
            label={t('settings.oldPassword')}
            value={oldPassword}
            onChange={(event) => setOldPassword(event.target.value)}
            error={passwordErrors.old_password}
            autoComplete="current-password"
          />
          <Input
            type="password"
            label={t('settings.newPassword')}
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            error={passwordErrors.new_password}
            hint={t('auth.passwordHint')}
            autoComplete="new-password"
          />
          <Input
            type="password"
            label={t('settings.newPasswordConfirm')}
            value={newPasswordConfirm}
            onChange={(event) => setNewPasswordConfirm(event.target.value)}
            error={passwordErrors.new_password_confirm}
            autoComplete="new-password"
          />
          {passwordBanner ? <AlertBanner message={passwordBanner} /> : null}
          <div className="flex justify-end">
            <Button
              type="submit"
              variant="primary"
              loading={savingPassword}
            >
              {t('settings.changePassword')}
            </Button>
          </div>
        </form>
      </Section>

      <Section
        title={t('settings.appearance')}
        description={t('settings.appearanceDescription')}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-secondary text-fg-muted">
            {t('settings.theme')}
          </span>
          {themes.map((option) => (
            <Button
              key={option.value}
              variant={theme === option.value ? 'primary' : 'secondary'}
              aria-pressed={theme === option.value}
              iconLeft={<Icon name={option.icon} size={14} />}
              onClick={() => setTheme(option.value)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </Section>

      <Section
        title={t('settings.language')}
        description={t('settings.languageDescription')}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-secondary text-fg-muted">
            {t('settings.language')}
          </span>
          {languages.map((option) => (
            <Button
              key={option.value}
              variant={language === option.value ? 'primary' : 'secondary'}
              aria-pressed={language === option.value}
              iconLeft={<Icon name="globe" size={14} />}
              onClick={() => setLanguage(option.value)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </Section>

      <AiSettingsSection />

      <ApiTokensSection />
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-card border border-border bg-surface p-4">
      <h2 className="text-card-title font-semibold text-fg">{title}</h2>
      <p className="mt-0.5 mb-3 text-secondary text-fg-muted">{description}</p>
      {children}
    </section>
  );
}
