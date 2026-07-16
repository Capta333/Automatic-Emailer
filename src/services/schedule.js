// Business-day scheduling helpers for the follow-up drip.
//
// Note: weekends are skipped; public holidays are NOT (no holiday calendar).
// Good enough for a 3-business-day cadence; document the caveat for the boss.
import { config } from '../config.js';

const isWeekend = (d) => d.getDay() === 0 || d.getDay() === 6;

// Returns a new Date `days` business days after `from`, preserving time-of-day.
export function addBusinessDays(from, days) {
  const d = new Date(from);
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    if (!isWeekend(d)) added++;
  }
  return d;
}

// Pull a time into the configured business-hours window (and off weekends).
// Used so follow-ups don't get scheduled for 2am. Minutes are randomized a
// little so a batch of follow-ups doesn't all land on the same exact minute.
export function clampToWindow(date) {
  const d = new Date(date);
  while (isWeekend(d)) {
    d.setDate(d.getDate() + 1);
    d.setHours(config.sendWindowStartHour, 0, 0, 0);
  }
  if (d.getHours() < config.sendWindowStartHour) {
    d.setHours(config.sendWindowStartHour, Math.floor(Math.random() * 30), 0, 0);
  } else if (d.getHours() >= config.sendWindowEndHour) {
    // Past the window — push to the next business day's opening.
    const next = addBusinessDays(d, 1);
    next.setHours(config.sendWindowStartHour, Math.floor(Math.random() * 30), 0, 0);
    return next;
  }
  return d;
}

// When should step N go out, measured from the campaign launch time?
// step 0 = now; each later step is gap_days business days after the previous,
// clamped into business hours.
export function sendTimeForStep(step, gapDays, from = new Date()) {
  if (step === 0) return new Date(from);
  return clampToWindow(addBusinessDays(from, gapDays * step));
}
