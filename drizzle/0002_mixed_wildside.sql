CREATE TABLE `generation_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`session_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`queue_order` integer NOT NULL,
	`provider_id` text NOT NULL,
	`model_id` text NOT NULL,
	`model_name` text NOT NULL,
	`requested_count` integer NOT NULL,
	`completed_count` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`usage_json` text NOT NULL,
	`cost_microusd` integer,
	`cost_complete` integer NOT NULL,
	`error_code` text,
	`error_message` text,
	`started_at` text,
	`finished_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `generation_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `generation_jobs_status_queue_idx` ON `generation_jobs` (`status`,`queue_order`);--> statement-breakpoint
CREATE INDEX `generation_jobs_session_created_idx` ON `generation_jobs` (`session_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `generation_jobs_owner_status_idx` ON `generation_jobs` (`owner_id`,`status`);--> statement-breakpoint
CREATE TABLE `generation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`prompt` text NOT NULL,
	`options_json` text NOT NULL,
	`requested_count` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `generation_runs_owner_idempotency_key_unique` ON `generation_runs` (`owner_id`,`idempotency_key`);--> statement-breakpoint
CREATE TABLE `job_references` (
	`job_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	PRIMARY KEY(`job_id`, `asset_id`),
	FOREIGN KEY (`job_id`) REFERENCES `generation_jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `job_references_job_ordinal_unique` ON `job_references` (`job_id`,`ordinal`);--> statement-breakpoint
ALTER TABLE `assets` ADD `job_id` text REFERENCES generation_jobs(id);--> statement-breakpoint
ALTER TABLE `assets` ADD `ordinal` integer;--> statement-breakpoint
CREATE INDEX `assets_job_ordinal_idx` ON `assets` (`job_id`,`ordinal`);