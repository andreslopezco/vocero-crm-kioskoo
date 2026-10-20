CREATE TABLE "dropi_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"oauth_cipher" text NOT NULL,
	"oauth_iv" text NOT NULL,
	"oauth_tag" text NOT NULL,
	"status" text DEFAULT 'connected' NOT NULL,
	"last_error" text,
	"rate_type" text,
	"order_creation_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dropi_oauth_flow" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"state_hash" text NOT NULL,
	"flow_cipher" text NOT NULL,
	"flow_iv" text NOT NULL,
	"flow_tag" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"consumed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dropi_order_submission" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"shop_order_id" text NOT NULL,
	"provider_order_id" text,
	"provider_status" text,
	"status" text DEFAULT 'submitting' NOT NULL,
	"payload" jsonb NOT NULL,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dropi_credentials" ADD CONSTRAINT "dropi_credentials_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dropi_oauth_flow" ADD CONSTRAINT "dropi_oauth_flow_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dropi_oauth_flow" ADD CONSTRAINT "dropi_oauth_flow_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dropi_order_submission" ADD CONSTRAINT "dropi_order_submission_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dropi_order_submission" ADD CONSTRAINT "dropi_order_submission_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dropi_order_submission" ADD CONSTRAINT "dropi_order_submission_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dropi_credentials_org_uq" ON "dropi_credentials" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "dropi_oauth_flow_org_idx" ON "dropi_oauth_flow" USING btree ("organization_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "dropi_order_submission_org_shop_id_uq" ON "dropi_order_submission" USING btree ("organization_id","shop_order_id");--> statement-breakpoint
CREATE INDEX "dropi_order_submission_org_conversation_idx" ON "dropi_order_submission" USING btree ("organization_id","conversation_id","created_at");