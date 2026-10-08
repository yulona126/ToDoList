import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import {
  buildWorkspaceParams,
  normalizeWorkspaceParams,
} from '../lib/queryParams';
import type {
  Paginated,
  Workspace,
  WorkspaceCreatePayload,
  WorkspaceQueryParams,
  WorkspaceUpdatePayload,
} from '../types';
import { queryKeys } from './queryKeys';

/** `GET /workspaces/` — the sidebar list, `stats.todo` drives the badge. */
export function useWorkspaces(params: WorkspaceQueryParams = {}) {
  const normalized = normalizeWorkspaceParams(params);
  return useQuery({
    queryKey: queryKeys.workspaces.list(normalized),
    queryFn: async ({ signal }) => {
      const { data } = await api.get<Paginated<Workspace>>('/workspaces/', {
        params: buildWorkspaceParams(normalized),
        signal,
      });
      return data;
    },
  });
}

/** `GET /workspaces/{id}/` */
export function useWorkspace(id: number) {
  return useQuery({
    queryKey: queryKeys.workspaces.detail(id),
    enabled: Number.isFinite(id) && id > 0,
    queryFn: async ({ signal }) => {
      const { data } = await api.get<Workspace>(`/workspaces/${id}/`, {
        signal,
      });
      return data;
    },
  });
}

export function useCreateWorkspace() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (payload: WorkspaceCreatePayload) => {
      const { data } = await api.post<Workspace>('/workspaces/', payload);
      return data;
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.workspaces.all });
    },
  });
}

export function useUpdateWorkspace() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      payload,
    }: {
      id: number;
      payload: WorkspaceUpdatePayload;
    }) => {
      const { data } = await api.patch<Workspace>(
        `/workspaces/${id}/`,
        payload,
      );
      return data;
    },
    onSuccess: (workspace) => {
      client.setQueryData(queryKeys.workspaces.detail(workspace.id), workspace);
      void client.invalidateQueries({ queryKey: queryKeys.workspaces.all });
    },
  });
}

export function useDeleteWorkspace() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await api.delete(`/workspaces/${id}/`);
      return id;
    },
    onSuccess: (id) => {
      client.removeQueries({ queryKey: queryKeys.workspaces.detail(id) });
      void client.invalidateQueries({ queryKey: queryKeys.workspaces.all });
      void client.invalidateQueries({ queryKey: queryKeys.lists.all });
      void client.invalidateQueries({ queryKey: queryKeys.tasks.all });
      void client.invalidateQueries({ queryKey: queryKeys.tags.all });
    },
  });
}
