CREATE TABLE `auth_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `auth_sessions_user_idx` ON `auth_sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `local_credentials` (
	`user_id` text PRIMARY KEY NOT NULL,
	`password_hash` text NOT NULL,
	`must_change_password` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`display_name` text NOT NULL,
	`is_admin` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);--> statement-breakpoint
CREATE TEMP TABLE `auth_owner_map` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL CHECK (`username` <> ''),
	`survivor_id` text NOT NULL
);--> statement-breakpoint
INSERT INTO `auth_owner_map` (`owner_id`, `username`, `survivor_id`)
SELECT
	`owner_id`,
	`username`,
	MIN(`owner_id`) OVER (PARTITION BY `username`)
FROM (
	SELECT `owner_id`, normalize_username(`owner_id`) AS `username`
	FROM (
		SELECT `owner_id` FROM `sessions`
		UNION
		SELECT `owner_id` FROM `assets`
		UNION
		SELECT `owner_id` FROM `generation_runs`
		UNION
		SELECT `owner_id` FROM `generation_jobs`
	)
);--> statement-breakpoint
INSERT INTO `users` (
	`id`,
	`username`,
	`display_name`,
	`is_admin`,
	`created_at`,
	`updated_at`
)
SELECT
	`survivor_id`,
	`username`,
	`owner_id`,
	false,
	strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
	strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM `auth_owner_map`
WHERE `owner_id` = `survivor_id`;--> statement-breakpoint
UPDATE `generation_runs`
SET `idempotency_key` = 'owner-merge:' || `id`
WHERE `owner_id` IN (
	SELECT `owner_id`
	FROM `auth_owner_map`
	WHERE `username` IN (
		SELECT `username`
		FROM `auth_owner_map`
		GROUP BY `username`
		HAVING COUNT(*) > 1
	)
);--> statement-breakpoint
UPDATE `sessions`
SET `owner_id` = (
	SELECT `survivor_id`
	FROM `auth_owner_map`
	WHERE `auth_owner_map`.`owner_id` = `sessions`.`owner_id`
)
WHERE `owner_id` IN (
	SELECT `owner_id` FROM `auth_owner_map` WHERE `owner_id` <> `survivor_id`
);--> statement-breakpoint
UPDATE `assets`
SET `owner_id` = (
	SELECT `survivor_id`
	FROM `auth_owner_map`
	WHERE `auth_owner_map`.`owner_id` = `assets`.`owner_id`
)
WHERE `owner_id` IN (
	SELECT `owner_id` FROM `auth_owner_map` WHERE `owner_id` <> `survivor_id`
);--> statement-breakpoint
UPDATE `generation_runs`
SET `owner_id` = (
	SELECT `survivor_id`
	FROM `auth_owner_map`
	WHERE `auth_owner_map`.`owner_id` = `generation_runs`.`owner_id`
)
WHERE `owner_id` IN (
	SELECT `owner_id` FROM `auth_owner_map` WHERE `owner_id` <> `survivor_id`
);--> statement-breakpoint
UPDATE `generation_jobs`
SET `owner_id` = (
	SELECT `survivor_id`
	FROM `auth_owner_map`
	WHERE `auth_owner_map`.`owner_id` = `generation_jobs`.`owner_id`
)
WHERE `owner_id` IN (
	SELECT `owner_id` FROM `auth_owner_map` WHERE `owner_id` <> `survivor_id`
);--> statement-breakpoint
DROP TABLE `auth_owner_map`;
