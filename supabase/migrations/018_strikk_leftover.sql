-- Whether a recipe itself mentions leftover yarn (restegarn, rester, leftover …), found
-- by searching the PDF text locally (scripts/strikk/leftover.mjs and save.mjs).
-- null: not checked (no text layer, or not scanned yet). leftover_note: the words found.
alter table strikk_oppskrift add column if not exists mentions_leftover boolean;
alter table strikk_oppskrift add column if not exists leftover_note text;
