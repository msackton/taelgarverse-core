// Keep long API requests visible without guessing a percentage or completion time.
export async function withPublicationProgress(label,action,log=()=>{}){
  const started=Date.now();let detail=label;
  const elapsed=()=>Math.round((Date.now()-started)/1000)+'s';
  log(label+'…');
  const timer=setInterval(()=>log(detail+' — still working ('+elapsed()+').'),10000);
  timer.unref();
  try{
    const result=await action(message=>{detail=message;log(message);});
    log(label+' complete ('+elapsed()+').');
    return result;
  }finally{clearInterval(timer);}
}
