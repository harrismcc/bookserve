CREATE TABLE `book_sources` (
	`book_id` text PRIMARY KEY NOT NULL,
	`source_id` integer,
	`integration` text NOT NULL,
	`external_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `market_sources`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `book_sources_source_external_idx` ON `book_sources` (`source_id`,`external_id`);--> statement-breakpoint
CREATE TABLE `market_sources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`integration` text NOT NULL,
	`name` text NOT NULL,
	`settings` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
INSERT INTO `market_sources` (`integration`, `name`) VALUES ('gutenberg', 'Project Gutenberg');
