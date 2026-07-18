import {
  db,
  achievementsTable,
  assetsTable,
  dailyMatchesTable,
  friendChallengesTable,
  gameStatesTable,
  liabilitiesTable,
  seasonsTable,
  streaksTable,
  usersTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { notifyUser } from "./notify";
import { logAudit } from "./audit";

/** Mirror of the client state shape stored in localStorage key menotme_complete_v1. */
export interface GameState {
  date: string;
  seasonStart: string;
  me: number;
  notme: number;
  streak: number;
  best: number;
  combo: number;
  crowd: number;
  ended: boolean;
  selected: number | null;
  assets: { name: string; done: boolean; scored: boolean }[];
  liabilities: { name: string; addressed: boolean; avoided: boolean }[];
  weekly: { meWins: number; notMeWins: number; history: { date: string; me: number; notme: number }[] };
  friend: { name: string; score: number | null };
  gate: { required: boolean; asset: boolean; liability: boolean };
  signature: string;
  shown: Record<string, boolean>;
}

export const DEFAULT_ASSETS = ["Morning Workout", "Read 20 Pages", "Meditation", "Cold Shower"];
export const DEFAULT_LIABILITIES = ["Tomorrow's Me", "Skip Workout", "Mindless Scroll", "Late Nights"];

export function defaultState(today: string): GameState {
  return {
    date: today,
    seasonStart: today,
    me: 0,
    notme: 0,
    streak: 1,
    best: 0,
    combo: 0,
    crowd: 65,
    ended: false,
    selected: null,
    assets: DEFAULT_ASSETS.map((name) => ({ name, done: false, scored: false })),
    liabilities: DEFAULT_LIABILITIES.map((name) => ({ name, addressed: false, avoided: true })),
    weekly: { meWins: 0, notMeWins: 0, history: [] },
    friend: { name: "", score: null },
    gate: { required: false, asset: false, liability: false },
    signature: "Team Me",
    shown: { 7: false, 30: false, 60: false, 90: false },
  };
}

export function isValidState(s: unknown): s is GameState {
  if (!s || typeof s !== "object") return false;
  const o = s as Record<string, unknown>;
  const weekly = o.weekly as Record<string, unknown> | undefined;
  const gate = o.gate as Record<string, unknown> | undefined;
  const friend = o.friend as Record<string, unknown> | undefined;
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(String(o.date)) &&
    /^\d{4}-\d{2}-\d{2}$/.test(String(o.seasonStart)) &&
    typeof o.me === "number" &&
    typeof o.notme === "number" &&
    typeof o.streak === "number" &&
    typeof o.best === "number" &&
    typeof o.ended === "boolean" &&
    Array.isArray(o.assets) &&
    (o.assets as unknown[]).every((a) => a && typeof (a as { name?: unknown }).name === "string") &&
    Array.isArray(o.liabilities) &&
    (o.liabilities as unknown[]).every((l) => l && typeof (l as { name?: unknown }).name === "string") &&
    !!weekly &&
    typeof weekly.meWins === "number" &&
    typeof weekly.notMeWins === "number" &&
    Array.isArray(weekly.history) &&
    !!gate &&
    typeof gate.required === "boolean" &&
    !!friend &&
    typeof o.shown === "object" &&
    o.shown !== null
  );
}

/** Mirror of the client's gateComplete(). */
export function gateComplete(state: GameState): boolean {
  return !state.gate.required || (state.gate.asset && state.gate.liability);
}

/** User's local date (YYYY-MM-DD) for an IANA timezone. */
export function localDate(timezone: string, d = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(d);
  } catch {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(d);
  }
}

/** Minutes remaining until the user's local midnight. */
export function minutesToMidnight(timezone: string, d = new Date()): number {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(d);
    const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
    const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
    return 24 * 60 - (h * 60 + m);
  } catch {
    return 24 * 60;
  }
}

function daysBetween(a: string, b: string): number {
  return Math.floor((new Date(b + "T00:00:00Z").getTime() - new Date(a + "T00:00:00Z").getTime()) / 86400000);
}

/**
 * Apply Final Bell to a state (mirror of the client's finalBell()).
 * Mutates and returns the state. Does not touch the DB.
 */
export function applyFinalBell(state: GameState): { meWon: boolean; newMilestone: number | null } {
  for (const l of state.liabilities) {
    if (l.addressed && l.avoided) state.me++;
    else state.notme++;
  }
  state.ended = true;
  const meWon = state.me > state.notme;
  if (meWon) {
    state.streak++;
    state.best = Math.max(state.best, state.streak);
    state.weekly.meWins++;
  } else {
    state.streak = 1;
    state.weekly.notMeWins++;
  }
  state.weekly.history.push({ date: state.date, me: state.me, notme: state.notme });

  let newMilestone: number | null = null;
  const s = state.streak;
  if (s >= 90 && !state.shown[90]) {
    state.shown[90] = true;
    newMilestone = 90;
  } else if (s >= 60 && !state.shown[60]) {
    state.shown[60] = true;
    newMilestone = 60;
  } else if (s >= 30 && !state.shown[30]) {
    state.shown[30] = true;
    state.gate = { required: true, asset: false, liability: false };
    newMilestone = 30;
  } else if (s >= 7 && !state.shown[7]) {
    state.shown[7] = true;
    newMilestone = 7;
  }
  return { meWon, newMilestone };
}

/** Roll the state to a new day (mirror of the client's rollDay()). */
export function rollDay(state: GameState, today: string) {
  if (state.date !== today) {
    state.date = today;
    state.me = 0;
    state.notme = 0;
    state.combo = 0;
    state.crowd = 65;
    state.ended = false;
    state.selected = null;
    state.assets.forEach((a) => {
      a.done = false;
      a.scored = false;
    });
    state.liabilities.forEach((l) => {
      l.addressed = false;
      l.avoided = true;
    });
  }
}

/** Season reset (mirror of the client's resetSeasonIfNeeded()). */
export function resetSeasonIfNeeded(state: GameState, today: string): GameState {
  if (daysBetween(state.seasonStart, today) >= 90) {
    return defaultState(today);
  }
  return state;
}

/**
 * Sync normalized tables from a saved state (idempotent).
 * Records daily match when the day ended, streaks, achievements, tags, friend challenge.
 */
export async function syncNormalized(userId: string, state: GameState) {
  // streaks
  await db
    .insert(streaksTable)
    .values({ userId, current: state.streak, best: state.best })
    .onConflictDoUpdate({
      target: streaksTable.userId,
      set: { current: state.streak, best: state.best, updatedAt: new Date() },
    });

  // tags
  for (const a of state.assets) {
    await db.insert(assetsTable).values({ userId, name: a.name }).onConflictDoNothing();
  }
  for (const l of state.liabilities) {
    await db.insert(liabilitiesTable).values({ userId, name: l.name }).onConflictDoNothing();
  }

  // season (unique on userId+startDate; number = count of prior seasons + 1)
  let [season] = await db
    .select()
    .from(seasonsTable)
    .where(and(eq(seasonsTable.userId, userId), eq(seasonsTable.startDate, state.seasonStart)));
  if (!season) {
    const existing = await db.select().from(seasonsTable).where(eq(seasonsTable.userId, userId));
    [season] = await db
      .insert(seasonsTable)
      .values({ userId, startDate: state.seasonStart, number: existing.length + 1 })
      .onConflictDoNothing()
      .returning();
    if (!season) {
      [season] = await db
        .select()
        .from(seasonsTable)
        .where(and(eq(seasonsTable.userId, userId), eq(seasonsTable.startDate, state.seasonStart)));
    }
  }

  // completed day
  if (state.ended) {
    const result = state.me > state.notme ? "me" : state.notme > state.me ? "notme" : "draw";
    await db
      .insert(dailyMatchesTable)
      .values({
        userId,
        date: state.date,
        me: state.me,
        notme: state.notme,
        result,
        details: { assets: state.assets, liabilities: state.liabilities },
      })
      .onConflictDoUpdate({
        target: [dailyMatchesTable.userId, dailyMatchesTable.date],
        set: {
          me: state.me,
          notme: state.notme,
          result,
          details: { assets: state.assets, liabilities: state.liabilities },
        },
      });
  }

  // achievements from shown flags
  for (const ms of [7, 30, 60, 90]) {
    if (state.shown[ms]) {
      await db
        .insert(achievementsTable)
        .values({ userId, milestone: ms, seasonNumber: season?.number ?? 1 })
        .onConflictDoNothing();
    }
  }

  // friend challenge snapshot
  if (state.friend?.name) {
    const existing = await db
      .select()
      .from(friendChallengesTable)
      .where(and(eq(friendChallengesTable.userId, userId), eq(friendChallengesTable.date, state.date)));
    if (existing.length === 0) {
      await db.insert(friendChallengesTable).values({
        userId,
        friendName: state.friend.name,
        friendScore: state.friend.score,
        date: state.date,
      });
    } else {
      await db
        .update(friendChallengesTable)
        .set({ friendName: state.friend.name, friendScore: state.friend.score })
        .where(eq(friendChallengesTable.id, existing[0].id));
    }
  }
}

const MILESTONE_TEXT: Record<number, string> = {
  7: "7 Days Straight — the paparazzi are waiting. Sign your autograph!",
  30: "30 Days Straight — MeNotMe Champion! Add one new Asset and one new Liability for the next challenge.",
  60: "60 Days Straight — welcome to the Wall of Fame.",
  90: "90 Days Straight — Retirement Ceremony. Team Me retires the jersey.",
};

/**
 * Server-side daily reset: for each user whose local date moved past their
 * state's date with the day un-ended, apply Final Bell (counting ignored
 * liabilities for Team Not Me), record the day, then roll to the new day.
 */
export async function runDailyResets() {
  const rows = await db
    .select({
      userId: gameStatesTable.userId,
      state: gameStatesTable.state,
      updatedAt: gameStatesTable.updatedAt,
      timezone: usersTable.timezone,
    })
    .from(gameStatesTable)
    .innerJoin(usersTable, eq(usersTable.id, gameStatesTable.userId));

  for (const row of rows) {
    try {
      const state = row.state as GameState;
      if (!isValidState(state)) continue;
      const today = localDate(row.timezone);
      if (state.date >= today) continue; // still the same local day

      // Mirror of client behavior: finalBell() is blocked while the 30-day
      // gate is incomplete; the day then rolls over unrecorded.
      if (!state.ended && gateComplete(state)) {
        const { meWon, newMilestone } = applyFinalBell(state);
        await syncNormalized(row.userId, state);
        await logAudit({ userId: row.userId, action: "auto_final_bell", details: { date: state.date, me: state.me, notme: state.notme } });
        if (meWon && newMilestone) {
          await notifyUser({
            userId: row.userId,
            type: "milestone_achieved",
            title: "Milestone reached!",
            body: MILESTONE_TEXT[newMilestone] ?? `${newMilestone} days straight!`,
            dedupeKey: `milestone_${newMilestone}_${state.seasonStart}`,
          });
        }
        if (!meWon) {
          await notifyUser({
            userId: row.userId,
            type: "streak_at_risk",
            title: "Team Not Me took yesterday",
            body: "Your streak reset to Day 1. Win today to start climbing again.",
            dedupeKey: `streak_reset_${state.date}`,
          });
        }
      }

      // roll to today and handle season end
      const prevSeasonStart = state.seasonStart;
      rollDay(state, today);
      const next = resetSeasonIfNeeded(state, today);
      if (next !== state) {
        await logAudit({ userId: row.userId, action: "season_reset", details: { previousSeasonStart: prevSeasonStart } });
      }
      // Compare-and-swap: only write if the client hasn't saved meanwhile.
      await db
        .update(gameStatesTable)
        .set({ state: next, updatedAt: new Date() })
        .where(and(eq(gameStatesTable.userId, row.userId), eq(gameStatesTable.updatedAt, row.updatedAt)));
    } catch (err) {
      await logAudit({ userId: row.userId, action: "daily_reset_failed", level: "error", details: { message: String(err) } });
    }
  }
}

/** Retention reminders, deduped one per type per local day. */
export async function runReminders() {
  const rows = await db
    .select({ userId: gameStatesTable.userId, state: gameStatesTable.state, timezone: usersTable.timezone })
    .from(gameStatesTable)
    .innerJoin(usersTable, eq(usersTable.id, gameStatesTable.userId));

  for (const row of rows) {
    try {
    const state = row.state as GameState;
    if (!isValidState(state)) continue;
    const today = localDate(row.timezone);
    if (state.date !== today || state.ended) continue;

    const mins = minutesToMidnight(row.timezone);
    const unaddressed = state.liabilities.filter((l) => !l.addressed).length;
    const day = today;

    // Final Bell approaching (last 2 hours)
    if (mins <= 120) {
      await notifyUser({
        userId: row.userId,
        type: "final_bell_reminder",
        title: "Final Bell approaching",
        body: `The Final Bell rings in under ${Math.ceil(mins / 60)} hour${mins > 60 ? "s" : ""}. Lock in today's win.`,
        dedupeKey: `final_bell_${day}`,
      });
      if (unaddressed > 0) {
        await notifyUser({
          userId: row.userId,
          type: "liabilities_unaddressed",
          title: "Liabilities still ignored",
          body: `You haven't addressed ${unaddressed} liabilit${unaddressed === 1 ? "y" : "ies"} — each one scores for Team Not Me at the bell.`,
          dedupeKey: `liab_${day}`,
        });
      }
    }

    // Team Not Me currently winning (projected: ignored liabilities count for Not Me)
    const projectedNotMe = state.notme + unaddressed;
    const projectedMe = state.me + state.liabilities.filter((l) => l.addressed && l.avoided).length;
    if (mins <= 360 && projectedNotMe > projectedMe) {
      await notifyUser({
        userId: row.userId,
        type: "notme_winning",
        title: "Team Not Me is winning",
        body: `Projected score: Team Not Me ${projectedNotMe} — ${projectedMe} Team Me. Turn it around before the bell.`,
        dedupeKey: `notme_winning_${day}`,
      });
    }
    if (mins <= 360 && projectedNotMe - projectedMe === 1) {
      await notifyUser({
        userId: row.userId,
        type: "one_more_asset",
        title: "One more Asset to take the lead",
        body: "Score one more Asset shot and Team Me takes the lead.",
        dedupeKey: `one_more_${day}`,
      });
    }

    // Streak at risk (evening, nothing scored yet)
    if (mins <= 240 && state.me === 0 && state.streak > 1) {
      await notifyUser({
        userId: row.userId,
        type: "streak_at_risk",
        title: `Day ${state.streak} streak at risk`,
        body: "No Asset shots yet today. Don't let Team Not Me end the run.",
        dedupeKey: `streak_risk_${day}`,
      });
    }

    // 7-day milestone approaching
    if (state.streak === 6 && !state.shown[7]) {
      await notifyUser({
        userId: row.userId,
        type: "milestone_approaching",
        title: "7-day milestone tomorrow",
        body: "Win today and the paparazzi show up — 7 days straight.",
        dedupeKey: `ms7_soon_${day}`,
      });
    }
    } catch (err) {
      await logAudit({ userId: row.userId, action: "reminder_run_failed", level: "error", details: { message: String(err) } });
    }
  }
}
