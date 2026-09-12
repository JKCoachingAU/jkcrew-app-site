/* A private, cosmetic bike workshop. Training scores and rider records are never written here. */
const JKCrewBikeGarage = (() => {
  const defaults = JKCrewBikeConfig.defaults;
  const normalize = JKCrewBikeConfig.normalize;
  const palette = [['Midnight','#252B39'],['Silver','#BCC7D6'],['Cloud','#F1F4F8'],['Lilac','#AD8AFF'],['Electric blue','#428CFF'],['Ice','#51D5E8'],['Mint','#7CE3B8'],['Acid','#D6F16A'],['Gold','#F2BC57'],['Orange','#F68B4D'],['Coral','#F26879'],['Pink','#E789D0']];
  const groups = {Frame:['frame'], 'Front end':['fork','bars','grips','stem','headset','brakes'], Wheels:['rims','hubs','spokes','nipples','tyres','pegs'], Details:['seat','seatpost','pedals','cranks','sprocket','drivetrain','decal']};
  const groupLabels = {Frame:'Paint','Front end':'Front end',Wheels:'Wheels',Details:'Details'};
  const groupIcons = {Frame:'◒','Front end':'⌁',Wheels:'◎',Details:'✦'};
  const labels = {frame:'Frame',fork:'Forks',bars:'Handlebars',grips:'Grips',rims:'Rims',hubs:'Hubs',tyres:'Tyres',seat:'Seat',seatpost:'Seat post',stem:'Stem',headset:'Headset',spokes:'Spokes',nipples:'Spoke nipples',pedals:'Pedals',cranks:'Cranks',sprocket:'Sprocket',pegs:'Pegs',brakes:'Brakes',drivetrain:'Drivetrain',decal:'Frame graphic'};
  const finishLabels = {gloss:'Gloss',matte:'Matte',chrome:'Chrome',raw:'Raw',jetfuel:'Jet fuel'};
  const catalogue = value => (globalThis.JKCrewBikeParts?.[value] || []).map(item => [item.id, item.name, item.tagline]);
  // Each style button carries its own config key so independent choices
  // such as bar shape and height remain unambiguous.
  const styleGroups = {
    bars: [['barStyle',[['two-piece','Two piece',''],['four-piece','Four piece','']],'CROSSBAR'], ['barModel', catalogue('barModels'), 'HEIGHT & WIDTH']],
    grips: [['gripStyle', catalogue('gripStyles'), 'FLANGE']],
    tyres: [['tyreStyle',[['white','All white',''],['black','All black',''],['tan-wall','Tan wall',''],['white-wall','White wall','']],'TYRE COLOUR'], ['tireTread', catalogue('tireTreads'), 'TREAD PATTERN']],
    hubs: [['hubStyle', catalogue('hubStyles'), 'HUB TYPE']],
    seat: [['seatStyle',[['slim','Slim',''],['padded','Padded','']],'STYLE']],
    pegs: [['pegs',[['none','No pegs',''],['rear','1 rear peg',''],['both','2 pegs',''],['four','4 pegs','']],'PEG SETUP']],
    decal: [['decal',[['jkcrew','JKCREW',''],['lightning','Lightning',''],['none','Clean frame','']],'GRAPHIC']],
    stem: [['stemStyle',[['top-load','Top load',''],['front-load','Front load','']],'STYLE']],
    pedals: [['pedalMaterial',[['plastic','Plastic platform',''],['metal','Metal platform','']],'MATERIAL']],
    drivetrain: [['driveSide',[['rhd','Right-hand drive (RHD)',''],['lhd','Left-hand drive (LHD)','']],'CHAIN & SPROCKET']],
    sprocket: [['sprocketStyle', catalogue('sprocketStyles'), 'SPROCKET FACE']],
    cranks: [['crankModel', catalogue('crankModels'), 'CRANK TYPE']],
    spokes: [['spokeStyle',[['standard','Solid colour',''],['rainbow','Titanium rainbow','']],'SPOKES']],
  };
  const copy = value => JSON.parse(JSON.stringify(value));
  const html = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const hex = value => /^#[0-9a-f]{6}$/i.test(String(value)) ? String(value).toUpperCase() : null;
  const normalFingerprint = value => {
    try { const parsed=JSON.parse(value); return JSON.stringify({name:parsed.name,configuration:normalize(parsed.configuration)}); } catch { return ''; }
  };
  let active = null;
  const memoryDrafts = new Map();
  function destroy() { if (active) { active.dispose(); active = null; } }
  function teaserHtml() {
    return `<button type="button" class="bike-garage-entry" data-open-bike-garage><span class="bike-entry-icon" aria-hidden="true">✳</span><span><small>JKCREW GARAGE</small><strong>Build your dream bike</strong><span>Pick your parts. Make it yours.</span></span><b aria-hidden="true">↗</b></button>`;
  }
  function mount({ root, client, userId, isCurrent, onBack }) {
    destroy();
    const controller = new AbortController();
    const key = `jkcrew-bike-draft-v1:${userId}`;
    let alive = true, config = copy(defaults), name = 'My dream bike', slot = null, revision = 0, savedFingerprint = '', pendingSave = null, history = [], future = [], group = 'Frame', part = 'frame';
    let builds = [], loaded = false, loading = false, busy = false, loadSequence = 0, status = '', statusKind = '', draftAvailable = true, fullscreen = null;
    let controlsOpen = false, optionsScroll = 0;
    let selectedView = 'photo';
    let bike3D = null, loading3D = false, failed3D = false, view3DRequest = 0, timer3D = 0;
    let photoSequence = 0, photoReady = false, seatCategory = 'All', seatPage = 0, layoutFrame = 0;
    const selectedParts = Object.fromEntries(Object.entries(groups).map(([label, parts]) => [label, parts[0]]));
    const valid = () => alive && root.isConnected && isCurrent();
    const snapshot = () => ({ name, configuration: copy(config) });
    const fingerprint = (value = snapshot()) => JSON.stringify(value);
    const dirty = () => fingerprint() !== savedFingerprint;
    try {
      let stored = null;
      try { stored = JSON.parse(localStorage.getItem(key) || 'null'); } catch { draftAvailable = false; }
      const draft = memoryDrafts.get(userId) || stored;
      if (draft?.configuration) {
        config = normalize(draft.configuration); name = String(draft.name || 'My dream bike').slice(0,40);
        slot = [1,2,3].includes(draft.slot) ? draft.slot : null;
        revision = Number.isInteger(draft.revision) && draft.revision >= 0 ? draft.revision : 0;
        savedFingerprint = typeof draft.savedFingerprint === 'string' ? normalFingerprint(draft.savedFingerprint) : '';
        if ([1,2,3].includes(draft.pendingSave?.slot) && Number.isInteger(draft.pendingSave.expectedRevision) && draft.pendingSave.expectedRevision >= 0) {
          pendingSave = {slot:draft.pendingSave.slot,expectedRevision:draft.pendingSave.expectedRevision,name:String(draft.pendingSave.name||'').slice(0,40),configuration:normalize(draft.pendingSave.configuration)};
        }
      }
    } catch { draftAvailable = false; }
    function persist() {
      const draft = {...snapshot(),slot,revision,savedFingerprint,pendingSave:pendingSave?copy(pendingSave):null};
      memoryDrafts.set(userId,draft);
      try { localStorage.setItem(key, JSON.stringify(draft)); }
      catch { draftAvailable = false; }
    }
    async function rpc(method, args) {
      let timer;
      try {
        return await Promise.race([client.rpc(method,args),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Connection timed out.')),15000);})]);
      } finally { clearTimeout(timer); }
    }
    function message(text, kind = '') {
      status=text;statusKind=kind;updateStatus();
      if(kind==='error'&&valid()&&root.querySelector('.bike-collection-dialog').open)root.querySelector('.bike-collection-body').scrollTop=0;
    }
    function updateStatus() {
      if (!valid()) return;
      const node = root.querySelector('[data-bike-status]');
      node.textContent = status || (dirty() ? (draftAvailable ? 'Draft kept on this device · save to your garage' : 'Draft kept for this visit · save to your garage') : 'Saved to your garage');
      node.className = `bike-save-status ${statusKind}`;
      const collectionStatus=root.querySelector('[data-bike-collection-status]');
      collectionStatus.textContent=status;
      collectionStatus.className=`bike-collection-status ${statusKind}`;
      collectionStatus.hidden=!status;
      root.querySelector('[data-bike-save]').disabled = busy || !loaded;
      root.querySelector('[data-bike-save]').textContent = busy ? 'Saving…' : slot ? 'Save changes' : 'Save to garage';
      root.querySelector('[data-bike-save-copy]').hidden = !slot;
      root.querySelector('[data-bike-save-copy]').disabled = busy || !loaded || builds.length >= 3;
      root.querySelector('[data-bike-undo]').disabled = busy || !history.length;
      root.querySelector('[data-bike-redo]').disabled = busy || !future.length;
      root.querySelector('[data-bike-name]').disabled = busy;
      root.querySelector('[data-bike-shuffle]').disabled = busy;
      root.querySelector('[data-bike-new]').disabled = busy;
      root.querySelector('[data-bike-preview]').disabled = busy || !photoReady;
      root.querySelectorAll('[data-bike-colour],[data-bike-style],[data-bike-finish],[data-bike-option],[data-bike-seat-design],[data-bike-brake],input[type="color"]').forEach(button => button.disabled = busy || !photoReady);
      const viewToggle=root.querySelector('[data-bike-view-toggle]');
      viewToggle.textContent=selectedView==='3d'?'Photo view':'360° view';
      viewToggle.setAttribute('aria-label',selectedView==='3d'?'Switch to photographic view':'Switch to 360° view');
      viewToggle.disabled=busy;
      root.querySelectorAll('[data-bike-camera],[data-bike-autorotate]').forEach(button => button.disabled = busy || !bike3D);
      root.querySelectorAll('[data-bike-load],[data-bike-remove]').forEach(button => button.disabled = busy || !loaded);
      root.querySelectorAll('[data-bike-reload],[data-bike-retry]').forEach(button => button.disabled = busy || loading);
      root.querySelector('[data-bike-retry]').hidden = loaded || loading;
    }
    function paint() {
      if(!valid())return;
      if(selectedView==='photo'||failed3D){paintPhoto();return;}
      if(!globalThis.JKCrewBike3D){fallback3D();return;}
      const artwork=root.querySelector('[data-bike-art]'),loading=root.querySelector('[data-bike-photo-status]');
      root.querySelector('[data-bike-design-title]').textContent=name.trim()||'My dream bike';
      root.querySelector('[data-bike-frame-colour]').style.backgroundColor=config.colors.frame;
      root.querySelector('[data-bike-part-hint]').textContent='Drag to spin · Pinch to zoom';
      if(bike3D){try{bike3D.update(copy(config))?.catch(()=>{if(valid())fallback3D();});}catch{fallback3D();return;}photoReady=true;updateStatus();return;}
      if(loading3D){updateStatus();return;}
      loading3D=true;photoReady=false;loading.hidden=false;
      const request=++view3DRequest;
      timer3D=setTimeout(()=>{if(valid()&&request===view3DRequest)fallback3D();},12000);
      artwork.setAttribute('aria-busy','true');loading.innerHTML='<span>Preparing your 360° bike…</span>';updateStatus();
      JKCrewBike3D.mount({element:artwork,configuration:copy(config),onSelect:id=>{if(valid())select(id);},onAutoRotateChange:on=>{if(valid()){const box=root.querySelector('[data-bike-autorotate]');if(box)box.checked=on;}},isCurrent:()=>valid()&&request===view3DRequest&&!failed3D,onError:()=>{if(request===view3DRequest)fallback3D();}}).then(handle=>{
        if(!valid()||failed3D||request!==view3DRequest){handle?.dispose();return;}
        clearTimeout(timer3D);
        bike3D=handle;loading3D=false;bike3D.update(copy(config));photoReady=true;
        artwork.dataset.view='3d';artwork.setAttribute('aria-busy','false');loading.hidden=true;
        root.querySelector('[data-bike-camera-menu]').hidden=false;updateStatus();
      }).catch(()=>{if(valid()&&request===view3DRequest)fallback3D();});
    }
    function switchView(view) {
      if(!valid()||busy)return;
      // Invalidate both async loaders before replacing their shared surface.
      ++view3DRequest;++photoSequence;clearTimeout(timer3D);
      bike3D?.dispose();bike3D=null;loading3D=false;failed3D=false;
      selectedView=view;photoReady=false;
      const artwork=root.querySelector('[data-bike-art]');
      artwork.innerHTML='';artwork.dataset.view=view;
      const cameraMenu=root.querySelector('[data-bike-camera-menu]');
      cameraMenu.hidden=true;cameraMenu.open=false;
      root.querySelector('[data-bike-autorotate]').checked=false;
      root.querySelector('[data-bike-3d-retry]').hidden=true;
      paint();
    }
    function fallback3D() {
      if(!valid()||failed3D)return;
      failed3D=true;selectedView='photo';loading3D=false;++view3DRequest;clearTimeout(timer3D);bike3D?.dispose();bike3D=null;
      root.querySelector('[data-bike-art]').dataset.view='photo';
      root.querySelector('[data-bike-camera-menu]').hidden=true;root.querySelector('[data-bike-camera-menu]').open=false;
      root.querySelector('[data-bike-3d-retry]').hidden=false;
      paintPhoto();
    }
    function paintPhoto() {
      if (!valid()) return;
      const sequence = ++photoSequence;
      photoReady = JKCrewBikeArt.isReady(config);
      const artwork = root.querySelector('[data-bike-art]');
      artwork.dataset.view='photo';
      const photoStatus = root.querySelector('[data-bike-photo-status]');
      artwork.setAttribute('aria-busy', String(!photoReady));
      photoStatus.hidden = photoReady;
      photoStatus.innerHTML = '<span>Loading your bike…</span>';
      const focusedPart = root.querySelector('[data-bike-art]')?.contains(document.activeElement) ? document.activeElement?.dataset.bikePart : '';
      root.querySelector('[data-bike-art]').innerHTML = JKCrewBikeArt.render(config,{idPrefix:'garage-main',selectedPart:part,interactive:true});
      if (focusedPart) root.querySelector(`[data-bike-art] [data-bike-part="${CSS.escape(focusedPart)}"]`)?.focus({preventScroll:true});
      root.querySelector('[data-bike-design-title]').textContent = name.trim() || 'My dream bike';
      root.querySelector('[data-bike-frame-colour]').style.backgroundColor = config.colors.frame;
      root.querySelector('[data-bike-part-hint]').textContent = failed3D?'Photo view · 360° unavailable':`Editing ${labels[part].toLowerCase()}`;
      updateStatus();
      if (!photoReady) JKCrewBikeArt.prepare(config).then(() => {
        if (!valid() || sequence !== photoSequence) return;
        photoReady = true; artwork.setAttribute('aria-busy', 'false'); photoStatus.hidden = true; updateStatus();
      }).catch(() => {
        if (!valid() || sequence !== photoSequence) return;
        artwork.setAttribute('aria-busy', 'false');
        photoStatus.innerHTML = '<span>The bike photo could not load.</span><button type="button" data-bike-photo-retry>Retry photo</button>';
        updateStatus();
      });
    }
    function optionButtons(key, options, title) {
      return `<div class="bike-style-options"><span class="bike-eyebrow">${title}</span><div>${options.map(([id,label])=>`<button type="button" data-bike-option="${key}" data-bike-value="${id}" aria-pressed="${config[key]===id}">${label}</button>`).join('')}</div></div>`;
    }
    function seatGallery() {
      const designs=JKCrewBikeSeats.designs.filter(design=>seatCategory==='All'||design.category===seatCategory);
      const pages=Math.ceil(designs.length/8);seatPage=Math.min(seatPage,pages-1);
      const chosen=JKCrewBikeSeats.designs.find(design=>design.id===config.seatDesign);
      return `<div class="bike-seat-library"><div class="bike-library-heading"><span class="bike-eyebrow">50 SEAT DESIGNS</span><button type="button" data-bike-seat-design="solid" aria-pressed="${config.seatDesign==='solid'}">Solid colour</button></div>
        <label class="bike-seat-filter"><span>Browse designs</span><select data-bike-seat-category aria-label="Seat design collection">${['All',...new Set(JKCrewBikeSeats.designs.map(design=>design.category))].map(category=>`<option ${category===seatCategory?'selected':''}>${html(category)}</option>`).join('')}</select></label>
        <div class="bike-seat-grid">${designs.slice(seatPage*8,seatPage*8+8).map(design=>`<button type="button" class="bike-seat-tile" data-bike-seat-design="${design.id}" aria-pressed="${config.seatDesign===design.id}" aria-label="${html(design.name)} seat design"><span class="bike-seat-thumb" aria-hidden="true">${JKCrewBikeSeats.thumbnail(design.id)}</span><span>${html(design.name)}</span>${config.seatDesign===design.id?'<b aria-hidden="true">✓</b>':''}</button>`).join('')}</div>
        <div class="bike-seat-pagination"><button type="button" data-bike-seat-page="-1" aria-label="Previous seat designs" ${seatPage===0?'disabled':''}>←</button><span>${seatPage+1} / ${pages} · ${designs.length} designs</span><button type="button" data-bike-seat-page="1" aria-label="Next seat designs" ${seatPage===pages-1?'disabled':''}>→</button></div>
        ${chosen?`<p class="bike-design-note"><strong>${html(chosen.name)}</strong> · Original JKCREW look</p>`:''}</div>`;
    }
    function controls() {
      if (!valid()) return;
      const scrollArea=root.querySelector('[data-bike-controls]'),scrollTop=root.querySelector('[data-bike-sheet]').hidden?optionsScroll:scrollArea.scrollTop;
      const focused=root.querySelector('.bike-controls')?.contains(document.activeElement)?document.activeElement:null;
      const focusAttribute=['data-bike-group','data-bike-select','data-bike-colour','data-bike-style','data-bike-custom-colour','data-bike-finish','data-bike-option','data-bike-fade-colour','data-bike-seat-design','data-bike-seat-category','data-bike-brake'].find(attribute=>focused?.hasAttribute(attribute));
      const focusValue=focusAttribute?focused.getAttribute(focusAttribute):'';
      const focusKey=focusAttribute==='data-bike-style'?focused.dataset.bikeKey:'';
      const optionValue=focused?.dataset.bikeValue;
      const selected=config.colors[part],styleRows=styleGroups[part]||[],finish=config.finishes[part];
      const usesColour=selected&&!['chrome','raw','jetfuel'].includes(finish)&&!(part==='seat'&&config.seatDesign!=='solid')&&!(part==='spokes'&&config.spokeStyle==='rainbow')&&!(part==='pegs'&&config.pegs==='none');
      const colourName=palette.find(([,value])=>value===selected)?.[0]||'Custom colour';
      const partButtons=groups[group].map(id=>`<button type="button" data-bike-select="${id}" aria-pressed="${part===id}">${labels[id]}</button>`).join('');
      root.querySelector('[data-bike-navigation]').innerHTML=`
        <div class="bike-part-tabs" aria-label="Bike sections">${Object.keys(groups).map(label=>`<button type="button" data-bike-group="${label}" aria-pressed="${controlsOpen&&group===label}" aria-expanded="${controlsOpen&&group===label}" aria-controls="bike-options-sheet"><i aria-hidden="true">${groupIcons[label]}</i>${groupLabels[label]}</button>`).join('')}</div>`;
      root.querySelector('[data-bike-part-navigation]').innerHTML=`${groups[group].length>1?`<details class="bike-part-menu"><summary aria-label="Choose a part, currently ${labels[part]}"><span><small>EDITING</small><strong>${labels[part]}</strong></span><span class="bike-part-menu-hint">Change part <b aria-hidden="true">⌄</b></span></summary><div class="bike-part-picker" aria-label="Choose a part">${partButtons}</div></details>`:`<div class="bike-part-current"><span><small>EDITING</small><strong>${labels[part]}</strong></span><span class="bike-part-menu-hint">Tap a part on your bike</span></div>`}`;
      scrollArea.innerHTML=`
        ${styleRows.map(([key,options,rowLabel])=>{
          const active=options.find(([id])=>config[key]===id);
          return `<div class="bike-style-options bike-component-options"><span class="bike-eyebrow">${rowLabel}</span><div>${options.map(([id,label])=>`<button type="button" data-bike-style="${id}" data-bike-key="${key}" aria-pressed="${config[key]===id}">${label}</button>`).join('')}</div>${active?.[2]?`<p class="bike-control-tip">${html(active[2])}</p>`:''}</div>`;
        }).join('')}
        ${part==='brakes'?`<fieldset class="bike-brake-setup"><legend class="bike-eyebrow">BRAKE SETUP</legend>${[['front','Front brake'],['rear','Rear brake']].map(([side,label])=>`<label><input type="checkbox" data-bike-brake="${side}" ${config.brakeStyle===side||config.brakeStyle==='dual'?'checked':''}><span>${label}</span><b aria-hidden="true">✓</b></label>`).join('')}<p class="bike-control-tip">Choose either brake, both, or leave both off for brakeless.</p></fieldset>`:''}
        ${usesColour?`<div class="bike-colour-section"><div class="bike-colour-heading"><span class="bike-eyebrow">${part==='frame'&&config.framePaint==='fade'?'FIRST COLOUR':'COLOUR'}</span><span class="bike-colour-name"><i style="background:${selected}"></i>${colourName}</span></div><div class="bike-palette" aria-label="${labels[part]} colour">${palette.map(([label,value])=>`<button type="button" class="bike-swatch" data-bike-colour="${value}" style="--swatch:${value}" aria-label="${label} ${labels[part].toLowerCase()}" aria-pressed="${selected===value}"><span aria-hidden="true">${selected===value?'✓':''}</span></button>`).join('')}</div><label class="bike-custom-colour"><span>Mix your own colour</span><input type="color" data-bike-custom-colour value="${selected}" aria-label="Custom ${labels[part].toLowerCase()} colour"></label></div>`:''}
        ${finish&&!(part==='pegs'&&config.pegs==='none')?`<div class="bike-finishes"><span class="bike-eyebrow">FINISH</span><div>${JKCrewBikeConfig.finishOptions.map(id=>`<button type="button" data-bike-finish="${id}" aria-pressed="${finish===id}"><i class="bike-finish-sample is-${id}" aria-hidden="true"></i><span>${finishLabels[id]}</span></button>`).join('')}</div></div>`:''}
        ${part==='frame'?optionButtons('framePaint',[['solid','One colour'],['fade','Two-colour fade']],'PAINT STYLE'):''}
        ${part==='frame'&&config.framePaint==='fade'?`<label class="bike-fade-colour"><span><strong>Fade into</strong><small>Second frame colour</small></span><span class="bike-fade-preview" style="background:linear-gradient(100deg,${config.colors.frame},${config.frameFadeColor})"></span><input type="color" data-bike-fade-colour value="${config.frameFadeColor}" aria-label="Second frame fade colour"></label>`:''}
        ${part==='seat'?seatGallery():''}
        ${part==='drivetrain'?'<p class="bike-control-tip">The chain and sprocket sit on this side of the bike.</p>':''}
        ${part==='pegs'&&config.pegs==='both'?'<p class="bike-control-tip">Front and rear pegs on the side opposite your chain.</p>':''}
        ${part==='pegs'&&config.pegs==='four'?'<p class="bike-control-tip">Front and rear pegs on both sides.</p>':''}
        ${['chrome','raw','jetfuel'].includes(finish)?`<p class="bike-control-tip">${finish==='jetfuel'?'Iridescent blue, purple and gold metal.':finish==='raw'?'Exposed steel with a brushed finish.':'Bright polished metal.'}</p>`:''}
        <p class="bike-control-tip bike-tap-tip">Tap any part on the bike to customise it.</p>`;
      root.querySelector('[data-bike-sheet]').hidden=!controlsOpen;
      root.querySelector('[data-bike-workshop]').dataset.controlsOpen=String(controlsOpen);
      if(focusAttribute)root.querySelector(`[${focusAttribute}="${CSS.escape(focusValue)}"]${focusKey?`[data-bike-key="${CSS.escape(focusKey)}"]`:''}${optionValue?`[data-bike-value="${CSS.escape(optionValue)}"]`:''}`)?.focus({preventScroll:true});
      scrollArea.scrollTop=scrollTop;optionsScroll=scrollTop;
      updateStatus();
    }
    function change(fn) {
      if (busy || !valid()) return;
      history.push(snapshot()); if (history.length > 60) history.shift(); future = [];
      fn(); status=''; persist(); paint(); controls();
    }
    function closeControls() {
      optionsScroll=root.querySelector('[data-bike-controls]').scrollTop;controlsOpen=false;controls();
      root.querySelector(`[data-bike-group="${CSS.escape(group)}"]`)?.focus({preventScroll:true});
    }
    function select(id) {
      if (!labels[id]) return;
      controlsOpen=true;
      const differentPart=part!==id;
      const fromMenu=Boolean(document.activeElement?.closest('.bike-part-menu'));
      part=id; group=Object.keys(groups).find(key=>groups[key].includes(id));selectedParts[group]=id;paint();controls();
      if(differentPart){optionsScroll=0;root.querySelector('[data-bike-controls]').scrollTop=0;}
      if(fromMenu)root.querySelector('.bike-part-menu summary')?.focus({preventScroll:true});
    }
    function garage() {
      if (!valid()) return;
      root.querySelector('[data-bike-count]').textContent = `${builds.length} / 3`;
      root.querySelector('[data-bike-collection-count]').textContent = String(builds.length);
      root.querySelector('[data-bike-saved-list]').innerHTML = builds.length ? builds.map(build => `<article class="bike-saved-card ${slot===build.slot?'is-current':''}"><div class="bike-saved-art">${JKCrewBikeArt.render(normalize(build.configuration),{idPrefix:`garage-slot-${build.slot}`})}</div><div class="bike-saved-title"><span>DESIGN 0${build.slot}</span><h3>${html(build.name)}</h3></div><div class="bike-saved-actions"><button type="button" data-bike-load="${build.slot}">${slot===build.slot?'Open design':'Edit design'}</button><button type="button" data-bike-remove="${build.slot}" aria-label="Remove ${html(build.name)}">Remove</button></div></article>`).join('') : `<div class="bike-garage-empty"><strong>Your first build belongs here.</strong><p>Save a design to keep it on your JKCREW account.</p></div>`;
      root.querySelector('[data-bike-reload]').hidden = loaded;
      updateStatus();
    }
    async function load() {
      if (busy || loading || !valid()) return;
      const sequence=++loadSequence;
      loading=true;loaded=false;message('Loading your saved bikes…');
      try {
        const {data,error}=await rpc('get_bike_garage'); if(error)throw error;
        if(!valid()||sequence!==loadSequence)return;
        builds=Array.isArray(data?.builds)?data.builds.filter(row=>[1,2,3].includes(row.slot)):[]; loaded=true;
        if (pendingSave) {
          const expected = fingerprint({name:pendingSave.name,configuration:pendingSave.configuration});
          const recovered = builds.find(row => row.slot===pendingSave.slot && row.revision>pendingSave.expectedRevision && fingerprint({name:row.name,configuration:normalize(row.configuration)})===expected);
          if (recovered) {
            slot=recovered.slot;revision=recovered.revision;savedFingerprint=expected;pendingSave=null;
            if(fingerprint({name:name.trim(),configuration:config})===expected){name=recovered.name;root.querySelector('[data-bike-name]').value=name;}
            persist();paint();
          }
        }
        if(slot && !builds.some(row=>row.slot===slot) && !dirty()) { slot=null;revision=0;savedFingerprint='';persist(); }
        status='';statusKind='';garage();
      } catch(error) {
        if(!valid()||sequence!==loadSequence)return;
        loaded=false;message('Your garage could not load. Keep designing, then retry to save.','error');garage();
      } finally { if(valid()&&sequence===loadSequence){loading=false;updateStatus();} }
    }
    async function save(asNew=false) {
      if(busy||!loaded||!valid())return;
      if(!name.trim()) {message('Give your bike a name first.','error');root.querySelector('[data-bike-name]').focus();return;}
      const target=pendingSave&&!asNew?pendingSave.slot:(!slot||asNew)?[1,2,3].find(id=>!builds.some(build=>build.slot===id)):slot;
      if(!target){message('Your three garage spaces are full. Open a saved design to edit it, or remove one.','error');openCollection();return;}
      const sent={name:name.trim(),configuration:copy(config)}, expected=pendingSave&&!asNew?pendingSave.expectedRevision:target===slot&&!asNew?revision:0;
      pendingSave={slot:target,expectedRevision:expected,...copy(sent)};persist();
      busy=true;++loadSequence;message('Saving your bike…');
      try {
        const {data,error}=await rpc('save_bike_build',{p_slot:target,p_name:sent.name,p_configuration:sent.configuration,p_expected_revision:expected});if(error)throw error;
        if(!valid())return;
        if(!data||data.slot!==target||!Number.isInteger(data.revision))throw new Error('The save could not be verified. Please retry.');
        slot=target;revision=data.revision;name=sent.name;config=normalize(data.configuration||sent.configuration);savedFingerprint=fingerprint();pendingSave=null;persist();
        builds=[...builds.filter(row=>row.slot!==slot),data].sort((a,b)=>a.slot-b.slot);
        root.querySelector('[data-bike-name]').value=name;garage();message('Saved to your garage ✓');
      } catch(error) {
        if(!valid())return;
        message(/changed|conflict|revision|stale/i.test(error.message||'')?'This garage space changed on another device. Refresh, then reopen its latest design or save this as a new design.':`The save wasn't confirmed. Your design is still here — refresh your garage before trying again.`,'error');
        loaded=false;root.querySelector('[data-bike-reload]').hidden=false;
      } finally {busy=false;if(valid())updateStatus();}
    }
    async function remove(id) {
      const row=builds.find(build=>build.slot===id);
      if(!row||busy||!loaded||!window.confirm(`Remove “${row.name}” from your garage?`))return;
      busy=true;++loadSequence;updateStatus();
      try {
        const {data,error}=await rpc('delete_bike_build',{p_slot:id,p_expected_revision:row.revision});if(error)throw error;
        if(!valid())return;if(data?.deleted!==true)throw new Error('Removal was not confirmed');
        builds=builds.filter(build=>build.slot!==id);
        if(slot===id){slot=null;revision=0;savedFingerprint='';}
        if(pendingSave?.slot===id)pendingSave=null;
        persist();
        garage();message('Removed from your garage.');
      }catch(error){if(valid()){loaded=false;message('Could not remove that design. Refresh your garage and try again.','error');root.querySelector('[data-bike-reload]').hidden=false;}}
      finally{busy=false;if(valid())updateStatus();}
    }
    function openBuild(id) {
      const row=builds.find(build=>build.slot===id);if(!row||busy)return;
      if(dirty() && !window.confirm('Open this saved bike and replace your current unsaved design?'))return;
      config=normalize(row.configuration);name=String(row.name);slot=row.slot;revision=row.revision;savedFingerprint=fingerprint();pendingSave=null;history=[];future=[];status='';
      root.querySelector('[data-bike-name]').value=name;persist();paint();controls();garage();
      closeCollection();root.querySelector('[data-bike-controls]').scrollTop=0;
    }
    function openCollection() {
      if(!valid())return;
      const dialog=root.querySelector('.bike-collection-dialog');
      if(dialog.open)return;
      root.querySelector('[data-bike-garage]').open=true;
      dialog.showModal();
    }
    function closeCollection() {
      const dialog=root.querySelector('.bike-collection-dialog');
      if(dialog.open)dialog.close();
    }
    function preview() {
      if(fullscreen||busy||!photoReady||!valid())return;
      if(!globalThis.JKCrewBikePreview?.mount){message('The bike preview is not ready. Refresh the app and try again.','error');return;}
      let handle;
      handle=JKCrewBikePreview.mount({
        configuration:copy(config),name:name.trim()||'My dream bike',isCurrent:valid,
        onBackgroundChange(background){
          if(!valid()||busy||typeof background!=='string')return null;
          const normalized=normalize({...config,background});
          if(normalized.background!==background)return null;
          if(config.background!==background)change(()=>config.background=background);
          return copy(config);
        },
        onClose(){if(fullscreen===handle)fullscreen=null;}
      });
      fullscreen=handle;
    }
    root.innerHTML=`<section class="bike-garage" data-bike-workshop data-controls-open="false">
      <header class="bike-garage-header"><div class="bike-header-title"><button type="button" class="bike-back" data-bike-back aria-label="Back to JKCREW">←</button><div><h1>Bike Garage</h1></div></div><button type="button" class="bike-collection-open" data-bike-collection-open>My garage <span data-bike-collection-count>0</span></button></header>
      <div class="bike-workshop-grid"><div class="bike-stage"><div class="bike-stage-top"><span><i data-bike-frame-colour></i> CUSTOM BUILD</span><button type="button" data-bike-new>+ Blank bike</button></div><div class="bike-stage-art" data-bike-art aria-busy="true"></div><div class="bike-photo-status" data-bike-photo-status role="status"><span>Loading your bike…</span></div><div class="bike-stage-bottom"><div><h2 data-bike-design-title></h2><span data-bike-part-hint></span></div><div class="bike-view-actions"><button type="button" data-bike-view-toggle aria-label="Switch to 360° view">360° view</button><button type="button" data-bike-preview aria-label="Open photo studio" title="Backgrounds & save photo"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M8 5l1-2h6l1 2h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/><circle cx="12" cy="12" r="4"/></svg></button></div></div><div class="bike-edit-tools"><button type="button" data-bike-undo aria-label="Undo last change">↶ <span>Undo</span></button><button type="button" data-bike-redo aria-label="Redo change">↷ <span>Redo</span></button><button type="button" data-bike-shuffle aria-label="Surprise me" title="Surprise me">✦</button><details class="bike-camera-menu" data-bike-camera-menu hidden><summary aria-label="Camera views" title="Camera views">⌖</summary><div class="bike-camera-picker" aria-label="Camera views">${(globalThis.JKCrewBike3D?.cameraPresets||[]).map(preset=>`<button type="button" data-bike-camera="${preset.id}">${html(preset.label)}</button>`).join('')}<label class="bike-camera-autorotate"><input type="checkbox" data-bike-autorotate><span>Showroom auto-rotate</span></label></div></details><button type="button" data-bike-3d-retry hidden aria-label="Retry 360° view" title="Retry 360° view">↻</button></div></div>
      <section class="bike-controls" aria-label="Customise your bike"><div class="bike-options-sheet" id="bike-options-sheet" data-bike-sheet hidden><div class="bike-sheet-heading"><div data-bike-part-navigation></div><button type="button" data-bike-sheet-close aria-label="Hide controls">⌄</button></div><div class="bike-control-scroll" data-bike-controls tabindex="0" aria-label="Part options"></div></div><div class="bike-control-navigation" data-bike-navigation></div></section></div>
      <div class="bike-save-bar"><label class="bike-name-field"><span>NAME YOUR BUILD</span><input type="text" maxlength="40" data-bike-name value="${html(name)}" autocomplete="off"></label><div class="bike-save-actions"><button type="button" class="bike-save-copy" data-bike-retry hidden aria-label="Refresh garage" title="Refresh garage">↻</button><button type="button" class="bike-save-copy" data-bike-save-copy hidden aria-label="Save as new" title="Save as new">⧉</button><button type="button" class="bike-primary" data-bike-save>Save to garage</button></div><p class="bike-save-status" data-bike-status role="status" aria-live="polite"></p></div>
      <dialog class="bike-collection-dialog" aria-label="My bike garage"><header><div><span class="bike-eyebrow">YOUR COLLECTION</span><h2>Saved bikes</h2></div><button type="button" data-bike-collection-close aria-label="Close my garage">×</button></header><div class="bike-collection-body"><p class="bike-collection-status" data-bike-collection-status role="status" aria-live="polite" hidden></p>
      <details class="bike-garage-shelf" data-bike-garage><summary><span><span class="bike-eyebrow">YOUR COLLECTION</span><strong>My garage <small data-bike-count>0 / 3</small></strong></span><b aria-hidden="true">+</b></summary><div class="bike-garage-toolbar"><p>Three spaces. Endless ideas.</p><button type="button" data-bike-reload>Retry loading garage</button></div><div class="bike-saved-grid" data-bike-saved-list></div></details>
      <p class="bike-garage-footnote">Dream builds, made by you. Saved designs are private to your account.</p>
      </div></dialog>
    </section>`;
    root.addEventListener('click',event=>{
      const button=event.target.closest('button,[data-bike-part]');if(!button||!root.contains(button)||button.disabled||!valid())return;
      if(button.hasAttribute('data-bike-back'))return onBack();
      if(button.hasAttribute('data-bike-collection-open'))return openCollection();
      if(button.hasAttribute('data-bike-collection-close'))return closeCollection();
      if(button.hasAttribute('data-bike-photo-retry'))return paint();
      if(button.dataset.bikeCamera){bike3D?.setCameraPreset(button.dataset.bikeCamera);root.querySelector('[data-bike-camera-menu]').open=false;return;}
      if(button.hasAttribute('data-bike-view-toggle'))return switchView(selectedView==='3d'?'photo':'3d');
      if(button.hasAttribute('data-bike-3d-retry'))return switchView('3d');
      if(button.dataset.bikePart)return select(button.dataset.bikePart);
      if(button.hasAttribute('data-bike-sheet-close'))return closeControls();
      if(button.dataset.bikeGroup){if(controlsOpen&&group===button.dataset.bikeGroup)return closeControls();group=button.dataset.bikeGroup;return select(selectedParts[group]||groups[group][0]);}
      if(button.dataset.bikeSelect)return select(button.dataset.bikeSelect);
      if(button.dataset.bikeColour)return change(()=>config.colors[part]=button.dataset.bikeColour);
      if(button.dataset.bikeStyle)return change(()=>config[button.dataset.bikeKey]=button.dataset.bikeStyle);
      if(button.dataset.bikeFinish)return change(()=>{config.finishes[part]=button.dataset.bikeFinish;if(part==='frame'&&['chrome','raw','jetfuel'].includes(button.dataset.bikeFinish))config.framePaint='solid';});
      if(button.dataset.bikeOption==='framePaint')return change(()=>{config.framePaint=button.dataset.bikeValue;if(config.framePaint==='fade'&&['chrome','raw','jetfuel'].includes(config.finishes.frame))config.finishes.frame='gloss';});
      if(button.dataset.bikeSeatDesign)return change(()=>config.seatDesign=button.dataset.bikeSeatDesign);
      if(button.hasAttribute('data-bike-seat-page')){seatPage+=Number(button.dataset.bikeSeatPage);return controls();}
      if(button.hasAttribute('data-bike-undo')&&history.length){future.push(snapshot());const prior=history.pop();config=prior.configuration;name=prior.name;root.querySelector('[data-bike-name]').value=name;status='';persist();paint();return controls();}
      if(button.hasAttribute('data-bike-redo')&&future.length){history.push(snapshot());const next=future.pop();config=next.configuration;name=next.name;root.querySelector('[data-bike-name]').value=name;status='';persist();paint();return controls();}
      if(button.hasAttribute('data-bike-shuffle'))return change(()=>{
        const pick=list=>list[Math.floor(Math.random()*list.length)];
        const colour=pick(palette)[1],contrast=pick(palette)[1];
        config.colors.frame=colour;for(const id of ['grips','hubs','pedals','sprocket'])config.colors[id]=contrast;
        config.tyreStyle=pick(['black','tan-wall','white-wall']);config.finishes.frame=pick(['gloss','matte','jetfuel']);config.framePaint='solid';
        config.seatDesign=pick(JKCrewBikeConfig.seatDesignIds);
        const parts=globalThis.JKCrewBikeParts;
        if(parts){
          config.barModel=pick(parts.barModels).id;
          config.tireTread=pick(parts.tireTreads).id;config.hubStyle=pick(parts.hubStyles).id;config.crankModel=pick(parts.crankModels).id;
          config.sprocketStyle=pick(parts.sprocketStyles).id;config.gripStyle=pick(parts.gripStyles).id;
        }
      });
      if(button.hasAttribute('data-bike-save'))return void save();
      if(button.hasAttribute('data-bike-reload')||button.hasAttribute('data-bike-retry'))return void load();
      if(button.hasAttribute('data-bike-save-copy'))return void save(true);
      if(button.dataset.bikeLoad)return openBuild(Number(button.dataset.bikeLoad));
      if(button.dataset.bikeRemove)return void remove(Number(button.dataset.bikeRemove));
      if(button.hasAttribute('data-bike-preview'))return preview();
      if(button.hasAttribute('data-bike-new')&&!busy){if(dirty()&&!window.confirm('Start a new bike and replace your current unsaved design?'))return;config=copy(defaults);name='My dream bike';slot=null;revision=0;savedFingerprint='';pendingSave=null;history=[];future=[];status='';root.querySelector('[data-bike-name]').value=name;persist();paint();controls();garage();}
    },{signal:controller.signal});
    root.addEventListener('change',event=>{
      if(!valid()||busy)return;
      if(event.target.matches('[data-bike-autorotate]'))return void bike3D?.setAutoRotate(event.target.checked);
      if(event.target.matches('[data-bike-brake]')){
        if(!photoReady)return;
        const front=root.querySelector('[data-bike-brake="front"]')?.checked,rear=root.querySelector('[data-bike-brake="rear"]')?.checked;
        return change(()=>config.brakeStyle=front?(rear?'dual':'front'):(rear?'rear':'none'));
      }
      if(event.target.matches('[data-bike-custom-colour]')&&hex(event.target.value))change(()=>config.colors[part]=hex(event.target.value));
      if(event.target.matches('[data-bike-fade-colour]')&&hex(event.target.value))change(()=>config.frameFadeColor=hex(event.target.value));
      if(event.target.matches('[data-bike-seat-category]')){seatCategory=event.target.value;seatPage=0;controls();}
    },{signal:controller.signal});
    let nameEditRecorded=false;
    root.querySelector('[data-bike-name]').addEventListener('focus',()=>{nameEditRecorded=false;},{signal:controller.signal});
    root.querySelector('[data-bike-name]').addEventListener('input',event=>{if(!busy){if(!nameEditRecorded){history.push(snapshot());if(history.length>60)history.shift();future=[];nameEditRecorded=true;}name=event.target.value.slice(0,40);status='';persist();paint();}},{signal:controller.signal});
    root.addEventListener('keydown',event=>{const target=event.target.closest('[data-bike-part]');if(target&&['Enter',' '].includes(event.key)){event.preventDefault();select(target.dataset.bikePart);}},{signal:controller.signal});
    const collection=root.querySelector('.bike-collection-dialog');
    collection.addEventListener('close',()=>{if(valid())root.querySelector('[data-bike-collection-open]')?.focus({preventScroll:true});},{signal:controller.signal});
    root.addEventListener('keydown',event=>{
      const menu=root.querySelector('.bike-part-menu[open], .bike-camera-menu[open]');
      if(event.key==='Escape'&&menu){event.preventDefault();menu.open=false;menu.querySelector('summary').focus({preventScroll:true});}
      else if(event.key==='Escape'&&controlsOpen&&!collection.open&&!fullscreen){event.preventDefault();closeControls();}
    },{signal:controller.signal});
    document.addEventListener('click',event=>{
      for(const menu of root.querySelectorAll('.bike-part-menu[open], .bike-camera-menu[open]'))if(!menu.contains(event.target))menu.open=false;
    },{signal:controller.signal});
    const workshop=root.querySelector('[data-bike-workshop]'),shell=root.closest('.app-shell');
    function fitWorkspace() {
      if(!valid())return;
      const viewport=window.visualViewport?.height||window.innerHeight;
      const topbar=shell?.querySelector('.topbar'),navigation=shell?.querySelector('.bottom-nav');
      const visibleHeight=node=>node&&getComputedStyle(node).display!=='none'?node.getBoundingClientRect().height:0;
      const padding=getComputedStyle(root);
      const available=Math.max(220,Math.floor(viewport-visibleHeight(topbar)-visibleHeight(navigation)-parseFloat(padding.paddingTop||0)-parseFloat(padding.paddingBottom||0)));
      workshop.style.setProperty('--bike-workspace-height',available+'px');
      workshop.dataset.compactHeight=String(available<420);
    }
    function scheduleLayout() {cancelAnimationFrame(layoutFrame);layoutFrame=requestAnimationFrame(fitWorkspace);}
    const observer=new ResizeObserver(scheduleLayout);
    observer.observe(root);
    for(const node of [shell?.querySelector('.topbar'),shell?.querySelector('.bottom-nav')])if(node)observer.observe(node);
    window.addEventListener('resize',scheduleLayout,{signal:controller.signal});
    window.visualViewport?.addEventListener('resize',scheduleLayout,{signal:controller.signal});
    window.addEventListener('beforeunload',event=>{if(valid()&&dirty()&&!draftAvailable){event.preventDefault();event.returnValue='';}},{signal:controller.signal});
    active={dispose(){alive=false;++view3DRequest;clearTimeout(timer3D);bike3D?.dispose();bike3D=null;controller.abort();observer.disconnect();cancelAnimationFrame(layoutFrame);if(collection.open)collection.close();if(fullscreen){fullscreen.destroy();fullscreen=null;}}};
    paint();controls();garage();fitWorkspace();void load();
  }
  return {mount,destroy,teaserHtml,normalize,defaults:copy(defaults)};
})();
