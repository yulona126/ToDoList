import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import {
  buildDocumentParams,
  normalizeDocumentParams,
} from '../lib/queryParams';
import type {
  Document,
  DocumentCreatePayload,
  DocumentQueryParams,
  DocumentUpdatePayload,
  Paginated,
} from '../types';
import { queryKeys } from './queryKeys';

/** `GET /documents/?workspace={id}` — workspace Markdown documents. */
export function useDocuments(
  workspaceId: number,
  params: Omit<DocumentQueryParams, 'workspace'> = {},
) {
  const normalized = normalizeDocumentParams({
    ...params,
    workspace: workspaceId,
  });
  return useQuery({
    queryKey: queryKeys.documents.list(normalized),
    enabled: Number.isFinite(workspaceId) && workspaceId > 0,
    queryFn: async ({ signal }) => {
      const { data } = await api.get<Paginated<Document>>('/documents/', {
        params: buildDocumentParams(normalized),
        signal,
      });
      return data;
    },
  });
}

export function useDocument(id: number) {
  return useQuery({
    queryKey: queryKeys.documents.detail(id),
    enabled: Number.isFinite(id) && id > 0,
    queryFn: async ({ signal }) => {
      const { data } = await api.get<Document>(`/documents/${id}/`, { signal });
      return data;
    },
  });
}

export function useCreateDocument() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (payload: DocumentCreatePayload) => {
      const { data } = await api.post<Document>('/documents/', payload);
      return data;
    },
    onSuccess: (doc) => {
      void client.invalidateQueries({ queryKey: queryKeys.documents.all });
      client.setQueryData(queryKeys.documents.detail(doc.id), doc);
    },
  });
}

export function useUpdateDocument() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      payload,
    }: {
      id: number;
      payload: DocumentUpdatePayload;
    }) => {
      const { data } = await api.patch<Document>(`/documents/${id}/`, payload);
      return data;
    },
    onSuccess: (doc) => {
      void client.invalidateQueries({ queryKey: queryKeys.documents.all });
      client.setQueryData(queryKeys.documents.detail(doc.id), doc);
    },
  });
}

export function useDeleteDocument() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await api.delete(`/documents/${id}/`);
      return id;
    },
    onSuccess: (id) => {
      void client.invalidateQueries({ queryKey: queryKeys.documents.all });
      client.removeQueries({ queryKey: queryKeys.documents.detail(id) });
    },
  });
}
