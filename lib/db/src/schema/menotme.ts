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
    normalizedName: text("normalized_name").notNull().default(""),
    active: boolean("active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("assets_user_name_idx").on(t.userId, t.name),
    uniqueIndex("assets_user_norm_idx").on(t.userId, t.normalizedName),
  ],
);

export const liabilitiesTable = pgTable(
  "liabilities",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull().default(""),
    active: boolean("active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("liabilities_user_name_idx").on(t.userId, t.name),
    uniqueIndex("liabilities_user_norm_idx").on(t.userId, t.normalizedName),
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
