INSERT INTO "compliance_categories" ("key", "name", "sort_order") VALUES ('local', 'Local compliance', 4) ON CONFLICT ("key") DO NOTHING;
