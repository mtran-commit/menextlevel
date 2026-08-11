import {
  pgTable,
  text,
  serial,
  integer,
  boolean,
  timestamp,
  jsonb,
  date,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ---------- Users ----------
export const usersTable = pgTable("users", {
  id: text("id").primaryKey(), // Clerk user id
  email: text("email"),
  username: text("username"),
  signature: text("signature").default("Team Me").notNull(),
  timezone: text("timezone").default("UTC").notNull(),
  role: text("role").default("user").notNull(), // user | admin
  tutorialDone: boolean("tutorial_done").default(false).notNull(),
  status: text("status").default("active").notNull(), // active | suspended
  createdAt: timestamp("created_at").defaultNow().notNull(),
  lastSeenAt: timestamp("last_seen_at").defaultNow().notNull(),
});
export type User = typeof usersTable.$inferSelect;

// ---------- Live game state blob (source of truth for the in-progress day) ----------
export const gameStatesTable = pgTable("game_states", {
  userId: text("user_id").primaryKey().references(() => usersTable.id, { onDelete: "cascade" }),
  state: jsonb("state").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ---------- Seasons ----------
export const seasonsTable = pgTable(
  "seasons",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    number: integer("number").default(1).notNull(),
    startDate: date("start_date").notNull(),
    endedAt: timestamp("ended_at"),
  },
  (t) => [uniqueIndex("seasons_user_start_idx").on(t.userId, t.startDate)],
);

// ---------- Tags ----------
export const assetsTable = pgTable(
  "assets",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // Nullable so the Publish diff adds the column without a conflicting default.
    // A startup DML backfill in the API server populates it for existing rows.
    normalizedName: text("normalized_name"),
    active: boolean("active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("assets_user_name_idx").on(t.userId, t.name),
    // Partial index: NULLs are excluded, so pre-migration rows don't conflict.
    uniqueIndex("assets_user_norm_idx").on(t.userId, t.normalizedName).where(sql`normalized_name IS NOT NULL`),
  ],
);

export const liabilitiesTable = pgTable(
  "liabilities",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // Same nullable + partial-index pattern as assetsTable.
    normalizedName: text("normalized_name"),
    active: boolean("active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("liabilities_user_name_idx").on(t.userId, t.name),
    uniqueIndex("liabilities_user_norm_idx").on(t.userId, t.normalizedName).where(sql`normalized_name IS NOT NULL`),
  ],
);

// ---------- Daily matches / scores ----------
export const dailyMatchesTable = pgTable(
  "daily_matches",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    me: integer("me").default(0).notNull(),
    notme: integer("notme").default(0).notNull(),
    result: text("result").notNull(), // me | notme | draw
    details: jsonb("details"), // per-tag done/scored/addressed snapshot
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("daily_matches_user_date_idx").on(t.userId, t.date),
    index("daily_matches_date_idx").on(t.date),
  ],
);

// ---------- Streaks ----------
export const streaksTable = pgTable("streaks", {
  userId: text("user_id").primaryKey().references(() => usersTable.id, { onDelete: "cascade" }),
  current: integer("current").default(1).notNull(),
  best: integer("best").default(0).notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ---------- Achievements ----------
export const achievementsTable = pgTable(
  "achievements",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    milestone: integer("milestone").notNull(), // 7 | 30 | 60 | 90
    seasonNumber: integer("season_number").default(1).notNull(),
    achievedAt: timestamp("achieved_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("achievements_user_ms_season_idx").on(t.userId, t.milestone, t.seasonNumber)],
);

export const achievementRulesTable = pgTable("achievement_rules", {
  id: serial("id").primaryKey(),
  milestone: integer("milestone").notNull().unique(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  enabled: boolean("enabled").default(true).notNull(),
});

// ---------- Friend challenges ----------
export const friendChallengesTable = pgTable(
  "friend_challenges",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    friendName: text("friend_name").notNull(),
    friendScore: integer("friend_score"),
    date: date("date").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("friend_challenges_user_idx").on(t.userId)],
);

// ---------- Notifications ----------
export const notificationsTable = pgTable(
  "notifications",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    read: boolean("read").default(false).notNull(),
    dedupeKey: text("dedupe_key"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("notifications_user_idx").on(t.userId),
    uniqueIndex("notifications_dedupe_idx").on(t.userId, t.dedupeKey),
  ],
);

export const pushSubscriptionsTable = pgTable(
  "push_subscriptions",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull().unique(),
    keys: jsonb("keys").notNull(), // { p256dh, auth }
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("push_subs_user_idx").on(t.userId)],
);

// ---------- User settings (notification prefs etc.) ----------
export const userSettingsTable = pgTable("user_settings", {
  userId: text("user_id").primaryKey().references(() => usersTable.id, { onDelete: "cascade" }),
  // { [notificationType]: { inapp: boolean, push: boolean } }
  notificationPrefs: jsonb("notification_prefs").notNull(),
  pushEnabled: boolean("push_enabled").default(false).notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ---------- Moderation / announcements ----------
export const reportsTable = pgTable("reports", {
  id: serial("id").primaryKey(),
  reporterId: text("reporter_id").references(() => usersTable.id, { onDelete: "set null" }),
  targetUserId: text("target_user_id"),
  targetType: text("target_type").notNull(), // tag | signature | other
  targetContent: text("target_content"),
  reason: text("reason").notNull(),
  status: text("status").default("open").notNull(), // open | resolved | dismissed
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const announcementsTable = pgTable("announcements", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ---------- App config (server-generated keys, e.g. VAPID) ----------
export const appConfigTable = pgTable("app_config", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ---------- Analytics events (onboarding funnel etc.) ----------
export const analyticsEventsTable = pgTable(
  "analytics_events",
  {
    id: serial("id").primaryKey(),
    anonId: text("anon_id"),
    userId: text("user_id"),
    event: text("event").notNull(),
    props: jsonb("props"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("analytics_events_event_idx").on(t.event, t.createdAt)],
);

// ---------- Arena sponsor advertising ----------
export const sponsorCampaignsTable = pgTable(
  "sponsor_campaigns",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(), // internal campaign name
    sponsorName: text("sponsor_name").notNull(), // shown on the board
    adType: text("ad_type").default("text").notNull(), // logo | text | banner
    textContent: text("text_content"), // e.g. "POWERED BY BRAND"
    ctaText: text("cta_text"), // e.g. "START YOUR FREE TRIAL"
    destinationUrl: text("destination_url"),
    logoData: text("logo_data"), // small data-URL image
    bannerData: text("banner_data"), // wide data-URL image
    placement: text("placement").default("any").notNull(), // left | right | backboard | ribbon | any
    startDate: date("start_date"),
    endDate: date("end_date"),
    durationSec: integer("duration_sec").default(8).notNull(),
    priority: integer("priority").default(0).notNull(),
    frequency: integer("frequency").default(1).notNull(), // rotation weight
    active: boolean("active").default(true).notNull(),
    // Optional targeting: { countries?: string[], regions?: string[], ageMin?, ageMax?,
    // devices?: ("mobile"|"desktop")[], audience?: "guest"|"registered"|"all" }.
    // NEVER derived from assets/liabilities/fans/doubters — those stay private.
    targeting: jsonb("targeting"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [index("sponsor_campaigns_active_idx").on(t.active, t.priority)],
);

export const sponsorEventsTable = pgTable(
  "sponsor_events",
  {
    id: serial("id").primaryKey(),
    campaignId: integer("campaign_id").notNull().references(() => sponsorCampaignsTable.id, { onDelete: "cascade" }),
    event: text("event").notNull(), // sponsor_impression | sponsor_click | sponsor_campaign_view | sponsor_placement | sponsor_milestone_view
    placement: text("placement"),
    device: text("device"), // mobile | desktop
    audience: text("audience"), // guest | registered
    anonId: text("anon_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("sponsor_events_campaign_idx").on(t.campaignId, t.event, t.createdAt)],
);

// ---------- Products (Shop) ----------
export const productsTable = pgTable(
  "products",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    shortDescription: text("short_description").notNull().default(""),
    description: text("description").notNull().default(""),
    whatsIncluded: text("whats_included").notNull().default(""),
    price: text("price").notNull().default("0.00"),
    currency: text("currency").notNull().default("AUD"),
    imageUrl: text("image_url").notNull().default(""),
    active: boolean("active").notNull().default(true),
    soldOut: boolean("sold_out").notNull().default(false),
    stockQuantity: integer("stock_quantity"),
    displayOrder: integer("display_order").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [index("products_active_order_idx").on(t.active, t.displayOrder)]
);
export type Product = typeof productsTable.$inferSelect;

// ---------- Orders ----------
export const ordersTable = pgTable(
  "orders",
  {
    id: serial("id").primaryKey(),
    orderNumber: text("order_number").notNull().unique(),
    userId: text("user_id"),
    customerName: text("customer_name").notNull().default(""),
    customerEmail: text("customer_email").notNull().default(""),
    customerPhone: text("customer_phone").notNull().default(""),
    shippingAddress: jsonb("shipping_address").notNull().default({}),
    subtotal: text("subtotal").notNull().default("0.00"),
    shipping: text("shipping").notNull().default("0.00"),
    total: text("total").notNull().default("0.00"),
    currency: text("currency").notNull().default("AUD"),
    paymentStatus: text("payment_status").notNull().default("pending"), // pending | paid | failed | refunded
    orderStatus: text("order_status").notNull().default("new"),         // new | paid | processing | packed | shipped | delivered | cancelled | refunded
    stripePaymentId: text("stripe_payment_id").notNull().default(""),
    stripeCheckoutSessionId: text("stripe_checkout_session_id").notNull().default(""),
    trackingNumber: text("tracking_number").notNull().default(""),
    courier: text("courier").notNull().default(""),
    adminNotes: text("admin_notes").notNull().default(""),
    // Email delivery tracking
    // null      = pre-feature order (never touch)
    // pending   = waiting to be claimed by a worker
    // in_flight = a worker holds the lease and is sending right now
    // sent      = successfully delivered (terminal)
    // failed    = max attempts exhausted (terminal)
    confirmationEmailStatus: text("confirmation_email_status"),
    confirmationEmailAttempts: integer("confirmation_email_attempts").notNull().default(0),
    confirmationEmailLockedAt: timestamp("confirmation_email_locked_at"), // when current in_flight lease was acquired
    confirmationEmailSentAt: timestamp("confirmation_email_sent_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("orders_status_idx").on(t.orderStatus),
    index("orders_payment_idx").on(t.paymentStatus),
    index("orders_created_idx").on(t.createdAt),
    index("orders_email_idx").on(t.customerEmail),
    index("orders_confirm_email_idx").on(t.confirmationEmailStatus),
  ]
);
export type Order = typeof ordersTable.$inferSelect;

export const orderItemsTable = pgTable(
  "order_items",
  {
    id: serial("id").primaryKey(),
    orderId: integer("order_id").notNull().references(() => ordersTable.id, { onDelete: "cascade" }),
    productId: integer("product_id"),
    productName: text("product_name").notNull().default(""),
    productSlug: text("product_slug").notNull().default(""),
    quantity: integer("quantity").notNull().default(1),
    unitPrice: text("unit_price").notNull().default("0.00"),
    currency: text("currency").notNull().default("AUD"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("order_items_order_idx").on(t.orderId)]
);
export type OrderItem = typeof orderItemsTable.$inferSelect;

// ---------- Audit logs ----------
export const auditLogsTable = pgTable(
  "audit_logs",
  {
    id: serial("id").primaryKey(),
    actorId: text("actor_id"),
    userId: text("user_id"),
    action: text("action").notNull(),
    level: text("level").default("info").notNull(), // info | warn | error
    details: jsonb("details"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("audit_logs_created_idx").on(t.createdAt)],
);
