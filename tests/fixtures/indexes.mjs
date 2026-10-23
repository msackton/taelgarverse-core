export const indexNotes = {
  'Places/Realm.md':{tags:['place'],typeOf:'region',population:12000,indexes:['residents','settlements']},
  'Places/Other Realm.md':{tags:['place'],typeOf:'region'},
  'Places/Town.md':{tags:['place'],typeOf:'settlement',typeOfAlias:'town',population:1234,aliases:['Old Town'],whereabouts:[
    {type:'home',location:'Realm',end:'1749-12-31'},{type:'home',location:'Other Realm',start:'1750-01-01'}]},
  'Places/Inn.md':{tags:['place'],typeOf:'inn',whereabouts:'Town'},
  'Places/Ruin.md':{tags:['place'],typeOf:'settlement',whereabouts:'Realm',destroyed:'1710-01-01'},
  'Groups/Guild.md':{tags:['group'],indexes:['members']},
  'Groups/Chapter.md':{tags:['group'],partOf:'Guild'},
  'People/Alice.md':{tags:['person'],name:'Alice Example',gender:'female',pronunciation:'AL-iss',ancestry:'Townfolk',species:'human',image:'[[portraits/alice.png]]',born:1700,whereabouts:[
    {type:'home',location:'Inn'},{type:'away',location:'Other Realm',start:'1720-01-01',end:'1740-01-01'}],
    affiliations:[{org:'Guild',start:'1710-01-01',end:'1730-01-01',title:'Treasurer'}]},
  'People/Bob.md':{tags:['person'],born:1700,whereabouts:'Old Town',leaderOf:[{place:'Guild',start:'1715-01-01',title:'Master'}]},
  'People/Visitor.md':{tags:['person'],whereabouts:[{type:'home',location:'Other Realm'},{type:'away',location:'Town',start:'1720-01-01',end:'1740-01-01'}]},
  'People/Dead.md':{tags:['person'],whereabouts:'Town',died:'1710-01-01',affiliations:['Guild']},
  'People/Future.md':{tags:['person'],whereabouts:'Town',born:1760,affiliations:['Guild']},
  'People/Chapter Member.md':{tags:['person'],affiliations:['Chapter']},
  'People/Hidden.md':{tags:['person'],whereabouts:'Town',affiliations:['Guild'],excludePublish:'all'},
  'People/Campaign Secret.md':{tags:['person'],whereabouts:'Town',affiliations:['Guild'],excludePublish:['dufr']},
  'People/POV Secret.md':{tags:['person'],whereabouts:'Town',affiliations:['Guild'],POV:'1740s'},
};

export const featureIndexNotes={
  'Places/Basin.md':{tags:['place'],typeOf:'watershed',aliases:['Drainage Basin'],indexes:['rivers']},
  'Places/River.md':{tags:['place'],typeOf:'waterway',typeOfAlias:'river',name:'Main River',pronunciation:'RIV-er',image:'portraits/alice.png',whereabouts:[
    {type:'home',location:'Realm'},{type:'secondary',location:'Drainage Basin'}]},
  'Places/Brook.md':{tags:['place'],typeOf:'waterway',typeOfAlias:'brook',whereabouts:'River'},
  'Places/Lake.md':{tags:['place'],typeOf:'lake',whereabouts:'Basin'},
  'Places/Hidden River.md':{tags:['place'],typeOf:'waterway',excludePublish:'all',whereabouts:'Basin'},
  'Places/Future River.md':{tags:['place'],typeOf:'waterway',created:1760,whereabouts:'Basin'},
  'Places/Town.md':{...indexNotes['Places/Town.md'],indexes:['places']},
  'Places/Quarter.md':{tags:['place'],typeOf:'neighborhood',typeOfAlias:'district',whereabouts:'Old Town'},
  'Places/Shop.md':{tags:['place'],typeOf:'building',typeOfAlias:'shop',whereabouts:'Quarter'},
  'Places/Temple.md':{tags:['place'],typeOf:'building',typeOfAlias:'temple',whereabouts:'Town'},
  'Places/Future Building.md':{tags:['place'],typeOf:'building',created:1760,whereabouts:'Town'},
  'Places/Hidden Building.md':{tags:['place'],typeOf:'building',excludePublish:'all',whereabouts:'Town'},
  'Groups/Town Guild.md':{tags:['group'],whereabouts:'Town'},
};

export function indexSources(extraNotes={}) {
  return Object.fromEntries(Object.entries({...indexNotes,...extraNotes}).map(([path,metadata])=>[path,'---\n'+
    Object.entries(metadata).map(([key,value])=>key+': '+JSON.stringify(value)).join('\n')+'\n---\n'+
    (metadata.indexes ? '```taelgar-header\n```' : '# '+path.split('/').at(-1).slice(0,-3))+'\n\nAuthored prose.']));
}
