import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type {
  ArchitectureDiagram,
  ArchitectureUpdatePayload,
} from '../types';
import { queryKeys } from './queryKeys';

export function useArchitecture(workspaceId: number) {
  return useQuery({
    queryKey: queryKeys.architecture.detail(workspaceId),
    enabled: Number.isFinite(workspaceId) && workspaceId > 0,
    queryFn: async ({ signal }) => {
      const { data } = await api.get<ArchitectureDiagram>(
        `/workspaces/${workspaceId}/architecture/`,
        { signal },
      );
      return data;
    },
  });
}

export function useUpdateArchitecture() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({
      workspaceId,
      payload,
    }: {
      workspaceId: number;
      payload: ArchitectureUpdatePayload;
    }) => {
      const { data } = await api.put<ArchitectureDiagram>(
        `/workspaces/${workspaceId}/architecture/`,
        payload,
      );
      return data;
    },
    onSuccess: (data) => {
      client.setQueryData(
        queryKeys.architecture.detail(data.workspace),
        data,
      );
    },
  });
}

export function useUploadArchitectureImage() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({
      workspaceId,
      file,
    }: {
      workspaceId: number;
      file: File;
    }) => {
      const body = new FormData();
      body.append('image', file);
      // Let the browser set multipart boundary; do not force Content-Type.
      const { data } = await api.post<ArchitectureDiagram>(
        `/workspaces/${workspaceId}/architecture/image/`,
        body,
      );
      return data;
    },
    onSuccess: (data) => {
      client.setQueryData(
        queryKeys.architecture.detail(data.workspace),
        data,
      );
    },
  });
}

export function useDeleteArchitectureImage() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (workspaceId: number) => {
      const { data } = await api.delete<ArchitectureDiagram>(
        `/workspaces/${workspaceId}/architecture/image/`,
      );
      return { workspaceId, data };
    },
    onSuccess: ({ workspaceId, data }) => {
      client.setQueryData(queryKeys.architecture.detail(workspaceId), data);
    },
  });
}

export function useDeleteArchitecture() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (workspaceId: number) => {
      await api.delete(`/workspaces/${workspaceId}/architecture/`);
      return workspaceId;
    },
    onSuccess: (workspaceId) => {
      client.setQueryData(queryKeys.architecture.detail(workspaceId), {
        workspace: workspaceId,
        title: '',
        mermaid: '',
        image_url: null,
        preferred: 'mermaid' as const,
        has_content: false,
        created_at: null,
        updated_at: null,
      });
    },
  });
}
