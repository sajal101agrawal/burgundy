CREATE TYPE "public"."listener_type" AS ENUM('otp', 'confirm', 'choice', 'info');--> statement-breakpoint
CREATE TYPE "public"."task_phase" AS ENUM('discuss', 'specify', 'confirm', 'execute', 'verify', 'deploy', 'deliver');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('pending', 'active', 'checkpointed', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."vault_share_permission" AS ENUM('view', 'use');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"event_type" varchar(64) NOT NULL,
	"description" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"content" text NOT NULL,
	"metadata" jsonb,
	"embedding" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pending_listeners" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"type" "listener_type" NOT NULL,
	"message_sent" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"goal" text NOT NULL,
	"status" "task_status" NOT NULL,
	"phase" "task_phase" NOT NULL,
	"strategy" jsonb,
	"checkpoint" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tool_registry" (
	"tool_id" varchar(64) PRIMARY KEY NOT NULL,
	"name" varchar(128) NOT NULL,
	"category" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"invocation_type" varchar(16) NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"quality_score" double precision DEFAULT 0.5 NOT NULL,
	"fallback_to" varchar(64),
	"last_validated" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"refresh_token_hash" text NOT NULL,
	"revoked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"phone" varchar(32) NOT NULL,
	"platform_email" varchar(255) NOT NULL,
	"platform_phone" varchar(32) NOT NULL,
	"persona_name" varchar(64) NOT NULL,
	"instance_endpoint" varchar(512) NOT NULL,
	"container_id" varchar(128),
	"provisioned_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_phone_unique" UNIQUE("phone")
);
--> statement-breakpoint
CREATE TABLE "vault_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"service" varchar(255) NOT NULL,
	"label" varchar(255) NOT NULL,
	"email" varchar(255),
	"username" varchar(255),
	"encrypted_password" text,
	"two_fa_type" varchar(32),
	"notes_encrypted" text,
	"created_by" varchar(16) NOT NULL,
	"shared_with" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vault_keys" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"encrypted_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vault_shares" (
	"id" uuid PRIMARY KEY NOT NULL,
	"vault_entry_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"permission" "vault_share_permission" NOT NULL,
	"expires_at" timestamp with time zone
);
