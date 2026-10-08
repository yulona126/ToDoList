import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { AlertBanner } from '../components/auth/AlertBanner';
import { AuthCard } from '../components/auth/AuthCard';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { fieldError, toApiError, type ApiError } from '../lib/api';
import { useAuth } from '../stores/AuthContext';

/** Client-side mirror of the register rules in api.md §1. */
export function RegisterPage() {
  const { t } = useTranslation();
  const { register } = useAuth();
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [apiError, setApiError] = useState<ApiError | null>(null);
  const [pending, setPending] = useState(false);

  const validate = (): boolean => {
    const next: Record<string, string | undefined> = {};

    const trimmedEmail = email.trim();
    if (!trimmedEmail) next.email = t('validation.emailRequired');
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      next.email = t('validation.emailInvalid');
    }

    const trimmedUsername = username.trim();
    if (!trimmedUsername) next.username = t('validation.usernameRequired');
    else if (trimmedUsername.length < 2 || trimmedUsername.length > 32) {
      next.username = t('validation.usernameLength');
    }

    if (!password) next.password = t('validation.passwordRequired');
    else if (password.length < 8) next.password = t('validation.passwordTooShort');
    else if (/^\d+$/.test(password)) next.password = t('validation.passwordNumeric');

    if (!passwordConfirm) {
      next.password_confirm = t('validation.passwordConfirmRequired');
    } else if (passwordConfirm !== password) {
      next.password_confirm = t('validation.passwordMismatch');
    }

    setErrors(next);
    return Object.values(next).every((value) => value === undefined);
  };

  const submit = async (): Promise<void> => {
    if (!validate()) return;
    setPending(true);
    setApiError(null);
    try {
      await register({
        email: email.trim(),
        username: username.trim(),
        password,
        password_confirm: passwordConfirm,
      });
    } catch (caught) {
      const normalized = toApiError(caught);
      setApiError(normalized);
      setErrors({
        email: fieldError(normalized, 'email'),
        username: fieldError(normalized, 'username'),
        password: fieldError(normalized, 'password'),
        password_confirm: fieldError(normalized, 'password_confirm'),
      });
    } finally {
      setPending(false);
    }
  };

  return (
    <AuthCard
      title={t('auth.registerTitle')}
      subtitle={t('auth.registerSubtitle')}
      footer={
        <>
          {t('auth.hasAccount')}{' '}
          <Link to="/login" className="text-fg underline underline-offset-2">
            {t('auth.goLogin')}
          </Link>
        </>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        noValidate
      >
        <Input
          type="email"
          label={t('auth.email')}
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={errors.email}
          data-autofocus
        />
        <Input
          label={t('auth.username')}
          autoComplete="username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          error={errors.username}
        />
        <Input
          type="password"
          label={t('auth.password')}
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={errors.password}
          hint={t('auth.passwordHint')}
        />
        <Input
          type="password"
          label={t('auth.passwordConfirm')}
          autoComplete="new-password"
          value={passwordConfirm}
          onChange={(event) => setPasswordConfirm(event.target.value)}
          error={errors.password_confirm}
        />

        {apiError ? <AlertBanner message={apiError.detail} /> : null}

        <Button
          type="submit"
          variant="primary"
          size="lg"
          block
          loading={pending}
          className="mt-1"
        >
          {pending ? t('auth.signingUp') : t('auth.signUp')}
        </Button>
      </form>
    </AuthCard>
  );
}
