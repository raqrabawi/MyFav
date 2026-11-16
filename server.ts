import 'dotenv/config';
import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import {
  dbMeta,
  ensureDatabaseSchema,
  verifyDatabaseStatus,
} from './src/db/index.ts';
import { requireAuth, type AuthRequest } from './src/middleware/auth.ts';
import {
  batchDeleteBookmarksInDb,
  batchEditBookmarksInDb,
  clearUserWorkspace,
  createCategoryInDb,
  deleteBookmarkById,
  deleteCategoryInDb,
  deleteQuickShortcutById,
  getPublicShareById,
  getUserWorkspace,
  importChromePlanToDb,
  publishOrUpdateShareInDb,
  reorderCategoryTreeInDb,
  reorderQuickShortcutsInDb,
  revokeShareInDb,
  syncLocalWorkspaceToCloud,
  toggleBookmarkFavorite,
  updateCategoryInDb,
  upsertBookmark,
  upsertQuickShortcut,
  upsertUserSettingsInDb,
} from './src/db/workspace.ts';

const PORT = Number(process.env.PORT) || 3000;
const isProduction = process.env.NODE_ENV === 'production';

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '8mb' }));

  app.get('/api/health', async (req, res) => {
    if (req.query.verify === '1') {
      try {
        const status = await verifyDatabaseStatus();
        return res.json({ ok: true, connected: true, ...status });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Database connection failed';
        console.error('Database health verification failed:', error);
        return res.status(503).json({
          ok: false,
          connected: false,
          provider: dbMeta.provider,
          parseError: dbMeta.parseError,
          hostHint: dbMeta.hostHint,
          error: message,
        });
      }
    }

    return res.json({
      ok: true,
      provider: dbMeta.provider,
      parseError: dbMeta.parseError,
    });
  });

  app.use('/api', async (req, res, next) => {
    if (req.path === '/health') {
      return next();
    }
    try {
      await ensureDatabaseSchema();
      return next();
    } catch (error) {
      console.error('Database schema initialization failed:', error);
      return res.status(503).json({ error: 'Database connection unavailable' });
    }
  });

  // Public read-only shared collection endpoint
  app.get('/api/shares/:shareId', async (req, res) => {
    try {
      const share = await getPublicShareById(String(req.params.shareId || ''));
      if (!share) {
        return res.status(404).json({ error: 'Shared collection not found' });
      }
      return res.json(share);
    } catch (error) {
      console.error('Failed to fetch share:', error);
      return res.status(500).json({ error: 'Failed to load shared collection' });
    }
  });

  // Authenticated workspace endpoints
  app.get('/api/workspace', requireAuth, async (req: AuthRequest, res) => {
    try {
      const data = await getUserWorkspace(req.user!.uid);
      return res.json(data);
    } catch (error) {
      console.error('GET /api/workspace failed:', error);
      return res.status(500).json({ error: 'Failed to load workspace data' });
    }
  });

  app.post('/api/workspace/sync-local', requireAuth, async (req: AuthRequest, res) => {
    try {
      await syncLocalWorkspaceToCloud(req.user!.uid, {
        categories: Array.isArray(req.body?.categories) ? req.body.categories : [],
        bookmarks: Array.isArray(req.body?.bookmarks) ? req.body.bookmarks : [],
        quickShortcuts: Array.isArray(req.body?.quickShortcuts)
          ? req.body.quickShortcuts
          : [],
      });
      const data = await getUserWorkspace(req.user!.uid);
      return res.json(data);
    } catch (error) {
      console.error('POST /api/workspace/sync-local failed:', error);
      return res.status(500).json({ error: 'Failed to sync local data' });
    }
  });

  app.delete('/api/workspace', requireAuth, async (req: AuthRequest, res) => {
    try {
      await clearUserWorkspace(req.user!.uid);
      return res.json({ ok: true });
    } catch (error) {
      console.error('DELETE /api/workspace failed:', error);
      return res.status(500).json({ error: 'Failed to clear workspace' });
    }
  });

  app.post('/api/workspace/import-plan', requireAuth, async (req: AuthRequest, res) => {
    try {
      const plan = req.body?.plan;
      const replaceAllExisting = Boolean(req.body?.replaceAllExisting);
      if (!plan || !Array.isArray(plan.categories) || !Array.isArray(plan.bookmarks)) {
        return res.status(400).json({ error: 'Invalid import plan payload' });
      }
      const summary = await importChromePlanToDb(req.user!.uid, plan, replaceAllExisting);
      const workspace = await getUserWorkspace(req.user!.uid);
      return res.json({ summary, workspace });
    } catch (error) {
      console.error('POST /api/workspace/import-plan failed:', error);
      return res.status(500).json({ error: 'Failed to import bookmarks' });
    }
  });

  // Bookmarks CRUD
  app.post('/api/bookmarks', requireAuth, async (req: AuthRequest, res) => {
    try {
      const saved = await upsertBookmark(req.user!.uid, req.body);
      return res.json(saved);
    } catch (error) {
      console.error('POST /api/bookmarks failed:', error);
      return res.status(500).json({ error: 'Failed to save website' });
    }
  });

  app.patch('/api/bookmarks/:id/favorite', requireAuth, async (req: AuthRequest, res) => {
    try {
      await toggleBookmarkFavorite(
        req.user!.uid,
        String(req.params.id),
        Boolean(req.body?.isFavorite)
      );
      return res.json({ ok: true });
    } catch (error) {
      console.error('PATCH /api/bookmarks/:id/favorite failed:', error);
      return res.status(500).json({ error: 'Failed to toggle favorite' });
    }
  });

  app.delete('/api/bookmarks/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      await deleteBookmarkById(req.user!.uid, String(req.params.id));
      return res.json({ ok: true });
    } catch (error) {
      console.error('DELETE /api/bookmarks/:id failed:', error);
      return res.status(500).json({ error: 'Failed to delete website' });
    }
  });

  app.post('/api/bookmarks/batch-edit', requireAuth, async (req: AuthRequest, res) => {
    try {
      await batchEditBookmarksInDb(req.user!.uid, {
        bookmarkIds: Array.isArray(req.body?.bookmarkIds) ? req.body.bookmarkIds : [],
        category: req.body?.category,
        favoriteStatus: req.body?.favoriteStatus || 'keep',
      });
      return res.json({ ok: true });
    } catch (error) {
      console.error('POST /api/bookmarks/batch-edit failed:', error);
      return res.status(500).json({ error: 'Failed to update selected websites' });
    }
  });

  app.post('/api/bookmarks/batch-delete', requireAuth, async (req: AuthRequest, res) => {
    try {
      await batchDeleteBookmarksInDb(
        req.user!.uid,
        Array.isArray(req.body?.bookmarkIds) ? req.body.bookmarkIds : []
      );
      return res.json({ ok: true });
    } catch (error) {
      console.error('POST /api/bookmarks/batch-delete failed:', error);
      return res.status(500).json({ error: 'Failed to delete selected websites' });
    }
  });

  // Quick Shortcuts CRUD
  app.post('/api/shortcuts', requireAuth, async (req: AuthRequest, res) => {
    try {
      const saved = await upsertQuickShortcut(req.user!.uid, req.body);
      return res.json(saved);
    } catch (error) {
      console.error('POST /api/shortcuts failed:', error);
      return res.status(500).json({ error: 'Failed to save shortcut' });
    }
  });

  app.delete('/api/shortcuts/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      await deleteQuickShortcutById(req.user!.uid, String(req.params.id));
      return res.json({ ok: true });
    } catch (error) {
      console.error('DELETE /api/shortcuts/:id failed:', error);
      return res.status(500).json({ error: 'Failed to delete shortcut' });
    }
  });

  app.put('/api/shortcuts/reorder', requireAuth, async (req: AuthRequest, res) => {
    try {
      await reorderQuickShortcutsInDb(
        req.user!.uid,
        Array.isArray(req.body?.orderedIds) ? req.body.orderedIds : []
      );
      return res.json({ ok: true });
    } catch (error) {
      console.error('PUT /api/shortcuts/reorder failed:', error);
      return res.status(500).json({ error: 'Failed to reorder shortcuts' });
    }
  });

  // Categories CRUD
  app.post('/api/categories', requireAuth, async (req: AuthRequest, res) => {
    try {
      const created = await createCategoryInDb(req.user!.uid, req.body);
      return res.json(created);
    } catch (error) {
      console.error('POST /api/categories failed:', error);
      return res.status(500).json({ error: 'Failed to create category' });
    }
  });

  app.put('/api/categories/reorder', requireAuth, async (req: AuthRequest, res) => {
    try {
      await reorderCategoryTreeInDb(req.user!.uid, req.body);
      return res.json({ ok: true });
    } catch (error) {
      console.error('PUT /api/categories/reorder failed:', error);
      return res.status(500).json({ error: 'Failed to reorder categories' });
    }
  });

  app.patch('/api/categories/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      await updateCategoryInDb(req.user!.uid, String(req.params.id), req.body);
      return res.json({ ok: true });
    } catch (error) {
      console.error('PATCH /api/categories/:id failed:', error);
      return res.status(500).json({ error: 'Failed to update category' });
    }
  });

  app.delete('/api/categories/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const fallbackCategoryId =
        typeof req.query.fallbackCategoryId === 'string'
          ? req.query.fallbackCategoryId
          : undefined;
      await deleteCategoryInDb(
        req.user!.uid,
        String(req.params.id),
        fallbackCategoryId
      );
      return res.json({ ok: true });
    } catch (error) {
      console.error('DELETE /api/categories/:id failed:', error);
      return res.status(500).json({ error: 'Failed to delete category' });
    }
  });

  // Settings
  app.put('/api/settings', requireAuth, async (req: AuthRequest, res) => {
    try {
      await upsertUserSettingsInDb(req.user!.uid, req.body);
      return res.json({ ok: true });
    } catch (error) {
      console.error('PUT /api/settings failed:', error);
      return res.status(500).json({ error: 'Failed to update settings' });
    }
  });

  // Shares management
  app.post('/api/shares', requireAuth, async (req: AuthRequest, res) => {
    try {
      const record = await publishOrUpdateShareInDb(req.user!.uid, req.body);
      return res.json(record);
    } catch (error) {
      console.error('POST /api/shares failed:', error);
      return res.status(500).json({ error: 'Failed to share category' });
    }
  });

  app.delete('/api/shares/:shareId', requireAuth, async (req: AuthRequest, res) => {
    try {
      await revokeShareInDb(req.user!.uid, String(req.params.shareId));
      return res.json({ ok: true });
    } catch (error) {
      console.error('DELETE /api/shares/:shareId failed:', error);
      return res.status(500).json({ error: 'Failed to revoke share link' });
    }
  });

  if (!isProduction) {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== 'true',
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(import.meta.dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`MyFav server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
