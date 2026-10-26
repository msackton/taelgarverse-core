/* Rivers traced from Photoshop; other geometry illustrative. Image pixels, Y down. */
(() => {
 const rivers=window.tracedRivers.rivers;
 const roads=[
  {id:'kingsway',name:'The Kingsway',rank:0,points:[[2900,3890],[3220,3810],[3500,3840],[3760,3810],[3915,3765],[3940,3765],[3940,3740],[3970,3740],[4010,3740],[4150,3690],[4460,3650],[4760,3590],[5100,3500]]},
  {id:'north',name:'North Road',rank:1,points:[[3970,3740],[3965,3740],[3965,3715],[3940,3715],[3940,3690],[3880,3590],[3850,3480],[3800,3270],[3890,3120],[3825,2970]]},
  {id:'willowroad',name:'Willow Road',rank:1,points:[[3940,3715],[3915,3715],[3880,3715],[3820,3650],[3660,3635],[3580,3500],[3580,3420]]},
  {id:'south',name:'South Road',rank:1,points:[[3970,3740],[3965,3740],[3965,3790],[4040,3870],[4200,3980],[4470,3990]]},
  {id:'mill',name:'Mill Lane',rank:2,points:[[4150,3690],[4200,3630],[4180,3560]]},
  {id:'oaktrack',name:'Oakham Track',rank:2,points:[[3660,3635],[3700,3720],[3760,3810]]},
  {id:'easttrack',name:'Eastmere Lane',rank:2,points:[[4470,3990],[4390,3850],[4460,3650]]},
  {id:'farm',name:'Orchard Lane',rank:3,points:[[3915,3715],[3884,3708],[3862,3693],[3840,3690]]}
 ];
 const towns=[
  {id:'alderbridge',name:'Alderbridge',x:3970,y:3740,rank:0,type:'Market town',description:'A fictional demonstration town with an illustrative street plan. Zoom in to reveal its extent, streets, buildings and named landmarks.'},
  {id:'northwatch',name:'Northwatch',x:3825,y:2970,rank:0,type:'Fortified town',description:'An illustrative northern waypoint.'},
  {id:'stoneford',name:'Stoneford',x:4470,y:3990,rank:0,type:'Town',description:'An illustrative trading settlement.'},
  {id:'willowcross',name:'Willowcross',x:3580,y:3420,rank:1,type:'Village',description:'An illustrative village.'},
  {id:'eastmere',name:'Eastmere',x:4460,y:3650,rank:1,type:'Village',description:'A roadside village in the sample network.'},
  {id:'birchend',name:'Birch End',x:3660,y:3635,rank:2,type:'Hamlet',description:'A woodland-edge hamlet shown at local zoom.'},
  {id:'oakham',name:'Oakham',x:3760,y:3810,rank:2,type:'Hamlet',description:'A small farming settlement on the Kingsway.'},
  {id:'hollowmill',name:'Hollow Mill',x:4180,y:3560,rank:2,type:'Mill',description:'An illustrative mill reached by a local lane.'}
 ];
 const extent=[[3900,3695],[3920,3674],[3961,3667],[3990,3684],[4004,3711],[3994,3753],[4003,3780],[3975,3804],[3935,3804],[3905,3779],[3894,3732]];
 const streets=[];
 for(const x of [3915,3940,3965,3990])streets.push({name:({3915:'West Lane',3940:'Market Street',3965:'Chapel Street',3990:'Riverside Lane'})[x],points:[[x,3690],[x,3790]]});
 for(const y of [3690,3715,3740,3765,3790])streets.push({name:({3690:'North Lane',3715:'Market Row',3740:'High Street',3765:'South Row',3790:'Garden Lane'})[y],points:[[3915,y],[3990,y]]});
 streets.push({name:'Bridge Street',points:[[3990,3740],[4010,3740],[4030,3732]]});
 // Buildings occupy blocks between streets. One seed fixes their geometry
 // at every zoom; they are never regenerated as the camera moves.
 let seed=71;const rand=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
 const buildings=[];
 for(let col=0;col<3;col++)for(let row=0;row<4;row++)for(let n=0;n<4;n++){
  if((col===1&&row===1)||(col===2&&row===3))continue; // Market square and chapel yard.
  const x=3919+25*col+(n%2)*10+rand(),y=3694+25*row+Math.floor(n/2)*10+rand();
  const w=5+rand()*3,h=5+rand()*3;
  buildings.push({id:'house-'+buildings.length,name:'House',type:'Building',points:[[x,y],[x+w,y],[x+w,y+h],[x,y+h]]});
 }
 buildings.push({id:'hall',name:'Market Hall',type:'Landmark',points:[[3944,3719],[3960,3719],[3960,3726],[3944,3726]]});
 buildings.push({id:'chapel',name:'Stonelight Chapel',type:'Landmark',points:[[3970,3769],[3985,3769],[3985,3782],[3970,3782]]});
 const fields=[
  [[3850,3670],[3881,3670],[3890,3700],[3854,3695]],
  [[3854,3700],[3889,3705],[3890,3730],[3860,3725]],
  [[3860,3732],[3887,3737],[3890,3765],[3860,3760]],
  [[3915,3820],[3950,3820],[3950,3845],[3915,3840]],
  [[3957,3820],[3995,3815],[4010,3840],[3960,3848]]
 ];
 window.mapDemoData={version:2,geography:"mixed",provenance:{rivers:"Photoshop centerline traces",otherFeatures:"Fictional demo geometry"},width:11329,height:9419,rivers,roads,towns,extent,streets,buildings,fields,
  views:{region:{center:[3833,3050],zoom:-.6},local:{center:[3790,3090],zoom:.7},river:{center:[3920,3075],zoom:2.1},town:{center:[3960,3738],zoom:2.3}}};
})();
