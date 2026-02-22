ALTER TABLE "users" ALTER COLUMN "platform_email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "platform_phone" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "instance_endpoint" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_hash" text NOT NULL;