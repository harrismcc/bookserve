CREATE TABLE `book_files` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`book_id` text NOT NULL,
	`path` text NOT NULL,
	`size` integer NOT NULL,
	`mtime_ms` integer NOT NULL,
	`hash` text NOT NULL,
	`format` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `book_files_path_unique` ON `book_files` (`path`);--> statement-breakpoint
CREATE INDEX `book_files_book_id_idx` ON `book_files` (`book_id`);--> statement-breakpoint
CREATE INDEX `book_files_hash_idx` ON `book_files` (`hash`);--> statement-breakpoint
CREATE TABLE `books` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`sort_title` text NOT NULL,
	`authors` text DEFAULT '[]' NOT NULL,
	`description` text,
	`language` text,
	`publisher` text,
	`published_date` text,
	`isbn` text,
	`series` text,
	`series_index` real,
	`cover_path` text,
	`matched` text,
	`missing` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `books_sort_title_idx` ON `books` (`sort_title`);