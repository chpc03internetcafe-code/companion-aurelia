-- OPTIONAL, PERMANENT: deletes the data of the removed member portal, VIP tiers and companion portal.
-- Run in Supabase → SQL Editor only when you're sure you no longer need it (members, memberships, favourites,
-- VIP tiers and collections, companion logins and pending profile updates). Take a backup first.
--
-- Bookings, contact messages and live chats are kept; only their (unused) links to member accounts are dropped.
-- Running supabase-setup.sql again afterwards recreates these tables empty, which is harmless.
BEGIN;
DROP TABLE IF EXISTS
  member_favorites, member_mfa_challenges, member_tokens, member_sessions, memberships,
  collection_profiles, collections,
  companion_mfa_challenges, companion_tokens, companion_sessions, companion_accounts,
  profile_change_requests,
  members, tiers
CASCADE;
COMMIT;
