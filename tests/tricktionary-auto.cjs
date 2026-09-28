const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const auto = require('../tricktionary-auto.js');

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(freeze);
  }
  return value;
}
const location = (entry, options) => {
  const result = auto.classify(entry, options);
  return [result.category, result.subcategory, result.status];
};
const catalog = freeze([
  {source_key: 'tbog', title: 'Toboggan', category: 'box', subcategory: 'other'},
  {source_key: 'barspin', title: 'Barspin', category: 'box', subcategory: 'other'},
  {source_key: 'barspin', title: 'Barspin', category: 'air', subcategory: 'other'},
  {source_key: 'truckdriver', title: 'Truckdriver', category: 'spine', subcategory: 'spins'},
  {source_key: 'opposite barspin', title: 'Opposite Barspin', category: 'air', subcategory: 'other'},
]);
let checks = 0;
function test(name, fn) { fn(); checks++; console.log('PASS ' + name); }

test('browser and CommonJS expose the same pure API without DOM dependencies', () => {
  const context = {};
  vm.runInNewContext(fs.readFileSync(require.resolve('../tricktionary-auto.js'), 'utf8'), context);
  assert.deepEqual(Object.keys(context.JKCrewTricktionaryAuto), Object.keys(auto));
  assert.equal(context.JKCrewTricktionaryAuto.classify({title:'360 Box'}).subcategory, 'spins');
});

test('explicit obstacle names and notes sort while ambiguous names stay unsorted', () => {
  for (const [title, category, subcategory] of [
    ['360 Box','box','spins'], ['Box jump Backflip','box','flips'], ['Jump-box Tailwhip','box','other'],
    ['Truckdriver Spine','spine','spins'], ['Truck-driver Box','box','spins'], ['270 Hip','hip','spins'],
    ['Back flip Quarter pipe','air','flips'], ['Quarterpipe 540','air','spins'], ['720 Vert','air','spins'],
    ['Fly-out Toboggan','air','other'], ['Air alley-oop','air','alleyoop'], ['Ali oop Box','box','transfers'],
    ['T-bog Box','box','other'], ['Tbog Spine','spine','other'], ['Toboggan Hip','hip','other'],
  ]) assert.deepEqual(location({title}), [category, subcategory, 'classified'], title);
  for (const title of ['Barspin','360','Tbog','T-bog','Toboggan','Invert','Airwalk','Whiplash']) {
    assert.deepEqual(location({title}, {catalog}), ['new',null,'needs_sorting'], title);
  }
  assert.deepEqual(location({title:'Barspin',notes:'On the spine'}), ['spine','other','classified']);
  assert.deepEqual(location({title:'Barspin',venue:'Box Hill skatepark',tricktionaryCategory:'box'}), ['new',null,'needs_sorting']);
  assert.deepEqual(location({title:'360',obstacleCategory:'hip'}), ['hip','spins','classified']);
});

test('title context wins over notes and mixed obstacles never receive guessed placement', () => {
  assert.deepEqual(location({title:'360 Air',notes:'Progressed from the Box'}), ['air','spins','classified']);
  assert.deepEqual(location({title:'Box Backflip',notes:'Start by the hip'}), ['box','flips','classified']);
  for (const title of ['Box 360 → Spine Barspin','Hip to Quarter transfer','Box / Air Tailwhip']) {
    assert.deepEqual(location({title,notes:'Box',tricktionaryCategory:'box'}), ['new',null,'needs_sorting']);
  }
  assert.deepEqual(location({title:'Barspin',notes:'Box or Air'}), ['new',null,'needs_sorting']);
  assert.equal(auto.classify({title:'Barspin'}).confidence, 0);
  assert(auto.classify({title:'Barspin Box'}).confidence > .9);
});

test('combined obstacle evidence cannot change original foam filtering or landed totals', () => {
  const input = freeze([
    { key:'barspin', title:'Barspin', notes:'Box', tricktionaryContextNotes:'Box\nAir', count:7, memberKeys:['barspin'] },
    { key:'backflip', title:'Backflip', notes:'Box', tricktionaryContextNotes:'Box\nFoam pit practice', count:2, memberKeys:['backflip'] },
  ]);
  const output = auto.organise(input);
  assert.deepEqual(output.map(entry => [entry.key,entry.count,entry.notes]), input.map(entry => [entry.key,entry.count,entry.notes]));
  assert.equal(output[0].tricktionaryCategory, 'new', 'Conflicting contexts stay unresolved');
  assert.equal(output[1].tricktionaryCategory, 'box', 'Supplementary context never replaces original foam evidence');
  assert.equal(auto.classify({title:'Backflip',notes:'Foam pit',tricktionaryContextNotes:'Box'}).status, 'excluded', 'Actual foam evidence remains excluded');
  assert.equal(auto.classify({title:'Barspin Box',notes:'Air',tricktionaryContextNotes:'Air\nSpine'}).category, 'box', 'Explicit title still has priority');
});

test('personal category and subcategory overrides, including deliberate New, win', () => {
  const profile = freeze({tricktionary_meta:{categories:{'360 box':'air','backflip box':'new','truck box':'box'},
    subcategories:{'360 box':'other','truck box':'transfers'}}});
  assert.deepEqual(location({title:'360 Box'}, {profile,catalog}), ['air','other','preserved']);
  assert.deepEqual(location({title:'Backflip Box'}, {profile,catalog}), ['new',null,'preserved']);
  assert.deepEqual(location({title:'Truck Box'}, {profile,catalog}), ['box','transfers','preserved']);
  assert.deepEqual(location({title:'360 Box',categoryOverride:'hip',subcategoryOverride:'other'}), ['hip','other','preserved']);
  assert.deepEqual(location({title:'360 Box',categoryOverride:'new'}), ['new',null,'preserved']);
  // A legacy aggregate's default New is not an explicit personal decision.
  assert.deepEqual(location({title:'360 Box',tricktionaryCategory:'new'}), ['box','spins','classified']);
  const previewProfile = {tricktionary_meta:{...profile.tricktionary_meta,categories:{...profile.tricktionary_meta.categories}}};
  delete previewProfile.tricktionary_meta.categories['backflip box'];
  assert.deepEqual(location({title:'Backflip Box'}, {profile:previewProfile}), ['box','flips','classified']);
  assert.equal(profile.tricktionary_meta.categories['backflip box'], 'new', 'Preview leaves the saved override untouched');
});

test('renames, merged aliases, canonical tombstones and legacy merge decisions survive', () => {
  const profile = freeze({tricktionary_meta:{aliases:{'old name':'middle','middle':'canon'},
    titles:{canon:'Coach Name'},categories:{canon:'spine'},subcategories:{canon:'other'},hidden:{'old name':true}}});
  assert.deepEqual(location({key:'old name',title:'360 Box',memberKeys:['old name','middle','canon']}, {profile}), ['spine','other','preserved']);
  const hidden = {tricktionary_meta:{...profile.tricktionary_meta,hidden:{canon:true}}};
  assert.equal(auto.classify({key:'old name',title:'Old name'}, {profile:hidden}).status, 'excluded');
  assert.equal(auto.organise([{key:'old name',title:'Old name',count:8}], {profile:hidden}).length, 0);
  const timestampHidden = {tricktionary_meta:{...profile.tricktionary_meta,hidden:{canon:'2026-09-28T01:23:45Z'}}};
  assert.equal(auto.classify({key:'old name',title:'Old name'}, {profile:timestampHidden}).status, 'excluded', 'Saved ISO timestamp tombstones are respected');
  assert.equal(auto.organise([{key:'old name',title:'Old name',count:8}], {profile:timestampHidden}).length, 0);
  const staleTimestamp = {tricktionary_meta:{...profile.tricktionary_meta,hidden:{'old name':'2026-09-28T01:23:45Z'}}};
  assert.deepEqual(location({key:'old name',title:'Old name'}, {profile:staleTimestamp}), ['spine','other','preserved'], 'A stale source tombstone cannot hide a merged canonical card');
  const legacy = freeze({manual_tricktionary:[{title:'Merged name',source:'merged',mergedFrom:['Old A','Old B'],tricktionaryCategory:'hip'}]});
  assert.deepEqual(location({key:'old a',title:'Old A'}, {profile:legacy}), ['hip','other','preserved']);
  const cycle = {tricktionary_meta:{aliases:{a:'b',b:'a'},categories:{a:'box'}}};
  assert.deepEqual(location({title:'b'}, {profile:cycle}), ['box','other','preserved']);
});

test('catalog matches exact approved names only in the explicit obstacle context', () => {
  const match = auto.classify({title:'Tbog Box'}, {catalog});
  assert.equal(match.source, 'catalog');
  assert.equal(match.suggestedTitle, 'Toboggan · Box');
  assert.equal(auto.classify({title:'Tbog'}, {catalog}).status, 'needs_sorting');
  assert.equal(auto.classify({title:'Tbog Air'}, {catalog}).source, 'title', 'A Box rule does not cross to Air');
  assert.equal(auto.classify({title:'Barspin Air'}, {catalog}).suggestedTitle, 'Barspin · Air');
  assert.equal(auto.classify({title:'Opposite Barspin Air'}, {catalog}).suggestedTitle, 'Opposite Barspin · Air');
  for (const title of ['Switch Barspin Air','180 Barspin Air','Barspin → Tailwhip Air','Double Barspin Air']) {
    assert.equal(auto.classify({title}, {catalog}).source, 'title', title + ' is not treated as plain Barspin');
  }
  assert.equal(auto.classify({title:'T-bog Box'}, {catalog}).source, 'title', 'Suggestion equivalents do not become unapproved classifier aliases');
  const conflicts = [...catalog,{source_key:'barspin',title:'Barspin',category:'air',subcategory:'spins'}];
  assert.equal(auto.classify({title:'Barspin Air'}, {catalog:conflicts}).source, 'title', 'Conflicting approved placements fall back to explicit text');
  const mislabeled = [{source_key:'barspin',title:'Barspin Air',category:'box',subcategory:'spins'}];
  assert.equal(auto.classify({title:'Barspin Box'}, {catalog:mislabeled}).source, 'title', 'Conflicting catalog obstacle wording is ignored');
  assert.deepEqual(auto.suggest('Barspin',mislabeled),[]);
  const renamedConflicts = [...catalog,{source_key:'barspin',title:'Different approved name',category:'air',subcategory:'other'}];
  assert.equal(auto.classify({title:'Barspin Air'}, {catalog:renamedConflicts}).suggestedTitle, undefined, 'Competing canonical names are not chosen arbitrarily');
});

test('foam evidence stays excluded and venue names do not exclude actual landings', () => {
  for (const entry of [{title:'Backflip Foam pit'},{title:'Box Backflip',category:'foam_pit'},
    {title:'Barspin',notes:'Foam-pit practice'},{title:'Barspin',tricktionaryCategory:'foam'}]) {
    assert.equal(auto.classify(entry).status, 'excluded');
    assert.equal(auto.organise([entry]).length, 0);
  }
  assert.deepEqual(location({title:'Barspin Air',venue:'Foam Factory Skatepark'}), ['air','other','classified']);
});

test('organising preserves every identity, title, count and evidence reference without merging', () => {
  const entries = freeze([
    {key:'tbog box',title:'Tbog Box',count:4,memberKeys:['tbog box'],landedAt:'2026-09-01',manualIds:['one'],sources:['Daily'],custom:{keep:true}},
    {key:'t-bog box',title:'T-bog Box',count:7,memberKeys:['t-bog box'],weekStart:'2026-08-31'},
    {key:'opposite barspin air',title:'Opposite Barspin Air',count:3,memberKeys:['opposite barspin air'],attempts:18},
    {key:'unknown',title:'Unknown',count:2,tricktionaryCategory:'new',memberKeys:['unknown']},
  ]);
  const original = JSON.stringify(entries), catalogBefore = JSON.stringify(catalog);
  const arranged = auto.organise(entries, {catalog});
  assert.notEqual(arranged, entries);
  assert.equal(arranged.length, entries.length);
  assert.equal(arranged.reduce((sum, entry) => sum + entry.count, 0), 16);
  for (let i = 0; i < entries.length; i++) {
    assert.notEqual(arranged[i], entries[i]);
    for (const [field,value] of Object.entries(entries[i])) {
      if (!['tricktionaryCategory','tricktionarySubcategory','tricktionaryAuto'].includes(field)) assert.equal(arranged[i][field],value,field);
    }
  }
  assert.equal(arranged[0].title,'Tbog Box');
  assert.equal(arranged[0].tricktionaryAuto.suggestedTitle,'Toboggan · Box');
  assert.equal(arranged[3].tricktionaryAuto.status,'needs_sorting');
  assert.equal(JSON.stringify(entries),original);
  assert.equal(JSON.stringify(catalog),catalogBefore);
});

test('suggestions qualify approved names without collapsing directions or obstacle choices', () => {
  assert.equal(auto.catalogTitle('Toboggan','box'),'Toboggan · Box');
  assert.equal(auto.catalogTitle('Opposite Barspin','air'),'Opposite Barspin · Air');
  for (const title of ['360 Box','Truck Spine','Air Tailwhip','Box → Spine line','Foam pit Backflip']) {
    assert.equal(auto.catalogTitle(title,'hip'),title);
  }
  assert.deepEqual(auto.suggest('Bar spin',catalog).map(row=>row.suggestedTitle),['Barspin · Air','Barspin · Box']);
  assert.deepEqual(auto.suggest('Bar spin Air',catalog).map(row=>row.suggestedTitle),['Barspin · Air']);
  assert.deepEqual(auto.suggest('T-bog',catalog).map(row=>row.suggestedTitle),['Toboggan · Box']);
  assert.deepEqual(auto.suggest('Opposite Bar',catalog).map(row=>row.suggestedTitle),['Opposite Barspin · Air']);
  assert.deepEqual(auto.suggest('Switch Bar',catalog),[]);
  assert.deepEqual(auto.suggest('Barspin Box Air',catalog),[]);
  assert.deepEqual(auto.suggest('',catalog),[]);
  assert.equal(catalog[0].title,'Toboggan');
});

test('batch sorting prepares the catalog once and never caches an outdated snapshot', () => {
  let categoryReads = 0;
  const rows = Array.from({length:100},(_,index)=>({source_key:'trick '+index,title:'Trick '+index,
    get category() { categoryReads++; return 'box'; },subcategory:'other'}));
  const entries = Array.from({length:30},(_,index)=>({key:'trick '+index,title:'Trick '+index+' Box',count:index+1}));
  const sorted = auto.organise(entries,{catalog:rows});
  assert.equal(sorted.length,30);
  assert(categoryReads < 1000, 'Catalog parsing is bounded by catalog size, not cards × catalog size');
  assert(sorted.every(entry=>entry.tricktionaryAuto.source==='catalog'));
  rows[0].title = 'Fresh approved name';
  assert.equal(auto.organise(entries,{catalog:rows})[0].tricktionaryAuto.suggestedTitle,'Fresh approved name · Box');
});

console.log(`${checks} Tricktionary automatic classification regressions passed.`);
