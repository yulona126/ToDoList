import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCreateInvite, useInvites, useMembers, useRemoveMember, useRevokeInvite, useUpdateMemberRole } from '../../hooks/useMembers';
import { useUI } from '../../stores/UIContext';
import { cn } from '../../lib/utils';
import type { ID, WorkspaceRole } from '../../types';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { IconButton } from '../ui/IconButton';
import { Modal } from '../ui/Modal';
import { Select } from '../ui/Select';
import { Spinner } from '../ui/Spinner';
import { Tooltip } from '../ui/Tooltip';

export interface MembersPanelProps {
  open: boolean;
  workspaceId: ID;
  /** Owner/admin may manage; everyone else sees a read-only roster. */
  canManage: boolean;
  currentUserId: ID | null;
  onClose: () => void;
}

const ROLE_ORDER: WorkspaceRole[] = ['admin', 'member', 'viewer'];

/**
 * Team roster and the invite link.
 *
 * The invite is link-based and single-use: minting one is a click, and the
 * invitee does not need an account yet. That keeps the whole flow to "copy,
 * paste, done" — which is the only reason a small team will use it.
 */
export function MembersPanel({
  open,
  workspaceId,
  canManage,
  currentUserId,
  onClose,
}: MembersPanelProps) {
  const { t } = useTranslation();
  const { push } = useUI();
  const members = useMembers(workspaceId);
  const invites = useInvites(workspaceId);
  const updateRole = useUpdateMemberRole(workspaceId);
  const removeMember = useRemoveMember(workspaceId);
  const createInvite = useCreateInvite(workspaceId);
  const revokeInvite = useRevokeInvite(workspaceId);

  const [inviteRole, setInviteRole] = useState<WorkspaceRole>('member');
  const [freshToken, setFreshToken] = useState<string | null>(null);

  const roleOptions = useMemo(
    () =>
      ROLE_ORDER.map((role) => ({
        value: role,
        label: t(`members.role.${role}`),
      })),
    [t],
  );

  const pending = (invites.data ?? []).filter((row) => row.status === 'pending');
  const acceptUrl = freshToken
    ? `${window.location.origin}/join/${freshToken}`
    : '';

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      push({ type: 'success', message: t('members.linkCopied') });
    } catch {
      push({ type: 'error', message: t('members.copyFailed') });
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('members.title')}
      description={t('members.description')}
      size="lg"
    >
      <div className="flex flex-col gap-5">
        {/* ---- invite ---- */}
        {canManage ? (
          <section className="rounded-card border border-border p-3">
            <h3 className="text-meta font-medium text-fg">{t('members.inviteTitle')}</h3>
            <p className="mt-0.5 text-meta text-fg-muted">{t('members.inviteHint')}</p>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Select
                value={inviteRole}
                onChange={(event) => setInviteRole(event.target.value as WorkspaceRole)}
                options={roleOptions}
                aria-label={t('members.inviteRole')}
                className="w-[132px]"
              />
              <Button
                size="sm"
                onClick={() =>
                  createInvite.mutate(inviteRole, {
                    onSuccess: (invite) => setFreshToken(invite.token),
                    onError: () => push({ type: 'error', message: t('errors.generic') }),
                  })
                }
                disabled={createInvite.isPending}
              >
                {createInvite.isPending ? <Spinner size={12} /> : null}
                {t('members.generate')}
              </Button>
            </div>

            {freshToken ? (
              <div className="mt-2 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-control border border-border bg-surface-muted px-2 py-1 font-mono text-meta text-fg">
                  {acceptUrl}
                </code>
                <Button size="sm" variant="secondary" onClick={() => void copy(acceptUrl)}>
                  <Icon name="file" size={12} />
                  {t('common.copy')}
                </Button>
              </div>
            ) : null}

            {pending.length > 0 ? (
              <ul className="mt-3 flex flex-col gap-1">
                {pending.map((invite) => (
                  <li
                    key={invite.id}
                    className="flex items-center gap-2 text-meta text-fg-muted"
                  >
                    <Icon name="inbox" size={12} />
                    <span className="flex-1 truncate">
                      {invite.role_label} · {t('members.expiresOn', {
                        date: new Date(invite.expires_at).toLocaleDateString(),
                      })}
                    </span>
                    <button
                      type="button"
                      onClick={() => void copy(`${window.location.origin}${invite.accept_path}`)}
                      className="text-fg-muted underline-offset-2 hover:text-fg hover:underline"
                    >
                      {t('members.copyLink')}
                    </button>
                    <IconButton
                      label={t('members.revoke')}
                      size="sm"
                      onClick={() =>
                        revokeInvite.mutate(invite.token, {
                          onSuccess: () => push({ type: 'success', message: t('members.revoked') }),
                        })
                      }
                    >
                      <Icon name="close" size={12} />
                    </IconButton>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ) : null}

        {/* ---- roster ---- */}
        <section>
          {members.isPending ? (
            <div className="flex justify-center py-6 text-fg-subtle" role="status">
              <Spinner size={16} />
            </div>
          ) : (
            <ul className="flex flex-col">
              {(members.data ?? []).map((row) => {
                const isOwner = row.role === 'owner';
                const isSelf = row.user.id === currentUserId;
                return (
                  <li
                    key={row.id}
                    className="flex items-center gap-3 border-b border-border py-2 last:border-b-0"
                  >
                    <Avatar name={row.user.name || row.user.email} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-body text-fg">
                        {row.user.name || row.user.username}
                        {isSelf ? (
                          <span className="ml-1.5 text-meta text-fg-subtle">
                            {t('members.you')}
                          </span>
                        ) : null}
                      </p>
                      <p className="truncate text-meta text-fg-muted">{row.user.email}</p>
                    </div>

                    {isOwner || !canManage || isSelf ? (
                      <Badge variant="muted">{t(`members.role.${row.role}`)}</Badge>
                    ) : (
                      <Select
                        value={row.role}
                        onChange={(event) =>
                          updateRole.mutate(
                            {
                              userId: row.user.id,
                              role: event.target.value as WorkspaceRole,
                            },
                            { onError: () => push({ type: 'error', message: t('errors.generic') }) },
                          )
                        }
                        options={roleOptions}
                        aria-label={t('members.roleOf', { name: row.user.name })}
                        className="w-[116px]"
                      />
                    )}

                    {canManage && !isOwner && !isSelf ? (
                      <Tooltip label={t('members.remove')}>
                        <IconButton
                          label={t('members.remove')}
                          size="sm"
                          onClick={() =>
                            removeMember.mutate(row.user.id, {
                              onSuccess: () =>
                                push({
                                  type: 'success',
                                  message: t('members.removed', { name: row.user.name }),
                                }),
                              onError: () =>
                                push({ type: 'error', message: t('errors.generic') }),
                            })
                          }
                        >
                          <Icon name="close" size={13} />
                        </IconButton>
                      </Tooltip>
                    ) : (
                      <span className="w-6" aria-hidden="true" />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <p className="text-meta text-fg-subtle">{t('members.roleHint')}</p>
      </div>
    </Modal>
  );
}

function Avatar({ name }: { name: string }) {
  const initials = name
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid size-8 shrink-0 place-items-center rounded-pill border border-border',
        'text-meta font-medium text-fg-muted',
      )}
    >
      {initials || '?'}
    </span>
  );
}
