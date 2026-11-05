// Shared by the suites that need a real MySQL (IDX_TEST_DB=1): where it is,
// and the WordPress tables the extractor reads, under a prefix of the suite's
// own.
//
// Connection details come from IDX_TEST_DB_* only. The app's own DB_*
// variables are deliberately NOT inherited: they point at a working WordPress
// (see app/.env), and an exported DB_NAME would otherwise aim a teardown at
// it.
export const ENABLED = process.env.IDX_TEST_DB === '1';

export const DB = {
  host: process.env.IDX_TEST_DB_HOST || '127.0.0.1',
  port: Number(process.env.IDX_TEST_DB_PORT || 3306),
  user: process.env.IDX_TEST_DB_USER || 'root',
  password: process.env.IDX_TEST_DB_PASS || 'root',
  database: process.env.IDX_TEST_DB_NAME || 'wordpress_idx_test',
};

// Fixture tables, in the order a teardown drops them. Identifiers are built
// from the suite's prefix and this list, never from input, so the template
// literals below are safe.
export const TABLES = ['comments', 'term_relationships', 'term_taxonomy', 'terms', 'posts', 'users'];

// post_password has the collation WordPress gives its tables. It pads with
// spaces when it compares, unlike the default of MySQL 8.0: there a password
// of spaces equals the empty string.
export function ddl(prefix) {
  return [
  `CREATE TABLE ${prefix}users (
     ID BIGINT UNSIGNED PRIMARY KEY,
     display_name VARCHAR(250) NOT NULL DEFAULT ''
   )`,
  `CREATE TABLE ${prefix}posts (
     ID BIGINT UNSIGNED PRIMARY KEY,
     post_author BIGINT UNSIGNED NOT NULL DEFAULT 0,
     post_date DATETIME NOT NULL,
     post_content LONGTEXT NOT NULL,
     post_title TEXT NOT NULL,
     post_status VARCHAR(20) NOT NULL DEFAULT 'publish',
     post_password VARCHAR(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
     post_name VARCHAR(200) NOT NULL DEFAULT '',
     post_type VARCHAR(20) NOT NULL DEFAULT 'post'
   )`,
  `CREATE TABLE ${prefix}terms (
     term_id BIGINT UNSIGNED PRIMARY KEY,
     name VARCHAR(200) NOT NULL DEFAULT ''
   )`,
  `CREATE TABLE ${prefix}term_taxonomy (
     term_taxonomy_id BIGINT UNSIGNED PRIMARY KEY,
     term_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
     taxonomy VARCHAR(32) NOT NULL DEFAULT ''
   )`,
  `CREATE TABLE ${prefix}term_relationships (
     object_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
     term_taxonomy_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
     PRIMARY KEY (object_id, term_taxonomy_id)
   )`,
  `CREATE TABLE ${prefix}comments (
     comment_ID BIGINT UNSIGNED PRIMARY KEY,
     comment_post_ID BIGINT UNSIGNED NOT NULL DEFAULT 0,
     comment_author TINYTEXT NOT NULL,
     comment_date DATETIME NOT NULL,
     comment_content TEXT NOT NULL,
     comment_approved VARCHAR(20) NOT NULL DEFAULT '1',
     comment_type VARCHAR(20) NOT NULL DEFAULT 'comment'
   )`,
  ];
}

export async function connect() {
  const mysql = (await import('mysql2/promise')).default;
  return mysql.createConnection({ ...DB, multipleStatements: false });
}

export async function createTables(conn, prefix) {
  for (const stmt of ddl(prefix)) await conn.query(stmt);
}

export async function dropTables(conn, prefix) {
  for (const table of TABLES) {
    await conn.query(`DROP TABLE IF EXISTS ${prefix}${table}`);
  }
}
