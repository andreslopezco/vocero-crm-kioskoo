CREATE TABLE "dropi_order_link" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"provider_order_id" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dropi_order_link" ADD CONSTRAINT "dropi_order_link_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dropi_order_link" ADD CONSTRAINT "dropi_order_link_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dropi_order_link_org_order_uq" ON "dropi_order_link" USING btree ("organization_id","provider_order_id");--> statement-breakpoint
CREATE INDEX "dropi_order_link_org_contact_idx" ON "dropi_order_link" USING btree ("organization_id","contact_id","created_at");