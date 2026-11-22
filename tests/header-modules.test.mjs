import test from 'node:test';
import assert from 'node:assert/strict';
import {standardHelpers} from '../scripts/build-runtime.mjs';

test('helper translation changes calls while preserving prose and regular expressions',()=>{
  const source = 'class Example { value() { const text=".first() .contains(x)"; return [1].first() + [2].last() + text.contains("x"); } }';
  const output = standardHelpers(source);
  assert.match(output,/"\.first\(\) \.contains\(x\)"/);
  assert.match(output,/\[1\]\.at\(0\)/);
  assert.match(output,/\[2\]\.at\(-1\)/);
  assert.match(output,/text\.includes\("x"\)/);
  assert.throws(()=>standardHelpers('console.log("unexpected module code")'),/Expected one CustomJS class/);
});

test('helper translation leaves comments, regex literals, computed methods and methods with arguments intact',()=>{
  const source=String.raw`class Example { value() {
    // Preserve .contains(x), .first(), and .last() in this comment.
    const pattern=/\.first\(\)\.last\(\)/;
    const a=values.first(1), b=values.last(2), c=values["first"]();
    return text.contains("x") && values.first() && values.last();
  } }`;
  const result=standardHelpers(source);
  assert.match(result,/\/\/ Preserve \.contains\(x\), \.first\(\), and \.last\(\) in this comment\./);
  assert.ok(result.includes(String.raw`/\.first\(\)\.last\(\)/`));
  assert.ok(result.includes('values.first(1), b=values.last(2), c=values["first"]()'));
  assert.ok(result.includes('text.includes("x") && values.at(0) && values.at(-1)'));
});
