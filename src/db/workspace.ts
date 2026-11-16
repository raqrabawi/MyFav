import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from './index.ts';
import {
  bookmarks,
  categories,
  quickShortcuts,
  sharedCategories,
  userSettings,
  type SharedBookmarkSnapshot,
  type SharedSubcategorySnapshot,
} from './schema.ts';

function generateId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 9);
  const ts = Date.now().toString(36);
  return `${prefix}_${ts}_${rand}`.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
}

function isCleanId(id: string): boolean {
  return /^[a-zA-Z0-9_-]{1,128}$/.test(id);
}

function cleanIcon(icon: string | undefined): string {
  return icon && /^[a-zA-Z0-9_-]{1,40}$/.test(icon) ? icon : 'bookmark';
}

function cleanUrl(url: string | undefined): string {
  const trimmed = (url || '').trim().slice(0, 500);
  return /^https?:\/\/.+/i.test(trimmed) ? trimmed : '';
}

function toIso(dt: Date | string | null | undefined): string {
  if (!dt) return new Date().toISOString();
  if (dt instanceof Date) return dt.toISOString();
  return String(dt);
}

export async function getUserWorkspace(uid: string) {
  try {
    const [catRows, bmRows, scRows, settingsRows, shareRows] = await Promise.all([
      db
        .select()
        .from(categories)
        .where(eq(categories.ownerId, uid))
        .orderBy(asc(categories.order), asc(categories.createdAt)),
      db
        .select()
        .from(bookmarks)
        .where(eq(bookmarks.ownerId, uid))
        .orderBy(asc(bookmarks.createdAt)),
      db
        .select()
        .from(quickShortcuts)
        .where(eq(quickShortcuts.ownerId, uid))
        .orderBy(asc(quickShortcuts.order), asc(quickShortcuts.createdAt)),
      db.select().from(userSettings).where(eq(userSettings.ownerId, uid)),
      db.select().from(sharedCategories).where(eq(sharedCategories.ownerId, uid)),
    ]);

    const settingsRow = settingsRows[0];

    return {
      categories: catRows.map((c) => ({
        id: c.id,
        ownerId: c.ownerId,
        name: c.name,
        icon: c.icon,
        parentId: c.parentId,
        order: c.order,
        createdAt: toIso(c.createdAt),
        updatedAt: toIso(c.updatedAt),
      })),
      bookmarks: bmRows.map((b) => ({
        id: b.id,
        ownerId: b.ownerId,
        title: b.title,
        url: b.url,
        description: b.description,
        categoryId: b.categoryId,
        subcategoryId: b.subcategoryId,
        isFavorite: b.isFavorite,
        createdAt: toIso(b.createdAt),
        updatedAt: toIso(b.updatedAt),
      })),
      quickShortcuts: scRows.map((s) => ({
        id: s.id,
        ownerId: s.ownerId,
        title: s.title,
        url: s.url,
        iconType:
          s.iconType === 'lucide' || s.iconType === 'custom'
            ? (s.iconType as 'lucide' | 'custom')
            : ('favicon' as const),
        customIcon: s.customIcon,
        order: s.order,
        createdAt: toIso(s.createdAt),
        updatedAt: toIso(s.updatedAt),
      })),
      settings: settingsRow
        ? {
            ownerId: settingsRow.ownerId,
            themeMode: (settingsRow.themeMode === 'light' ? 'light' : 'dark') as
              | 'light'
              | 'dark',
            primaryColor: settingsRow.primaryColor,
            glassIntensity: (settingsRow.glassIntensity === 'subtle' ||
            settingsRow.glassIntensity === 'frosted'
              ? settingsRow.glassIntensity
              : 'balanced') as 'subtle' | 'balanced' | 'frosted',
            cardDensity: (settingsRow.cardDensity === 'compact'
              ? 'compact'
              : 'comfortable') as 'comfortable' | 'compact',
            updatedAt: toIso(settingsRow.updatedAt),
          }
        : null,
      sharedCategories: shareRows.map((sh) => ({
        id: sh.id,
        ownerId: sh.ownerId,
        categoryId: sh.categoryId,
        categoryName: sh.categoryName,
        categoryIcon: sh.categoryIcon,
        isPublic: sh.isPublic,
        subcategories: Array.isArray(sh.subcategories) ? sh.subcategories : [],
        bookmarks: Array.isArray(sh.bookmarks) ? sh.bookmarks : [],
        createdAt: toIso(sh.createdAt),
        updatedAt: toIso(sh.updatedAt),
      })),
    };
  } catch (error) {
    console.error('Failed to load user workspace from PostgreSQL:', error);
    throw new Error('Failed to load workspace data.', { cause: error });
  }
}

export async function clearUserWorkspace(uid: string) {
  try {
    await db.transaction(async (tx) => {
      await tx.delete(sharedCategories).where(eq(sharedCategories.ownerId, uid));
      await tx.delete(quickShortcuts).where(eq(quickShortcuts.ownerId, uid));
      await tx.delete(bookmarks).where(eq(bookmarks.ownerId, uid));
      await tx.delete(categories).where(eq(categories.ownerId, uid));
    });
  } catch (error) {
    console.error('Failed to clear user workspace in PostgreSQL:', error);
    throw new Error('Failed to clear workspace data.', { cause: error });
  }
}

export interface LocalSyncPayload {
  categories: Array<{
    id: string;
    name: string;
    icon?: string;
    parentId?: string;
    order?: number;
  }>;
  bookmarks: Array<{
    id: string;
    title: string;
    url: string;
    description?: string;
    categoryId: string;
    subcategoryId?: string;
    isFavorite?: boolean;
  }>;
  quickShortcuts: Array<{
    id: string;
    title: string;
    url: string;
    iconType?: string;
    customIcon?: string;
    order?: number;
  }>;
}

export async function syncLocalWorkspaceToCloud(
  uid: string,
  payload: LocalSyncPayload
) {
  try {
    await db.transaction(async (tx) => {
      const existingCats = await tx
        .select()
        .from(categories)
        .where(eq(categories.ownerId, uid));
      const existingBms = await tx
        .select()
        .from(bookmarks)
        .where(eq(bookmarks.ownerId, uid));
      const existingScs = await tx
        .select()
        .from(quickShortcuts)
        .where(eq(quickShortcuts.ownerId, uid));

      const existingRootsByName = new Map<string, string>();
      const existingSubsByKey = new Map<string, string>();
      const existingCatIds = new Set(existingCats.map((c) => c.id));
      for (const c of existingCats) {
        if (!c.parentId) {
          existingRootsByName.set(c.name.trim().toLowerCase(), c.id);
        } else {
          existingSubsByKey.set(`${c.parentId}::${c.name.trim().toLowerCase()}`, c.id);
        }
      }

      const catIdMap: Record<string, string> = {};
      let nextRootOrder = existingCats.filter((c) => !c.parentId).length;
      const rootRows: Array<typeof categories.$inferInsert> = [];

      const localRoots = payload.categories
        .filter((c) => !c.parentId)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

      for (const root of localRoots) {
        const cleanName = (root.name || '').trim().slice(0, 80) || 'Untitled';
        const matchId = existingRootsByName.get(cleanName.toLowerCase());
        if (matchId) {
          catIdMap[root.id] = matchId;
          continue;
        }
        const docId =
          isCleanId(root.id) && !existingCatIds.has(root.id)
            ? root.id
            : generateId('cat');
        existingCatIds.add(docId);
        existingRootsByName.set(cleanName.toLowerCase(), docId);
        catIdMap[root.id] = docId;

        rootRows.push({
          id: docId,
          ownerId: uid,
          name: cleanName,
          icon: cleanIcon(root.icon),
          parentId: '',
          order: Math.min(100000, Math.max(0, nextRootOrder++)),
        });
      }

      if (rootRows.length > 0) {
        await tx.insert(categories).values(rootRows).onConflictDoNothing();
      }

      const subRows: Array<typeof categories.$inferInsert> = [];
      const localSubs = payload.categories
        .filter((c) => Boolean(c.parentId))
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

      for (const sub of localSubs) {
        const mappedParentId = sub.parentId ? catIdMap[sub.parentId] : undefined;
        if (!mappedParentId) continue;
        const cleanName = (sub.name || '').trim().slice(0, 80) || 'Subcategory';
        const subKey = `${mappedParentId}::${cleanName.toLowerCase()}`;
        const matchId = existingSubsByKey.get(subKey);
        if (matchId) {
          catIdMap[sub.id] = matchId;
          continue;
        }
        const docId =
          isCleanId(sub.id) && !existingCatIds.has(sub.id)
            ? sub.id
            : generateId('sub');
        existingCatIds.add(docId);
        existingSubsByKey.set(subKey, docId);
        catIdMap[sub.id] = docId;

        subRows.push({
          id: docId,
          ownerId: uid,
          name: cleanName,
          icon: cleanIcon(sub.icon),
          parentId: mappedParentId,
          order: Math.min(100000, Math.max(0, sub.order ?? 0)),
        });
      }

      if (subRows.length > 0) {
        await tx.insert(categories).values(subRows).onConflictDoNothing();
      }

      const validCatIds = new Set([...existingCatIds]);
      const existingUrls = new Set(
        existingBms.map((b) => b.url.trim().toLowerCase())
      );
      const existingBmIds = new Set(existingBms.map((b) => b.id));
      const bmRows: Array<typeof bookmarks.$inferInsert> = [];

      for (const bm of payload.bookmarks) {
        const safeUrl = cleanUrl(bm.url);
        if (!safeUrl || existingUrls.has(safeUrl.toLowerCase())) continue;

        const mappedCatId = catIdMap[bm.categoryId] || bm.categoryId;
        if (!validCatIds.has(mappedCatId)) continue;
        const mappedSubId = bm.subcategoryId
          ? catIdMap[bm.subcategoryId] || bm.subcategoryId
          : '';
        const safeSubId = mappedSubId && validCatIds.has(mappedSubId) ? mappedSubId : '';

        existingUrls.add(safeUrl.toLowerCase());
        const bmDocId =
          isCleanId(bm.id) && !existingBmIds.has(bm.id)
            ? bm.id
            : generateId('bm');
        existingBmIds.add(bmDocId);

        bmRows.push({
          id: bmDocId,
          ownerId: uid,
          title: (bm.title || '').trim().slice(0, 120) || safeUrl.slice(0, 120),
          url: safeUrl,
          description: (bm.description || '').slice(0, 400),
          categoryId: mappedCatId,
          subcategoryId: safeSubId,
          isFavorite: Boolean(bm.isFavorite),
        });
      }

      if (bmRows.length > 0) {
        for (let i = 0; i < bmRows.length; i += 250) {
          await tx
            .insert(bookmarks)
            .values(bmRows.slice(i, i + 250))
            .onConflictDoNothing();
        }
      }

      const existingScUrls = new Set(
        existingScs.map((s) => s.url.trim().toLowerCase())
      );
      const existingScIds = new Set(existingScs.map((s) => s.id));
      let nextScOrder = existingScs.length;
      const scRows: Array<typeof quickShortcuts.$inferInsert> = [];

      for (const sc of payload.quickShortcuts) {
        const safeUrl = cleanUrl(sc.url);
        if (!safeUrl || existingScUrls.has(safeUrl.toLowerCase())) continue;
        existingScUrls.add(safeUrl.toLowerCase());

        const scDocId =
          isCleanId(sc.id) && !existingScIds.has(sc.id)
            ? sc.id
            : generateId('qs');
        existingScIds.add(scDocId);

        const iconType =
          sc.iconType === 'lucide' || sc.iconType === 'custom'
            ? sc.iconType
            : 'favicon';
        const customIcon =
          iconType === 'favicon' ? '' : (sc.customIcon || '').trim().slice(0, 500);

        scRows.push({
          id: scDocId,
          ownerId: uid,
          title: (sc.title || '').trim().slice(0, 80) || 'Shortcut',
          url: safeUrl,
          iconType,
          customIcon,
          order: Math.min(100000, Math.max(0, nextScOrder++)),
        });
      }

      if (scRows.length > 0) {
        await tx.insert(quickShortcuts).values(scRows).onConflictDoNothing();
      }
    });
  } catch (error) {
    console.error('Failed to sync local workspace to PostgreSQL:', error);
    throw new Error('Failed to sync local data to your cloud workspace.', {
      cause: error,
    });
  }
}

export interface ChromeImportPlanInput {
  categories: Array<{
    tempId: string;
    name: string;
    icon: string;
    parentTempId: string;
    order: number;
  }>;
  bookmarks: Array<{
    title: string;
    url: string;
    categoryTempId: string;
    subcategoryTempId: string;
    order: number;
  }>;
}

export async function importChromePlanToDb(
  uid: string,
  plan: ChromeImportPlanInput,
  replaceAllExisting: boolean
) {
  try {
    return await db.transaction(async (tx) => {
      if (replaceAllExisting) {
        await tx.delete(sharedCategories).where(eq(sharedCategories.ownerId, uid));
        await tx.delete(quickShortcuts).where(eq(quickShortcuts.ownerId, uid));
        await tx.delete(bookmarks).where(eq(bookmarks.ownerId, uid));
        await tx.delete(categories).where(eq(categories.ownerId, uid));
      }

      const existingCats = replaceAllExisting
        ? []
        : await tx.select().from(categories).where(eq(categories.ownerId, uid));
      const existingBms = replaceAllExisting
        ? []
        : await tx.select().from(bookmarks).where(eq(bookmarks.ownerId, uid));

      const existingRootsByName = new Map<string, string>();
      const existingSubsByKey = new Map<string, string>();
      const existingUrls = new Set<string>();

      for (const c of existingCats) {
        if (!c.parentId) {
          existingRootsByName.set(c.name.trim().toLowerCase(), c.id);
        } else {
          existingSubsByKey.set(`${c.parentId}::${c.name.trim().toLowerCase()}`, c.id);
        }
      }
      for (const b of existingBms) {
        existingUrls.add(b.url.trim().toLowerCase());
      }

      const rootCats = plan.categories
        .filter((c) => !c.parentTempId)
        .sort((a, b) => a.order - b.order);
      const subCats = plan.categories
        .filter((c) => Boolean(c.parentTempId))
        .sort((a, b) => a.order - b.order);
      const orderedBookmarks = [...plan.bookmarks].sort((a, b) => a.order - b.order);

      const tempToRealId: Record<string, string> = {};
      const expandedCategoryIds: string[] = [];
      let nextRootOrder = replaceAllExisting
        ? 0
        : existingCats.filter((c) => !c.parentId).length;
      const baseTimeMs = Date.now();
      let addedCategories = 0;
      let addedBookmarks = 0;
      let skippedDuplicates = 0;

      const rootInserts: Array<typeof categories.$inferInsert> = [];
      for (let i = 0; i < rootCats.length; i++) {
        const rc = rootCats[i];
        const cleanName = (rc.name || '').trim().slice(0, 80) || 'Bookmarks';
        const matchId = !replaceAllExisting
          ? existingRootsByName.get(cleanName.toLowerCase())
          : undefined;
        if (matchId) {
          tempToRealId[rc.tempId] = matchId;
          expandedCategoryIds.push(matchId);
          continue;
        }
        const realId = generateId(`cat_${i}`);
        tempToRealId[rc.tempId] = realId;
        expandedCategoryIds.push(realId);
        existingRootsByName.set(cleanName.toLowerCase(), realId);
        addedCategories++;
        const dt = new Date(baseTimeMs + i * 10);
        rootInserts.push({
          id: realId,
          ownerId: uid,
          name: cleanName,
          icon: cleanIcon(rc.icon),
          parentId: '',
          order: replaceAllExisting ? i : nextRootOrder++,
          createdAt: dt,
          updatedAt: dt,
        });
      }

      if (rootInserts.length > 0) {
        for (let i = 0; i < rootInserts.length; i += 250) {
          await tx
            .insert(categories)
            .values(rootInserts.slice(i, i + 250))
            .onConflictDoNothing();
        }
      }

      const subInserts: Array<typeof categories.$inferInsert> = [];
      for (let i = 0; i < subCats.length; i++) {
        const sc = subCats[i];
        const parentRealId = tempToRealId[sc.parentTempId];
        if (!parentRealId) continue;
        const cleanName = (sc.name || '').trim().slice(0, 80) || 'Subcategory';
        const key = `${parentRealId}::${cleanName.toLowerCase()}`;
        const matchId = !replaceAllExisting ? existingSubsByKey.get(key) : undefined;
        if (matchId) {
          tempToRealId[sc.tempId] = matchId;
          continue;
        }
        const realSubId = generateId(`sub_${i}`);
        tempToRealId[sc.tempId] = realSubId;
        existingSubsByKey.set(key, realSubId);
        addedCategories++;
        const dt = new Date(baseTimeMs + 1000 + i * 10);
        subInserts.push({
          id: realSubId,
          ownerId: uid,
          name: cleanName,
          icon: cleanIcon(sc.icon),
          parentId: parentRealId,
          order: sc.order ?? 0,
          createdAt: dt,
          updatedAt: dt,
        });
      }

      if (subInserts.length > 0) {
        for (let i = 0; i < subInserts.length; i += 250) {
          await tx
            .insert(categories)
            .values(subInserts.slice(i, i + 250))
            .onConflictDoNothing();
        }
      }

      const bmInserts: Array<typeof bookmarks.$inferInsert> = [];
      for (let i = 0; i < orderedBookmarks.length; i++) {
        const bm = orderedBookmarks[i];
        const safeUrl = cleanUrl(bm.url);
        if (!safeUrl) continue;
        const normalizedUrl = safeUrl.toLowerCase();
        if (!replaceAllExisting && existingUrls.has(normalizedUrl)) {
          skippedDuplicates++;
          continue;
        }
        existingUrls.add(normalizedUrl);

        const realCatId = tempToRealId[bm.categoryTempId];
        if (!realCatId) continue;
        const realSubId = bm.subcategoryTempId
          ? tempToRealId[bm.subcategoryTempId] || ''
          : '';

        const bmId = generateId(`bm_${String(i).padStart(4, '0')}`);
        const dt = new Date(baseTimeMs + 5000 + i * 10);
        addedBookmarks++;

        bmInserts.push({
          id: bmId,
          ownerId: uid,
          title: (bm.title || '').trim().slice(0, 120) || safeUrl.slice(0, 120),
          url: safeUrl,
          description: '',
          categoryId: realCatId,
          subcategoryId: realSubId,
          isFavorite: false,
          createdAt: dt,
          updatedAt: dt,
        });
      }

      if (bmInserts.length > 0) {
        for (let i = 0; i < bmInserts.length; i += 250) {
          await tx
            .insert(bookmarks)
            .values(bmInserts.slice(i, i + 250))
            .onConflictDoNothing();
        }
      }

      return {
        addedCategories,
        addedBookmarks,
        skippedDuplicates,
        expandedCategoryIds,
      };
    });
  } catch (error) {
    console.error('Failed to import Chrome bookmarks plan in PostgreSQL:', error);
    throw new Error('Failed to import bookmarks into database.', { cause: error });
  }
}

export async function upsertBookmark(
  uid: string,
  data: {
    id?: string;
    title: string;
    url: string;
    description?: string;
    categoryId: string;
    subcategoryId?: string;
    isFavorite?: boolean;
  }
) {
  try {
    const safeUrl = cleanUrl(data.url);
    if (!safeUrl) throw new Error('Invalid bookmark URL.');

    const now = new Date();
    const cleanTitle = (data.title || '').trim().slice(0, 120) || safeUrl.slice(0, 120);
    const cleanDesc = (data.description || '').slice(0, 400);
    const subId = data.subcategoryId || '';

    if (data.id && isCleanId(data.id)) {
      const existing = await db
        .select()
        .from(bookmarks)
        .where(and(eq(bookmarks.id, data.id), eq(bookmarks.ownerId, uid)));

      if (existing.length > 0) {
        const [updated] = await db
          .update(bookmarks)
          .set({
            title: cleanTitle,
            url: safeUrl,
            description: cleanDesc,
            categoryId: data.categoryId,
            subcategoryId: subId,
            isFavorite: Boolean(data.isFavorite),
            updatedAt: now,
          })
          .where(and(eq(bookmarks.id, data.id), eq(bookmarks.ownerId, uid)))
          .returning();

        return updated;
      }
    }

    const newId =
      data.id && isCleanId(data.id) ? data.id : generateId('bm');

    const [created] = await db
      .insert(bookmarks)
      .values({
        id: newId,
        ownerId: uid,
        title: cleanTitle,
        url: safeUrl,
        description: cleanDesc,
        categoryId: data.categoryId,
        subcategoryId: subId,
        isFavorite: Boolean(data.isFavorite),
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    return created;
  } catch (error) {
    console.error('Failed to save bookmark in PostgreSQL:', error);
    throw new Error('Failed to save bookmark.', { cause: error });
  }
}

export async function toggleBookmarkFavorite(
  uid: string,
  id: string,
  isFavorite: boolean
) {
  try {
    await db
      .update(bookmarks)
      .set({ isFavorite: Boolean(isFavorite), updatedAt: new Date() })
      .where(and(eq(bookmarks.id, id), eq(bookmarks.ownerId, uid)));
  } catch (error) {
    console.error('Failed to toggle bookmark favorite in PostgreSQL:', error);
    throw new Error('Failed to update bookmark favorite status.', { cause: error });
  }
}

export async function deleteBookmarkById(uid: string, id: string) {
  try {
    await db
      .delete(bookmarks)
      .where(and(eq(bookmarks.id, id), eq(bookmarks.ownerId, uid)));
  } catch (error) {
    console.error('Failed to delete bookmark in PostgreSQL:', error);
    throw new Error('Failed to delete bookmark.', { cause: error });
  }
}

export async function batchEditBookmarksInDb(
  uid: string,
  payload: {
    bookmarkIds: string[];
    category?: { categoryId: string; subcategoryId: string };
    favoriteStatus: 'keep' | 'favorite' | 'unfavorite';
  }
) {
  try {
    if (payload.bookmarkIds.length === 0) return;
    const setValues: {
      updatedAt: Date;
      categoryId?: string;
      subcategoryId?: string;
      isFavorite?: boolean;
    } = {
      updatedAt: new Date(),
    };

    if (payload.category?.categoryId) {
      setValues.categoryId = payload.category.categoryId;
      setValues.subcategoryId = payload.category.subcategoryId || '';
    }
    if (payload.favoriteStatus === 'favorite') {
      setValues.isFavorite = true;
    } else if (payload.favoriteStatus === 'unfavorite') {
      setValues.isFavorite = false;
    }

    await db
      .update(bookmarks)
      .set(setValues)
      .where(
        and(
          eq(bookmarks.ownerId, uid),
          inArray(bookmarks.id, payload.bookmarkIds)
        )
      );
  } catch (error) {
    console.error('Failed to batch edit bookmarks in PostgreSQL:', error);
    throw new Error('Failed to update selected bookmarks.', { cause: error });
  }
}

export async function batchDeleteBookmarksInDb(
  uid: string,
  bookmarkIds: string[]
) {
  try {
    if (bookmarkIds.length === 0) return;
    await db
      .delete(bookmarks)
      .where(and(eq(bookmarks.ownerId, uid), inArray(bookmarks.id, bookmarkIds)));
  } catch (error) {
    console.error('Failed to batch delete bookmarks in PostgreSQL:', error);
    throw new Error('Failed to delete selected bookmarks.', { cause: error });
  }
}

export async function upsertQuickShortcut(
  uid: string,
  data: {
    id?: string;
    title: string;
    url: string;
    iconType: 'favicon' | 'lucide' | 'custom';
    customIcon: string;
  }
) {
  try {
    const safeUrl = cleanUrl(data.url);
    if (!safeUrl) throw new Error('Invalid shortcut URL.');

    const now = new Date();
    const cleanTitle = (data.title || '').trim().slice(0, 80) || 'Shortcut';
    const iconType =
      data.iconType === 'lucide' || data.iconType === 'custom'
        ? data.iconType
        : 'favicon';
    const cleanCustomIcon =
      iconType === 'favicon' ? '' : (data.customIcon || '').trim().slice(0, 500);

    if (data.id && isCleanId(data.id)) {
      const existing = await db
        .select()
        .from(quickShortcuts)
        .where(and(eq(quickShortcuts.id, data.id), eq(quickShortcuts.ownerId, uid)));

      if (existing.length > 0) {
        const [updated] = await db
          .update(quickShortcuts)
          .set({
            title: cleanTitle,
            url: safeUrl,
            iconType,
            customIcon: cleanCustomIcon,
            updatedAt: now,
          })
          .where(and(eq(quickShortcuts.id, data.id), eq(quickShortcuts.ownerId, uid)))
          .returning();

        return updated;
      }
    }

    const existingAll = await db
      .select({ id: quickShortcuts.id })
      .from(quickShortcuts)
      .where(eq(quickShortcuts.ownerId, uid));

    const newId =
      data.id && isCleanId(data.id) ? data.id : generateId('qs');

    const [created] = await db
      .insert(quickShortcuts)
      .values({
        id: newId,
        ownerId: uid,
        title: cleanTitle,
        url: safeUrl,
        iconType,
        customIcon: cleanCustomIcon,
        order: existingAll.length,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    return created;
  } catch (error) {
    console.error('Failed to save quick shortcut in PostgreSQL:', error);
    throw new Error('Failed to save quick shortcut.', { cause: error });
  }
}

export async function deleteQuickShortcutById(uid: string, id: string) {
  try {
    await db
      .delete(quickShortcuts)
      .where(and(eq(quickShortcuts.id, id), eq(quickShortcuts.ownerId, uid)));
  } catch (error) {
    console.error('Failed to delete quick shortcut in PostgreSQL:', error);
    throw new Error('Failed to delete quick shortcut.', { cause: error });
  }
}

export async function reorderQuickShortcutsInDb(
  uid: string,
  orderedIds: string[]
) {
  try {
    await db.transaction(async (tx) => {
      const now = new Date();
      for (let i = 0; i < orderedIds.length; i++) {
        await tx
          .update(quickShortcuts)
          .set({ order: i, updatedAt: now })
          .where(
            and(
              eq(quickShortcuts.id, orderedIds[i]),
              eq(quickShortcuts.ownerId, uid)
            )
          );
      }
    });
  } catch (error) {
    console.error('Failed to reorder quick shortcuts in PostgreSQL:', error);
    throw new Error('Failed to reorder quick shortcuts.', { cause: error });
  }
}

export async function createCategoryInDb(
  uid: string,
  data: {
    id?: string;
    name: string;
    icon: string;
    parentId?: string;
  }
) {
  try {
    const cleanName = (data.name || '').trim().slice(0, 80);
    if (!cleanName) throw new Error('Category name is required.');

    const parentId = data.parentId || '';
    const siblings = await db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.ownerId, uid), eq(categories.parentId, parentId)));

    const newId =
      data.id && isCleanId(data.id)
        ? data.id
        : generateId(parentId ? 'sub' : 'cat');
    const now = new Date();

    const [created] = await db
      .insert(categories)
      .values({
        id: newId,
        ownerId: uid,
        name: cleanName,
        icon: cleanIcon(data.icon),
        parentId,
        order: siblings.length,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    return created;
  } catch (error) {
    console.error('Failed to create category in PostgreSQL:', error);
    throw new Error('Failed to create category.', { cause: error });
  }
}

export async function updateCategoryInDb(
  uid: string,
  id: string,
  data: { name: string; icon: string }
) {
  try {
    const cleanName = (data.name || '').trim().slice(0, 80);
    if (!cleanName) return;

    await db
      .update(categories)
      .set({
        name: cleanName,
        icon: cleanIcon(data.icon),
        updatedAt: new Date(),
      })
      .where(and(eq(categories.id, id), eq(categories.ownerId, uid)));
  } catch (error) {
    console.error('Failed to update category in PostgreSQL:', error);
    throw new Error('Failed to update category.', { cause: error });
  }
}

export async function deleteCategoryInDb(
  uid: string,
  id: string,
  fallbackCategoryId?: string
) {
  try {
    await db.transaction(async (tx) => {
      const [target] = await tx
        .select()
        .from(categories)
        .where(and(eq(categories.id, id), eq(categories.ownerId, uid)));
      if (!target) return;

      const isRoot = !target.parentId;
      if (isRoot) {
        if (fallbackCategoryId) {
          await tx
            .update(bookmarks)
            .set({
              categoryId: fallbackCategoryId,
              subcategoryId: '',
              updatedAt: new Date(),
            })
            .where(and(eq(bookmarks.ownerId, uid), eq(bookmarks.categoryId, id)));
        } else {
          await tx
            .delete(bookmarks)
            .where(and(eq(bookmarks.ownerId, uid), eq(bookmarks.categoryId, id)));
        }

        await tx
          .delete(categories)
          .where(and(eq(categories.ownerId, uid), eq(categories.parentId, id)));
        await tx
          .delete(sharedCategories)
          .where(
            and(eq(sharedCategories.ownerId, uid), eq(sharedCategories.categoryId, id))
          );
      } else {
        await tx
          .update(bookmarks)
          .set({ subcategoryId: '', updatedAt: new Date() })
          .where(and(eq(bookmarks.ownerId, uid), eq(bookmarks.subcategoryId, id)));
      }

      await tx
        .delete(categories)
        .where(and(eq(categories.ownerId, uid), eq(categories.id, id)));
    });
  } catch (error) {
    console.error('Failed to delete category in PostgreSQL:', error);
    throw new Error('Failed to delete category.', { cause: error });
  }
}

export async function reorderCategoryTreeInDb(
  uid: string,
  payload: {
    draggedId: string;
    newParentId: string;
    reorderedSiblings: Array<{ id: string; order: number }>;
    childSubsToMove: Array<{ id: string; order: number }>;
    bookmarksToUpdate: Array<{
      id: string;
      categoryId: string;
      subcategoryId: string;
    }>;
  }
) {
  try {
    await db.transaction(async (tx) => {
      const now = new Date();
      for (const sib of payload.reorderedSiblings) {
        if (sib.id === payload.draggedId) {
          await tx
            .update(categories)
            .set({
              parentId: payload.newParentId,
              order: sib.order,
              updatedAt: now,
            })
            .where(and(eq(categories.id, sib.id), eq(categories.ownerId, uid)));
        } else {
          await tx
            .update(categories)
            .set({ order: sib.order, updatedAt: now })
            .where(and(eq(categories.id, sib.id), eq(categories.ownerId, uid)));
        }
      }

      for (const childSub of payload.childSubsToMove) {
        await tx
          .update(categories)
          .set({
            parentId: payload.newParentId,
            order: childSub.order,
            updatedAt: now,
          })
          .where(and(eq(categories.id, childSub.id), eq(categories.ownerId, uid)));
      }

      for (const bmUpd of payload.bookmarksToUpdate) {
        await tx
          .update(bookmarks)
          .set({
            categoryId: bmUpd.categoryId,
            subcategoryId: bmUpd.subcategoryId,
            updatedAt: now,
          })
          .where(and(eq(bookmarks.id, bmUpd.id), eq(bookmarks.ownerId, uid)));
      }
    });
  } catch (error) {
    console.error('Failed to reorder category tree in PostgreSQL:', error);
    throw new Error('Failed to reorder categories.', { cause: error });
  }
}

export async function upsertUserSettingsInDb(
  uid: string,
  data: {
    themeMode?: string;
    primaryColor: string;
    glassIntensity: string;
    cardDensity: string;
  }
) {
  try {
    const themeMode = data.themeMode === 'light' ? 'light' : 'dark';
    const primaryColor = (data.primaryColor || 'blue').slice(0, 32);
    const glassIntensity =
      data.glassIntensity === 'subtle' || data.glassIntensity === 'frosted'
        ? data.glassIntensity
        : 'balanced';
    const cardDensity =
      data.cardDensity === 'compact' ? 'compact' : 'comfortable';
    const now = new Date();

    await db
      .insert(userSettings)
      .values({
        ownerId: uid,
        themeMode,
        primaryColor,
        glassIntensity,
        cardDensity,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: userSettings.ownerId,
        set: {
          themeMode,
          primaryColor,
          glassIntensity,
          cardDensity,
          updatedAt: now,
        },
      });
  } catch (error) {
    console.error('Failed to save user settings in PostgreSQL:', error);
    throw new Error('Failed to save settings.', { cause: error });
  }
}

export async function publishOrUpdateShareInDb(
  uid: string,
  payload: {
    existingShareId?: string;
    categoryId: string;
    categoryName: string;
    categoryIcon: string;
    subcategories: SharedSubcategorySnapshot[];
    bookmarks: SharedBookmarkSnapshot[];
  }
) {
  try {
    const now = new Date();
    const safeCatName = payload.categoryName.trim().slice(0, 80) || 'Shared Collection';
    const safeCatIcon = cleanIcon(payload.categoryIcon);

    if (payload.existingShareId) {
      const existing = await db
        .select()
        .from(sharedCategories)
        .where(
          and(
            eq(sharedCategories.id, payload.existingShareId),
            eq(sharedCategories.ownerId, uid)
          )
        );
      if (existing.length > 0) {
        const [updated] = await db
          .update(sharedCategories)
          .set({
            categoryName: safeCatName,
            categoryIcon: safeCatIcon,
            isPublic: true,
            subcategories: payload.subcategories,
            bookmarks: payload.bookmarks,
            updatedAt: now,
          })
          .where(
            and(
              eq(sharedCategories.id, payload.existingShareId),
              eq(sharedCategories.ownerId, uid)
            )
          )
          .returning();

        return {
          ...updated,
          createdAt: toIso(updated.createdAt),
          updatedAt: toIso(updated.updatedAt),
        };
      }
    }

    const newShareId = generateId('share');
    const [created] = await db
      .insert(sharedCategories)
      .values({
        id: newShareId,
        ownerId: uid,
        categoryId: payload.categoryId,
        categoryName: safeCatName,
        categoryIcon: safeCatIcon,
        isPublic: true,
        subcategories: payload.subcategories,
        bookmarks: payload.bookmarks,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    return {
      ...created,
      createdAt: toIso(created.createdAt),
      updatedAt: toIso(created.updatedAt),
    };
  } catch (error) {
    console.error('Failed to publish shared collection in PostgreSQL:', error);
    throw new Error('Failed to publish shared collection.', { cause: error });
  }
}

export async function revokeShareInDb(uid: string, shareId: string) {
  try {
    await db
      .delete(sharedCategories)
      .where(and(eq(sharedCategories.id, shareId), eq(sharedCategories.ownerId, uid)));
  } catch (error) {
    console.error('Failed to revoke share in PostgreSQL:', error);
    throw new Error('Failed to revoke shared collection.', { cause: error });
  }
}

export async function getPublicShareById(shareId: string) {
  try {
    const [row] = await db
      .select()
      .from(sharedCategories)
      .where(
        and(eq(sharedCategories.id, shareId), eq(sharedCategories.isPublic, true))
      );

    if (!row) return null;
    return {
      id: row.id,
      ownerId: row.ownerId,
      categoryId: row.categoryId,
      categoryName: row.categoryName,
      categoryIcon: row.categoryIcon,
      isPublic: row.isPublic,
      subcategories: Array.isArray(row.subcategories) ? row.subcategories : [],
      bookmarks: Array.isArray(row.bookmarks) ? row.bookmarks : [],
      createdAt: toIso(row.createdAt),
      updatedAt: toIso(row.updatedAt),
    };
  } catch (error) {
    console.error('Failed to fetch public share from PostgreSQL:', error);
    throw new Error('Failed to fetch shared collection.', { cause: error });
  }
}
