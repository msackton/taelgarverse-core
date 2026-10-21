// Invented examples, independent of vault lore and of the large Serin history.
// Assertions in header-synthesized.test.mjs state the expected domain behavior;
// there is no script-generated output snapshot to refresh.
export const synthesizedNotes={
  'People/Leda.md':{tags:['person'],name:'Leda',species:'human',pronouns:'they/them',born:'1700-01-01',
    pronunciation:'LEH-dah',affiliations:[{org:'North House',type:'primary'},
      {org:'South House',type:'primary'},'Astronomers'],whereabouts:'Aster'},
  'People/Eve.md':{tags:['person'],name:'Eve',title:'Warden',leaderOf:[
    {place:'Aster',title:'Warden',start:'1710-01-01',end:'1720-12-31'},
    {place:'Bellport',title:'Steward',start:'1721-01-01'},
  ]},
  'People/Noor.md':{tags:['person'],name:'Noor',title:'Warden',affiliations:[
    {org:'Aster',type:'leader',title:'Warden',start:'1715-01-01'},
  ]},
  'Places/Aster.md':{tags:['place'],name:'Aster',typeOf:'village',population:800,whereabouts:'East County',
    displayDefaults:{defArt:'',ruledBy:'<affiliationtitle:tx>: <name>'}},
  'Places/Bellport.md':{tags:['place'],name:'Bellport',typeOf:'town',whereabouts:'West County',
    displayDefaults:{defArt:'',ruledBy:'<affiliationtitle:tx>: <name>'}},
  'Places/East County.md':{tags:['place'],name:'East County',typeOf:'county',whereabouts:'North Realm'},
  'Places/West County.md':{tags:['place'],name:'West County',typeOf:'county',whereabouts:'North Realm'},
  'Places/North Realm.md':{tags:['place'],name:'North Realm',typeOf:'realm',whereabouts:'Coast'},
  'Places/Coast.md':{tags:['place'],name:'Coast',typeOf:'region',whereabouts:'Taelgar'},
  'Places/Loft.md':{tags:['place'],name:'Observatory Loft',typeOf:'building',whereabouts:'Aster'},
  'Places/Pier.md':{tags:['place'],name:'Old Pier',typeOf:'pier',created:'1700-01-01',destroyed:'1720-04-01',
    whereabouts:'Aster',displayDefaults:{endStatus:'washed away'}},
  'Objects/Sea Chest.md':{tags:['object'],name:'Sea Chest',typeOf:'chest',whereabouts:[
    {type:'home',location:'Loft',end:'1720-06-05'},
    {type:'home',location:'Skylark',start:'1720-06-06'},
  ]},
  'Objects/Skylark.md':{tags:['object'],name:'Skylark',typeOf:'ship',whereabouts:'Bellport'},
  'Objects/Traveller’s Lantern.md':{tags:['object'],name:'Traveller’s Lantern',typeOf:'lantern',subTypeOf:'magical',
    rarity:'uncommon',created:'1710-01-01',whereabouts:'Leda',displayDefaults:{wHome:'Carried <home:4q>'}},
  'Objects/Glass Compass.md':{tags:['object'],name:'Glass Compass',typeOf:'compass',created:'1700-01-01',whereabouts:[
    {type:'home',location:'Leda',end:'1710-12-31'},
    {type:'away',location:'Sea Chest',start:'1720-06-01',end:'1720-06-05'},
  ],displayDefaults:{wLastKnown:'Last seen <lastknown:4q> on <lastknowndate>'}},
  'Events/Bridge Opening.md':{tags:['event'],name:'Bridge Opening',DR:'1710-04-01',DR_end:'1710-04-03',
    whereabouts:'Aster',partOf:'Spring Festival'},
  'Events/Spring Festival.md':{tags:['event'],name:'Spring Festival'},
  'Powers/Lantern Keeper.md':{tags:['power'],name:'Lantern Keeper',typeOf:'spirit',pronouns:'xe/xem'},
  'Groups/North House.md':{tags:['group'],name:'North House'},
  'Groups/South House.md':{tags:['group'],name:'South House'},
  'Groups/Astronomers.md':{tags:['group'],name:'Astronomers',partOf:'Council',displayDefaults:{defArt:'the'}},
  'Groups/Council.md':{tags:['group'],name:'Learned Council'},
  'Creatures/Humans.md':{tags:['creature'],name:'Human'},
  'Field Notes.md':{},
};

export const synthesizedExamples=[
  {id:'person-with-two-primary-affiliations',path:'People/Leda.md',date:'1720-01-01'},
  {id:'object-carried-by-a-person',path:'Objects/Traveller’s Lantern.md',date:'1720-01-01'},
  {id:'lost-object-in-a-moving-container',path:'Objects/Glass Compass.md',date:'1720-06-07'},
  {id:'place-after-destruction',path:'Places/Pier.md',date:'1721-01-01'},
  {id:'short-historical-event',path:'Events/Bridge Opening.md',date:'1720-01-01'},
  {id:'power-with-custom-pronouns',path:'Powers/Lantern Keeper.md',date:'1720-01-01'},
  {id:'place-with-concurrent-rulers',path:'Places/Aster.md',date:'1720-01-01'},
  {id:'plain-note-without-metadata',path:'Field Notes.md',date:'1720-01-01'},
];
