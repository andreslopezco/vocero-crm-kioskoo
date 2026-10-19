CREATE TABLE "meta_catalog" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"catalog_id" text NOT NULL,
	"catalog_name" text,
	"synced_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "meta_catalog_product" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"catalog_id" text NOT NULL,
	"retailer_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"availability" text,
	"price" text,
	"currency" text,
	"brand" text,
	"image_url" text,
	"url" text,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "meta_catalog" ADD CONSTRAINT "meta_catalog_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_catalog_product" ADD CONSTRAINT "meta_catalog_product_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "meta_catalog_org_uq" ON "meta_catalog" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "meta_catalog_product_org_retailer_uq" ON "meta_catalog_product" USING btree ("organization_id","retailer_id");--> statement-breakpoint
CREATE INDEX "meta_catalog_product_org_idx" ON "meta_catalog_product" USING btree ("organization_id");
