/* Registered photographic BMX layers. All parts share one camera and coordinate
 * system; finishes retain the original photograph's lighting and surface detail. */
const JKCrewBikeArt=(()=>{
  'use strict';
  const names={frame:'Frame',fork:'Fork',bars:'Handlebars',grips:'Grips',rims:'Wheel rims',hubs:'Wheel hubs',seat:'Seat',pedals:'Pedals',cranks:'Cranks',sprocket:'Sprocket',tyres:'Tyres',pegs:'Pegs',decal:'Frame decal',seatpost:'Seatpost',stem:'Stem',headset:'Headset',spokes:'Spokes',nipples:'Spoke nipples',brakes:'Brakes'};
  const assetUrls=Object.freeze({base:'./images/bike-garage/studio-white-v1.webp',options:'./images/bike-garage/studio-options-v1.webp',hardware:'./images/bike-garage/studio-hardware-v2.webp',metal:'./images/bike-garage/studio-metal-v2.webp'});
  const images=new Map(),finishes=['gloss','matte','chrome','raw','jetfuel'];
  const choice=(v,values,fallback)=>values.includes(v)?v:fallback;
  const colour=v=>typeof v==='string'&&/^#[0-9a-f]{6}$/i.test(v)?v.toUpperCase():'#F1F4F8';
  const styles=c=>({bars:choice(c?.barStyle,['two-piece','four-piece'],'two-piece'),seat:choice(c?.seatStyle,['slim','padded'],'slim'),pegs:choice(c?.pegs,['none','rear','both','four'],'none'),tyres:choice(c?.tyreStyle,['white','black','tan-wall','white-wall'],'white'),decal:choice(c?.decal,['none','jkcrew','lightning'],'none'),brakes:choice(c?.brakeStyle,['none','rear','dual'],'none'),stem:choice(c?.stemStyle,['top-load','front-load'],'top-load'),pedal:choice(c?.pedalMaterial,['plastic','metal'],'plastic'),spokes:choice(c?.spokeStyle,['standard','rainbow'],'standard'),modern:Number(c?.version)>=2||['pedalMaterial','stemStyle','brakeStyle'].some(k=>Object.hasOwn(c||{},k))});
  const urls=c=>{const s=styles(c),list=[assetUrls.base];if(s.bars==='four-piece'||s.seat==='padded')list.push(assetUrls.options);if(s.pegs!=='none'||s.brakes!=='none'||s.modern&&(s.pedal==='plastic'||s.stem==='top-load'))list.push(assetUrls.hardware);if(s.pedal==='metal'||s.stem==='front-load')list.push(assetUrls.metal);return list;};
  function prepare(config={}){return Promise.all(urls(config).map(url=>{if(images.has(url))return images.get(url).promise;const entry={ready:false,promise:null};entry.promise=new Promise((resolve,reject)=>{const img=new Image();let settled=false;const finish=error=>{if(settled)return;settled=true;clearTimeout(timer);img.onload=null;img.onerror=null;if(error){if(images.get(url)===entry)images.delete(url);reject(error);}else{entry.ready=true;resolve();}};const timer=setTimeout(()=>{finish(new Error('The bike photo took too long to load.'));img.src='';},12000);img.onload=async()=>{try{if(img.decode)await img.decode();finish();}catch(error){finish(error);}};img.onerror=()=>finish(new Error('The bike photo could not load.'));img.src=url;});images.set(url,entry);return entry.promise;}));}
  const isReady=c=>urls(c).every(url=>images.get(url)?.ready);
  const table=(fn)=>Array.from({length:41},(_,i)=>Math.max(0,Math.min(1,fn(i/40))).toFixed(4)).join(' ');
  function render(config={}, {idPrefix='bike',selectedPart='',interactive=false}={}){
    config=config&&typeof config==='object'?config:{};
    const masks=globalThis.JKCrewBikePhotoMasks,s=styles(config),prefix='bmx-'+(String(idPrefix||'bike').replace(/[^a-z0-9_-]/gi,'-').slice(0,64)||'bike');
    const id=k=>`${prefix}-${k}`,defs=[],layers=[],hits=[];
    const photo=url=>`<image href="${url}" x="0" y="0" width="1536" height="1024" preserveAspectRatio="none" pointer-events="none"/>`;
    const path=(shape,fill)=>`<path d="${shape.path||''}" fill="${fill}" fill-rule="${shape.fillRule||'nonzero'}"/>${shape.strokePath?`<path d="${shape.strokePath}" fill="none" stroke="${fill}" stroke-width="${shape.strokeWidth||4}" stroke-linecap="round"/>`:''}`;
    const union=(shapes)=>({path:shapes.filter(Boolean).map(m=>m.path).join(' '),bounds:[0,0,1536,1024]});
    const activePegs=s.pegs==='none'?[]:[masks.rearPegV2,...(['both','four'].includes(s.pegs)?[masks.frontPegV2]:[]),...(s.pegs==='four'?[masks.rearFarPeg,masks.frontFarPeg]:[])];
    const activeBrakes=s.brakes==='none'?[]:[masks.rearBrake,...(s.brakes==='dual'?[masks.frontBrake]:[])];
    const stemShape=s.stem==='front-load'?masks.stemFront:s.modern?masks.stemTop:masks.stem;
    const pedalShape=s.pedal==='metal'?masks.metalPedal:s.modern?masks.plasticPedal:masks.pedals;
    const pegShape={...union(activePegs),bounds:[209,653,1093,94],excludePath:activePegs.map(m=>m.excludePath||'').join(' ')};
    const shapeFor=part=>part==='pegs'?pegShape:part==='stem'?stemShape:part==='pedals'?pedalShape:masks[part==='bars'&&s.bars==='four-piece'?'barsFour':part==='grips'&&s.bars==='four-piece'?'gripsFour':part==='seat'&&s.seat==='padded'?'seatPadded':part];
    let composite=photo(assetUrls.base);
    const rectPatch=(key,url,x,y,w,h)=>{defs.push(`<clipPath id="${id(key+'-patch')}"><rect x="${x}" y="${y}" width="${w}" height="${h}"/></clipPath>`);composite+=`<g clip-path="url(#${id(key+'-patch')})">${photo(url)}</g>`;};
    if(s.bars==='four-piece')rectPatch('bars',assetUrls.options,865,25,260,260);
    if(s.seat==='padded')rectPatch('seat',assetUrls.options,425,295,260,125);
    if(s.modern||s.pedal==='metal')rectPatch('pedal',s.pedal==='metal'?assetUrls.metal:assetUrls.hardware,774,597,134,86);
    if(s.modern||s.stem==='front-load'){
      const shape=union([masks.stem,stemShape]);
      defs.push(`<mask id="${id('stem-patch')}" maskUnits="userSpaceOnUse" x="1016" y="245" width="109" height="70">${path(shape,'white')}<path d="${shapeFor('bars').path}" fill="black"/></mask>`);
      composite+=`<g mask="url(#${id('stem-patch')})">${photo(s.stem==='front-load'?assetUrls.metal:assetUrls.hardware)}</g>`;
    }
    if(activePegs.length){defs.push(`<clipPath id="${id('pegs-patch')}">${path(pegShape,'white')}</clipPath>`);composite+=`<g clip-path="url(#${id('pegs-patch')})">${photo(assetUrls.hardware)}</g>`;}
    defs.push(`<g id="${id('photograph')}">${composite}</g>`);
    function maskFor(key,shape,detail=shape.detail){
      const [x,y,w,h]=shape.bounds;
      const exclusions=[shape.excludePath,key!=='pegs'?activePegs.map(m=>m.path).join(' '):''].filter(Boolean).join(' ');
      defs.push(`<mask id="${id(key+'-mask')}" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="${x-3}" y="${y-3}" width="${w+6}" height="${h+6}">${path(shape,'white')}${exclusions?`<path d="${exclusions}" fill="black"/>`:''}</mask>`);
      if(detail){
        defs.push(`<filter id="${id(key+'-detail-filter')}" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 -.2126 -.7152 -.0722 0 1"/><feComponentTransfer><feFuncA type="table" tableValues="${table(a=>a<.11?0:Math.min(1,(a-.11)/.32))}"/></feComponentTransfer></filter><mask id="${id(key+'-detail')}" maskUnits="userSpaceOnUse" x="${x}" y="${y}" width="${w}" height="${h}"><use href="#${id('photograph')}" filter="url(#${id(key+'-detail-filter')})"/></mask>`);
      }
    }
    function paintGradient(key,shape,finish,value){
      const [x,y,w,h]=shape.bounds,stops=[];
      const fade=key==='frame'&&config.framePaint==='fade'&&['gloss','matte'].includes(finish);
      const rgb=[1,3,5].map(p=>parseInt(value.slice(p,p+2),16)),neutral=Math.max(...rgb)-Math.min(...rgb)<30;
      const mix=(v)=>key!=='pedals'||neutral?`rgb(${v},${v},${v})`:`rgb(${rgb.map(c=>Math.round(c*(v/255)*.75+v*.25)).join(',')})`;
      if(fade)stops.push([0,value],[1,colour(config.frameFadeColor)]);
      else if(key==='spokes'&&s.spokes==='rainbow'||finish==='jetfuel')stops.push([0,'#9260E5'],[.18,'#337DDB'],[.35,'#48C6C0'],[.5,'#C7CF5A'],[.63,'#D78A56'],[.8,'#C257A0'],[1,'#6751BA']);
      else if(finish==='chrome')stops.push([0,mix(232)],[.23,mix(247)],[.39,mix(133)],[.48,mix(242)],[.54,mix(255)],[.59,mix(103)],[.72,mix(187)],[.87,mix(250)],[1,mix(186)]);
      else if(finish==='raw')stops.push([0,mix(208)],[.4,mix(226)],[.62,mix(177)],[1,mix(205)]);
      else return value;
      const horizontal=fade||key==='spokes';
      defs.push(`<linearGradient id="${id(key+'-surface')}" gradientUnits="userSpaceOnUse" x1="${x}" y1="${y}" x2="${horizontal?x+w:x+w*.2}" y2="${horizontal?y:y+h}">${stops.map(([offset,color])=>`<stop offset="${offset}" stop-color="${color}"/>`).join('')}</linearGradient>`);
      return `url(#${id(key+'-surface')})`;
    }
    function coated(key,shape,value,finish='gloss',customFill=''){
      if(!shape||!shape.path)return '';
      const special=customFill||finish!=='gloss'||key==='frame'&&config.framePaint==='fade'||key==='spokes'&&s.spokes==='rainbow';
      if(value==='#F1F4F8'&&!special)return '';
      maskFor(key,shape);
      const [x,y,w,h]=shape.bounds,fill=customFill||paintGradient(key,shape,finish,value),matte=finish==='matte',raw=finish==='raw';
      const lightTable=table(l=>matte?.39+.61*Math.pow(Math.min(1,l/.92),1.15):Math.pow(Math.min(1,l/.92),1.45));
      const specTable=table(l=>Math.pow(Math.max(0,(l-.88)/.12),2.4));
      defs.push(`<filter id="${id(key+'-lighting')}" filterUnits="userSpaceOnUse" x="${x-3}" y="${y-3}" width="${w+6}" height="${h+6}" color-interpolation-filters="sRGB"><feColorMatrix type="saturate" values="0"/><feComponentTransfer>${['R','G','B'].map(c=>`<feFunc${c} type="table" tableValues="${lightTable}"/>`).join('')}</feComponentTransfer></filter><filter id="${id(key+'-shine')}" filterUnits="userSpaceOnUse" x="${x-3}" y="${y-3}" width="${w+6}" height="${h+6}" color-interpolation-filters="sRGB"><feColorMatrix type="saturate" values="0"/><feComponentTransfer>${['R','G','B'].map(c=>`<feFunc${c} type="table" tableValues="${specTable}"/>`).join('')}</feComponentTransfer></filter>`);
      if(raw)defs.push(`<pattern id="${id(key+'-grain')}" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(-28)"><path d="M0 0H3" stroke="#36404B" stroke-width=".4" opacity=".035"/><path d="M0 1.6H3" stroke="#FFF" stroke-width=".45" opacity=".075"/></pattern>`);
      return `<g mask="url(#${id(key+'-mask')})" pointer-events="none">${shape.detail?`<g mask="url(#${id(key+'-detail')})">`:''}<g style="isolation:isolate"><rect x="${x-3}" y="${y-3}" width="${w+6}" height="${h+6}" fill="${fill}"/><use href="#${id('photograph')}" filter="url(#${id(key+'-lighting')})" style="mix-blend-mode:multiply"/><use href="#${id('photograph')}" filter="url(#${id(key+'-shine')})" style="mix-blend-mode:screen" opacity="${matte?.035:raw?.12:finish==='chrome'?.76:.52}"/>${raw?`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#${id(key+'-grain')})"/>`:''}</g>${shape.detail?'</g>':''}</g>`;
    }
    const seatDesign=typeof config.seatDesign==='string'&&/^design-(?:0[1-9]|[1-4][0-9]|50)$/.test(config.seatDesign)?config.seatDesign:'solid';
    const seatArt=globalThis.JKCrewBikeSeats;
    if(seatDesign!=='solid'&&seatArt)defs.push(seatArt.defs(prefix,seatDesign));
    for(const part of ['tyres','rims','spokes','nipples','frame','fork','headset','seatpost','stem','bars','grips','seat','sprocket','cranks','pedals','hubs','pegs']){
      const shape=shapeFor(part);if(!shape)continue;
      const finish=choice(config.finishes?.[part],finishes,'gloss'),paint=part==='tyres'?(s.tyres==='white'?'#F1F4F8':'#25282C'):colour(config.colors?.[part]);
      layers.push(coated(part,shape,paint,part==='pedals'?(s.pedal==='metal'?'chrome':s.modern?'matte':'gloss'):finish,part==='seat'&&seatDesign!=='solid'&&seatArt?seatArt.fill(prefix,seatDesign):''));
      if(part==='tyres'&&['tan-wall','white-wall'].includes(s.tyres))layers.push(coated('sidewalls',masks.sidewalls,s.tyres==='tan-wall'?'#C8A474':'#E3E1D7','matte'));
      if(interactive)hits.push(`<g data-bike-part="${part}" role="button" tabindex="0" aria-label="Customize ${names[part].toLowerCase()}" data-selected="${selectedPart===part}" style="cursor:pointer"><title>${names[part]}</title><path class="bike-photo-hit" d="${shape.path}" fill="transparent" fill-rule="${shape.fillRule||'nonzero'}" pointer-events="fill"/></g>`);
    }
    if(s.decal!=='none'){
      const tone=colour(config.colors?.frame),bright=[1,3,5].reduce((a,i)=>a+parseInt(tone.slice(i,i+2),16),0)/3,ink=bright<90?'#F1F2F2':'#29303A';
      layers.push(`<g transform="translate(887 518) rotate(-31.4)" opacity=".8" pointer-events="none">${s.decal==='jkcrew'?`<text x="0" y="7" text-anchor="middle" fill="${ink}" font-family="Arial,Helvetica,sans-serif" font-size="21" font-weight="800" letter-spacing="2">JKCREW</text>`:`<path d="M-9 -15 H14 L0 -2 H20 L-16 19 L-4 3 H-22 L-9 -9 H-26Z" fill="${ink}"/>`}</g>`);
    }
    for(const [index,shape]of activeBrakes.entries()){
      const key='brake-photo-'+index;
      const shifted=index===1&&s.bars==='four-piece';
      const actual=shifted?{...shape,path:shape.caliperPath,strokePath:shape.strokePathFour}:shape;
      defs.push(`<mask id="${id(key)}" maskUnits="userSpaceOnUse" x="0" y="0" width="1536" height="1024">${path(actual,'white')}</mask>`);layers.push(`<g mask="url(#${id(key)})" pointer-events="none">${photo(assetUrls.hardware)}</g>`);
      if(shifted){defs.push(`<clipPath id="${id('front-lever-shift')}"><path d="${shape.leverPath}"/></clipPath>`);layers.push(`<g transform="translate(-12 26)" pointer-events="none"><g clip-path="url(#${id('front-lever-shift')})">${photo(assetUrls.hardware)}</g></g><path d="M1101 132 Q1123 130 1141.5 140" fill="none" stroke="#303233" stroke-width="3.1" stroke-linecap="round" pointer-events="none"/>`);}
    }
    if(interactive){hits.push(`<g data-bike-part="decal" role="button" tabindex="0" aria-label="Customize frame decal"><title>Frame decal</title><path class="bike-photo-hit" d="M794 550 L970 442 L985 468 L810 578Z" fill="transparent" pointer-events="fill"/></g>`);hits.push(`<g data-bike-part="brakes" role="button" tabindex="0" aria-label="Customize brakes"><title>Brakes</title>${activeBrakes.map(m=>`<path class="bike-photo-hit" d="${m.path}" fill="transparent" pointer-events="fill"/>`).join('')}</g>`);}
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1536 1024" preserveAspectRatio="xMidYMid meet" class="jkcrew-bike-art" role="${interactive?'group':'img'}" aria-labelledby="${id('title')}" data-bike-photo="true" style="display:block;width:100%;height:auto"><title id="${id('title')}">Photographic custom BMX bike${interactive?'; select a part to customise it':''}</title><defs>${defs.join('')}</defs><use href="#${id('photograph')}" pointer-events="none"/>${layers.join('')}${hits.join('')}</svg>`;
  }
  return Object.freeze({render,prepare,isReady,assetUrls});
})();
globalThis.JKCrewBikeArt=JKCrewBikeArt;
