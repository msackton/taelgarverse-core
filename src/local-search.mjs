import {compileSearch,searchDescriptor} from '../scripts/compile-search.mjs';
import {SearchIndex} from '../scripts/search-index.mjs';
import {createIndexSearch} from './search.mjs';

// Lazy, disposable SQLite preview index. Uses the production compiler/schema
// and SQL without Cloudflare credentials, remote storage or AI services.
export class LocalSearch {
  constructor(store){this.store=store;}
  async search(input,context){
    this.pending ??= this.initialize().catch(error=>{this.pending=null;throw error;});
    return (await this.pending)(input,context);
  }
  async initialize(){
    const {DatabaseSync}=await import('node:sqlite'),manifest=compileSearch(this.store),revision=manifest.digest;
    const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');this.db=db;
    const adapter={identity:'local-preview',query:async statements=>{
      db.exec('BEGIN');
      try{
        const output=statements.map(({sql,params=[]})=>{
          const statement=db.prepare(sql),read=sql.trim().startsWith('SELECT');
          const results=read?statement.all(...params):[];if(!read)statement.run(...params);
          return {success:true,results};
        });db.exec('COMMIT');return output;
      }catch(error){db.exec('ROLLBACK');throw error;}
    }};
    try{
      await new SearchIndex(adapter).stage(revision,manifest);
      return createIndexSearch(adapter.query,{revision,descriptor:searchDescriptor(manifest),store:this.store});
    }catch(error){this.close();throw error;}
  }
  close(){this.db?.close();this.db=null;this.pending=null;}
}
