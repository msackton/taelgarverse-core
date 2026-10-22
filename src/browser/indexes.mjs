import {mountIndexPopups} from './index-popups.mjs';
mountIndexPopups(document,{load:async(details,{signal})=>{
  const url=new URL(details.dataset.indexUrl,location.href);
  if(url.origin!==location.origin || url.pathname!=='/api/index')throw new Error('Invalid index destination');
  const response=await fetch(url,{signal,headers:{Accept:'text/html'}});
  if(!response.ok)throw new Error('Index unavailable');
  return response.text();
}});
