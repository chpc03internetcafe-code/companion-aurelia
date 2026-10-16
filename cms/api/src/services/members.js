// VIP memberships: requests from the portal, approval by staff, renewals and upgrades.
//
// A member has at most one current tier (members.tier_id) valid through members.membership_expires_on.
// Approving a request:
//   - New / Upgrade: starts today, runs the tier's duration_days (an upgrade replaces the current tier).
//   - Renewal of the same tier while still active: starts the day after the current expiry, so no days are lost.
// Every request and grant is a row in memberships, which is the history shown to staff and the member.
import { HttpError } from '../lib/http.js';
import { addDays, phDate } from '../lib/dates.js';
import { newReference } from '../lib/refs.js';

export const MEMBERSHIP_STATUSES = ['Pending', 'Active', 'Expired', 'Rejected', 'Cancelled'];
export const MEMBERSHIP_KINDS = ['New', 'Renewal', 'Upgrade', 'Manual'];
export const MEMBER_PAYMENT_METHODS = ['GCash', 'Maya', 'Bank transfer', 'Card', 'Cash', 'Other'];

export const SELECT_MEMBERSHIP = `
  SELECT ms.*, t.name AS tier_name, t.rank AS tier_rank, t.duration_days, m.full_name AS member_name, m.email AS member_email, m.member_no
  FROM memberships ms JOIN tiers t ON t.id = ms.tier_id JOIN members m ON m.id = ms.member_id`;

/** Which kind a request is, given the member's current tier. */
export function requestKind(member, tier) {
  const active = member.tierId && member.membershipExpiresOn && member.membershipExpiresOn >= phDate();
  if (!member.tierId) return 'New';
  if (member.tierId === tier.id) return 'Renewal';
  return active && tier.rank > (member.currentRank || 0) ? 'Upgrade' : 'New';
}

/** Marks memberships whose end date has passed as Expired (lazy; called when lists are read). */
export async function expireOld(db) {
  await db.run("UPDATE memberships SET status = 'Expired', updated_at = now() WHERE status = 'Active' AND ends_on < ph_today()");
}

/** Activates a membership row (db = tx helpers). Returns the updated membership. */
export async function activate(db, membership, { actor, staffNote, startsOn }) {
  const member = await db.one('SELECT id, tier_id, membership_expires_on FROM members WHERE id = $1 FOR UPDATE', [membership.memberId]);
  const tier = await db.one('SELECT id, name, duration_days, is_active FROM tiers WHERE id = $1', [membership.tierId]);
  if (!tier?.isActive) throw new HttpError(409, 'This tier is no longer active. Reactivate it or choose another tier.');
  const today = phDate();
  let start = startsOn || today;
  if (!startsOn && membership.kind === 'Renewal' && member.tierId === tier.id && member.membershipExpiresOn && member.membershipExpiresOn >= today) {
    start = addDays(member.membershipExpiresOn, 1);
  }
  const end = addDays(start, tier.durationDays - 1);
  await db.run(
    `UPDATE memberships SET status = 'Active', starts_on = $1, ends_on = $2, staff_note = COALESCE($3::text, staff_note), decided_by = $4, decided_at = now(), updated_at = now() WHERE id = $5`,
    [start, end, staffNote || null, actor, membership.id]
  );
  // an upgrade or new tier ends earlier active memberships of another tier
  await db.run("UPDATE memberships SET status = 'Cancelled', staff_note = COALESCE(staff_note, 'Replaced by ' || $3::text), updated_at = now() WHERE member_id = $1 AND id <> $2 AND status = 'Active' AND tier_id <> $4",
    [member.id, membership.id, membership.membershipNo, tier.id]);
  await db.run('UPDATE members SET tier_id = $1, membership_expires_on = $2, updated_at = now() WHERE id = $3', [tier.id, end, member.id]);
  return db.one(`${SELECT_MEMBERSHIP} WHERE ms.id = $1`, [membership.id]);
}

/** Creates a membership row. status Pending for portal requests; Manual grants are activated straight away by the caller. */
export async function createMembership(db, { memberId, tierId, kind, amount, paymentMethod, paymentReference, memberNote, staffNote }) {
  const membershipNo = await newReference(db, 'MEM', 'memberships', 'membership_no');
  const row = await db.one(
    `INSERT INTO memberships (membership_no, member_id, tier_id, kind, amount, payment_method, payment_reference, member_note, staff_note)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [membershipNo, memberId, tierId, kind, amount || 0, paymentMethod || null, paymentReference || null, memberNote || null, staffNote || null]
  );
  return db.one(`${SELECT_MEMBERSHIP} WHERE ms.id = $1`, [row.id]);
}

/** The member's effective tier rank (0 = none / expired). */
export const RANK_SQL = `CASE WHEN t.id IS NOT NULL AND t.is_active AND m.membership_expires_on >= ph_today() THEN t.rank ELSE 0 END`;
