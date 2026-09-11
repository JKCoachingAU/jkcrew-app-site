/* Original JKCrew seat-cover artwork. Product references are research links,
 * not product replicas, available inventory, sponsorships or compatibility claims.
 * Patterns share the photograph's 1536 × 1024 coordinate space. No remote assets.
 */
const JKCrewBikeSeats = (() => {
  'use strict';
  const references = Object.freeze([
    {part:'seat',title:'Odyssey Aaron Ross Tie-Dye Pivotal Seat',shop:"Albe’s BMX",url:'https://www.albes.com/products/odyssey-aaron-ross-tie-dye-pivotal-seat',description:'A real tie-dye seat reference; our spiral artwork is an original JKCrew design.'},
    {part:'seat',title:'Bone Deth Vibrator Pivotal Seat',shop:'LUXBMX',url:'https://www.luxbmx.com/products/bone-deth-vibrator-pivotal-seat',description:'A real leopard-print pivotal seat reference; our animal patterns are original artwork.'},
    {part:'seat',title:'Fiend Reynolds V2 Pivotal Seat (Zebra)',shop:'Dan’s Comp',url:'https://www.danscomp.com/fiend-reynolds-v2-pivotal-seat-zebra-st-402zbr/p1557946',description:'A printed canvas zebra seat reference; no brand graphics are copied into the garage.'},
    {part:'seat',title:'Odyssey X Bloom BMX Pivotal Seat (Cream Corduroy/Flowers)',shop:'Dan’s Comp',url:'https://www.danscomp.com/odyssey-x-bloom-bmx-pivotal-seat-v2-cream-corduroy-flowers-slim-ods-417-bloom2/p1629907',description:'A floral corduroy seat reference for colour and textile ideas.'},
    {part:'seat',title:'Federal Bikes Slim Logo Pivotal Seat (Camo/Black)',shop:'Dan’s Comp',url:'https://www.danscomp.com/federal-bikes-slim-logo-pivotal-seat-camo-black-12-fe306v/p1308873',description:'An archived camouflage seat reference, not an availability listing.'},
    {part:'pedals',title:'Odyssey Twisted Pro PC Pedals (Black/Purple Swirl)',shop:'Dan’s Comp',url:'https://www.danscomp.com/odyssey-twisted-pro-pc-pedals-black-purple-swirl-pair-odp-109-bkpur-p/p1429032',description:'Plastic composite platform with moulded grip pins; a reference for the plastic pedal shape and swirl finish.'},
    {part:'pedals',title:'MCS Sealed Pedals',shop:'LUXBMX',url:'https://www.luxbmx.com/products/mcs-sealed-pedals',description:'Nylon composite platforms with replaceable screw pins. A plastic body can also have metal grip pins.'},
    {part:'pedals',title:'HT AE05 Pedals (Alloy / CNC CRMO)',shop:'LUXBMX',url:'https://www.luxbmx.com/products/ht-ae05-pedals-alloy-cnc-crmo',description:'CNC aluminium platforms with replaceable pins; a reference for the metal pedal option.'},
    {part:'stem',title:'Odyssey CFL3 Stem',shop:"Albe’s BMX",url:'https://www.albes.com/products/odyssey-cfl3-stem',description:'A front-load BMX stem with a low-profile clamp and machined aluminium body.'},
    {part:'stem',title:'Salt Pro V2 Top Load Stem',shop:'LUXBMX',url:'https://www.luxbmx.com/products/salt-pro-v2-top-load-stem',description:'A top-load stem reference with a top clamp plate; its listed finishes include Chrome and Oil Slick.'},
    {part:'spokes',title:'USA Brand Titanium Spoke for 16-inch Wheels (Rainbow)',shop:"Albe’s BMX",url:'https://www.albes.com/products/usa-brand-titanium-spoke-for-16-wheels-rainbow',description:'Rainbow titanium finish reference. This specific listing is for 16-inch wheels; it is not a fit recommendation for the illustrated bike.'},
    {part:'finish',title:'S&M Enduro V2 Stem',shop:'LUXBMX',url:'https://www.luxbmx.com/products/s-m-enduro-v2-stem',description:'Anodised colour and machined-metal finish reference; the garage finish is an original approximation.'},
    {part:'finish',title:'Arise Xenon Expert Pedals',shop:'LUXBMX',url:'https://www.luxbmx.com/products/arise-xenon-expert-pedals',description:'The listed High Polished Silver and Oil Slick finishes provide real examples of reflective BMX parts.'},
  ].map(Object.freeze));
  const entries = [
    ['Leopard','Wild','leopard',['#DBAE6C','#87572E','#201B19'],1],
    ['Snow leopard','Wild','leopard',['#EAECE9','#A9ACB0','#242832']],
    ['Neon leopard','Wild','leopard',['#DBED5A','#79A752','#222B34']],
    ['Zebra','Wild','zebra',['#F4EFE5','#191D28'],2],
    ['Electric zebra','Wild','zebra',['#A682EF','#191D38']],
    ['Tiger stripes','Wild','tiger',['#ED923B','#30232A','#FFE0A4']],
    ['Cow spots','Wild','cow',['#F1EDE6','#24232A']],
    ['Emerald scales','Wild','scales',['#103D3B','#70C4A8','#248378']],
    ['Rainbow tie dye','Tie dye','dye',['#FFD97A','#F86B93','#A078EF','#53BBD7','#73D4AD'],0],
    ['Sunset tie dye','Tie dye','dye',['#FCE4A6','#F6B468','#F17974','#BC659B','#663E84']],
    ['Ocean tie dye','Tie dye','dye',['#E3FAEF','#76DBC7','#34A8C4','#346AC0','#534C9F']],
    ['Acid tie dye','Tie dye','dye',['#F2F89A','#BDD84B','#6DBD78','#399C9A','#335D78']],
    ['Berry tie dye','Tie dye','dye',['#FFD6E2','#ED8EAD','#B95FA8','#774B99','#383C73']],
    ['Pastel tie dye','Tie dye','dye',['#FFF1BF','#F5B8C7','#C7B5ED','#A7D9E9','#C5E6CA']],
    ['Race checker','Graphic','checker',['#F3EFE5','#202531']],
    ['Lilac checker','Graphic','checker',['#EADDF9','#8563B7']],
    ['Warped checker','Graphic','warp',['#EADFAD','#252735']],
    ['Lightning club','Graphic','lightning',['#25223D','#B6A1F7','#F0ED96']],
    ['Hazard stripe','Graphic','stripe',['#EBCD51','#282A2E']],
    ['Contour map','Graphic','topo',['#172D35','#74B4A0','#CEDCC2']],
    ['Pixel arcade','Graphic','pixel',['#252743','#7D71D4','#54C3B2','#F4A2BD']],
    ['Retro grid','Graphic','grid',['#202839','#927ACC','#55BEBD','#EFA773']],
    ['Daisy chain','Nature','flower',['#F4E5C6','#F9F3E7','#D49B43','#718F72'],3],
    ['Midnight bloom','Nature','flower',['#252842','#D88AAB','#F7C97A','#658F94']],
    ['Tropical palms','Nature','leaf',['#F4D6BC','#3C7B67','#79AA81']],
    ['Cherry blossom','Nature','blossom',['#C3D8DB','#D884A1','#F9D7DB','#66516F']],
    ['Fern forest','Nature','fern',['#133D35','#78B88C','#C6D6A4']],
    ['Sunflower','Nature','sunflower',['#253C42','#EABD4A','#805A38','#6F8F70']],
    ['Woodland camo','Camo','camo',['#7F8960','#3F6652','#B4A57A','#303E38'],4],
    ['Arctic camo','Camo','camo',['#E5ECEA','#B5C2C4','#73899C','#4F6071']],
    ['Desert camo','Camo','camo',['#D4BA92','#A3876B','#F0DCB8','#70655C']],
    ['Neon camo','Camo','camo',['#ABDF70','#3E8A80','#425570','#DDD981']],
    ['Digital camo','Camo','digital',['#818E7A','#ADB5A2','#4D665E','#293E3B']],
    ['Deep galaxy','Cosmic','galaxy',['#171A3C','#6F4EAD','#2F819C','#EDE5CF']],
    ['Pink nebula','Cosmic','galaxy',['#302043','#B965AB','#715BB7','#FAE5D3']],
    ['Constellation','Cosmic','stars',['#202A42','#7A94B2','#F8E5A6']],
    ['Northern lights','Cosmic','aurora',['#192C42','#75C4AE','#8897D1','#C5DFA9']],
    ['Meteor shower','Cosmic','meteor',['#272444','#A784CD','#F9C38D']],
    ['Ocean waves','Flow','waves',['#1D4D6F','#58A7BA','#C9E8DE']],
    ['Heat waves','Flow','waves',['#E29170','#F3C494','#8C577A']],
    ['Marble cloud','Flow','marble',['#EAE9E2','#AFBCC1','#6B8493']],
    ['Lava flow','Flow','lava',['#332732','#D46356','#F2AB66','#F3D6A1']],
    ['Liquid silver','Flow','chrome',['#C3C8D0','#5F7385','#EFF2EC','#8C9DB0']],
    ['Neon squiggle','Flow','squiggle',['#22263E','#A393E5','#72D6C1','#F0ABBD']],
    ['Carbon weave','Texture','carbon',['#272F37','#4C5762','#1A202A']],
    ['Diamond quilt','Texture','quilt',['#4C3E51','#A588A4','#C3A2B3']],
    ['Coffee corduroy','Texture','cord',['#906C50','#BE9872','#604A3E']],
    ['Indigo denim','Texture','denim',['#314D75','#8AA9C0','#233852']],
    ['Terrazzo','Texture','terrazzo',['#EFE3D0','#D6917A','#687D90','#B0AD7C','#57505C']],
    ['Confetti club','Texture','confetti',['#262D40','#AD9BE4','#ED9DA7','#73CDBB','#F3C77A']],
  ];
  const designs = Object.freeze(entries.map(([name,category,type,colours,reference],i) => {
    const item={id:`design-${String(i+1).padStart(2,'0')}`,name,category};
    if(Number.isInteger(reference)){item.sourceTitle=references[reference].title;item.sourceUrl=references[reference].url;}
    return Object.freeze(item);
  }));
  const lookup = new Map(designs.map((design,i)=>[design.id,{...design,type:entries[i][2],colours:entries[i][3]}]));
  const safePrefix = value => `jkseat-${String(value??'bike').replace(/[^A-Za-z0-9_-]/g,'-').slice(0,80)||'bike'}`;
  const idFor = (prefix,id) => `${safePrefix(prefix)}-${id}`;
  const num = value => Number(value.toFixed(2));
  const circle = (x,y,r,colour,opacity=1) => `<circle cx="${num(x)}" cy="${num(y)}" r="${num(r)}" fill="${colour}" opacity="${opacity}"/>`;
  const path = (d,colour,extra='') => `<path d="${d}" fill="${colour}" ${extra}/>`;
  const rect = (x,y,w,h,colour,extra='') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${colour}" ${extra}/>`;
  const line = (d,colour,width=1,extra='') => path(d,'none',`stroke="${colour}" stroke-width="${width}" ${extra}`);
  const ellipse = (x,y,rx,ry,colour,extra='') => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${colour}" ${extra}/>`;
  const seeded = seed => () => {seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const radial = (id,colours) => `<radialGradient id="${id}">${colours.map((colour,i)=>`<stop offset="${i/(colours.length-1)}" stop-color="${colour}"/>`).join('')}</radialGradient>`;
  const linear = (id,colours) => `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">${colours.map((colour,i)=>`<stop offset="${i/(colours.length-1)}" stop-color="${colour}"/>`).join('')}</linearGradient>`;
  function artwork(design,id) {
    const c=design.colours,rnd=seeded(Number(design.id.slice(-2))*179+23);
    let w=64,h=48,body='',extra='';
    switch(design.type) {
      case 'leopard':
        w=68;h=48;
        body=path('M5 8 Q10 0 17 6 L24 10 Q26 19 17 22 Q5 23 3 17Z',c[1])+path('M38 25 Q49 18 54 24 L59 32 Q55 41 46 42 Q34 38 38 25Z',c[1]);
        body+=line('M4 10 Q8 2 14 5 M20 7 Q30 12 23 19 M19 23 Q9 28 3 19 M37 27 Q40 20 47 21 M53 25 Q63 31 57 39 M49 43 Q39 46 35 37',c[2],4,'stroke-linecap="round"');
        body+=path('M40 4 Q46 0 50 5 L46 11 L40 9Z M8 35 L14 32 L17 37 L12 42 L7 40Z M60 13 L65 12 L66 18 L61 19Z',c[2]);break;
      case 'zebra':
        body=path('M-4 0 L10 0 Q28 10 11 23 Q2 33 17 48 L3 48 Q-6 34 5 22 Q17 9-4 0Z M31 0 L41 0 Q30 15 39 25 Q54 38 42 48 L31 48 Q42 35 30 25 Q22 13 31 0Z M57 0 L64 0 L64 48 L59 48 Q45 32 55 19 Q61 9 57 0Z',c[1]);break;
      case 'tiger':
        body=path('M0 0 L17 0 Q10 12 28 24 Q7 19 0 7Z M35 0 L46 0 Q29 18 50 29 Q27 24 29 12Z M64 7 L64 25 Q40 34 47 48 L37 48 Q29 29 64 7Z M0 30 Q15 27 24 48 L11 48 Q15 37 0 42Z',c[1])+line('M18 1 Q13 12 30 22 M51 3 Q37 20 54 28',c[2],2);break;
      case 'cow':
        body=path('M0 4 Q10-1 15 5 Q16 15 28 18 Q32 27 21 31 Q10 32 11 43 L0 45Z M44 0 Q36 6 42 16 Q51 24 58 13 Q65 9 64 0Z M40 35 Q48 27 59 35 L64 48 L37 48Z',c[1]);break;
      case 'scales':
        w=24;h=30;body=path('M0 1 Q12 18 24 1 M-12 16 Q0 33 12 16 Q24 33 36 16',c[2],`stroke="${c[1]}" stroke-width="1.5"`)+line('M3 4 Q12 15 21 4 M-9 19 Q0 29 9 19 M15 19 Q24 29 33 19',c[1],.7);break;
      case 'dye': {
        w=100;h=100;extra=radial(`${id}-glow`,[c[0],c[2],c[4]]);body=rect(0,0,w,h,`url(#${id}-glow)`);
        for(let arm=0;arm<12;arm++){
          const points=[];for(let r=1;r<=76;r+=2){const a=arm*Math.PI/6+r*.049+Math.sin(r*.73+arm)*.025;points.push([50+Math.cos(a)*r,50+Math.sin(a)*r]);}
          for(let r=76;r>=1;r-=2){const a=(arm+.98)*Math.PI/6+r*.049+Math.sin(r*.64+arm)*.025;points.push([50+Math.cos(a)*r,50+Math.sin(a)*r]);}
          body+=path('M'+points.map(p=>p.map(num).join(' ')).join(' L')+'Z',c[arm%c.length],'opacity=".8"');
        }
        for(let vein=0;vein<36;vein++){
          const points=[];for(let r=5;r<=76;r+=2){const a=vein*Math.PI/18+r*.049+Math.sin(r*.82+vein)*.022;points.push([50+Math.cos(a)*r,50+Math.sin(a)*r]);}
          body+=line('M'+points.map(p=>p.map(num).join(' ')).join(' L'),c[0],.55,'opacity=".22"');
        }
        for(let i=0;i<40;i++)body+=circle(rnd()*100,rnd()*100,1+rnd()*2.8,c[0],.11);
        body+=circle(50,50,3,c[0],.55);break;
      }
      case 'checker':w=32;h=32;body=rect(0,0,16,16,c[1])+rect(16,16,16,16,c[1]);break;
      case 'warp':
        w=64;h=64;body=path('M0 0 H32 Q44 16 32 32 H0 Q12 16 0 0Z M32 32 H64 Q52 48 64 64 H32 Q20 48 32 32Z',c[1]);break;
      case 'lightning':
        body=path('M20 3 L8 26 L19 23 L13 44 L36 16 L24 20 L32 3Z',c[1])+path('M52 1 L43 18 L50 17 L44 31 L60 11 L53 13 L60 1Z',c[2])+circle(47,40,1.5,c[1]);break;
      case 'stripe':w=32;h=32;body=path('M-16 0 H0 L32 32 H16Z M16 0 H32 L64 32 H48Z',c[1]);break;
      case 'topo':
        w=80;h=64;for(let i=0;i<6;i++)body+=line(`M${-10+i*2} ${5+i*9} C15 ${-5+i*7} 21 ${32+i*4} 45 ${13+i*8} S77 ${6+i*9} 94 ${20+i*8}`,c[i%2+1],i%3===0?1.4:.7);break;
      case 'pixel':
        for(let i=0;i<12;i++){const x=Math.floor(rnd()*8)*8,y=Math.floor(rnd()*6)*8;body+=path(`M${x} ${y} h8 v8 h8 v8 h-8 v-8 h-8Z`,c[1+i%3]);}break;
      case 'grid':
        w=64;h=64;body=line('M0 0 H64 M0 16 H64 M0 32 H64 M0 48 H64 M0 0 V64 M16 0 V64 M32 0 V64 M48 0 V64',c[1],.8)+path('M12 8 L30 23 L9 27Z',c[2])+circle(46,45,8,c[3])+line('M37 5 L50 17 M40 3 L53 15',c[3],2);break;
      case 'flower':case 'sunflower':case 'blossom': {
        w=68;h=52;const blossom=design.type==='blossom',sun=design.type==='sunflower';
        for(const [x,y,scale] of [[18,18,1],[53,44,.75]]){
          body+=line(`M${x} ${y} q8 8 17 21`,c[3],1.6)+ellipse(x+10,y+11,6,2.5,c[3],`transform="rotate(-30 ${x+10} ${y+11})"`);
          for(let i=0;i<(sun?10:blossom?5:8);i++){const angle=i*360/(sun?10:blossom?5:8);body+=ellipse(x,y-7*scale,blossom?5*scale:3*scale,7*scale,c[1],`transform="rotate(${angle} ${x} ${y})"`);}
          body+=circle(x,y,(sun?5:3)*scale,c[2]);
        }break;
      }
      case 'leaf':
        body=path('M9 44 Q-6 11 23 3 Q37 13 9 44Z M39 47 Q24 10 56 5 Q73 22 39 47Z',c[1])+line('M10 42 L23 8 M18 22 L8 18 M15 31 L27 21 M40 45 L55 10 M45 31 L59 24 M49 20 L40 16',c[2],1.8);break;
      case 'fern':
        w=52;h=58;for(const [x,y,a] of [[8,6,-20],[31,33,24]]){let leaves=line('M0 0 Q10 18 6 37',c[2],1);for(let i=0;i<6;i++)leaves+=path(`M${i<3?i*2:6} ${6+i*5} q-15-9-10-12 q11 2 11 11 q12-10 14-8 q0 7-14 11Z`,c[1]);body+=`<g transform="translate(${x} ${y}) rotate(${a})">${leaves}</g>`;}break;
      case 'camo':
        w=80;h=60;body=path('M-5 2 Q6 17 19 8 Q35 1 36 18 Q21 21 27 31 Q14 42-2 34Z M44 46 Q58 28 74 37 L84 62 H48Z',c[1])+path('M26-3 Q43 4 52 0 L71 0 Q60 12 67 22 Q52 28 41 17 Q39 11 26 13Z M3 51 Q18 39 33 48 L39 65 H4Z',c[2])+path('M44 26 Q53 19 58 27 Q50 38 35 42 Q21 42 29 34Z M75 6 Q68 20 81 27 L85 3Z',c[3]);break;
      case 'digital':
        w=72;h=48;for(let i=0;i<18;i++){const x=Math.floor(rnd()*12)*6,y=Math.floor(rnd()*8)*6;body+=path(`M${x} ${y} h18 v6 h-6 v6 h-18 v-6 h6Z`,c[1+i%3]);}break;
      case 'galaxy':
        w=100;h=72;extra=radial(`${id}-nebula`,[c[2],c[1],c[0]]);body=rect(0,0,w,h,`url(#${id}-nebula)`);for(let i=0;i<45;i++)body+=circle(rnd()*w,rnd()*h,.35+rnd()*.8,c[3],.4+rnd()*.6);body+=line('M24 14 V22 M20 18 H28 M70 47 V55 M66 51 H74',c[3],1);break;
      case 'stars':
        w=80;h=60;body=line('M10 11 L30 20 L43 8 L64 25 L57 45 L32 49 L30 20 M10 11 L9 38 L32 49',c[1],.7);for(const [x,y]of[[10,11],[30,20],[43,8],[64,25],[57,45],[32,49],[9,38]])body+=circle(x,y,1.7,c[2]);body+=circle(72,8,.8,c[2])+circle(18,55,.7,c[2]);break;
      case 'aurora':
        w=96;h=64;extra=linear(`${id}-sky`,[c[0],c[2],c[0]]);body=rect(0,0,w,h,`url(#${id}-sky)`);for(let i=0;i<10;i++)body+=line(`M-10 ${20+i*1.8} Q14 ${i*1.2} 36 ${22+i*1.5} T100 ${17+i*2.3}`,c[i%2?1:3],1.8,'opacity=".4"');for(let i=0;i<15;i++)body+=circle(rnd()*w,rnd()*h,.55,c[3],.7);break;
      case 'meteor':
        body=line('M4 26 L23 5 M22 51 L47 24 M48 25 L64 8',c[1],1.5)+line('M13 21 L24 8 M34 40 L48 25 M55 21 L62 12',c[2],2)+circle(24,8,2,c[2])+circle(48,25,1.6,c[2])+circle(6,45,.8,c[2]);break;
      case 'waves':
        w=64;h=36;for(let i=0;i<3;i++)body+=line(`M-16 ${i*12} Q0 ${i*12-11} 16 ${i*12} T48 ${i*12} T80 ${i*12}`,c[i%2+1],i===0?4:1.8);break;
      case 'marble':case 'chrome':
        w=96;h=60;extra=linear(`${id}-stone`,[c[0],c[2],c[0],c[1],c[0]]);body=rect(0,0,w,h,`url(#${id}-stone)`);for(let i=0;i<6;i++)body+=line(`M-10 ${i*12} C12 ${i*8-6} 26 ${i*10+20} 44 ${i*8+6} S74 ${i*8+22} 109 ${i*11+3}`,c[design.type==='chrome'?2:i%2+1],i%2===0?1.5:.5,`opacity="${design.type==='chrome'?.55:.6}"`);break;
      case 'lava':
        w=80;h=60;body=path('M0 2 Q23 20 15 31 T32 61 H53 Q31 42 41 25 T54 0Z',c[1])+path('M4 0 Q35 13 27 32 T42 60 H48 Q35 40 46 24 T60 0Z',c[2])+line('M10 0 Q41 12 33 32 T45 60',c[3],2.4);break;
      case 'squiggle':
        body=line('M2 6 Q21-2 11 13 T21 27 T8 43',c[1],3,'stroke-linecap="round"')+line('M36 2 Q22 17 42 18 T46 39',c[2],3,'stroke-linecap="round"')+line('M59 6 Q45 15 59 29 T57 48',c[3],2.5,'stroke-linecap="round"');break;
      case 'carbon':w=16;h=16;body=rect(0,0,8,8,c[1])+rect(8,8,8,8,c[1])+line('M1 1 H7 M1 3 H7 M1 5 H7 M1 7 H7 M9 9 V15 M11 9 V15 M13 9 V15 M15 9 V15',c[2],1);break;
      case 'quilt':w=32;h=32;body=line('M-16 0 L16 32 L48 0 M-16 32 L16 0 L48 32',c[1],1.2,'stroke-dasharray="2 1.3"')+circle(16,0,1.4,c[2])+circle(0,16,1.4,c[2])+circle(32,16,1.4,c[2])+circle(16,32,1.4,c[2]);break;
      case 'cord':w=12;h=16;body=rect(0,0,5,16,c[1])+rect(5,0,2,16,c[2])+line('M2 0 V16 M9 0 V16',c[0],.7);break;
      case 'denim':w=16;h=16;body=line('M-8 0 L8 16 M0 0 L16 16 M8 0 L24 16',c[1],1.5,'opacity=".55"')+line('M0 4 H16 M0 12 H16',c[2],.7);break;
      case 'terrazzo':
        w=72;h=56;for(let i=0;i<16;i++){const x=num(rnd()*w),y=num(rnd()*h),s=num(2+rnd()*5);body+=path(`M${x} ${y} l${s} -2 l${s*.6} ${s} l-${s*1.4} ${s*.5}Z`,c[1+i%4]);}break;
      case 'confetti':
        w=64;h=48;for(let i=0;i<21;i++){const x=num(rnd()*w),y=num(rnd()*h);body+=i%3===0?circle(x,y,1.8,c[1+i%4]):rect(x,y,2,5,c[1+i%4],`transform="rotate(${num(rnd()*180)} ${x} ${y})"`);}break;
    }
    return {w,h,body:rect(0,0,w,h,c[0])+body,extra};
  }
  function defs(prefix,designId) {
    const design=lookup.get(designId);if(!design)return '';
    const id=idFor(prefix,designId),art=artwork(design,id);
    return `${art.extra}<pattern id="${id}" patternUnits="userSpaceOnUse" x="440" y="300" width="${art.w}" height="${art.h}">${art.body}</pattern>`;
  }
  function fill(prefix,designId) {return lookup.has(designId)?`url(#${idFor(prefix,designId)})`:'';}
  let thumbnailNumber=0;
  function thumbnail(designId) {
    if(!lookup.has(designId))return '';
    const prefix=`thumb-${++thumbnailNumber}`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="440 300 240 120" width="160" height="80" aria-hidden="true" focusable="false"><defs>${defs(prefix,designId)}</defs>${rect(440,300,240,120,fill(prefix,designId),'rx="12"')}</svg>`;
  }
  return Object.freeze({designs,references,defs,fill,thumbnail});
})();
globalThis.JKCrewBikeSeats=JKCrewBikeSeats;
