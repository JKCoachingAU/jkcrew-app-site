/* Registered photographic BMX layers. All parts share one camera and coordinate
 * system; finishes retain the original photograph's lighting and surface detail. */
const JKCrewBikeArt=(()=>{
  'use strict';
  const names={frame:'Frame',fork:'Fork',bars:'Handlebars',grips:'Grips',rims:'Wheel rims',hubs:'Wheel hubs',seat:'Seat',pedals:'Pedals',cranks:'Cranks',sprocket:'Sprocket',tyres:'Tyres',pegs:'Pegs',decal:'Frame decal',seatpost:'Seatpost',stem:'Stem',headset:'Headset',spokes:'Spokes',nipples:'Spoke nipples',brakes:'Brakes'};
  const assetUrls=Object.freeze({base:'./images/bike-garage/studio-white-v1.webp',options:'./images/bike-garage/studio-options-v1.webp',hardware:'./images/bike-garage/studio-hardware-v2.webp',metal:'./images/bike-garage/studio-metal-v2.webp',chrome:'./images/bike-garage/studio-chrome-v3.webp',chromeOptions:'./images/bike-garage/studio-chrome-options-v3.webp',jetfuel:'./images/bike-garage/studio-jetfuel-v3.webp',jetfuelOptions:'./images/bike-garage/studio-jetfuel-options-v3.webp',chromeTopStem:'./images/bike-garage/studio-chrome-top-stem-v3.webp',chromeFrontStem:'./images/bike-garage/studio-chrome-front-stem-v3.webp'});
  const images=new Map(),finishes=['gloss','matte','chrome','raw','jetfuel'];
  const choice=(v,values,fallback)=>values.includes(v)?v:fallback;
  const colour=v=>typeof v==='string'&&/^#[0-9a-f]{6}$/i.test(v)?v.toUpperCase():'#F1F4F8';
  const styles=c=>({bars:choice(c?.barStyle,['two-piece','four-piece'],'two-piece'),seat:choice(c?.seatStyle,['slim','padded'],'slim'),pegs:choice(c?.pegs,['none','rear','both','four'],'none'),tyres:choice(c?.tyreStyle,['white','black','tan-wall','white-wall'],'white'),decal:choice(c?.decal,['none','jkcrew','lightning'],'none'),brakes:choice(c?.brakeStyle,['none','rear','dual'],'none'),stem:choice(c?.stemStyle,['top-load','front-load'],'top-load'),pedal:choice(c?.pedalMaterial,['plastic','metal'],'plastic'),spokes:choice(c?.spokeStyle,['standard','rainbow'],'standard'),modern:Number(c?.version)>=2||['pedalMaterial','stemStyle','brakeStyle'].some(k=>Object.hasOwn(c||{},k))});
  const reflectionParts=['frame','fork','bars','rims','hubs','cranks','sprocket','seatpost','headset'];
  const needsChrome=c=>reflectionParts.some(k=>['chrome','raw'].includes(c?.finishes?.[k])&&!(k==='bars'&&styles(c).bars==='four-piece'));
  const needsJetfuel=c=>reflectionParts.some(k=>c?.finishes?.[k]==='jetfuel'&&!(k==='bars'&&styles(c).bars==='four-piece'));
  const needsChromeOptions=c=>styles(c).bars==='four-piece'&&['chrome','raw'].includes(c?.finishes?.bars);
  const needsJetfuelOptions=c=>styles(c).bars==='four-piece'&&c?.finishes?.bars==='jetfuel';
  const stemReflectionUrl=c=>{if(!['chrome','raw','jetfuel'].includes(c?.finishes?.stem))return '';const s=styles(c);return s.stem==='front-load'?assetUrls.chromeFrontStem:s.modern?assetUrls.chromeTopStem:c.finishes.stem==='jetfuel'?assetUrls.jetfuel:assetUrls.chrome;};
  const urls=c=>{const s=styles(c),list=[assetUrls.base];if(s.bars==='four-piece'||s.seat==='padded')list.push(assetUrls.options);if(s.pegs!=='none'||s.brakes!=='none'||s.modern&&(s.pedal==='plastic'||s.stem==='top-load'))list.push(assetUrls.hardware);if(s.pedal==='metal'||s.stem==='front-load')list.push(assetUrls.metal);if(needsChrome(c))list.push(assetUrls.chrome);if(needsChromeOptions(c))list.push(assetUrls.chromeOptions);if(needsJetfuel(c))list.push(assetUrls.jetfuel);if(needsJetfuelOptions(c))list.push(assetUrls.jetfuelOptions);if(stemReflectionUrl(c))list.push(stemReflectionUrl(c));return [...new Set(list)];};
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
    if(needsChrome(config))defs.push(`<g id="${id('chrome-photograph')}">${photo(assetUrls.chrome)}</g>`);
    if(needsChromeOptions(config))defs.push(`<g id="${id('chrome-options-photograph')}">${photo(assetUrls.chromeOptions)}</g>`);
    if(needsJetfuel(config))defs.push(`<g id="${id('jetfuel-photograph')}">${photo(assetUrls.jetfuel)}</g>`);
    if(needsJetfuelOptions(config))defs.push(`<g id="${id('jetfuel-options-photograph')}">${photo(assetUrls.jetfuelOptions)}</g>`);
    if(stemReflectionUrl(config))defs.push(`<g id="${id('stem-reflection-photograph')}">${photo(stemReflectionUrl(config))}</g>`);
    const materialFor=key=>id(key==='stem'?'stem-reflection-photograph':key==='bars'&&s.bars==='four-piece'?'chrome-options-photograph':reflectionParts.includes(key)?'chrome-photograph':'photograph');
    function maskFor(key,shape,detail=shape.detail){
      const [x,y,w,h]=shape.bounds;
      const exclusions=[shape.excludePath,key==='stem'?shapeFor('bars').path:'',key!=='pegs'?activePegs.map(m=>m.path).join(' '):''].filter(Boolean).join(' ');
      defs.push(`<mask id="${id(key+'-mask')}" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="${x-3}" y="${y-3}" width="${w+6}" height="${h+6}">${path(shape,'white')}${exclusions?`<path d="${exclusions}" fill="black"/>`:''}</mask>`);
      if(detail){
        defs.push(`<filter id="${id(key+'-detail-filter')}" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 -.2126 -.7152 -.0722 0 1"/><feComponentTransfer><feFuncA type="table" tableValues="${table(a=>a<.11?0:Math.min(1,(a-.11)/.32))}"/></feComponentTransfer></filter><mask id="${id(key+'-detail')}" maskUnits="userSpaceOnUse" x="${x}" y="${y}" width="${w}" height="${h}"><use href="#${id('photograph')}" filter="url(#${id(key+'-detail-filter')})"/></mask>`);
      }
    }
    // Only intentional paint transitions use image-space gradients. Metal
    // finishes are derived from registered photographic reflections below.
    function paintGradient(key,shape,value){
      const [x,y,w]=shape.bounds,stops=[];
      if(key==='frame'&&config.framePaint==='fade')stops.push([0,value],[1,colour(config.frameFadeColor)]);
      else if(key==='spokes'&&s.spokes==='rainbow')stops.push([0,'#7949BE'],[.18,'#266EBB'],[.35,'#24968D'],[.5,'#A79931'],[.63,'#C07732'],[.8,'#AD3F85'],[1,'#604398']);
      else return value;
      defs.push(`<linearGradient id="${id(key+'-surface')}" gradientUnits="userSpaceOnUse" x1="${x}" y1="${y}" x2="${x+w}" y2="${y}">${stops.map(([offset,color])=>`<stop offset="${offset}" stop-color="${color}"/>`).join('')}</linearGradient>`);
      return `url(#${id(key+'-surface')})`;
    }
    function coated(key,shape,value,finish='gloss',customFill=''){
      if(!shape||!shape.path)return '';
      const special=customFill||finish!=='gloss'||key==='frame'&&config.framePaint==='fade'||key==='spokes'&&s.spokes==='rainbow';
      if(value==='#F1F4F8'&&!special)return '';
      maskFor(key,shape);
      const [x,y,w,h]=shape.bounds,metal=['chrome','raw','jetfuel'].includes(finish),raw=finish==='raw';
      const soft=['seat','grips','tyres','sidewalls'].includes(key)||key==='pedals'&&s.pedal!=='metal';
      const matte=finish==='matte'||soft;
      const attributes=`filterUnits="userSpaceOnUse" x="${x-3}" y="${y-3}" width="${w+6}" height="${h+6}" color-interpolation-filters="sRGB"`;
      const transfer=fn=>`<feComponentTransfer>${['R','G','B'].map((c,i)=>`<feFunc${c} type="table" tableValues="${table(l=>fn(l,i))}"/>`).join('')}</feComponentTransfer>`;
      let surface='';
      if(metal){
        // The luminance of the photographed tube supplies both its reflected
        // environment and its curvature. No stripe can run across two tubes.
        const spectral=[[0,[8,10,16]],[.18,[27,25,43]],[.4,[72,51,114]],[.6,[48,119,122]],[.79,[141,102,145]],[.94,[216,224,235]],[1,[255,255,255]]];
        const iridescent=(l,ch)=>{let i=1;while(i<spectral.length-1&&l>spectral[i][0])i++;const[a,from]=spectral[i-1],[b,to]=spectral[i],t=(l-a)/(b-a);return (from[ch]+(to[ch]-from[ch])*t)/255;};
        const rgb=[1,3,5].map(p=>parseInt(value.slice(p,p+2),16)/255);
        const colouredPedal=key==='pedals'&&Math.max(...rgb)-Math.min(...rgb)>.08;
        const tone=(l,ch)=>{
          if(finish==='jetfuel')return iridescent(l,ch);
          if(raw)return .055+.77*Math.pow(l,1.25);
          const reflection=.012+.988*Math.pow(l,1.05);
          const pinHighlight=.7*Math.pow(Math.max(0,(l-.76)/.24),2);
          return colouredPedal?reflection*(.16+.84*rgb[ch])*(1-pinHighlight)+pinHighlight:reflection;
        };
        defs.push(`<filter id="${id(key+'-metal')}" ${attributes}><feColorMatrix type="saturate" values="0"/>${transfer(tone)}</filter>`);
        const trueIridescence=finish==='jetfuel'&&(reflectionParts.includes(key)||key==='stem'&&!s.modern&&s.stem==='top-load');
        const iridescentPhoto=key==='stem'?'stem-reflection-photograph':key==='bars'&&s.bars==='four-piece'?'jetfuel-options-photograph':'jetfuel-photograph';
        surface=trueIridescence?`<use href="#${id(iridescentPhoto)}"/>`:raw?`<use href="#${id('photograph')}" filter="url(#${id(key+'-metal')})"/><use href="#${materialFor(key)}" filter="url(#${id(key+'-metal')})" opacity=".2"/>`:`<use href="#${materialFor(key)}" filter="url(#${id(key+'-metal')})"/>`;
      }else{
        const fill=customFill||paintGradient(key,shape,value);
        const darkPaint=!matte&&[1,3,5].reduce((sum,p)=>sum+parseInt(value.slice(p,p+2),16),0)<210;
        // Soft material retains seams/tread but has broad, weak reflections.
        // Paint has deeper contour shadows and a compact clear-coat highlight.
        const light=l=>soft?.14+.86*Math.pow(Math.min(1,l/.965),1.9):matte?.1+.9*Math.pow(Math.min(1,l/.96),1.9):.045+.955*Math.pow(Math.min(1,l/.975),2.25);
        const highlightStart=soft?.91:darkPaint?.84:.925;
        const spec=l=>Math.pow(Math.max(0,(l-highlightStart)/(1-highlightStart)),2.8);
        defs.push(`<filter id="${id(key+'-lighting')}" ${attributes}><feColorMatrix type="saturate" values="0"/>${transfer(light)}</filter><filter id="${id(key+'-shine')}" ${attributes}><feColorMatrix type="saturate" values="0"/>${transfer(spec)}</filter>`);
        surface=`<g style="isolation:isolate"><rect x="${x-3}" y="${y-3}" width="${w+6}" height="${h+6}" fill="${fill}"/><use href="#${id('photograph')}" filter="url(#${id(key+'-lighting')})" style="mix-blend-mode:multiply"/><use href="#${id('photograph')}" filter="url(#${id(key+'-shine')})" style="mix-blend-mode:screen" opacity="${soft?.11:matte?.055:darkPaint?.3:.26}"/></g>`;
      }
      return `<g mask="url(#${id(key+'-mask')})" pointer-events="none">${shape.detail?`<g mask="url(#${id(key+'-detail')})">`:''}${surface}${shape.detail?'</g>':''}</g>`;
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
      const lettering=`<g transform="translate(887 518) rotate(-31.4)">${s.decal==='jkcrew'?`<text x="0" y="7" text-anchor="middle" fill="white" font-family="Arial,Helvetica,sans-serif" font-size="21" font-weight="800" letter-spacing="2">JKCREW</text>`:`<path d="M-9 -15 H14 L0 -2 H20 L-16 19 L-4 3 H-22 L-9 -9 H-26Z" fill="white"/>`}</g>`;
      defs.push(`<mask id="${id('decal-ink')}" maskUnits="userSpaceOnUse" x="790" y="440" width="200" height="145">${lettering}</mask><filter id="${id('decal-light')}" color-interpolation-filters="sRGB"><feColorMatrix type="saturate" values="0"/><feComponentTransfer>${['R','G','B'].map(c=>`<feFunc${c} type="table" tableValues="${table(l=>.18+.82*Math.pow(l,1.2))}"/>`).join('')}</feComponentTransfer></filter>`);
      layers.push(`<g mask="url(#${id('decal-ink')})" opacity=".88" pointer-events="none" style="isolation:isolate"><rect x="790" y="440" width="200" height="145" fill="${ink}"/><use href="#${id('photograph')}" filter="url(#${id('decal-light')})" style="mix-blend-mode:multiply"/></g>`);
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
