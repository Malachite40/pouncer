import {
    boolean,
    integer,
    numeric,
    pgTable,
    serial,
    text,
    timestamp,
    uuid,
} from 'drizzle-orm/pg-core';

// Better Auth tables
export const user = pgTable('user', {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull().unique(),
    emailVerified: boolean('email_verified').notNull(),
    image: text('image'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

export const session = pgTable('session', {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    token: text('token').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
        .notNull()
        .references(() => user.id, { onDelete: 'cascade' }),
});

export const account = pgTable('account', {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
        .notNull()
        .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', {
        withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', {
        withTimezone: true,
    }),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

export const verification = pgTable('verification', {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
});

export const watches = pgTable('watches', {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    name: text('name').notNull(),
    checkType: text('check_type').notNull().default('both'),
    cssSelector: text('css_selector'),
    checkIntervalSeconds: integer('check_interval_seconds').notNull().default(900),
    lastPrice: numeric('last_price'),
    lastStockStatus: text('last_stock_status'),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
    notifyPrice: boolean('notify_price').notNull().default(true),
    notifyStock: boolean('notify_stock').notNull().default(true),
    priceThreshold: numeric('price_threshold'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
        .notNull()
        .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
        .notNull()
        .defaultNow(),
});

export const checkResults = pgTable('check_results', {
    id: serial('id').primaryKey(),
    watchId: uuid('watch_id')
        .notNull()
        .references(() => watches.id, { onDelete: 'cascade' }),
    price: numeric('price'),
    stockStatus: text('stock_status'),
    rawContent: text('raw_content'),
    error: text('error'),
    checkedAt: timestamp('checked_at', { withTimezone: true })
        .notNull()
        .defaultNow(),
});

export const notificationSettings = pgTable('notification_settings', {
    id: serial('id').primaryKey(),
    userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
    telegramChatId: text('telegram_chat_id').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
        .notNull()
        .defaultNow(),
});
