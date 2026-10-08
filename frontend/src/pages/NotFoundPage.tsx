import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';

export function NotFoundPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg">
      <EmptyState
        icon="compass"
        title={t('pages.notFoundTitle')}
        description={t('pages.notFoundBody')}
        action={
          <Button variant="primary" onClick={() => navigate('/')}>
            {t('pages.notFoundAction')}
          </Button>
        }
      />
    </div>
  );
}
