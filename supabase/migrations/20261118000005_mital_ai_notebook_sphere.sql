-- Mital AI: notebook entries (documents, notes, links, saved photos) also belong to a sphere of life.
-- Everything saved so far was about work.
alter table public.ai_notebook add column sphere text not null default 'work'
  check (sphere in ('work', 'personal', 'family', 'friends', 'ideas'));
