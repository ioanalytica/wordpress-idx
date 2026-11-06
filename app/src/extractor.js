import { createPool } from './db.js';
import config from './config.js';

const { prefix } = config.db;

// A numeric character reference (&#38; or &#x26;) as the character it names;
// one that names no character stays as it is.
function decodeNumeric(match, hex, dec) {
  const code = hex ? parseInt(hex, 16) : parseInt(dec, 10);
  if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return match;
  return String.fromCodePoint(code);
}

export function stripHtml(html) {
  let text = html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#(?:x([0-9a-f]{1,6})|([0-9]{1,7}));/gi, decodeNumeric)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text;
}

// A batch is fetched, turned into entries and handed on before the next one
// is read, so the build holds a part of the site at a time. A batch ends when
// its posts and their comments reach this many bytes, or this many posts; a
// single post that is larger than that is a batch of its own.
const BATCH_BYTES = 4 * 1024 * 1024;
const BATCH_POSTS = 500;

// The posts and pages that are public: published, and without a password.
// The password is checked by its length: the collations of WordPress' tables
// pad with spaces when they compare, so a password of spaces would equal ''.
const PUBLIC = `p.post_status = 'publish'
        AND LENGTH(p.post_password) = 0
        AND p.post_type IN ('post', 'page')`;

// The comments that are shown with a post.
const SHOWN = `comment_approved = '1'
        AND comment_type IN ('', 'comment')`;

/**
 * Yields the entries of the site in batches (arrays), newest first: the
 * order in which a search without a query returns them.
 */
export async function* extractBatches({ batchBytes = BATCH_BYTES, batchPosts = BATCH_POSTS } = {}) {
  const pool = createPool();
  try {
    // 1. Which posts, in which order, and how much text each brings. Posts
    //    of the same second are ordered by their ID, so that two builds of
    //    the same site give the same order.
    const [plan] = await pool.query(`
      SELECT p.ID, LENGTH(p.post_content) AS bytes
      FROM ${prefix}posts p
      WHERE ${PUBLIC}
      ORDER BY p.post_date DESC, p.ID DESC
    `);
    if (plan.length === 0) return;

    const [commentSizes] = await pool.query(`
      SELECT comment_post_ID AS post_id, SUM(LENGTH(comment_content)) AS bytes
      FROM ${prefix}comments
      WHERE ${SHOWN}
      GROUP BY comment_post_ID
    `);
    const commentBytes = new Map(commentSizes.map((row) => [row.post_id, Number(row.bytes)]));

    let ids = [];
    let bytes = 0;
    for (const row of plan) {
      ids.push(row.ID);
      bytes += Number(row.bytes) + (commentBytes.get(row.ID) || 0);
      if (bytes >= batchBytes || ids.length >= batchPosts) {
        yield await extractBatch(pool, ids);
        ids = [];
        bytes = 0;
      }
    }
    if (ids.length) yield await extractBatch(pool, ids);
  } finally {
    await pool.end();
    console.log('Database pool closed.');
  }
}

// The entries of the posts `postIds`, in that order. A post that stopped
// being public since the plan was made is left out.
async function extractBatch(pool, postIds) {
  // 1. Fetch the posts. The author is optional (LEFT JOIN): a post whose
  //    post_author is 0, or names a user that was deleted, is published
  //    content all the same and gets an empty author.
  const [rows] = await pool.query(
    `
      SELECT p.ID, p.post_type, p.post_title, p.post_date, p.post_content,
             p.post_name, COALESCE(u.display_name, '') AS author
      FROM ${prefix}posts p
      LEFT JOIN ${prefix}users u ON p.post_author = u.ID
      WHERE ${PUBLIC}
        AND p.ID IN (?)
    `,
    [postIds],
  );
  const byId = new Map(rows.map((p) => [p.ID, p]));
  const posts = postIds.map((id) => byId.get(id)).filter(Boolean);
  if (posts.length === 0) return [];

  // 2. Fetch categories and tags
  const [terms] = await pool.query(
    `
      SELECT tr.object_id AS post_id, t.name, tt.taxonomy
      FROM ${prefix}term_relationships tr
      JOIN ${prefix}term_taxonomy tt ON tr.term_taxonomy_id = tt.term_taxonomy_id
      JOIN ${prefix}terms t ON tt.term_id = t.term_id
      WHERE tt.taxonomy IN ('category', 'post_tag')
        AND tr.object_id IN (?)
    `,
    [postIds],
  );

  // 3. Group terms by post ID
  const termsByPost = new Map();
  for (const term of terms) {
    if (!termsByPost.has(term.post_id)) {
      termsByPost.set(term.post_id, { categories: [], tags: [] });
    }
    const entry = termsByPost.get(term.post_id);
    if (term.taxonomy === 'category') {
      entry.categories.push(term.name);
    } else {
      entry.tags.push(term.name);
    }
  }

  // 4. Fetch approved comments, oldest first
  const [comments] = await pool.query(
    `
      SELECT comment_post_ID AS post_id, comment_author, comment_date, comment_content
      FROM ${prefix}comments
      WHERE ${SHOWN}
        AND comment_post_ID IN (?)
      ORDER BY comment_date ASC, comment_ID ASC
    `,
    [postIds],
  );

  // 5. Group comments by post ID
  const commentsByPost = new Map();
  for (const c of comments) {
    if (!commentsByPost.has(c.post_id)) {
      commentsByPost.set(c.post_id, []);
    }
    commentsByPost.get(c.post_id).push({
      author: c.comment_author,
      date: c.comment_date,
      content: stripHtml(c.comment_content),
    });
  }

  // 6. Assemble result
  return posts.map((p) => {
    const postTerms = termsByPost.get(p.ID) || { categories: [], tags: [] };
    const postComments = commentsByPost.get(p.ID) || [];
    return {
      id: p.ID,
      type: p.post_type,
      author: p.author,
      title: p.post_title,
      // What a query is matched against: the title as it reads, without
      // the entities and tags it is stored with.
      titleText: stripHtml(p.post_title),
      date: p.post_date,
      slug: `/${p.post_name}/`,
      categories: postTerms.categories,
      tags: postTerms.tags,
      content: stripHtml(p.post_content),
      comments: postComments,
      commentsText: postComments.map((c) => c.content).join(' '),
    };
  });
}
