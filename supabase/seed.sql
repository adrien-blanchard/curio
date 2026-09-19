insert into public.tags (id, name, slug, color, sort_order)
values
  ('00000000-0000-4000-8000-000000000001', 'Computer Vision', 'computer-vision', '#0075c9', 10),
  ('00000000-0000-4000-8000-000000000002', 'Research', 'research', '#8b5cf6', 20),
  ('00000000-0000-4000-8000-000000000003', '3D', '3d', '#f59e0b', 30),
  ('00000000-0000-4000-8000-000000000004', 'Developer Tools', 'developer-tools', '#10b981', 40),
  ('00000000-0000-4000-8000-000000000005', 'LLM', 'llm', '#ec4899', 50),
  ('00000000-0000-4000-8000-000000000006', 'Evaluation', 'evaluation', '#6366f1', 60),
  ('00000000-0000-4000-8000-000000000007', 'Workflow', 'workflow', '#14b8a6', 70),
  ('00000000-0000-4000-8000-000000000008', 'Collaboration', 'collaboration', '#3b82f6', 80),
  ('00000000-0000-4000-8000-000000000009', 'Real-time', 'real-time', '#06b6d4', 90),
  ('00000000-0000-4000-8000-000000000010', 'Rendering', 'rendering', '#f97316', 100),
  ('00000000-0000-4000-8000-000000000011', 'Image', 'image', '#ef4444', 110),
  ('00000000-0000-4000-8000-000000000012', 'Generative AI', 'generative-ai', '#8b5cf6', 120),
  ('00000000-0000-4000-8000-000000000013', 'Knowledge', 'knowledge', '#0075c9', 130),
  ('00000000-0000-4000-8000-000000000014', 'Relighting', 'relighting', '#eab308', 140),
  ('00000000-0000-4000-8000-000000000015', 'MLOps', 'mlops', '#6366f1', 150),
  ('00000000-0000-4000-8000-000000000016', 'Audio', 'audio', '#ec4899', 160),
  ('00000000-0000-4000-8000-000000000017', 'Retrieval', 'retrieval', '#84cc16', 170),
  ('00000000-0000-4000-8000-000000000018', 'Documentation', 'documentation', '#f97316', 180)
on conflict (slug) do update
set name = excluded.name,
    color = excluded.color,
    sort_order = excluded.sort_order;
