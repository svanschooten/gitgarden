import test from 'node:test';
import assert from 'node:assert';
import { safeJson, fillTemplate } from '../src/html.js';

test('HTML data embedding', async (t) => {
  await t.test('safeJson neutralizes script-closing markup', () => {
    const embedded = safeJson([{ path: 'a</script><img src=x onerror=alert(1)>.js' }]);
    assert.ok(!embedded.includes('</script>'), 'must not close the script block');
    assert.ok(!embedded.includes('<'), 'no raw angle brackets survive');
    assert.ok(!embedded.includes('>'));
    assert.ok(!embedded.includes('&'));
    // Still valid JSON that round-trips to the original value.
    assert.deepStrictEqual(JSON.parse(embedded), [{ path: 'a</script><img src=x onerror=alert(1)>.js' }]);
  });

  await t.test('safeJson escapes JavaScript line terminators', () => {
    const raw = 'a\u2028b\u2029c';
    const embedded = safeJson({ path: raw });
    assert.ok(!embedded.includes('\u2028'), 'U+2028 is valid JSON but breaks a JS string literal');
    assert.ok(!embedded.includes('\u2029'));
    assert.deepStrictEqual(JSON.parse(embedded), { path: raw });
  });

  await t.test('fillTemplate does not interpret $ patterns in the data', () => {
    // A string replacement would expand $&, $` , $' and $1 out of the data.
    const data = safeJson([{ path: "weird/$&$`$'$1.js" }]);
    const html = fillTemplate('const p = {{PATCHES}};', { PATCHES: data });
    assert.strictEqual(html, `const p = ${data};`);
    assert.deepStrictEqual(JSON.parse(html.slice('const p = '.length, -1)), [{ path: "weird/$&$`$'$1.js" }]);
  });

  await t.test('fillTemplate replaces every occurrence of a token', () => {
    assert.strictEqual(
      fillTemplate('{{A}} and {{A}} and {{B}}', { A: 'x', B: 'y' }),
      'x and x and y'
    );
  });
});
