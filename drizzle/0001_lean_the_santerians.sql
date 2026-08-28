CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`session_id` text NOT NULL,
	`kind` text NOT NULL,
	`sha256` text NOT NULL,
	`storage_path` text NOT NULL,
	`mime_type` text NOT NULL,
	`bytes` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `assets_owner_created_idx` ON `assets` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `assets_session_kind_created_idx` ON `assets` (`session_id`,`kind`,`created_at`);