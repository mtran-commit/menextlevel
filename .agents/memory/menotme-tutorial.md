---
name: MeNotMe tutorial
description: Design rules and gotchas for the first-time interactive tutorial / practice-mode replay.
---
- Tutorial is a spotlight layer (`src/tutorial.ts` + `tutorial.css`, z-9500) over the live arena; it replaced the old cloud.ts `runOnboarding`/`teachFirstShot` onboarding. Boot wiring via `initTutorial(deps)` in cloud.ts.
- **Rule:** Any fixed overlay card must never sit over the paper/hoop drag zone (bottom-centre). During the shot step the card is pinned top (`tut-pin-top`).
  **Why:** A bottom-anchored card silently ate the pointer-capture drag — shots did nothing, looked like endless misses (caught in e2e).
- **Rule:** Practice replays snapshot the real state into `mnm_tutorial_practice_v1` at start; `initTutorial` restores an orphaned snapshot on boot before any save/sync hook runs, and `pushState` skips while `practiceActive()`.
  **Why:** In-memory-only restore is not crash-safe; a mid-practice reload would let throwaway state become canonical and sync to the cloud (caught in review).
- Direct tag writes must mirror `saveTag()`'s gate side-effects (`state.gate.asset/liability`, clear `required`) or tags stay disabled under the 30-day gate.
- Completion flags: guest = `mnm_tutorial_done_v1` + `mnm_onboarded_v1` (+ `mnm_intro_day` set to today so the day intro doesn't stack); registered = monotonic `tutorialDone` on users (PATCH /account/profile accepts true only).
- Tutorial commentator clip `comm_tutorial_1` = ElevenLabs Daryl voice, registered in the crowd-audio FILES list (new comm_* keys must be added there or playCommentary silently no-ops).
