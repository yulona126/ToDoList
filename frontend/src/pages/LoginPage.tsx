import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { AuthCard } from '../components/auth/AuthCard';
import { AlertBanner } from '../components/auth/AlertBanner';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { fieldError, toApiError, type ApiError } from '../lib/api';
import { useAuth } from '../stores/AuthContext';

export function LoginPage() {
  const { t } = useTranslation();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [apiError, setApiError] = useState<ApiError | null>(null);
  const [pending, setPending] = useState(false);

  const validate = (): boolean => {
    const next: Record<string, string | undefined> = {};
    if (!email.trim()) next.email = t('validation.emailRequired');
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      next.email = t('validation.emailInvalid');
    }
    if (!password) next.password = t('validation.passwordRequired');
    setErrors(next);
    return Object.values(next).every((value) => value === undefined);
  };

  const submit = async (): Promise<void> => {
    if (!validate()) return;
    setPending(true);
    setApiError(null);
    try {
      await login({ email: email.trim(), password });
      // PublicOnlyRoute redirects as soon as the session exists.
    } catch (caught) {
      const normalized = toApiError(caught);
      setApiError(normalized);
      setErrors({
        email: fieldError(normalized, 'email'),
        password: fieldError(normalized, 'password'),
      });
    } finally {
      setPending(false);
    }
  };

  return (
    <AuthCard
      title={t('auth.loginTitle')}
      subtitle={t('auth.loginSubtitle')}
      footer={
        <>
          {t('auth.noAccount')}{' '}
          <Link to="/register" className="text-fg underline underline-offset-2">
            {t('auth.goRegister')}
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
          type="password"
          label={t('auth.password')}
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={errors.password}
        />

        {apiError && !errors.email && !errors.password ? (
          <AlertBanner message={apiError.detail} />
        ) : null}

        <Button
          type="submit"
          variant="primary"
          size="lg"
          block
          loading={pending}
          className="mt-1"
        >
          {pending ? t('auth.signingIn') : t('auth.signIn')}
        </Button>
      </form>
    </AuthCard>
  );
}
