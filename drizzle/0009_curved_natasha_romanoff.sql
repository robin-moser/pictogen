CREATE TABLE `session_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`title` text NOT NULL,
	`is_archived` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `session_groups_owner_order_idx` ON `session_groups` (`owner_id`,`is_archived`,`sort_order`);--> statement-breakpoint
ALTER TABLE `sessions` ADD `group_id` text REFERENCES session_groups(id);--> statement-breakpoint
ALTER TABLE `sessions` ADD `sort_order` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `sessions_group_order_idx` ON `sessions` (`group_id`,`sort_order`);