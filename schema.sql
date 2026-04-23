-- Chichang.ai — Supabase Schema
-- Run this in your Supabase SQL editor: https://app.supabase.com/project/_/sql

-- ─── Brand analyses ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS brand_analyses (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  handle        text        NOT NULL,
  full_name     text,
  bio           text,
  followers     int,
  engagement    text,
  niche         text,
  hashtags      text[]      DEFAULT '{}',
  sells         text,
  audience      text,
  tone          text,
  market        text,
  story         text,
  data_source   text        NOT NULL DEFAULT 'ai',  -- 'live' | 'ai'
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS brand_analyses_handle_idx ON brand_analyses (handle);

-- ─── Influencer searches ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS influencer_searches (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_handle      text        NOT NULL,
  criteria          text[]      DEFAULT '{}',
  search_keywords   text[]      DEFAULT '{}',
  influencer_tier   text,
  influencer_source text        NOT NULL DEFAULT 'ai',  -- 'live' | 'ai'
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS searches_handle_idx ON influencer_searches (brand_handle);

-- ─── Influencer matches (results of a search) ────────────────────────────────
CREATE TABLE IF NOT EXISTS influencer_matches (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  search_id       uuid        NOT NULL REFERENCES influencer_searches (id) ON DELETE CASCADE,
  brand_handle    text        NOT NULL,
  handle          text        NOT NULL,
  full_name       text,
  followers       text,
  niche_score     smallint,
  audience_score  smallint,
  engagement_score smallint,
  openness_score  smallint,
  reason          text,
  badges          text[]      DEFAULT '{}',
  rank            smallint    NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS matches_search_idx  ON influencer_matches (search_id);
CREATE INDEX IF NOT EXISTS matches_handle_idx  ON influencer_matches (brand_handle);

-- ─── Partnerships / ROI tracking ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS partnerships (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_handle        text        NOT NULL,
  influencer_handle   text        NOT NULL,
  influencer_name     text,
  status              text        NOT NULL DEFAULT 'monitoring',  -- 'monitoring' | 'confirmed' | 'completed'
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (brand_handle, influencer_handle)
);

CREATE INDEX IF NOT EXISTS partnerships_brand_idx ON partnerships (brand_handle);

-- ─── Stripe payments ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payments (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_session_id   text        UNIQUE,
  stripe_customer_id  text,
  brand_handle        text,
  plan                text,   -- 'pro' | 'enterprise'
  status              text        NOT NULL DEFAULT 'pending',  -- 'pending' | 'paid' | 'cancelled'
  amount_cents        int,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payments_handle_idx   ON payments (brand_handle);
CREATE INDEX IF NOT EXISTS payments_session_idx  ON payments (stripe_session_id);

-- ─── Row-level security (public read-only; writes only from service key) ─────
ALTER TABLE brand_analyses      ENABLE ROW LEVEL SECURITY;
ALTER TABLE influencer_searches ENABLE ROW LEVEL SECURITY;
ALTER TABLE influencer_matches  ENABLE ROW LEVEL SECURITY;
ALTER TABLE partnerships        ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments            ENABLE ROW LEVEL SECURITY;

-- All tables: allow anon SELECT, block anon INSERT/UPDATE/DELETE
-- Serverless routes use the service-role key which bypasses RLS

CREATE POLICY "anon_select" ON brand_analyses      FOR SELECT USING (true);
CREATE POLICY "anon_select" ON influencer_searches FOR SELECT USING (true);
CREATE POLICY "anon_select" ON influencer_matches  FOR SELECT USING (true);
CREATE POLICY "anon_select" ON partnerships        FOR SELECT USING (true);
-- payments are private — no public read
