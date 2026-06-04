-- 软件工厂缩小版 · 全量初始化（Postgres 14；云端 docker-compose initdb 用）
-- 与 backend/app/models/entities.py 同源。本地 SQLite 路径用 create_all 自动建表，无需本文件。
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;

-- ---------- 核心域 ----------
CREATE TABLE project (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL, description text,
  current_stage text NOT NULL DEFAULT 'S0',
  hitl_mode text NOT NULL DEFAULT 'Semi' CHECK (hitl_mode IN ('Auto','Semi','Manual')),
  version int NOT NULL DEFAULT 1,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  parent_session_id uuid REFERENCES session(id) ON DELETE SET NULL,
  title text, stage text, agent text,
  hitl_mode text CHECK (hitl_mode IN ('Auto','Semi','Manual')),
  delegate_ref uuid,
  status text NOT NULL DEFAULT 'active',
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX idx_session_project ON session(project_id);
CREATE INDEX idx_session_parent ON session(parent_session_id);

CREATE TABLE message (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user','assistant','system','tool')),
  content text, attachments jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL DEFAULT 'completed',
  created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX idx_message_session ON message(session_id, created_at);

CREATE TABLE artifact (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  type text NOT NULL, title text NOT NULL, stage text,
  status text NOT NULL DEFAULT 'draft',
  current_version int NOT NULL DEFAULT 1, version int NOT NULL DEFAULT 1,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX idx_artifact_project ON artifact(project_id);

CREATE TABLE artifact_version (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id uuid NOT NULL REFERENCES artifact(id) ON DELETE CASCADE,
  version int NOT NULL, content text, author text NOT NULL, note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (artifact_id, version));

CREATE TABLE task (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  code text, title text NOT NULL, stage text,
  status text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','in_progress','blocked','done','cancelled')),
  assignee text, estimate numeric, version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX idx_task_project ON task(project_id, status);

CREATE TABLE pending_change (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  target_type text NOT NULL,
  target_id uuid, op text NOT NULL,
  diff jsonb NOT NULL, source_actor text NOT NULL,
  hitl_mode text NOT NULL CHECK (hitl_mode IN ('Auto','Semi','Manual')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX idx_pending_project ON pending_change(project_id, status);

CREATE TABLE hitl_decision (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pending_change_id uuid NOT NULL REFERENCES pending_change(id) ON DELETE CASCADE,
  decision text NOT NULL CHECK (decision IN ('approve','reject','edit_approve')),
  decided_by text NOT NULL, reason text, edited_diff jsonb,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX idx_hitl_change ON hitl_decision(pending_change_id);

CREATE TABLE rtm_node (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  code text NOT NULL, layer text NOT NULL, title text, status text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, code));
CREATE INDEX idx_rtm_node_project ON rtm_node(project_id, layer);

CREATE TABLE rtm_edge (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  from_node_id uuid NOT NULL REFERENCES rtm_node(id) ON DELETE CASCADE,
  to_node_id uuid NOT NULL REFERENCES rtm_node(id) ON DELETE CASCADE,
  relation text NOT NULL DEFAULT 'derives',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (from_node_id, to_node_id, relation));

CREATE TABLE delegate_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  session_id uuid REFERENCES session(id) ON DELETE SET NULL,
  target text NOT NULL CHECK (target IN ('pi_subsession','claude_code','generic_http_agent')),
  request jsonb NOT NULL, response jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','succeeded','failed')),
  latency_ms int, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX idx_delegate_project ON delegate_audit(project_id, created_at);

CREATE TABLE stage_gate (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  stage text NOT NULL, decision text NOT NULL, actor text NOT NULL,
  forced boolean NOT NULL DEFAULT false, report jsonb,
  created_at timestamptz NOT NULL DEFAULT now());

-- ---------- 设置域（M-SET）----------
CREATE TABLE settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL DEFAULT 'global',
  project_id uuid REFERENCES project(id) ON DELETE CASCADE,
  category text NOT NULL, key text NOT NULL,
  value jsonb NOT NULL DEFAULT '{}',
  is_secret boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scope, project_id, category, key));
CREATE INDEX idx_settings_lookup ON settings (scope, project_id, category);

CREATE TABLE endpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES project(id) ON DELETE CASCADE,
  kind text NOT NULL, name text NOT NULL,
  base_url text, model text, api_key_cipher text,
  extra jsonb NOT NULL DEFAULT '{}',
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX idx_endpoints_proj ON endpoints (project_id, kind);

CREATE TABLE session_setting_override (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  category text NOT NULL, key text NOT NULL, value jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, category, key));

CREATE TABLE setting_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text, project_id uuid, session_id uuid,
  category text, key text, old_value jsonb, new_value jsonb,
  actor text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX idx_setting_audit_proj ON setting_audit (project_id, created_at DESC);

-- ---------- updated_at 触发器 ----------
CREATE TRIGGER t_project  BEFORE UPDATE ON project  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER t_session  BEFORE UPDATE ON session  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER t_artifact BEFORE UPDATE ON artifact FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER t_task     BEFORE UPDATE ON task     FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER t_settings BEFORE UPDATE ON settings FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
