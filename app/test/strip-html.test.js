import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { stripHtml } from '../src/extractor.js';

// What the extractor makes of a stored title, content or comment before it is
// indexed: the text as it reads.
describe('stripHtml()', () => {
  test('replaces tags by a space and collapses whitespace', () => {
    assert.equal(stripHtml('<p>Hello <b>world</b></p>\n\n<p>again</p>'), 'Hello world again');
    assert.equal(stripHtml('Hello<br>world'), 'Hello world');
  });

  test('decodes the named entities WordPress stores', () => {
    assert.equal(stripHtml('Tom &amp; Jerry &lt;3 &quot;cheese&quot;&nbsp;&gt; all'), 'Tom & Jerry <3 "cheese" > all');
  });

  test('decodes numeric entities, decimal and hexadecimal', () => {
    assert.equal(stripHtml('Tom &#38; Jerry'), 'Tom & Jerry');
    assert.equal(stripHtml('Tom &#x26; Jerry'), 'Tom & Jerry');
    assert.equal(stripHtml('It&#039;s here, it&#39;s there, it&#8217;s everywhere'), "It's here, it's there, it’s everywhere");
    assert.equal(stripHtml('caf&#xE9; &#x1F600;'), 'café \u{1F600}');
  });

  test('leaves a reference that names no character as it is', () => {
    assert.equal(stripHtml('a &#0; b &#xD800; c &#99999999; d'), 'a &#0; b &#xD800; c &#99999999; d');
  });
});
