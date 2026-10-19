import fs from 'node:fs';
import {median} from './stats.mjs';
import {Engine} from '../src/engine.mjs';
import {loadSettings} from '../src/config.mjs';

const repeats = Number(process.env.REPEATS || 10);
if (!Number.isInteger(repeats) || repeats < 1) throw new Error('REPEATS must be a positive integer');
const started = performance.now();
const engine = new Engine(loadSettings());
const startup_ms = performance.now() - started;
const results = [];
for (const [page,date] of [
  ['Zahara','1730-01-20'],['Zahara','1730-02-01'],['Seeker','1748-01-01'],
  ['Melusa','1730-01-20'],['Dunmar Fellowship','1750-01-01'],['Vindristjarna','1750-01-01'],
]) {
  engine.render(page,date);
  const timings = [];
  for (let i = 0; i < repeats; i++) {
    const start = performance.now();
    engine.render(page,date);
    timings.push(performance.now() - start);
  }
  results.push({page,date,median_ms:Number(median(timings).toFixed(2))});
}
const report = {runtime:'node',startup_ms:Math.round(startup_ms),pages:engine.store.bySlug.size,repeats,
  response_cache:false,measurement:'warm single-request engine; excludes HTTP and browser',results};
console.log(JSON.stringify(report,null,2));
if (process.argv[2]) fs.writeFileSync(process.argv[2],JSON.stringify(report,null,2) + '\n');
