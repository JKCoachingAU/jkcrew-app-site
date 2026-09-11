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
  // Printed fabric has irregular ink boundaries, not repeated geometric stamps.
  // These curves and the fine weave are deterministic, local SVG artwork.
  const smooth = (points,closed=false) => {
    let d=`M${points[0].map(num).join(' ')}`;
    for(let i=0;i<(closed?points.length:points.length-1);i++){
      const at=n=>points[closed?(n+points.length)%points.length:Math.max(0,Math.min(points.length-1,n))];
      const a=at(i-1),b=at(i),c=at(i+1),e=at(i+2);
      d+=` C${num(b[0]+(c[0]-a[0])/6)} ${num(b[1]+(c[1]-a[1])/6)} ${num(c[0]-(e[0]-b[0])/6)} ${num(c[1]-(e[1]-b[1])/6)} ${c.map(num).join(' ')}`;
    }
    return d+(closed?'Z':'');
  };
  const blob = (rnd,x,y,rx,ry,n=11) => Array.from({length:n},(_,i)=>{
    const a=i*Math.PI*2/n,r=.67+rnd()*.56;
    return [x+Math.cos(a)*rx*r,y+Math.sin(a)*ry*r];
  });
  const wrap = (body,w,h,id) => `<g id="${id}-tile-art">${body}</g>`+[-h,0,h].map(y=>[-w,0,w].filter(x=>x!==0||y!==0).map(x=>`<use href="#${id}-tile-art" transform="translate(${x} ${y})"/>`).join('')).join('');
  const inkFilter = (id,seed,scale=1.4,blur=.12) => `<filter id="${id}" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency=".047 .093" numOctaves="2" seed="${seed}" stitchTiles="stitch" result="ink"/><feDisplacementMap in="SourceGraphic" in2="ink" scale="${scale}" xChannelSelector="R" yChannelSelector="G"/><feGaussianBlur stdDeviation="${blur}"/></filter>`;
  const fabricDefs = id => `<pattern id="${id}-weave" patternUnits="userSpaceOnUse" width="4" height="4"><path d="M0 .4H4 M0 2.4H4" stroke="#17202B" stroke-width=".34" opacity=".1"/><path d="M.6 0V4 M2.6 0V4" stroke="#FFF9EB" stroke-width=".38" opacity=".13"/><path d="M.4 .5h.9 M2.4 2.5h.9" stroke="#FFF9EB" stroke-width=".35" opacity=".12"/></pattern>`;
  function artwork(design,id) {
    const c=design.colours,seed=Number(design.id.slice(-2))*179+23,rnd=seeded(seed);
    let w=64,h=48,body='',extra='',organic=false;
    switch(design.type) {
      case 'leopard': {
        w=240;h=160;organic=true;let spots='';
        for(let row=0;row<5;row++)for(let col=0;col<7;col++){
          const x=col*w/7+(row%2?14:0)+rnd()*9,y=row*32+rnd()*12,rx=7+rnd()*7,ry=6+rnd()*7;
          const points=blob(rnd,0,0,rx,ry,12);let spot=path(smooth(points,true),c[1],`opacity="${num(.58+rnd()*.25)}"`);
          // Broken, differently weighted rosettes; no two spots share an outline.
          for(let arc=0;arc<3;arc++){
            const start=arc*4,length=2+(rnd()>.4?1:0),outer=points.slice(start,start+length+1);
            const inner=outer.slice().reverse().map(([a,b])=>[a*.68,b*.64]);
            spot+=path(smooth(outer.concat(inner),true),c[2]);
          }
          if(rnd()>.48)spot+=path(smooth(blob(rnd,rx+3,-ry*.5,2+rnd()*2,1+rnd()*2,6),true),c[2]);
          spots+=`<g transform="translate(${num(x)} ${num(y)}) rotate(${num(rnd()*150)})">${spot}</g>`;
        }
        body=wrap(spots,w,h,id);break;
      }
      case 'zebra':case 'tiger': {
        w=240;h=160;organic=true;let stripes='';const tiger=design.type==='tiger';
        for(let i=-1;i<12;i++){
          const x=i*24,top=6+rnd()*8,bottom=4+rnd()*7,lean=-17+rnd()*34,bend=-13+rnd()*26;
          stripes+=path(`M${x} -8 C${x+lean+18} 24 ${x+bend-18} 48 ${x+lean} 80 S${x-bend+20} 128 ${x+lean} 168 L${x+lean+bottom} 168 C${x-bend+35} 123 ${x+lean+top+10} 114 ${x+lean+top} 80 S${x+lean+top+24} 23 ${x+top} -8Z`,c[1]);
          if(i%3===1)stripes+=path(`M${x+lean+4} 72 Q${x-30} 47 ${x-17} 16 Q${x-18} 46 ${x+lean+13} 62Z`,c[1]);
          if(tiger&&i%2===0)stripes+=line(`M${x+top+4} 0 Q${x+lean+30} 36 ${x+lean+top+3} 73`,c[2],1.2,'opacity=".4"');
        }
        body=wrap(stripes,w,h,id);break;
      }
      case 'cow': {
        w=240;h=160;organic=true;let spots='';
        for(let row=0;row<3;row++)for(let col=0;col<5;col++)spots+=path(smooth(blob(rnd,col*51+rnd()*15+(row%2?18:0),row*58+rnd()*10,18+rnd()*10,15+rnd()*12,13),true),c[1]);
        body=wrap(spots,w,h,id);break;
      }
      case 'scales':
        w=24;h=30;body=path('M0 1 Q12 18 24 1 M-12 16 Q0 33 12 16 Q24 33 36 16',c[2],`stroke="${c[1]}" stroke-width="1.5"`)+line('M3 4 Q12 15 21 4 M-9 19 Q0 29 9 19 M15 19 Q24 29 33 19',c[1],.7);break;
      case 'dye': {
        w=320;h=240;const cx=88+rnd()*42,cy=56+rnd()*22;
        extra=radial(`${id}-glow`,[c[0],c[2],c[4]])+inkFilter(`${id}-dye`,seed,9,.42);
        body=rect(0,0,w,h,`url(#${id}-glow)`);let dye='';
        const point=(a,r)=>[cx+Math.cos(a+r*.025+Math.sin(r*.063+a)*.09)*r,cy+Math.sin(a+r*.025+Math.sin(r*.054+a)*.1)*r*.83];
        for(let arm=0;arm<10;arm++){
          const a=arm*Math.PI/5,points=[];
          for(let r=2;r<=390;r+=5)points.push(point(a+Math.sin(r*.094+arm)*.035,r));
          for(let r=390;r>=2;r-=5)points.push(point(a+Math.PI/5+.05+Math.sin(r*.061+arm)*.048,r));
          dye+=path('M'+points.map(p=>p.map(num).join(' ')).join(' L')+'Z',c[arm%5],`opacity="${num(.65+rnd()*.23)}"`);
        }
        // Uneven pale resist marks follow the folds of one large dyed cloth.
        for(let vein=0;vein<65;vein++){
          const a=vein*Math.PI*2/65+(rnd()-.5)*.07,points=[],start=3+rnd()*28,end=140+rnd()*230;
          for(let r=start;r<end;r+=6)points.push(point(a+Math.sin(r*.32+vein)*.012,r));
          dye+=line('M'+points.map(p=>p.map(num).join(' ')).join(' L'),c[0],num(.45+rnd()*1.8),`opacity="${num(.1+rnd()*.25)}" stroke-linecap="round"`);
        }
        body+=`<g filter="url(#${id}-dye)">${dye}</g>`;break;
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
        w=240;h=160;organic=true;const blossom=design.type==='blossom',sun=design.type==='sunflower';let flowers='';
        for(let row=0;row<3;row++)for(let col=0;col<5;col++){
          const x=col*49+(row%2?18:0)+rnd()*12,y=row*55+rnd()*20,size=.65+rnd()*.65;
          let flower=line('M0 0 Q15 12 12 32',c[3],1.1)+path('M12 21 Q20 10 26 14 Q23 24 12 21 M11 25 Q-2 16-5 21 Q-1 28 11 25Z',c[3]);
          const petals=sun?13:blossom?5:9;
          for(let p=0;p<petals;p++){
            const angle=p*360/petals+(rnd()-.5)*10,reach=10+rnd()*5,width=blossom?7:sun?3.3:4;
            flower+=path(`M0 1 C${-width} -3 ${-width-2} ${-reach} -1 ${-reach-2} Q0 ${-reach-1} 1 ${-reach-3} C${width+3} ${-reach} ${width} -2 0 1Z`,blossom&&p%4===0?c[2]:c[1],`transform="rotate(${num(angle)})" opacity="${p%4===0?.8:.96}"`);
          }
          flower+=circle(0,0,sun?5.1:blossom?2.4:3.4,c[2]);
          for(let i=0;i<(sun?16:6);i++)flower+=circle((rnd()-.5)*(sun?6:3),(rnd()-.5)*(sun?6:3),.38,c[0],.65);
          flowers+=`<g transform="translate(${num(x)} ${num(y)}) rotate(${num(rnd()*140-70)}) scale(${num(size)})">${flower}</g>`;
        }
        body=wrap(flowers,w,h,id);break;
      }
      case 'leaf':case 'fern': {
        w=240;h=160;organic=true;const fern=design.type==='fern';let plants='';
        for(let row=0;row<3;row++)for(let col=0;col<5;col++){
          const x=col*48+(row%2?20:0)+rnd()*12,y=row*56+rnd()*18,length=37+rnd()*25;
          let leaves=line(`M0 8 Q9 ${-length*.4} 0 ${-length}`,c[2],.9);
          for(let i=0;i<8;i++){
            const y0=-i*length/8,reach=Math.sin((i+1)*Math.PI/10)*(fern?12:19),up=fern?8:15;
            for(const side of [-1,1])leaves+=path(`M${num(3+Math.sin(i/8*Math.PI)*2)} ${num(y0)} Q${num(side*reach*.5)} ${num(y0-up)} ${num(side*reach)} ${num(y0-up-3)} Q${num(side*reach*.8)} ${num(y0-1)} 3 ${num(y0+2)}Z`,(i+col)%4===0?c[2]:c[1]);
          }
          plants+=`<g transform="translate(${num(x)} ${num(y)}) rotate(${num(rnd()*115-58)})">${leaves}</g>`;
        }
        body=wrap(plants,w,h,id);break;
      }
      case 'camo': {
        w=240;h=160;organic=true;let patches='';
        for(let layer=1;layer<=3;layer++)for(let i=0;i<18;i++){
          const x=rnd()*w,y=rnd()*h,rx=13+rnd()*21,ry=7+rnd()*14;
          patches+=path(smooth(blob(rnd,x,y,rx,ry,14),true),c[layer]);
          if(i%3===0)patches+=path(smooth(blob(rnd,x+rx*.6,y+ry*.5,rx*.6,ry*.9,10),true),c[layer]);
        }
        body=wrap(patches,w,h,id);break;
      }
      case 'digital':
        w=72;h=48;for(let i=0;i<18;i++){const x=Math.floor(rnd()*12)*6,y=Math.floor(rnd()*8)*6;body+=path(`M${x} ${y} h18 v6 h-6 v6 h-18 v-6 h6Z`,c[1+i%3]);}break;
      case 'galaxy': {
        w=320;h=240;
        extra=`<radialGradient id="${id}-nebula"><stop stop-color="${c[2]}" stop-opacity=".85"/><stop offset=".5" stop-color="${c[1]}" stop-opacity=".6"/><stop offset="1" stop-color="${c[0]}" stop-opacity="0"/></radialGradient>`+inkFilter(`${id}-cloud`,seed,24,1.6);
        let clouds='';for(let i=0;i<9;i++)clouds+=ellipse(10+i*35,72+Math.sin(i*.65)*42,35+rnd()*40,18+rnd()*20,`url(#${id}-nebula)`,`transform="rotate(-24 ${10+i*35} ${num(72+Math.sin(i*.65)*42)})"`);
        body=`<g filter="url(#${id}-cloud)">${clouds}</g>`;
        for(let i=0;i<175;i++)body+=circle(rnd()*w,rnd()*h,.18+rnd()*.65,c[3],num(.23+rnd()*.6));
        for(const [x,y]of[[38,24],[172,87],[284,173]])body+=circle(x,y,1,c[3],.85)+line(`M${x-2} ${y}h4 M${x} ${y-2}v4`,c[3],.35,'opacity=".65"');break;
      }
      case 'stars':
        w=80;h=60;body=line('M10 11 L30 20 L43 8 L64 25 L57 45 L32 49 L30 20 M10 11 L9 38 L32 49',c[1],.7);for(const [x,y]of[[10,11],[30,20],[43,8],[64,25],[57,45],[32,49],[9,38]])body+=circle(x,y,1.7,c[2]);body+=circle(72,8,.8,c[2])+circle(18,55,.7,c[2]);break;
      case 'aurora':
        w=96;h=64;extra=linear(`${id}-sky`,[c[0],c[2],c[0]]);body=rect(0,0,w,h,`url(#${id}-sky)`);for(let i=0;i<10;i++)body+=line(`M-10 ${20+i*1.8} Q14 ${i*1.2} 36 ${22+i*1.5} T100 ${17+i*2.3}`,c[i%2?1:3],1.8,'opacity=".4"');for(let i=0;i<15;i++)body+=circle(rnd()*w,rnd()*h,.55,c[3],.7);break;
      case 'meteor':
        body=line('M4 26 L23 5 M22 51 L47 24 M48 25 L64 8',c[1],1.5)+line('M13 21 L24 8 M34 40 L48 25 M55 21 L62 12',c[2],2)+circle(24,8,2,c[2])+circle(48,25,1.6,c[2])+circle(6,45,.8,c[2]);break;
      case 'waves':
        w=64;h=36;for(let i=0;i<3;i++)body+=line(`M-16 ${i*12} Q0 ${i*12-11} 16 ${i*12} T48 ${i*12} T80 ${i*12}`,c[i%2+1],i===0?4:1.8);break;
      case 'marble':case 'chrome':case 'lava': {
        w=320;h=220;const lava=design.type==='lava',chrome=design.type==='chrome';
        extra=linear(`${id}-stone`,lava?[c[0],c[1],c[0]]:[c[0],c[2],c[0],c[1],c[0]])+inkFilter(`${id}-stone-ink`,seed,chrome?5:13,chrome?.12:.4);
        body=rect(0,0,w,h,`url(#${id}-stone)`);let veins='';
        for(let i=-3;i<18;i++){
          const points=[];for(let x=-20;x<=350;x+=12)points.push([x,35+i*12+Math.sin(x*.022+i*.13)*26+Math.sin(x*.049+i*.1)*8]);
          veins+=line(smooth(points),c[lava?1+(i+3)%3:(i+4)%2+1],lava?3+rnd()*7:chrome?1+rnd()*4:.35+rnd()*1.3,`opacity="${lava?.76:chrome?.7:.44}"`);
          if(i%3===0)veins+=line(smooth(points.map(([x,y])=>[x,y+2])),c[lava?3:1],.55,'opacity=".5"');
        }
        body+=`<g filter="url(#${id}-stone-ink)">${veins}</g>`;break;
      }
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
    if(organic){extra+=inkFilter(`${id}-ink`,seed);body=`<g filter="url(#${id}-ink)">${body}</g>`;}
    // A light warp/weft and tiny yarn slubs are visible in close-up, but do not
    // compete with the print or add another glossy layer to the saddle photo.
    extra+=fabricDefs(id);
    body+=rect(0,0,w,h,`url(#${id}-weave)`);
    for(let i=0;i<Math.ceil(w*h/190);i++){
      const x=rnd()*w,y=rnd()*h;
      body+=line(`M${num(x)} ${num(y)}h${num(.4+rnd()*1.1)}`,i%2?'#FFF9EC':'#17202B',.32,`opacity="${num(.06+rnd()*.06)}"`);
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
