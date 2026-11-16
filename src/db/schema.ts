import { relations } from 'drizzle-orm';
import {
  boolean,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

export interface SharedSubcategorySnapshot {
  id: string;
  name: string;
  icon: string;
  order: number;
}

export interface SharedBookmarkSnapshot {
  title: string;
  url: string;
  description: string;
  subcategoryId: string;
  isFavorite: boolean;
}

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const categories = pgTable('categories', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id')
    .notNull()
    .references(() => users.uid, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  icon: text('icon').notNull().default('bookmark'),
  parentId: text('parent_id').notNull().default(''),
  order: integer('order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const bookmarks = pgTable('bookmarks', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id')
    .notNull()
    .references(() => users.uid, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  url: text('url').notNull(),
  description: text('description').notNull().default(''),
  categoryId: text('category_id')
    .notNull()
    .references(() => categories.id, { onDelete: 'cascade' }),
  subcategoryId: text('subcategory_id').notNull().default(''),
  isFavorite: boolean('is_favorite').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const quickShortcuts = pgTable('quick_shortcuts', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id')
    .notNull()
    .references(() => users.uid, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  url: text('url').notNull(),
  iconType: text('icon_type').notNull().default('favicon'),
  customIcon: text('custom_icon').notNull().default(''),
  order: integer('order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const userSettings = pgTable('user_settings', {
  ownerId: text('owner_id')
    .primaryKey()
    .references(() => users.uid, { onDelete: 'cascade' }),
  themeMode: text('theme_mode').notNull().default('dark'),
  primaryColor: text('primary_color').notNull().default('blue'),
  glassIntensity: text('glass_intensity').notNull().default('balanced'),
  cardDensity: text('card_density').notNull().default('comfortable'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const sharedCategories = pgTable('shared_categories', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id')
    .notNull()
    .references(() => users.uid, { onDelete: 'cascade' }),
  categoryId: text('category_id')
    .notNull()
    .references(() => categories.id, { onDelete: 'cascade' }),
  categoryName: text('category_name').notNull(),
  categoryIcon: text('category_icon').notNull().default('bookmark'),
  isPublic: boolean('is_public').notNull().default(true),
  subcategories: jsonb('subcategories')
    .$type<SharedSubcategorySnapshot[]>()
    .notNull()
    .default([]),
  bookmarks: jsonb('bookmarks')
    .$type<SharedBookmarkSnapshot[]>()
    .notNull()
    .default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const usersRelations = relations(users, ({ many, one }) => ({
  categories: many(categories),
  bookmarks: many(bookmarks),
  quickShortcuts: many(quickShortcuts),
  sharedCategories: many(sharedCategories),
  settings: one(userSettings, {
    fields: [users.uid],
    references: [userSettings.ownerId],
  }),
}));

export const categoriesRelations = relations(categories, ({ one, many }) => ({
  owner: one(users, {
    fields: [categories.ownerId],
    references: [users.uid],
  }),
  bookmarks: many(bookmarks),
  shares: many(sharedCategories),
}));

export const bookmarksRelations = relations(bookmarks, ({ one }) => ({
  owner: one(users, {
    fields: [bookmarks.ownerId],
    references: [users.uid],
  }),
  category: one(categories, {
    fields: [bookmarks.categoryId],
    references: [categories.id],
  }),
}));

export const quickShortcutsRelations = relations(quickShortcuts, ({ one }) => ({
  owner: one(users, {
    fields: [quickShortcuts.ownerId],
    references: [users.uid],
  }),
}));

export const userSettingsRelations = relations(userSettings, ({ one }) => ({
  owner: one(users, {
    fields: [userSettings.ownerId],
    references: [users.uid],
  }),
}));

export const sharedCategoriesRelations = relations(sharedCategories, ({ one }) => ({
  owner: one(users, {
    fields: [sharedCategories.ownerId],
    references: [users.uid],
  }),
  category: one(categories, {
    fields: [sharedCategories.categoryId],
    references: [categories.id],
  }),
}));
