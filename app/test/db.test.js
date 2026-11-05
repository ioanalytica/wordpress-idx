import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { ENABLED, DB, connect, createTables, dropTables } from './db-helpers.js';

// Integration tests against a real MySQL. They exercise mysql2 itself — the
// connection pool, the array expansion in `IN (?)` that groups terms and
// comments, and the DATETIME mapping — none of which a mocked driver would
// cover. Opt-in via IDX_TEST_DB=1 so `npm test` stays green without a database.
//
// This suite creates and drops tables, so it must never be able to touch a real
// install. Two guards:
//
// 1. Connection details come from IDX_TEST_DB_* only (db-helpers.js).
// 2. Fixtures live under a prefix unique to this run, so even a misaimed
//    database cannot collide with its wp_ tables.
const PREFIX = `idx_test_${process.pid}_${Date.now()}_`;

if (ENABLED) {
  // config.js reads these once at import time, so they must be set before the
  // dynamic imports in before().
  process.env.DB_HOST = DB.host;
  process.env.DB_PORT = String(DB.port);
  process.env.DB_USER = DB.user;
  process.env.DB_PASS = DB.password;
  process.env.DB_NAME = DB.database;
  process.env.DB_PREFIX = PREFIX;
}

const SEED = [
  [`INSERT INTO ${PREFIX}users (ID, display_name) VALUES (1,'Alice'),(2,'Bob')`],
  [
    `INSERT INTO ${PREFIX}posts
       (ID, post_author, post_date, post_content, post_title, post_status, post_password, post_name, post_type)
     VALUES
       (10,1,'2021-03-15 10:00:00','<p>Hello <b>world</b> &amp; tomatoes</p>','Hello World','publish','','hello-world','post'),
       (11,2,'2022-07-01 10:00:00','<div>About   us</div>','About Us','publish','','about-us','page'),
       (12,1,'2023-01-20 10:00:00','Plain text post','Second Post','publish','','second-post','post'),
       (13,1,'2024-01-01 10:00:00','Draft body','Draft','draft','','draft-post','post'),
       (14,1,'2024-02-01 10:00:00','Attachment body','Attachment','publish','','att','attachment'),
       (15,0,'2020-05-01 10:00:00','Created without an author','No Author','publish','','no-author','post'),
       (16,99,'2020-04-01 10:00:00','Its author was deleted','Former Author','publish','','former-author','post'),
       (17,1,'2024-03-01 10:00:00','Behind a password','Protected','publish','secret','protected','post'),
       (18,1,'2024-03-02 10:00:00','Behind a password of spaces','Protected too','publish','   ','protected-too','post'),
       (19,2,'2019-01-01 10:00:00','Cats and dogs','Tom &amp; <em>Jerry</em>','publish','','tom-and-jerry','post')`,
  ],
  [`INSERT INTO ${PREFIX}terms (term_id, name) VALUES (1,'News'),(2,'intro'),(3,'Info')`],
  [
    `INSERT INTO ${PREFIX}term_taxonomy (term_taxonomy_id, term_id, taxonomy) VALUES
       (101,1,'category'),(102,2,'post_tag'),(103,3,'category'),(104,1,'nav_menu')`,
  ],
  [
    `INSERT INTO ${PREFIX}term_relationships (object_id, term_taxonomy_id) VALUES
       (10,101),(10,102),(11,103),(10,104)`,
  ],
  [
    `INSERT INTO ${PREFIX}comments
       (comment_ID, comment_post_ID, comment_author, comment_date, comment_content, comment_approved, comment_type)
     VALUES
       (1,10,'Carol','2021-03-16 09:00:00','<p>Nice post about tomatoes</p>','1','comment'),
       (2,10,'Dave','2021-03-17 09:00:00','Second comment','1',''),
       (3,10,'Spam','2021-03-18 09:00:00','Not approved','0','comment'),
       (4,10,'Bot','2021-03-19 09:00:00','A pingback','1','pingback'),
       (5,17,'Erin','2024-03-02 09:00:00','Comment on the protected post','1','comment')`,
  ],
];

describe('mysql2 database layer', { skip: ENABLED ? false : 'set IDX_TEST_DB=1 and provide a MySQL' }, () => {
  let extractAll;
  let testConnection;
  let entries;

  before(async () => {
    const conn = await connect();
    try {
      await createTables(conn, PREFIX);
      for (const [stmt] of SEED) await conn.query(stmt);
    } finally {
      await conn.end();
    }

    ({ testConnection } = await import('../src/db.js'));
    ({ extractAll } = await import('../src/extractor.js'));
    entries = await extractAll();
  });

  after(async () => {
    if (!ENABLED) return;
    const conn = await connect();
    try {
      await dropTables(conn, PREFIX);
    } finally {
      await conn.end();
    }
  });

  test('testConnection() reaches the database', async () => {
    await testConnection();
  });

  test('extractAll() returns only published posts and pages, newest first', () => {
    assert.deepEqual(
      entries.map((e) => e.id),
      [12, 11, 10, 15, 16, 19],
      'drafts and non post/page types must be excluded, ordered by post_date DESC',
    );
  });

  // WordPress stores a post without an author with post_author 0 (wp-cli
  // creates such posts by default), and deleting a user can leave posts that
  // point to a user that is gone. Both are published content.
  test('includes a published post whose author is 0 or no longer exists, with an empty author', () => {
    const noAuthor = entries.find((e) => e.id === 15);
    const formerAuthor = entries.find((e) => e.id === 16);
    assert.ok(noAuthor, 'post_author 0 must not drop the post');
    assert.ok(formerAuthor, 'a deleted user must not drop the post');
    assert.equal(noAuthor.author, '');
    assert.equal(formerAuthor.author, '');
    assert.equal(noAuthor.content, 'Created without an author');
  });

  // Published with a password is not public: WordPress shows the content and
  // the comments only after the password was entered.
  test('leaves out a post that is protected by a password, with its comments', () => {
    assert.equal(entries.find((e) => e.id === 17), undefined);
    assert.equal(entries.find((e) => e.id === 18), undefined, 'a password of spaces is a password');
    const text = JSON.stringify(entries);
    assert.ok(!text.includes('Behind a password'));
    assert.ok(!text.includes('Comment on the protected post'));
  });

  test('joins the author display name', () => {
    assert.equal(entries.find((e) => e.id === 10).author, 'Alice');
    assert.equal(entries.find((e) => e.id === 11).author, 'Bob');
  });

  // WordPress stores a title as it is typed into the editor, with entities
  // and the few tags a title may have. The search matches the plain text;
  // the response keeps the title as stored.
  test('keeps the title as stored and adds its plain text for the search', () => {
    const post = entries.find((e) => e.id === 19);
    assert.equal(post.title, 'Tom &amp; <em>Jerry</em>');
    assert.equal(post.titleText, 'Tom & Jerry');
    assert.equal(entries.find((e) => e.id === 10).titleText, 'Hello World');
  });

  test('maps slug and type', () => {
    const page = entries.find((e) => e.id === 11);
    assert.equal(page.type, 'page');
    assert.equal(page.slug, '/about-us/');
  });

  test('post_date arrives as a Date', () => {
    assert.ok(entries.every((e) => e.date instanceof Date), 'mysql2 must map DATETIME to Date');
  });

  test('strips HTML and entities from content', () => {
    assert.equal(entries.find((e) => e.id === 10).content, 'Hello world & tomatoes');
    assert.equal(entries.find((e) => e.id === 11).content, 'About us', 'whitespace must be collapsed');
  });

  // The term and comment queries pass an array to `IN (?)`, which mysql2
  // expands into a value list. A regression there would silently drop every
  // category, tag and comment.
  test('groups categories and tags per post, ignoring other taxonomies', () => {
    const post = entries.find((e) => e.id === 10);
    assert.deepEqual(post.categories, ['News']);
    assert.deepEqual(post.tags, ['intro'], 'nav_menu terms must not leak into tags');
    assert.deepEqual(entries.find((e) => e.id === 11).categories, ['Info']);
  });

  test('posts without terms get empty arrays', () => {
    const post = entries.find((e) => e.id === 12);
    assert.deepEqual(post.categories, []);
    assert.deepEqual(post.tags, []);
    assert.deepEqual(post.comments, []);
  });

  test('keeps only approved comments of a commentable type, oldest first', () => {
    const post = entries.find((e) => e.id === 10);
    assert.deepEqual(
      post.comments.map((c) => c.author),
      ['Carol', 'Dave'],
      'unapproved comments and pingbacks must be excluded',
    );
    assert.equal(post.comments[0].content, 'Nice post about tomatoes', 'comment HTML must be stripped');
  });

  test('commentsText concatenates the comment bodies', () => {
    const post = entries.find((e) => e.id === 10);
    assert.equal(post.commentsText, 'Nice post about tomatoes Second comment');
  });
});
