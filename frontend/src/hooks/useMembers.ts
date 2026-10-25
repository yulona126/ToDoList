import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  acceptInvite,
  addMember,
  createInvite,
  fetchInvites,
  fetchInvitePreview,
  fetchMembers,
  removeMember,
  revokeInvite,
  updateMemberRole,
} from '../lib/membersApi';
import { queryKeys } from './queryKeys';
import type { ID, WorkspaceRole } from '../types';

export function useMembers(workspaceId: ID) {
  return useQuery({
    queryKey: queryKeys.members.list(workspaceId),
    queryFn: () => fetchMembers(workspaceId),
    enabled: Number.isFinite(workspaceId) && workspaceId > 0,
  });
}

export function useInvites(workspaceId: ID) {
  return useQuery({
    queryKey: queryKeys.members.invites(workspaceId),
    queryFn: () => fetchInvites(workspaceId),
    enabled: Number.isFinite(workspaceId) && workspaceId > 0,
  });
}

/** Changing the roster can also change what the caller may do, so workspaces refresh too. */
function refreshRoster(client: ReturnType<typeof useQueryClient>, workspaceId: ID) {
  void client.invalidateQueries({ queryKey: queryKeys.members.list(workspaceId) });
  void client.invalidateQueries({ queryKey: queryKeys.members.invites(workspaceId) });
  void client.invalidateQueries({ queryKey: queryKeys.workspaces.all });
  // Assignee pickers read from the member list; unassignment happens server-side.
  void client.invalidateQueries({ queryKey: queryKeys.tasks.listPrefix });
}

export function useAddMember(workspaceId: ID) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: { email: string; role: WorkspaceRole }) =>
      addMember(workspaceId, payload),
    onSuccess: () => refreshRoster(client, workspaceId),
  });
}

export function useUpdateMemberRole(workspaceId: ID) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: { userId: ID; role: WorkspaceRole }) =>
      updateMemberRole(workspaceId, payload.userId, payload.role),
    onSuccess: () => refreshRoster(client, workspaceId),
  });
}

export function useRemoveMember(workspaceId: ID) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (userId: ID) => removeMember(workspaceId, userId),
    onSuccess: () => refreshRoster(client, workspaceId),
  });
}

export function useCreateInvite(workspaceId: ID) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (role: WorkspaceRole) => createInvite(workspaceId, role),
    onSuccess: () =>
      void client.invalidateQueries({ queryKey: queryKeys.members.invites(workspaceId) }),
  });
}

export function useRevokeInvite(workspaceId: ID) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (token: string) => revokeInvite(workspaceId, token),
    onSuccess: () =>
      void client.invalidateQueries({ queryKey: queryKeys.members.invites(workspaceId) }),
  });
}

export function useInvitePreview(token: string) {
  return useQuery({
    queryKey: queryKeys.members.preview(token),
    queryFn: () => fetchInvitePreview(token),
    enabled: Boolean(token),
    retry: false,
  });
}

export function useAcceptInvite(token: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => acceptInvite(token),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.workspaces.all });
    },
  });
}
