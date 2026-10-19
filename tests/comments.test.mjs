import test from 'node:test';
import assert from 'node:assert/strict';
import {filterComments} from '../src/comments.mjs';

const filter = (text,date = '1740-10-07',campaigns = []) => filterComments(text,{date,campaigns,source:'Example.md'});
test('date blocks include cutoff; b blocks strictly precede it',() => {
  const source = '%%^Date:1740-10-07%%new%%^End%%%%^Date:1740-10-07b%%old%%^End%%';
  assert.equal(filter(source,'1740-10-06'),'old');
  assert.equal(filter(source),'new');
  assert.equal(filter(source,'1740-10-08'),'new');
  assert.equal(filter('%%^Date:1740%%year%%^End%%','1740-01-01'),'year');
});
test('campaign IDs are case-insensitive; none is always private',() => {
  assert.equal(filter('%%^Campaign:dufr%%yes%%^End%%%%^Campaign:none%%secret%%^End%%',undefined,['DUFR']),'yes');
  assert.equal(filter('%%^Campaign:none%%secret%%^End%%',undefined,['none']),'');
});
test('all metadata, POV, lint and ordinary comments are stripped',() => {
  const source = 'public%% ordinary %%' + ['Metadata','Metadata:names:v1','Metadata:map:v1','povNotes','povNotes:v1','Lint']
    .map(marker => '%%^' + marker + '%%secret%%^End%%').join('') + '%%SECRET private %%after';
  assert.equal(filter(source),'publicafter');
});
test('code spans and fences retain literal comment syntax',() => {
  const bt = String.fromCharCode(96);
  for (const source of [
    'Examples: ' + bt + '%%SECRET' + bt + ', ' + bt + '%% ordinary %%' + bt + '.',
    bt.repeat(2) + '%%^Lint%%private%%^End%%' + bt.repeat(2),
    'before\n' + bt.repeat(3) + 'markdown\n%%SECRET\n%%^Lint%%private%%^End%%\n' + bt.repeat(3) + '\nafter',
  ]) assert.equal(filter(source),source);
  assert.equal(filter('%%^Campaign:dufr%%\n~~~markdown\n%%^End%%\n~~~\nkept\n%%^End%%',undefined,['dufr']),
    '\n~~~markdown\n%%^End%%\n~~~\nkept\n');
});
test('code delimiters inside comments and unmatched/escaped spans',() => {
  const bt = String.fromCharCode(96);
  assert.equal(filter('public %% private ' + bt + '%%' + bt + ' detail %% after'),'public  after');
  assert.equal(filter('public ' + bt + '\n%% private %%\n' + bt + ' after'),'public ' + bt + '\n\n' + bt + ' after');
  assert.equal(filter('public \\' + bt + ' %% private %% \\' + bt + ' after'),'public \\' + bt + '  \\' + bt + ' after');
  assert.equal(filter('%%^Campaign:none%%private ' + bt + '%%SECRET' + bt + ' example%%^End%%public'),'public');
});
for (const source of [
  'visible %% comment','%%^Campagin:none%%private%%^End%%','%%^Lint%%private','visible%%^End%%',
  '%%^Campaign:dufr%%outer%%^Date:1740%%inner%%^End%%%%^End%%',
  '%%^Lint%%private %% comment%%^End%%','%%^Date:1740-10-07^%%later%%^End%%',
  '%%^Date:1740a%%private%%^End%%','%%^Date:1740-13-01%%private%%^End%%',
]) test('reject malformed comment: ' + source.slice(0,30),() => assert.throws(() => filter(source),{status:422}));
test('date blocks require a date; errors identify lines without body',() => {
  assert.throws(() => filterComments('%%^Date:1740%%private%%^End%%'),/requires a configured/);
  assert.throws(() => filterComments('visible\n%%^Lint%%PRIVATE BODY',{source:'Secret.md',lineOffset:7}),
    error => error.message.includes('Secret.md:9') && !error.message.includes('PRIVATE BODY'));
});
