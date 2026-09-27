ALTER TABLE "items" ADD COLUMN "inventory_tracking" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Backfill: every existing item is a Product created before this flag existed, and every one of them already
-- tracks real stock (that's all the "items" table has ever held) — so they all become tracked, matching current
-- behavior exactly. New Product items default to tracked too (see createItem); this is a one-time historical fix-up.
UPDATE "items" SET "inventory_tracking" = true WHERE "item_type" = 'product';