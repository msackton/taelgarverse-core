import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveReviewPython} from '../obsidian/taelgarverse/features/session-review-python.mjs';

test('Windows resolution skips a non-executable alias and resolves an installed Python .exe',()=>{
  const checked=[];
  const result=resolveReviewPython('',{platform:'win32',env:{Path:'C:\\WindowsApps',ProgramFiles:'C:\\Program Files'},
    executable:file=>{checked.push(file);return file==='C:\\Program Files\\Python311\\python.exe';},list:()=>['Other','Python311']});
  assert.equal(result,'C:\\Program Files\\Python311\\python.exe');assert.equal(checked[0],'C:\\WindowsApps\\python.exe');
});

test('configured native paths are honored and missing paths fail before process creation',()=>{
  const options={platform:'win32',env:{},executable:file=>file==='D:\\Tools\\Python\\python.exe'};
  assert.equal(resolveReviewPython('D:\\Tools\\Python\\python.exe',options),'D:\\Tools\\Python\\python.exe');
  assert.throws(()=>resolveReviewPython('D:\\Missing\\python.exe',options),/absolute path/);
  assert.throws(()=>resolveReviewPython('missing',{...options,list:()=>[]}),/not found as a native executable/);
});

test('Unix keeps configured commands and the python3 default',()=>{
  assert.equal(resolveReviewPython('',{platform:'linux'}),'python3');
  assert.equal(resolveReviewPython('/opt/python/bin/python',{platform:'darwin'}),'/opt/python/bin/python');
});
