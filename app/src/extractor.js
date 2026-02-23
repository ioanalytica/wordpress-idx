import { createPool } from './db.js';
import config from './config.js';

const { prefix } = config.db;

function stripHtml(html) {
  let text = html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text;
}

export async function extractAll() {
  const pool = createPool();
  try {
    // 1. Fetch published posts and pages with author
    const [posts] = await pool.query(`
      SELECT p.ID, p.post_type, p.post_title, p.post_date, p.post_content,
             p.post_name, u.display_name AS author
      FROM ${prefix}posts p
      JOIN ${prefix}users u ON p.post_author = u.ID
      WHERE p.post_status = 'publish'
        AND p.post_type IN ('post', 'page')
      ORDER BY p.post_date DESC
    `);

    if (posts.length === 0) {
      return [];
    }

    // 2. Fetch categories and tags for all post IDs
    const postIds = posts.map((p) => p.ID);
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

    // 4. Fetch approved comments for all post IDs
    const [comments] = await pool.query(
      `
      SELECT comment_post_ID AS post_id, comment_author, comment_date, comment_content
      FROM ${prefix}comments
      WHERE comment_approved = '1'
        AND comment_type IN ('', 'comment')
        AND comment_post_ID IN (?)
      ORDER BY comment_date ASC
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
        date: p.post_date,
        slug: `/${p.post_name}/`,
        categories: postTerms.categories,
        tags: postTerms.tags,
        content: stripHtml(p.post_content),
        comments: postComments,
        commentsText: postComments.map((c) => c.content).join(' '),
      };
    });
  } finally {
    await pool.end();
    console.log('Database pool closed.');
  }
}
