// Keep long API requests visible without guessing a percentage or completion time.
export async function withPublicationProgress(label,action,log=()=>{},timings){
  const started=performance.now();let detail=label;
  const elapsed=()=>((performance.now()-started)/1000).toFixed(1)+'s';
  log(label+'…');
  const timer=setInterval(()=>log(detail+' — still working ('+elapsed()+').'),10000);
  timer.unref();
  try{
    const result=await action(message=>{detail=message;log(message);});
    log(label+' complete ('+elapsed()+').');
    return result;
  }catch(error){
    log(label+' failed ('+elapsed()+').');
    throw error;
  }finally{
    clearInterval(timer);
    if(timings)timings[label]=Math.round(performance.now()-started);
  }
}
