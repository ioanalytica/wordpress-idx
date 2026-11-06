// Generated entries for the tests that need a site rather than a handful of
// samples: the same call returns the same entries. Nothing here is taken from
// a real site.
//
// The text is made to hold what the index has to get right: words that share
// prefixes, words that FlexSearch's encoder maps to the same term ("das" and
// "dass": it collapses repeated letters), umlauts and typographic characters
// (most entries are not Latin-1), numbers, a few words in other scripts, one
// of them beyond the Basic Multilingual Plane, and titles with entities.

// mulberry32
function generator(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ONSETS = ['b', 'd', 'f', 'g', 'h', 'k', 'l', 'm', 'n', 'r', 's', 't', 'w', 'z', 'sch', 'st', 'br', 'gr', 'kl', 'pf', 'tr', 'v', 'bl'];
const VOWELS = ['a', 'e', 'i', 'o', 'u', 'ä', 'ö', 'ü', 'ei', 'au', 'ie', 'eu'];
const CODAS = ['', '', 'n', 'r', 's', 't', 'l', 'ch', 'ng', 'ß', 'nn', 'll', 'ss', 'tt', 'mm', 'rt', 'cht'];

// Frequent words, among them pairs the encoder cannot tell apart.
const COMMON = [
  'der', 'die', 'das', 'dass', 'und', 'in', 'den', 'denn', 'von', 'zu', 'mit', 'sich', 'auf', 'für', 'ist', 'nicht',
  'ein', 'eine', 'als', 'auch', 'es', 'an', 'man', 'Mann', 'wen', 'wenn', 'so', 'soll', 'wie', 'im', 'ich', 'aber',
];
const RARE = ['Κίρκη', 'μῆνιν', 'Ödipus', 'naïve', 'Straße', 'Strasse', '𠀀𠀁', 'x𠀂y', 'Ärger', 'Überfluß', 'coöperation'];
const PUNCTUATION = ['.', '.', '.', ',', ',', ',', ';', ' –', '!', '?', ':', ' …'];

function vocabulary(random, size) {
  const words = [...COMMON];
  const seen = new Set(words);
  while (words.length < size) {
    const syllables = 1 + Math.floor(random() * 4);
    let word = '';
    for (let i = 0; i < syllables; i++) {
      word += pick(random, ONSETS) + pick(random, VOWELS) + pick(random, CODAS);
    }
    if (random() < 0.3) word = word[0].toUpperCase() + word.slice(1);
    if (!seen.has(word)) {
      seen.add(word);
      words.push(word);
    }
  }
  return words;
}

function pick(random, list) {
  return list[Math.floor(random() * list.length)];
}

// A word by Zipf's law: few words make up most of a text.
function zipf(random, words) {
  const rank = Math.floor(words.length ** random()) - 1;
  return words[Math.min(Math.max(rank, 0), words.length - 1)];
}

function sentence(random, words, length) {
  const parts = [];
  for (let i = 0; i < length; i++) {
    const kind = random();
    let word;
    if (kind < 0.004) word = pick(random, RARE);
    else if (kind < 0.012) word = String(1900 + Math.floor(random() * 130));
    else if (kind < 0.016) word = `${Math.floor(random() * 999)}.${String(Math.floor(random() * 999)).padStart(3, '0')}`;
    else if (kind < 0.022) word = `„${zipf(random, words)}“`;
    else if (kind < 0.026) word = `${zipf(random, words)}-${zipf(random, words)}`;
    else word = zipf(random, words);
    if (random() < 0.12) word += pick(random, PUNCTUATION);
    parts.push(word);
  }
  return parts.join(' ');
}

const pad = (n) => String(n).padStart(2, '0');

/**
 * `count` entries as the extractor yields them, newest first.
 *
 *   words     mean number of words of a content (they vary widely)
 *   vocabulary  number of distinct generated words
 */
export function generateEntries(count, { seed = 1, words = 120, vocabulary: size = 2500 } = {}) {
  const random = generator(seed);
  const vocab = vocabulary(random, size);
  const authors = ['Alice Ahorn', 'Bob Birke', 'Carla Ç. Eiche', ''];
  const categories = ['Tagebuch', 'Notizen', 'Arbeitsjournal', 'Über uns', 'Lyrik'];
  const tags = Array.from({ length: 40 }, () => zipf(random, vocab));
  const some = (list, max) => {
    const out = [];
    const n = Math.floor(random() * (max + 1));
    for (let i = 0; i < n; i++) {
      const item = pick(random, list);
      if (!out.includes(item)) out.push(item);
    }
    return out;
  };

  const entries = [];
  let time = Date.UTC(2024, 5, 30, 12, 0, 0);
  for (let i = 0; i < count; i++) {
    time -= Math.floor(random() * 4 * 86400000);
    const date = new Date(time);
    // A few very long entries, many short ones.
    const length = Math.max(1, Math.floor(words * (random() < 0.03 ? 8 : 2 * random() * random() * 2)));
    const titleText = sentence(random, vocab, 2 + Math.floor(random() * 5));
    const comments = [];
    if (random() < 0.3) {
      const n = 1 + Math.floor(random() * 4);
      for (let c = 0; c < n; c++) {
        comments.push({
          author: pick(random, ['Dora', 'Emil', 'Frieda', 'Gast']),
          date: new Date(time + (c + 1) * 3600000),
          content: sentence(random, vocab, 3 + Math.floor(random() * 60)),
        });
      }
    }
    const id = 10 + i * 3 + Math.floor(random() * 3);
    entries.push({
      id,
      type: random() < 0.08 ? 'page' : 'post',
      author: pick(random, authors),
      // Stored as WordPress stores it: with entities, sometimes a tag.
      title: random() < 0.1 ? `<em>${titleText.replace(/&/g, '&amp;')}</em>` : titleText.replace(/&/g, '&amp;'),
      titleText,
      date,
      slug: `/${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}/eintrag-${id}/`,
      categories: some(categories, 2),
      tags: some(tags, 4),
      content: sentence(random, vocab, length),
      comments,
      commentsText: comments.map((c) => c.content).join(' '),
    });
  }
  return entries;
}

/**
 * Queries taken from the entries themselves: words, prefixes of words, pairs
 * of words that follow each other and quoted phrases, from titles, contents
 * and comments.
 */
export function generateQueries(entries, count, { seed = 7 } = {}) {
  const random = generator(seed);
  const queries = [];
  while (queries.length < count) {
    const entry = pick(random, entries);
    const kind = random();
    const text = kind < 0.2 && entry.commentsText ? entry.commentsText : kind < 0.4 ? entry.titleText : entry.content;
    const words = text.split(/\s+/).filter(Boolean);
    if (!words.length) continue;
    const at = Math.floor(random() * words.length);
    const word = words[at];
    const shape = random();
    if (shape < 0.3) queries.push(word);
    else if (shape < 0.5) queries.push(word.slice(0, 1 + Math.floor(random() * word.length)));
    else if (shape < 0.7) queries.push(words.slice(at, at + 2).join(' '));
    else if (shape < 0.9) queries.push(`"${words.slice(at, at + 2 + Math.floor(random() * 2)).join(' ')}"`);
    else queries.push(`${word} ${pick(random, words)}`);
  }
  return queries;
}
