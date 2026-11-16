import { auth } from '../firebase';
import type {
  BookmarkItem,
  CategoryItem,
  QuickShortcutItem,
  SharedCategoryRecord,
  UserSettings,
} from '../types';
import type { ChromeImportPlan } from '../utils/chromeBookmarksParser';

export interface WorkspacePayload {
  categories: CategoryItem[];
  bookmarks: BookmarkItem[];
  quickShortcuts: QuickShortcutItem[];
  settings: UserSettings | null;
  sharedCategories: SharedCategoryRecord[];
}

async function getAuthHeaders(includeJson = false): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};
  if (includeJson) {
    headers['Content-Type'] = 'application/json';
  }
  const currentUser = auth.currentUser;
  if (currentUser) {
    const token = await currentUser.getIdToken();
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

async function apiRequest<T>(
  url: string,
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    body?: unknown;
    requireAuthHeader?: boolean;
  } = {}
): Promise<T> {
  const { method = 'GET', body, requireAuthHeader = true } = options;
  const hasBody = body !== undefined;
  const headers = requireAuthHeader
    ? await getAuthHeaders(hasBody)
    : hasBody
    ? { 'Content-Type': 'application/json' }
    : {};

  const response = await fetch(url, {
    method,
    headers,
    ...(hasBody ? { body: JSON.stringify(body) } : {}),
  });

  if (!response.ok) {
    let errMsg = `Request failed (${response.status})`;
    try {
      const errBody = await response.json();
      if (errBody?.error) errMsg = errBody.error;
    } catch {
      // ignore non-JSON error body
    }
    throw new Error(errMsg);
  }

  return response.json() as Promise<T>;
}

export const apiClient = {
  getWorkspace: () => apiRequest<WorkspacePayload>('/api/workspace'),

  syncLocalWorkspace: (payload: {
    categories: CategoryItem[];
    bookmarks: BookmarkItem[];
    quickShortcuts: QuickShortcutItem[];
  }) =>
    apiRequest<WorkspacePayload>('/api/workspace/sync-local', {
      method: 'POST',
      body: payload,
    }),

  clearWorkspace: () =>
    apiRequest<{ ok: boolean }>('/api/workspace', { method: 'DELETE' }),

  importChromePlan: (plan: ChromeImportPlan, replaceAllExisting: boolean) =>
    apiRequest<{
      summary: {
        addedCategories: number;
        addedBookmarks: number;
        skippedDuplicates: number;
        expandedCategoryIds: string[];
      };
      workspace: WorkspacePayload;
    }>('/api/workspace/import-plan', {
      method: 'POST',
      body: { plan, replaceAllExisting },
    }),

  saveBookmark: (data: {
    id?: string;
    title: string;
    url: string;
    description: string;
    categoryId: string;
    subcategoryId: string;
    isFavorite: boolean;
  }) =>
    apiRequest<BookmarkItem>('/api/bookmarks', {
      method: 'POST',
      body: data,
    }),

  toggleFavorite: (id: string, isFavorite: boolean) =>
    apiRequest<{ ok: boolean }>(`/api/bookmarks/${encodeURIComponent(id)}/favorite`, {
      method: 'PATCH',
      body: { isFavorite },
    }),

  deleteBookmark: (id: string) =>
    apiRequest<{ ok: boolean }>(`/api/bookmarks/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  batchEditBookmarks: (payload: {
    bookmarkIds: string[];
    category?: { categoryId: string; subcategoryId: string };
    favoriteStatus: 'keep' | 'favorite' | 'unfavorite';
  }) =>
    apiRequest<{ ok: boolean }>('/api/bookmarks/batch-edit', {
      method: 'POST',
      body: payload,
    }),

  batchDeleteBookmarks: (bookmarkIds: string[]) =>
    apiRequest<{ ok: boolean }>('/api/bookmarks/batch-delete', {
      method: 'POST',
      body: { bookmarkIds },
    }),

  saveQuickShortcut: (data: {
    id?: string;
    title: string;
    url: string;
    iconType: 'favicon' | 'lucide' | 'custom';
    customIcon: string;
  }) =>
    apiRequest<QuickShortcutItem>('/api/shortcuts', {
      method: 'POST',
      body: data,
    }),

  deleteQuickShortcut: (id: string) =>
    apiRequest<{ ok: boolean }>(`/api/shortcuts/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  reorderQuickShortcuts: (orderedIds: string[]) =>
    apiRequest<{ ok: boolean }>('/api/shortcuts/reorder', {
      method: 'PUT',
      body: { orderedIds },
    }),

  createCategory: (data: {
    id?: string;
    name: string;
    icon: string;
    parentId: string;
  }) =>
    apiRequest<CategoryItem>('/api/categories', {
      method: 'POST',
      body: data,
    }),

  updateCategory: (id: string, data: { name: string; icon: string }) =>
    apiRequest<{ ok: boolean }>(`/api/categories/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: data,
    }),

  deleteCategory: (id: string, fallbackCategoryId?: string) => {
    const qs = fallbackCategoryId
      ? `?fallbackCategoryId=${encodeURIComponent(fallbackCategoryId)}`
      : '';
    return apiRequest<{ ok: boolean }>(
      `/api/categories/${encodeURIComponent(id)}${qs}`,
      { method: 'DELETE' }
    );
  },

  reorderCategoryTree: (payload: {
    draggedId: string;
    newParentId: string;
    reorderedSiblings: Array<{ id: string; order: number }>;
    childSubsToMove: Array<{ id: string; order: number }>;
    bookmarksToUpdate: Array<{
      id: string;
      categoryId: string;
      subcategoryId: string;
    }>;
  }) =>
    apiRequest<{ ok: boolean }>('/api/categories/reorder', {
      method: 'PUT',
      body: payload,
    }),

  updateSettings: (settings: {
    themeMode?: string;
    primaryColor: string;
    glassIntensity: string;
    cardDensity: string;
  }) =>
    apiRequest<{ ok: boolean }>('/api/settings', {
      method: 'PUT',
      body: settings,
    }),

  publishOrUpdateShare: (payload: {
    existingShareId?: string;
    categoryId: string;
    categoryName: string;
    categoryIcon: string;
    subcategories: Array<{ id: string; name: string; icon: string; order: number }>;
    bookmarks: Array<{
      title: string;
      url: string;
      description: string;
      subcategoryId: string;
      isFavorite: boolean;
    }>;
  }) =>
    apiRequest<SharedCategoryRecord>('/api/shares', {
      method: 'POST',
      body: payload,
    }),

  revokeShare: (shareId: string) =>
    apiRequest<{ ok: boolean }>(`/api/shares/${encodeURIComponent(shareId)}`, {
      method: 'DELETE',
    }),

  getPublicShare: (shareId: string) =>
    apiRequest<SharedCategoryRecord>(
      `/api/shares/${encodeURIComponent(shareId)}`,
      { requireAuthHeader: false }
    ),
};
