/* Representative BMX component catalogue.
 * Frame/fork/bar/wheel/drivetrain "models" below are original geometry and
 * finishes inspired by well-known, real BMX part archetypes so riders can
 * recognise the shape language they already know from real bikes. They are
 * not licensed replicas and carry no brand logos or trademarked graphics —
 * where a specific real product informed a shape, it is named in
 * `references` below (verified, currently-live listings), exactly like the
 * existing seat-design reference pattern in bike-seat-designs.js.
 * All dimensions are metres, in the same coordinate space bike-three-model.js
 * already uses (20" wheel outer radius ≈ .266m ≈ real 20x2.20 BMX tyre).
 */
const JKCrewBikeParts = (() => {
  'use strict';

  const references = Object.freeze([
    {part:'frame',title:'Fit Bike Co Shortcut Frame',shop:'LUXBMX',url:'https://www.luxbmx.com/products/fit-bike-co-shortcut-frame',description:'A real 12.4" chainstay street frame — the shortest-chainstay archetype our Compact geometry is generalised from.'},
    {part:'frame',title:'SE Bikes PK Ripper Super Elite BMX Frame',shop:"Dan's Comp",url:'https://www.danscomp.com/se-racing-pk-ripper-super-elite-bmx-frame-black-29231070820-p/p1625319?v=1620969',description:'A classic elongated race-style frame — the long-wheelbase archetype our Long geometry is generalised from.'},
    {part:'fork',title:'Odyssey R32 Forks',shop:"Albe's BMX",url:'https://www.albes.com/products/odyssey-r32-forks',description:'Tapered, formed legs with a slotted dropout — the shape family our fork models are generalised from.'},
    {part:'bars',title:'Cult AK Bar (Alex Kennedy)',shop:'LUXBMX',url:'https://www.luxbmx.com/products/cult-ak-bar',description:'A real 30"-wide, 9–10" rise bar — the tall/wide archetype our Tall bar model is generalised from.'},
    {part:'tyres',title:'Odyssey Path Pro Tire',shop:"Albe's BMX",url:'https://www.albes.com/products/odyssey-path-pro-tire',description:'A directional tread with a smooth centre strip and side knurl — the pattern our All-Round tread is generalised from.'},
    {part:'hubs',title:'Cult Crew Freecoaster BMX Hub',shop:"Albe's BMX",url:'https://www.albes.com/products/cult-crew-freecoaster-bmx-hub',description:'A sealed freecoaster shell — the symmetric hub-shell archetype our Freecoaster hub style is generalised from.'},
    {part:'hubs',title:'Profile Racing Elite Cassette Hub Set',shop:"Dan's Comp",url:'https://www.danscomp.com/profile-racing-elite-cassette-hub-set-black-aluminum-driver-2816-800-bk/p1401654?v=1131044',description:'A driver-side cassette body and ratchet ring — the asymmetric hub-shell archetype our Cassette hub style is generalised from.'},
    {part:'cranks',title:'Profile 3 Piece BMX Cranks w/ GDH Spindle',shop:"Albe's BMX",url:'https://www.albes.com/products/profile-3-piece-bmx-cranks-w-gdh-hollow-chromoly-spindle',description:'Tubular chromoly arms on a splined spindle — the three-piece archetype our 3-Piece crank model is generalised from.'},
    {part:'cranks',title:'Odyssey Thunderbolt Cranks',shop:"Albe’s BMX",url:'https://www.albes.com/products/odyssey-thunderbolt-cranks',description:'A one-bolt, two-piece wedge-cluster crank — the single-arm archetype our 2-Piece crank model is generalised from.'},
    {part:'sprocket',title:'Cult Dak Guard Sprocket (Dakota Roche)',shop:"Dan's Comp",url:'https://www.danscomp.com/cult-dak-guard-sprocket-dakota-roche-black-04-spt-dakg-blk-p/p1146818',description:'A CNC guard sprocket with no cutouts — the solid-face archetype our Guard sprocket style is generalised from.'},
    {part:'grips',title:'ODI Longneck Soft Compound Flangeless Grips',shop:"Dan's Comp",url:'https://www.danscomp.com/odi-longneck-soft-compound-flangeless-grips-black-135mm-f01slb/p315318',description:'A uniform-barrel grip with no end flange — the shape our Flangeless grip style is generalised from.'},
    {part:'grips',title:'Cult x Vans Grips',shop:"Dan's Comp",url:'https://www.danscomp.com/cult-x-vans-grips-black-150mm-a01vfb/p432968',description:'A single inner flange with a waffle barrel — the shape our Flanged grip style is generalised from.'},
  ].map(Object.freeze));

  // Frame geometry presets: the six hardpoints bike-three-model.js already
  // builds the whole bike from (rear axle, front axle, bottom bracket, seat
  // tube top, head tube low/top). Chainstay, wheelbase, reach and stack all
  // fall out of these six points and stay in realistic BMX ranges.
  const frameModels = Object.freeze([
    {id:'compact', name:'Compact 20.5"', tagline:'Short 13.2" rear end · tight and flickable',
      rear:[-.495,.266], front:[.470,.266], bb:[-.16,.293], seat:[-.250,.600], headLow:[.345,.565], headTop:[.315,.686]},
    {id:'standard', name:'Standard 20.75"', tagline:'All-round street & park geometry',
      rear:[-.54,.266], front:[.505,.266], bb:[-.16,.295], seat:[-.255,.61], headLow:[.355,.58], headTop:[.324,.703]},
    {id:'long', name:'Long 21.25"', tagline:'Stretched 16.1" rear end · stable at speed',
      rear:[-.565,.266], front:[.560,.266], bb:[-.155,.298], seat:[-.265,.625], headLow:[.375,.598], headTop:[.342,.724]},
    {id:'tall', name:'Tall 21.5" / high-stack', tagline:'Raised front end for bigger riders',
      rear:[-.545,.266], front:[.520,.266], bb:[-.16,.300], seat:[-.260,.640], headLow:[.360,.615], headTop:[.328,.745]},
  ]);

  // Fork models vary leg thickness/taper/crown bulk — cosmetic families that
  // read as "lightweight", "standard" and "heavy duty" the way real fork
  // catalogues do.
  const forkModels = Object.freeze([
    {id:'lightweight', name:'Lightweight tapered', tagline:'Slim formed legs, light front end', legRadius:.0142, taper:.34, crownRadius:.0225},
    {id:'standard', name:'Standard', tagline:'All-round tapered legs', legRadius:.016, taper:.27, crownRadius:.025},
    {id:'heavy-duty', name:'Heavy duty', tagline:'Thicker straight-gauge legs for big impacts', legRadius:.0185, taper:.16, crownRadius:.0285},
  ]);

  // Bar models vary rise/width, layered on top of the existing two-piece /
  // four-piece weld-pattern choice.
  const barModels = Object.freeze([
    {id:'street-low', name:'Low 6" rise', tagline:'Low, narrow bars for technical street', riseY:.152, widthZ:.300},
    {id:'classic-mid', name:'Mid 8" rise', tagline:'The go-to all-around height and width', riseY:.210, widthZ:.335},
    {id:'tall-ak', name:'Tall 9.5" rise', tagline:'Tall, wide bars for a commanding cockpit', riseY:.245, widthZ:.375},
  ]);

  // Tread presets reshape the instanced tread-block pass around each tyre.
  const tireTreads = Object.freeze([
    {id:'slick', name:'Street slick', tagline:'Smooth centre strip, minimal rows', rows:1, blockScale:.7, spacingJitter:.006},
    {id:'all-round', name:'All-round tread', tagline:'Directional centre strip with side knurl', rows:3, blockScale:1, spacingJitter:.013},
    {id:'knobby', name:'Knobby dirt tread', tagline:'Tall, aggressive blocks for dirt and park', rows:4, blockScale:1.55, spacingJitter:.02},
  ]);

  const hubStyles = Object.freeze([
    {id:'cassette', name:'Cassette', tagline:'Driver body and ratchet ring on the drive side'},
    {id:'freecoaster', name:'Freecoaster', tagline:'Symmetric sealed shell, coasts either direction'},
  ]);

  const crankModels = Object.freeze([
    {id:'three-piece', name:'3-piece tubular', tagline:'Tubular chromoly arms on a splined spindle'},
    {id:'two-piece', name:'2-piece wedge', tagline:'One-bolt wedge cluster, thicker single-arm profile'},
  ]);

  const sprocketStyles = Object.freeze([
    {id:'cutout', name:'Cutout', tagline:'Lightened with five cutouts'},
    {id:'guard', name:'Guard', tagline:'Solid face guards the chain during grinds'},
  ]);

  const gripStyles = Object.freeze([
    {id:'flangeless', name:'Flangeless', tagline:'Uniform barrel, no end lip'},
    {id:'flanged', name:'Flanged', tagline:'Single inner flange locates the grip'},
  ]);

  const byId = list => Object.freeze(Object.fromEntries(list.map(item => [item.id, item])));
  return Object.freeze({
    references,
    frameModels, frameById: byId(frameModels),
    forkModels, forkById: byId(forkModels),
    barModels, barById: byId(barModels),
    tireTreads, tireTreadById: byId(tireTreads),
    hubStyles, hubStyleById: byId(hubStyles),
    crankModels, crankById: byId(crankModels),
    sprocketStyles, sprocketStyleById: byId(sprocketStyles),
    gripStyles, gripStyleById: byId(gripStyles),
  });
})();
globalThis.JKCrewBikeParts = JKCrewBikeParts;
