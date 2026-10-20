CREATE TABLE "dropi_order_sync" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "order_id" text NOT NULL,
  "contact_id" text,
  "snapshot" jsonb NOT NULL,
  "ignored" boolean DEFAULT false NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "dropi_order_sync_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "dropi_order_sync_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE set null ON UPDATE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX "dropi_order_sync_org_order_uq" ON "dropi_order_sync" USING btree ("organization_id","order_id");
--> statement-breakpoint
CREATE INDEX "dropi_order_sync_org_updated_idx" ON "dropi_order_sync" USING btree ("organization_id","updated_at");
