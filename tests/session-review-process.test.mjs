import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewLaunchPaths,runReviewProcess} from '../obsidian/taelgarverse/features/session-review-process.mjs';
import {resolveReviewPython} from '../obsidian/taelgarverse/features/session-review-python.mjs';

const python=resolveReviewPython(),args=code=>['-X','utf8','-B','-c',code];
const options={windowsHide:true,shell:false,timeout:5000,maxBuffer:1024*1024,encoding:'utf8'};

test('Windows launch paths normalize native drive and UNC separators without shell quoting',()=>{
  assert.deepEqual(reviewLaunchPaths('C:\\Program Files\\Python311\\python.exe','D:\\personal\\taelgar','win32'),{executable:'C:/Program Files/Python311/python.exe',cwd:'D:/personal/taelgar'});
  assert.deepEqual(reviewLaunchPaths('\\\\server\\share\\python.exe','\\\\server\\vault','win32'),{executable:'//server/share/python.exe',cwd:'//server/vault'});
  assert.deepEqual(reviewLaunchPaths('python',undefined,'win32'),{executable:'python',cwd:undefined});
  assert.deepEqual(reviewLaunchPaths('/usr/bin/python3','/notes\\literal','linux'),{executable:'/usr/bin/python3',cwd:'/notes\\literal'});
});

test('normalized process transport preserves Unicode JSON, large responses and helper errors',async()=>{
  const input={text:'Ch’ik’a — "quoted" % & $(literal)!'};
  const result=await runReviewProcess(python,args('import json,sys; value=json.load(sys.stdin); print(json.dumps({"echo":value,"padding":"x"*100000},ensure_ascii=False))'),options,JSON.stringify(input));
  assert.equal(result.error,null);assert.deepEqual(JSON.parse(result.output).echo,input);assert.equal(JSON.parse(result.output).padding.length,100000);
  const failure=await runReviewProcess(python,args('import sys,json; json.load(sys.stdin); print(json.dumps({"error":"Guarded failure"})); print("diagnostic",file=sys.stderr); sys.exit(1)'),options,'{}');
  assert.equal(failure.error.code,1);assert.equal(JSON.parse(failure.output).error,'Guarded failure');assert.match(failure.stderr,/diagnostic/);
});

test('normalized process transport bounds output and terminates timed-out helpers',async()=>{
  const large=await runReviewProcess(python,args('print("x"*10000)'),{...options,maxBuffer:100},'{}');
  assert.equal(large.error.code,'ERR_CHILD_PROCESS_STDIO_MAXBUFFER');
  const result=await runReviewProcess(python,args('import time; time.sleep(10)'),{...options,timeout:100},'{}');
  assert.equal(result.error.killed,true);
});

test('normalized process transport surfaces an early missing-executable error',async()=>{
  const result=await runReviewProcess('taelgar-review-nonexistent-executable',[],options,'{}');
  assert.equal(result.error.code,'ENOENT');
});
