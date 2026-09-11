/* Photographic BMX materials. The same photo coordinates are used by every
 * preview, colour mask and hit target; no third-party images or services. */
const JKCrewBikeArt = (() => {
  'use strict';
  const names={frame:'Frame',fork:'Fork',bars:'Handlebars',grips:'Grips',rims:'Wheel rims',hubs:'Wheel hubs',seat:'Seat',pedals:'Pedals',cranks:'Cranks',sprocket:'Sprocket',tyres:'Tyres',pegs:'Pegs',decal:'Frame decal'};
  const assetUrls=Object.freeze({base:'./images/bike-garage/studio-white-v1.webp',options:'./images/bike-garage/studio-options-v1.webp'});
  const images=new Map();
  const choice=(value,values,fallback)=>values.includes(value)?value:fallback;
  const colour=value=>typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value)?value.toUpperCase():'#F1F4F8';
  const styles=config=>({bars:choice(config?.barStyle,['two-piece','four-piece'],'two-piece'),seat:choice(config?.seatStyle,['slim','padded'],'slim'),pegs:choice(config?.pegs,['none','rear','both'],'none'),tyres:choice(config?.tyreStyle,['white','black','tan-wall','white-wall'],'white'),decal:choice(config?.decal,['none','jkcrew','lightning'],'none')});
  const urls=config=>{const s=styles(config);return s.bars==='four-piece'||s.seat==='padded'||s.pegs!=='none'?[assetUrls.base,assetUrls.options]:[assetUrls.base];};
  function prepare(config={}) {
    return Promise.all(urls(config).map(url=>{
      if(images.has(url))return images.get(url).promise;
      const entry={ready:false,promise:null};
      entry.promise=new Promise((resolve,reject)=>{
        const img=new Image();let settled=false;
        const finish=error=>{
          if(settled)return;settled=true;clearTimeout(timer);img.onload=null;img.onerror=null;
          if(error){if(images.get(url)===entry)images.delete(url);reject(error);}
          else{entry.ready=true;resolve();}
        };
        const timer=setTimeout(()=>{finish(new Error('The bike photo took too long to load.'));img.src='';},12000);
        img.onload=async()=>{try{if(img.decode)await img.decode();finish();}catch(error){finish(error);}};
        img.onerror=()=>finish(new Error('The bike photo could not load.'));
        img.src=url;
      });
      images.set(url,entry);return entry.promise;
    }));
  }
  const isReady=config=>urls(config).every(url=>images.get(url)?.ready);
  // Map neutral photographic luminance into painted colour, retaining dark
  // surface detail and bright softbox reflections instead of a flat overlay.
  function materialTable(channel) {
    const target=channel/255;
    return Array.from({length:21},(_,i)=>{
      const light=i/20;
      const diffuse=target*Math.pow(Math.min(1,light/.91),1.6);
      const specular=Math.pow(Math.max(0,(light-.91)/.09),2.2)*.94;
      return Math.min(1,diffuse*(1-specular)+specular).toFixed(4);
    }).join(' ');
  }
  function render(config={}, {idPrefix='bike',selectedPart='',interactive=false}={}) {
    config=config&&typeof config==='object'?config:{};
    const masks=globalThis.JKCrewBikePhotoMasks,s=styles(config);
    const prefix='bmx-'+(String(idPrefix||'bike').replace(/[^a-z0-9_-]/gi,'-').slice(0,64)||'bike');
    const id=key=>`${prefix}-${key}`;
    const defs=[],layers=[],hits=[];
    const photo=(url)=>`<image href="${url}" x="0" y="0" width="1536" height="1024" preserveAspectRatio="none" pointer-events="none"/>`;
    let composite=photo(assetUrls.base);
    const patch=(key,x,y,width,height)=>{
      defs.push(`<clipPath id="${id(key+'-patch')}" clipPathUnits="userSpaceOnUse"><rect x="${x}" y="${y}" width="${width}" height="${height}"/></clipPath>`);
      composite+=`<g clip-path="url(#${id(key+'-patch')})">${photo(assetUrls.options)}</g>`;
    };
    if(s.bars==='four-piece')patch('bars',865,25,260,260);
    if(s.seat==='padded')patch('seat',425,295,260,125);
    if(s.pegs!=='none')patch('rear-peg',270,650,94,70);
    if(s.pegs==='both')patch('front-peg',1140,676,101,71);
    defs.push(`<g id="${id('photograph')}">${composite}</g>`);
    const shapeFor=part=>masks[part==='bars'&&s.bars==='four-piece'?'barsFour':part==='grips'&&s.bars==='four-piece'?'gripsFour':part==='seat'&&s.seat==='padded'?'seatPadded':part];
    function maskFor(key,shape) {
      const [x,y,w,h]=shape.bounds;
      const exclusions=[shape.excludePath,s.pegs!=='none'?masks.rearPeg.path:'',s.pegs==='both'?masks.frontPeg.path:''].filter(Boolean).join(' ');
      defs.push(`<mask id="${id(key+'-mask')}" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="${x-3}" y="${y-3}" width="${w+6}" height="${h+6}"><path d="${shape.path}" fill="white" fill-rule="${shape.fillRule||'nonzero'}"/>${exclusions?`<path d="${exclusions}" fill="black" fill-rule="nonzero"/>`:''}</mask>`);
    }
    function tinted(key,shape,value) {
      if(!shape||value==='#F1F4F8')return '';
      maskFor(key,shape);
      const [x,y,w,h]=shape.bounds;
      defs.push(`<filter id="${id(key+'-paint')}" filterUnits="userSpaceOnUse" x="${x-3}" y="${y-3}" width="${w+6}" height="${h+6}" color-interpolation-filters="sRGB"><feColorMatrix type="saturate" values="0"/><feComponentTransfer>${['R','G','B'].map((name,i)=>`<feFunc${name} type="table" tableValues="${materialTable(parseInt(value.slice(1+i*2,3+i*2),16))}"/>`).join('')}</feComponentTransfer></filter>`);
      return `<g mask="url(#${id(key+'-mask')})" pointer-events="none"><use href="#${id('photograph')}" filter="url(#${id(key+'-paint')})"/></g>`;
    }
    for(const part of ['tyres','rims','frame','fork','bars','grips','seat','sprocket','cranks','pedals','hubs']) {
      const shape=shapeFor(part);if(!shape)continue;
      let content=tinted(part,shape,part==='tyres'?(s.tyres==='white'?'#F1F4F8':'#25282C'):colour(config.colors?.[part]));
      if(part==='tyres'&&['tan-wall','white-wall'].includes(s.tyres))content+=tinted('sidewalls',masks.sidewalls,s.tyres==='tan-wall'?'#C8A474':'#E3E1D7');
      layers.push(content);
      if(interactive)hits.push(`<g data-bike-part="${part}" role="button" tabindex="0" aria-label="Customize ${names[part].toLowerCase()}" data-selected="${selectedPart===part}" style="cursor:pointer"><title>${names[part]}</title><path class="bike-photo-hit" d="${shape.path}" fill="transparent" fill-rule="${shape.fillRule||'nonzero'}" pointer-events="fill"/></g>`);
    }
    if(s.decal!=='none'){
      const tone=colour(config.colors?.frame),brightness=[1,3,5].reduce((v,i)=>v+parseInt(tone.slice(i,i+2),16),0)/3;
      const ink=brightness<90?'#F1F2F2':'#29303A';
      layers.push(`<g transform="translate(887 518) rotate(-31.4)" opacity=".8" pointer-events="none">${s.decal==='jkcrew'?`<text x="0" y="7" text-anchor="middle" fill="${ink}" font-family="Arial,Helvetica,sans-serif" font-size="21" font-weight="800" letter-spacing="2">JKCREW</text>`:`<path d="M-9 -15 H14 L0 -2 H20 L-16 19 L-4 3 H-22 L-9 -9 H-26Z" fill="${ink}"/>`}</g>`);
    }
    if(interactive){
      hits.push(`<g data-bike-part="decal" role="button" tabindex="0" aria-label="Customize frame decal"><title>Frame decal</title><path class="bike-photo-hit" d="M794 550 L970 442 L985 468 L810 578Z" fill="transparent" pointer-events="fill"/></g>`);
      hits.push(`<g data-bike-part="pegs" role="button" tabindex="0" aria-label="Customize pegs"><title>Pegs</title>${s.pegs!=='none'?'<path class="bike-photo-hit" d="M274 665 H350 V713 H274Z'+(s.pegs==='both'?' M1150 679 H1238 V737 H1150Z':'')+'" fill="transparent" pointer-events="fill"/>':''}</g>`);
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1536 1024" preserveAspectRatio="xMidYMid meet" class="jkcrew-bike-art" role="${interactive?'group':'img'}" aria-labelledby="${id('title')}" data-bike-photo="true" style="display:block;width:100%;height:auto"><title id="${id('title')}">Photographic custom BMX bike${interactive?'; select a part to customise it':''}</title><defs>${defs.join('')}</defs><use href="#${id('photograph')}" pointer-events="none"/>${layers.join('')}${hits.join('')}</svg>`;
  }
  return Object.freeze({render,prepare,isReady,assetUrls});
})();
globalThis.JKCrewBikeArt=JKCrewBikeArt;
