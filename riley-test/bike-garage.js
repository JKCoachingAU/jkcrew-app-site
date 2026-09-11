/* A private, cosmetic bike workshop. Training scores and rider records are never written here. */
const JKCrewBikeGarage = (() => {
  const defaults = {
    version: 1, colors: { frame: '#F1F4F8', fork: '#F1F4F8', bars: '#F1F4F8', grips: '#F1F4F8', rims: '#F1F4F8', hubs: '#F1F4F8', seat: '#F1F4F8', pedals: '#F1F4F8', cranks: '#F1F4F8', sprocket: '#F1F4F8' },
    barStyle: 'two-piece', tyreStyle: 'white', seatStyle: 'slim', pegs: 'none', decal: 'none',
  };
  const palette = [['Midnight','#252B39'],['Chrome','#BCC7D6'],['Cloud','#F1F4F8'],['Lilac','#AD8AFF'],['Electric blue','#428CFF'],['Ice','#51D5E8'],['Mint','#7CE3B8'],['Acid','#D6F16A'],['Gold','#F2BC57'],['Orange','#F68B4D'],['Coral','#F26879'],['Pink','#E789D0']];
  const groups = { Frame: ['frame'], 'Front end': ['fork','bars','grips'], Wheels: ['rims','hubs','tyres'], Details: ['seat','pedals','cranks','sprocket','pegs','decal'] };
  const labels = {frame:'Frame',fork:'Forks',bars:'Handlebars',grips:'Grips',rims:'Rims',hubs:'Hubs',tyres:'Tyres',seat:'Seat',pedals:'Pedals',cranks:'Cranks',sprocket:'Sprocket',pegs:'Pegs',decal:'Frame graphic'};
  const styles = {
    bars: ['barStyle',[['two-piece','Two piece'],['four-piece','Four piece']]],
    tyres: ['tyreStyle',[['white','All white'],['black','All black'],['tan-wall','Tan wall'],['white-wall','White wall']]],
    seat: ['seatStyle',[['slim','Slim'],['padded','Padded']]],
    pegs: ['pegs',[['none','No pegs'],['rear','Rear only'],['both','Front & rear']]],
    decal: ['decal',[['jkcrew','JKCREW'],['lightning','Lightning'],['none','Clean frame']]],
  };
  const copy = value => JSON.parse(JSON.stringify(value));
  const html = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const hex = value => /^#[0-9a-f]{6}$/i.test(String(value)) ? String(value).toUpperCase() : null;
  function normalize(value) {
    const result = copy(defaults);
    for (const key of Object.keys(result.colors)) result.colors[key] = hex(value?.colors?.[key]) || result.colors[key];
    for (const [key, options] of Object.values(styles)) if (options.some(([id]) => id === value?.[key])) result[key] = value[key];
    return result;
  }
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
    let photoSequence = 0, photoReady = false;
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
        savedFingerprint = typeof draft.savedFingerprint === 'string' ? draft.savedFingerprint : '';
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
    function message(text, kind = '') { status = text; statusKind = kind; updateStatus(); }
    function updateStatus() {
      if (!valid()) return;
      const node = root.querySelector('[data-bike-status]');
      node.textContent = status || (dirty() ? (draftAvailable ? 'Draft kept on this device · save to your garage' : 'Draft kept for this visit · save to your garage') : 'Saved to your garage');
      node.className = `bike-save-status ${statusKind}`;
      root.querySelector('[data-bike-save]').disabled = busy || !loaded;
      root.querySelector('[data-bike-save]').textContent = busy ? 'Saving…' : slot ? 'Save changes' : 'Save to garage';
      root.querySelector('[data-bike-save-copy]').hidden = !slot;
      root.querySelector('[data-bike-save-copy]').disabled = busy || !loaded || builds.length >= 3;
      root.querySelector('[data-bike-undo]').disabled = busy || !history.length;
      root.querySelector('[data-bike-redo]').disabled = busy || !future.length;
      root.querySelector('[data-bike-name]').disabled = busy;
      root.querySelector('[data-bike-shuffle]').disabled = busy;
      root.querySelector('[data-bike-new]').disabled = busy;
      root.querySelector('[data-bike-preview]').disabled = !photoReady;
      root.querySelectorAll('[data-bike-colour],[data-bike-style],input[type="color"]').forEach(button => button.disabled = busy || !photoReady);
      root.querySelectorAll('[data-bike-load],[data-bike-remove]').forEach(button => button.disabled = busy || !loaded);
      root.querySelectorAll('[data-bike-reload],[data-bike-retry]').forEach(button => button.disabled = busy || loading);
      root.querySelector('[data-bike-retry]').hidden = loaded || loading;
    }
    function paint() {
      if (!valid()) return;
      const sequence = ++photoSequence;
      photoReady = JKCrewBikeArt.isReady(config);
      const artwork = root.querySelector('[data-bike-art]');
      const photoStatus = root.querySelector('[data-bike-photo-status]');
      artwork.setAttribute('aria-busy', String(!photoReady));
      photoStatus.hidden = photoReady;
      photoStatus.innerHTML = '<span>Loading your bike…</span>';
      const focusedPart = root.querySelector('[data-bike-art]')?.contains(document.activeElement) ? document.activeElement?.dataset.bikePart : '';
      root.querySelector('[data-bike-art]').innerHTML = JKCrewBikeArt.render(config,{idPrefix:'garage-main',selectedPart:part,interactive:true});
      if (focusedPart) root.querySelector(`[data-bike-art] [data-bike-part="${CSS.escape(focusedPart)}"]`)?.focus({preventScroll:true});
      root.querySelector('[data-bike-design-title]').textContent = name.trim() || 'My dream bike';
      root.querySelector('[data-bike-frame-colour]').style.backgroundColor = config.colors.frame;
      root.querySelector('[data-bike-part-hint]').textContent = `Editing ${labels[part].toLowerCase()}`;
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
    function controls() {
      if (!valid()) return;
      const focused = root.querySelector('[data-bike-controls]')?.contains(document.activeElement) ? document.activeElement : null;
      const focusAttribute = ['data-bike-group','data-bike-select','data-bike-colour','data-bike-style','data-bike-custom-colour'].find(attribute => focused?.hasAttribute(attribute));
      const focusValue = focusAttribute ? focused.getAttribute(focusAttribute) : '';
      const selected = config.colors[part], style = styles[part];
      const colourName = palette.find(([,value]) => value === selected)?.[0] || 'Custom colour';
      root.querySelector('[data-bike-controls]').innerHTML = `
        <div class="bike-part-tabs" aria-label="Bike sections">${Object.keys(groups).map(label => `<button type="button" data-bike-group="${label}" aria-pressed="${group===label}">${label}</button>`).join('')}</div>
        <div class="bike-part-picker" aria-label="Choose a part">${groups[group].map(id => `<button type="button" data-bike-select="${id}" aria-pressed="${part===id}">${labels[id]}</button>`).join('')}</div>
        <div class="bike-control-heading"><div><span class="bike-eyebrow">MAKE IT YOURS</span><h2>${labels[part]}</h2></div>${selected ? `<span class="bike-colour-name">${colourName}</span>` : ''}</div>
        ${selected ? `<div class="bike-palette" aria-label="${labels[part]} colour">${palette.map(([label,value]) => `<button type="button" class="bike-swatch" data-bike-colour="${value}" style="--swatch:${value}" aria-label="${label} ${labels[part].toLowerCase()}" aria-pressed="${selected===value}"><span aria-hidden="true">${selected===value?'✓':''}</span></button>`).join('')}</div><label class="bike-custom-colour"><span>Mix your own colour</span><input type="color" data-bike-custom-colour value="${selected}" aria-label="Custom ${labels[part].toLowerCase()} colour"></label>` : ''}
        ${style ? `<div class="bike-style-options"><span class="bike-eyebrow">${part==='decal'?'GRAPHIC':'STYLE'}</span><div>${style[1].map(([id,label]) => `<button type="button" data-bike-style="${id}" aria-pressed="${config[style[0]]===id}">${label}</button>`).join('')}</div></div>` : ''}
        <p class="bike-control-tip">Tap a part on the bike, or choose it above.</p>`;
      if (focusAttribute) root.querySelector(`[${focusAttribute}="${CSS.escape(focusValue)}"]`)?.focus({preventScroll:true});
      updateStatus();
    }
    function change(fn) {
      if (busy) return;
      history.push(snapshot()); if (history.length > 60) history.shift(); future = [];
      fn(); status=''; persist(); paint(); controls();
    }
    function select(id) {
      if (!labels[id]) return;
      part=id; group=Object.keys(groups).find(key=>groups[key].includes(id)); paint(); controls();
    }
    function garage() {
      if (!valid()) return;
      root.querySelector('[data-bike-count]').textContent = `${builds.length} / 3`;
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
      if(!target){message('Your three garage spaces are full. Open a saved design to edit it, or remove one.','error');root.querySelector('[data-bike-garage]').open=true;return;}
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
      root.querySelector('[data-bike-workshop]').scrollIntoView({behavior:'instant',block:'start'});
    }
    function preview() {
      if(fullscreen)return;
      fullscreen=document.createElement('dialog');fullscreen.className='bike-fullscreen';fullscreen.setAttribute('aria-label','Full bike preview');
      fullscreen.innerHTML=`<button type="button" class="bike-fullscreen-close" aria-label="Close bike preview">×</button><div class="bike-preview-title"><span>JKCREW GARAGE</span><h2>${html(name.trim()||'My dream bike')}</h2></div>${JKCrewBikeArt.render(config,{idPrefix:'garage-full'})}`;
      document.body.append(fullscreen);const dialog=fullscreen;dialog.showModal();
      dialog.querySelector('button').onclick=()=>dialog.close();dialog.addEventListener('close',()=>{dialog.remove();if(fullscreen===dialog)fullscreen=null;},{once:true});
    }
    root.innerHTML=`<section class="bike-garage" data-bike-workshop>
      <header class="bike-garage-header"><div><span class="bike-eyebrow">JKCREW GARAGE / 01</span><h1>Your bike.<br><em>Your style.</em></h1><p>Build something only you would ride.</p></div><button type="button" class="bike-back" data-bike-back>← Back</button></header>
      <div class="bike-workshop-grid"><div class="bike-stage"><div class="bike-stage-top"><span><i data-bike-frame-colour></i> CUSTOM BUILD</span><button type="button" data-bike-new>+ Blank bike</button></div><div class="bike-stage-art" data-bike-art aria-busy="true"></div><div class="bike-photo-status" data-bike-photo-status role="status"><span>Loading your bike…</span></div><div class="bike-stage-bottom"><div><h2 data-bike-design-title></h2><span data-bike-part-hint></span></div><button type="button" data-bike-preview aria-label="Expand bike preview">⛶</button></div></div>
      <section class="bike-controls" aria-label="Customise your bike"><div data-bike-controls></div><div class="bike-edit-tools"><button type="button" data-bike-undo aria-label="Undo last change">↶ Undo</button><button type="button" data-bike-redo aria-label="Redo change">↷ Redo</button><button type="button" data-bike-shuffle>✳ Surprise me</button></div></section></div>
      <div class="bike-save-bar"><label class="bike-name-field"><span>NAME YOUR BUILD</span><input type="text" maxlength="40" data-bike-name value="${html(name)}" autocomplete="off"></label><div class="bike-save-actions"><button type="button" class="bike-save-copy" data-bike-retry hidden>Refresh garage</button><button type="button" class="bike-save-copy" data-bike-save-copy hidden>Save as new</button><button type="button" class="bike-primary" data-bike-save>Save to garage</button></div><p class="bike-save-status" data-bike-status role="status" aria-live="polite"></p></div>
      <details class="bike-garage-shelf" data-bike-garage><summary><span><span class="bike-eyebrow">YOUR COLLECTION</span><strong>My garage <small data-bike-count>0 / 3</small></strong></span><b aria-hidden="true">+</b></summary><div class="bike-garage-toolbar"><p>Three spaces. Endless ideas.</p><button type="button" data-bike-reload>Retry loading garage</button></div><div class="bike-saved-grid" data-bike-saved-list></div></details>
      <p class="bike-garage-footnote">Dream builds, made by you. Saved designs are private to your account.</p>
    </section>`;
    root.addEventListener('click',event=>{
      const button=event.target.closest('button,[data-bike-part]');if(!button||!root.contains(button)||button.disabled||!valid())return;
      if(button.hasAttribute('data-bike-back'))return onBack();
      if(button.hasAttribute('data-bike-photo-retry'))return paint();
      if(button.dataset.bikePart)return select(button.dataset.bikePart);
      if(button.dataset.bikeGroup){group=button.dataset.bikeGroup;return select(groups[group][0]);}
      if(button.dataset.bikeSelect)return select(button.dataset.bikeSelect);
      if(button.dataset.bikeColour)return change(()=>config.colors[part]=button.dataset.bikeColour);
      if(button.dataset.bikeStyle)return change(()=>config[styles[part][0]]=button.dataset.bikeStyle);
      if(button.hasAttribute('data-bike-undo')&&history.length){future.push(snapshot());const prior=history.pop();config=prior.configuration;name=prior.name;root.querySelector('[data-bike-name]').value=name;status='';persist();paint();return controls();}
      if(button.hasAttribute('data-bike-redo')&&future.length){history.push(snapshot());const next=future.pop();config=next.configuration;name=next.name;root.querySelector('[data-bike-name]').value=name;status='';persist();paint();return controls();}
      if(button.hasAttribute('data-bike-shuffle'))return change(()=>{const colour=palette[Math.floor(Math.random()*palette.length)][1],contrast=palette[Math.floor(Math.random()*palette.length)][1];config.colors.frame=colour;for(const id of ['grips','hubs','pedals','sprocket'])config.colors[id]=contrast;config.tyreStyle=['black','tan-wall','white-wall'][Math.floor(Math.random()*3)];});
      if(button.hasAttribute('data-bike-save'))return void save();
      if(button.hasAttribute('data-bike-reload')||button.hasAttribute('data-bike-retry'))return void load();
      if(button.hasAttribute('data-bike-save-copy'))return void save(true);
      if(button.dataset.bikeLoad)return openBuild(Number(button.dataset.bikeLoad));
      if(button.dataset.bikeRemove)return void remove(Number(button.dataset.bikeRemove));
      if(button.hasAttribute('data-bike-preview'))return preview();
      if(button.hasAttribute('data-bike-new')&&!busy){if(dirty()&&!window.confirm('Start a new bike and replace your current unsaved design?'))return;config=copy(defaults);name='My dream bike';slot=null;revision=0;savedFingerprint='';pendingSave=null;history=[];future=[];status='';root.querySelector('[data-bike-name]').value=name;persist();paint();controls();garage();}
    },{signal:controller.signal});
    root.addEventListener('change',event=>{if(event.target.matches('[data-bike-custom-colour]')&&hex(event.target.value))change(()=>config.colors[part]=hex(event.target.value));},{signal:controller.signal});
    let nameEditRecorded=false;
    root.querySelector('[data-bike-name]').addEventListener('focus',()=>{nameEditRecorded=false;},{signal:controller.signal});
    root.querySelector('[data-bike-name]').addEventListener('input',event=>{if(!busy){if(!nameEditRecorded){history.push(snapshot());if(history.length>60)history.shift();future=[];nameEditRecorded=true;}name=event.target.value.slice(0,40);status='';persist();paint();}},{signal:controller.signal});
    root.addEventListener('keydown',event=>{const target=event.target.closest('[data-bike-part]');if(target&&['Enter',' '].includes(event.key)){event.preventDefault();select(target.dataset.bikePart);}},{signal:controller.signal});
    window.addEventListener('beforeunload',event=>{if(valid()&&dirty()&&!draftAvailable){event.preventDefault();event.returnValue='';}},{signal:controller.signal});
    active={dispose(){alive=false;controller.abort();if(fullscreen){fullscreen.remove();fullscreen=null;}}};
    paint();controls();garage();void load();
  }
  return {mount,destroy,teaserHtml,normalize,defaults:copy(defaults)};
})();
