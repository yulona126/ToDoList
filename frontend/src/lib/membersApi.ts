import { api } from './api';
import type {
  ID,
  InvitePreview,
  WorkspaceInvite,
  WorkspaceMember,
  WorkspaceRole,
} from '../types';

export async function fetchMembers(workspaceId: ID): Promise<WorkspaceMember[]> {
  const { data } = await api.get<{ results: WorkspaceMember[] } | WorkspaceMember[]>(
    `/workspaces/${workspaceId}/members/`,
  );
  return Array.isArray(data) ? data : data.results;
}

export async function addMember(
  workspaceId: ID,
  payload: { email: string; role: WorkspaceRole },
): Promise<WorkspaceMember> {
  const { data } = await api.post<WorkspaceMember>(
    `/workspaces/${workspaceId}/members/`,
    payload,
  );
  return data;
}

export async function updateMemberRole(
  workspaceId: ID,
  userId: ID,
  role: WorkspaceRole,
): Promise<WorkspaceMember> {
  const { data } = await api.patch<WorkspaceMember>(
    `/workspaces/${workspaceId}/members/${userId}/`,
    { role },
  );
  return data;
}

export async function removeMember(workspaceId: ID, userId: ID): Promise<void> {
  await api.delete(`/workspaces/${workspaceId}/members/${userId}/`);
}

export async function fetchInvites(workspaceId: ID): Promise<WorkspaceInvite[]> {
  const { data } = await api.get<WorkspaceInvite[]>(
    `/workspaces/${workspaceId}/invites/`,
  );
  return data;
}

export async function createInvite(
  workspaceId: ID,
  role: WorkspaceRole,
): Promise<WorkspaceInvite> {
  const { data } = await api.post<WorkspaceInvite>(
    `/workspaces/${workspaceId}/invites/`,
    { role },
  );
  return data;
}

export async function revokeInvite(workspaceId: ID, token: string): Promise<void> {
  await api.delete(`/workspaces/${workspaceId}/invites/${token}/`);
}

/** Public: no auth required, so it uses a bare axios call. */
export async function fetchInvitePreview(token: string): Promise<InvitePreview> {
  const { data } = await api.get<InvitePreview>(`/invites/${token}/`);
  return data;
}

export async function acceptInvite(
  token: string,
): Promise<{ workspace: ID; workspace_name: string; role: WorkspaceRole }> {
  const { data } = await api.post<{
    workspace: ID;
    workspace_name: string;
    role: WorkspaceRole;
  }>(`/invites/${token}/accept/`);
  return data;
}
