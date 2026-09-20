-- ============================================================================
--  CrispAI 自部署版 — Postgres 数据库结构
--
--  表结构、列名、索引和 match_payloads 与 SaaS 版（Supabase）保持一致，
--  这样项目导入导出可以逐行对应。和 SaaS 版的差异只有：
--    · 去掉 auth.users 外键（单用户，没有用户表）
--    · 去掉 RLS / 角色授权 / Realtime / Storage 桶
--    · 去掉 wallet、wallet_log 和计费相关函数、触发器
--
--  服务启动时自动执行，脚本可重复执行。
--  注意：表里有 camelCase 列（websiteId / telegramId / botName / botIcon /
--        enableKeyword / enableAI / enableAIPic），必须带双引号，和代码保持一致。
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. 扩展（沿用 Supabase 的 extensions schema，函数定义可以原样保留）
-- ---------------------------------------------------------------------------
create schema if not exists extensions;
create extension if not exists vector with schema extensions;   -- payload.vector 向量检索

-- ---------------------------------------------------------------------------
-- 1. project — 客服项目（一个 Crisp 站点对应一个项目）
--    hosted / joined / invited / plan_id / expired_at / renewal 是 SaaS 版的多用户与计费字段，
--    自部署版不读不写，保留只是为了导入导出时结构一致。
-- ---------------------------------------------------------------------------
create table if not exists public.project (
  id              uuid primary key default gen_random_uuid(),
  name            text        not null default 'Untitled',
  hosted          uuid,
  joined          uuid[]      not null default '{}',
  invited         uuid[]      not null default '{}',
  enabled         boolean     not null default false,  -- 总开关，worker 里 enabled=false 直接忽略
  "websiteId"     text,                                -- Crisp website_id，worker 按它查项目
  "telegramId"    bigint,                              -- Telegram 话题群 chat_id
  "botName"       text,
  "botIcon"       text,
  "enableKeyword" boolean     not null default false,
  keyword         jsonb       not null default '[]'::jsonb,   -- [{keyword,type,text?,optionId?}]
  "enableAI"      boolean     not null default false,
  "enableAIPic"   boolean     not null default false,
  payload         text,                                -- AI 系统提示词（<=5000 字，可为 JSON 字符串数组）
  options         jsonb       not null default '{}'::jsonb,   -- 欢迎语 {type:'none'|'text'|'option', text?, optionId?}
  timer           integer     not null default 1800,   -- 人工介入后多少秒恢复 AI
  plan_id         text        not null default 'Free',
  expired_at      timestamptz not null default now(),
  renewal         boolean     not null default false,
  created_at      timestamptz not null default now()
);

-- worker 按 websiteId 查项目，同一个 websiteId 只能有一个项目
create unique index if not exists project_website_id_key on public.project ("websiteId")
  where "websiteId" is not null;

-- ---------------------------------------------------------------------------
-- 2. option — 选项卡片（Crisp picker 消息）
-- ---------------------------------------------------------------------------
create table if not exists public.option (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid        not null references public.project (id) on delete cascade,
  name       text        not null,
  text       text        not null,                               -- 卡片文案
  options    jsonb       not null default '[]'::jsonb,           -- [{id,label,trigger:{type,text?,optionId?}}]
  created_at timestamptz not null default now()
);

create index if not exists option_project_id_idx on public.option (project_id);

-- ---------------------------------------------------------------------------
-- 3. payload — 知识库条目 + 向量（text-embedding-3-small = 1536 维）
--    注意：列名是 project（不是 project_id），列名 vector 和类型同名，和 SaaS 版一致
-- ---------------------------------------------------------------------------
create table if not exists public.payload (
  id         uuid primary key default gen_random_uuid(),
  project    uuid        not null references public.project (id) on delete cascade,
  name       text        not null,
  raw        text        not null,
  vector     extensions.vector(1536),
  created_at timestamptz not null default now()
);

create index if not exists payload_project_idx on public.payload (project);
create index if not exists payload_vector_idx  on public.payload
  using hnsw (vector extensions.vector_cosine_ops);

-- ---------------------------------------------------------------------------
-- 4. session — Crisp 会话 ↔ Telegram 话题绑定
--    注意：建会话用 on conflict (session_id)，session_id 必须有唯一约束
-- ---------------------------------------------------------------------------
create table if not exists public.session (
  id           uuid primary key default gen_random_uuid(),
  website_id   text        not null,
  session_id   text        not null unique,           -- Crisp session_id（去掉 "session_" 前缀）
  group_id     bigint,                                -- Telegram 群 chat_id
  topic_id     bigint,                                -- 话题 message_thread_id
  message_id   bigint,                                -- 话题里的信息卡 message_id
  enable_reply boolean     not null default true,     -- AI 回复开关
  enable_time  timestamptz not null default now(),    -- 上次切换时间，switch.cron 据此恢复 AI
  thread       jsonb       not null default '[]'::jsonb,   -- 对话上下文
  created_at   timestamptz not null default now()
);

create index if not exists session_group_topic_idx on public.session (group_id, topic_id);
create index if not exists session_website_id_idx  on public.session (website_id);
create index if not exists session_enable_idx      on public.session (enable_reply, enable_time);

-- ---------------------------------------------------------------------------
-- 5. match_payloads(project, query_embedding, match_count)：知识库向量检索（余弦相似度）
--    调用：messageSend.task.ts searchDocuments()，只用了返回值里的 raw
-- ---------------------------------------------------------------------------
create or replace function public.match_payloads(
  project         uuid,
  query_embedding extensions.vector(1536),
  match_count     integer default 3
)
returns table (id uuid, name text, raw text, similarity double precision)
language sql
stable
set search_path = public, extensions
as $$
  select p.id,
         p.name,
         p.raw,
         1 - (p.vector <=> query_embedding) as similarity
  from public.payload p
  where p.project = match_payloads.project
    and p.vector is not null
  order by p.vector <=> query_embedding
  limit match_count;
$$;
