import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAcceptInvite, useInvitePreview } from '../hooks/useMembers';
import { useAuth } from '../stores/AuthContext';
import { useUI } from '../stores/UIContext';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Icon } from '../components/ui/Icon';
import { Spinner } from '../components/ui/Spinner';

/**
 * `/join/:token` — the page an invite link opens.
 *
 * Deliberately outside both route guards. Someone who has never used the app
 * gets this link; making them sign up before they can see *who* is inviting them
 * to *what* is the fastest way to have the invite abandoned. So the preview is
 * public, and the account is only required at the moment of joining.
 */
export function JoinPage() {
  const { token = '' } = useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { isAuthenticated, user } = useAuth();
  const { push } = useUI();
  const preview = useInvitePreview(token);
  const accept = useAcceptInvite(token);

  /* A successful join lands the invitee in the workspace they just joined,
     rather than on a generic home page. */
  useEffect(() => {
    if (accept.data) {
      const id = accept.data.workspace;
      const timer = window.setTimeout(() => navigate(`/w/${id}`, { replace: true }), 900);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [accept.data, navigate]);

  const backTo = `/join/${token}`;

  if (preview.isPending) {
    return (
      <Shell>
        <div className="flex justify-center py-10 text-fg-subtle" role="status">
          <Spinner size={18} />
        </div>
      </Shell>
    );
  }

  if (preview.isError || !preview.data) {
    return (
      <Shell>
        <StateBlock
          title={t('join.invalidTitle')}
          body={t('join.invalidBody')}
          action={
            <Button variant="secondary" onClick={() => navigate('/')}>
              {t('join.goHome')}
            </Button>
          }
        />
      </Shell>
    );
  }

  const invite = preview.data;
  const unusable = !invite.is_usable;

  return (
    <Shell>
      <div className="flex flex-col gap-4">
        <div>
          <p className="eyebrow text-fg-subtle">{t('join.invitedTo')}</p>
          <h1 className="mt-1 text-page-title font-semibold text-fg">
            {invite.workspace_name}
          </h1>
          {invite.workspace_description ? (
            <p className="mt-1 text-body text-fg-muted">{invite.workspace_description}</p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-meta text-fg-muted">
          {/* Localised from the role key, not the server's English label. */}
          <Badge variant="muted">{t(`members.role.${invite.role}`)}</Badge>
          {invite.invited_by ? (
            <span>{t('join.invitedBy', { name: invite.invited_by })}</span>
          ) : null}
        </div>

        {accept.data ? (
          <StateBlock
            title={t('join.joinedTitle', { name: invite.workspace_name })}
            body={t('join.joinedBody')}
          />
        ) : unusable ? (
          <StateBlock
            title={t('join.unusableTitle')}
            body={t(`join.status.${invite.status}`)}
            action={
              <Button variant="secondary" onClick={() => navigate('/')}>
                {t('join.goHome')}
              </Button>
            }
          />
        ) : isAuthenticated ? (
          <div className="flex flex-col gap-2">
            <Button
              onClick={() =>
                accept.mutate(undefined, {
                  onError: () => push({ type: 'error', message: t('join.failed') }),
                })
              }
              disabled={accept.isPending}
            >
              {accept.isPending ? <Spinner size={13} /> : null}
              {t('join.accept', { name: invite.workspace_name })}
            </Button>
            <p className="text-meta text-fg-subtle">
              {t('join.signedInAs', { email: user?.email ?? '' })}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <Link to="/register" state={{ from: { pathname: backTo, search: '' } }}>
              <Button className="w-full">{t('join.registerAndJoin')}</Button>
            </Link>
            <Link to="/login" state={{ from: { pathname: backTo, search: '' } }}>
              <Button variant="secondary" className="w-full">
                {t('join.loginAndJoin')}
              </Button>
            </Link>
            <p className="text-meta text-fg-subtle">{t('join.accountNeeded')}</p>
          </div>
        )}
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-4 py-10">
      <div className="w-full max-w-[420px]">
        <div className="mb-6 flex items-center gap-2">
          <span className="grid size-7 place-items-center rounded-control bg-fg text-fg-inverse">
            <Icon name="check" size={15} />
          </span>
          <span className="text-card-title font-semibold text-fg">ToDoList</span>
        </div>
        <div className="rounded-card border border-border bg-surface p-5">{children}</div>
      </div>
    </main>
  );
}

function StateBlock({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 py-6 text-center">
      <Icon name="inbox" size={20} className="text-fg-subtle" />
      <p className="text-card-title font-medium text-fg">{title}</p>
      <p className="text-meta text-fg-muted">{body}</p>
      {action}
    </div>
  );
}
