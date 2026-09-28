(function (global) {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const key = value => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const categories = { box: 'Box', air: 'Air', spine: 'Spine', hip: 'Hip' };
  const subcategories = category => ['spins','flips',...(category === 'box' ? ['transfers'] : category === 'air' ? ['alleyoop'] : []),'other'];
  const cache = new Map();
  let activeDialog = null;
  async function rpc(config, name, args) {
    if (config.currentUser && config.currentUser() !== config.userId) throw Error('Your account changed. Reopen the Tricktionary.');
    if (config.isCurrent && !config.isCurrent()) throw Error('The rider changed. Reopen their Tricktionary.');
    const result = await config.withTimeout(config.client.rpc(name, args), 'Tricktionary update', 15000);
    if (result.error) throw result.error;
    return result.data;
  }
  function invalidate() { cache.clear(); }
  function loadCatalog(config) {
    const cacheKey = `${config.userId}:${config.athleteId || ''}`;
    const saved = cache.get(cacheKey);
    if (saved && saved.until > Date.now()) return saved.promise;
    const entry = { until: Date.now() + 60000 };
    entry.promise = rpc(config, 'get_tricktionary_catalog', { p_athlete_id: config.athleteId || null }).then(rows => {
      if (!Array.isArray(rows)) throw Error('The crew trick library could not load.');
      return rows;
    }).catch(error => { if (cache.get(cacheKey) === entry) cache.delete(cacheKey); throw error; });
    cache.set(cacheKey, entry);
    return entry.promise;
  }
  function toolbarHtml() {
    return '<div class="trick-auto-toolbar"><div><strong>Auto sorting is on</strong><small>Known tricks find their place. Tap Sort for anything that needs a hand.</small></div><button class="secondary-btn" type="button" data-auto-organise>Auto-organise</button></div>';
  }
  function cardButtonHtml(entry) {
    return `<button class="tricktionary-rename-btn trick-sort-btn" type="button" draggable="false" data-sort-trick="${esc(entry.key)}" aria-label="Sort ${esc(entry.title)}">${entry.tricktionaryCategory === 'new' ? 'Sort trick ↗' : 'Change category'}</button>`;
  }
  function dialog(title, intro, config) {
    activeDialog?.close();
    const previous = document.activeElement;
    const element = document.createElement('dialog');
    element.className = 'trick-auto-dialog';
    element.setAttribute('aria-labelledby','trick-auto-title');
    element.innerHTML = `<header><div><div class="eyebrow">Your trick library</div><h2 id="trick-auto-title">${esc(title)}</h2></div><button type="button" data-close-auto aria-label="Close">×</button></header><p class="trick-auto-intro">${esc(intro)}</p><div data-auto-body></div><p class="trick-auto-status" data-auto-status role="status" aria-live="polite"></p>`;
    document.body.append(element);
    let closed = false;
    const valid = () => !closed && element.isConnected && config.currentUser() === config.userId && (!config.isCurrent || config.isCurrent());
    const close = () => { if (closed) return; closed = true; element.close(); element.remove(); if (activeDialog?.element === element) activeDialog = null; if (previous?.isConnected) previous.focus(); };
    element.addEventListener('cancel', event => { event.preventDefault(); close(); });
    element.querySelector('[data-close-auto]').onclick = close;
    element.showModal();
    const result = { element, body: element.querySelector('[data-auto-body]'), status: element.querySelector('[data-auto-status]'), valid, close };
    activeDialog = result;
    return result;
  }
  async function teach(config, entry, category, subcategory) {
    if (!config.coach || !categories[category]) return;
    const title = global.JKCrewTricktionaryAuto.catalogTitle(entry.title, category);
    const placement = global.JKCrewTricktionaryAuto.classify({ title }, { profile: {}, catalog: [] });
    if (placement.category !== category) return false;
    await rpc(config, 'save_tricktionary_catalog_entry', { p_source_key: key(title), p_title: title, p_category: category, p_subcategory: subcategory });
    invalidate();
    return true;
  }
  function quickSort(config, entry) {
    const ui = dialog('Find its place', entry.title, config);
    ui.body.innerHTML = `<form data-sort-form><fieldset><legend>Obstacle</legend><div class="trick-sort-options">${Object.entries(categories).map(([value,label]) => `<label><input type="radio" name="category" value="${value}" required ${entry.tricktionaryCategory === value ? 'checked' : ''}><span>${label}</span></label>`).join('')}</div></fieldset><div class="field"><label for="trick-sort-subcategory">Group</label><select id="trick-sort-subcategory" name="subcategory"></select></div>${config.coach ? '<label class="trick-auto-share"><input type="checkbox" name="share" checked><span>Remember in the crew library<small>Use this placement for matching tricks and list suggestions.</small></span></label>' : ''}<button class="primary-btn wide" type="submit">Save placement</button></form>`;
    const form = ui.body.querySelector('form'), sub = form.elements.subcategory;
    const update = () => {
      const category = form.elements.category.value;
      sub.innerHTML = subcategories(category).map(value => `<option value="${value}">${value === 'other' ? 'Other tricks' : value.charAt(0).toUpperCase()+value.slice(1)}</option>`).join('');
      const guessed = global.JKCrewTricktionaryAuto.classify({...entry,categoryOverride:category,tricktionarySubcategory:''},{profile:{},catalog:config.data.catalog || []});
      sub.value = subcategories(category).includes(entry.tricktionarySubcategory) && category === entry.tricktionaryCategory ? entry.tricktionarySubcategory : guessed.subcategory || 'other';
    };
    form.addEventListener('change', event => { if (event.target.name === 'category') update(); }); update();
    let busy = false, placementSaved = false;
    form.onsubmit = async event => {
      event.preventDefault(); if (busy || !ui.valid() || !form.reportValidity()) return;
      busy = true; const button = form.querySelector('[type=submit]'); button.disabled = true; button.textContent = 'Saving…';
      const category = form.elements.category.value, subcategory = sub.value;
      ui.status.textContent = '';
      try {
        await config.move(entry.key, category, subcategory); placementSaved = true;
        if (!ui.valid()) return;
        const sharing = config.coach && form.elements.share.checked;
        const remembered = sharing ? await teach(config, entry, category, subcategory) : false;
        if (!ui.valid()) return;
        ui.close(); config.notify(remembered ? 'Placement saved · remembered for your crew.' : sharing
          ? 'Placement saved for this rider. The trick name mentions a different obstacle, so no crew rule was created.' : 'Placement saved.');
        await config.refresh();
      } catch (error) {
        if (ui.valid()) ui.status.textContent = (placementSaved ? 'Placement saved. The crew library could not update. ' : 'Could not save. ') + 'Your choices are kept — try again.';
      } finally { busy = false; button.disabled = false; button.textContent = 'Save placement'; }
    };
  }
  function previewItems(data, aggregate) {
    const meta = data.profile?.tricktionary_meta || {};
    const profile = { ...data.profile, tricktionary_meta: { ...meta, categories: Object.fromEntries(Object.entries(meta.categories || {}).filter(([,value]) => value !== 'new')) } };
    const original = global.JKCrewTricktionaryAuto.organise(aggregate(data), { profile, catalog: data.catalog || [] });
    return original.flatMap(entry => {
      const persisted = meta.categories?.[entry.key] ?? null, subcategory = meta.subcategories?.[entry.key] ?? null;
      if (persisted && persisted !== 'new' || subcategory || meta.hidden?.[entry.key]) return [];
      const suggestion = entry.tricktionaryAuto;
      if (!categories[suggestion.category]) return [];
      return [{ key: entry.key, title: entry.title, category: suggestion.category, subcategory: suggestion.subcategory || 'other', expected_category: persisted, expected_subcategory: subcategory }];
    });
  }
  function autoOrganise(config) {
    const ui = dialog('Auto-organise', 'Preview placements before saving. Existing organised tricks and landed totals are kept.', config);
    const riders = config.coach && config.roster?.length ? config.roster : [{id:config.athleteId,display_name:config.data.profile?.display_name || 'Your tricks'}];
    ui.body.innerHTML = `<div class="field"><label for="trick-auto-scope">Riders</label><select id="trick-auto-scope"><option value="selected">This rider</option>${riders.length > 1 ? '<option value="crew">My whole crew</option>' : ''}</select></div><button class="secondary-btn wide" type="button" data-preview-auto>Preview placements</button><div data-auto-preview></div><button class="primary-btn wide" type="button" data-apply-auto hidden>Apply placements</button>`;
    const preview = ui.body.querySelector('[data-auto-preview]'), load = ui.body.querySelector('[data-preview-auto]'), apply = ui.body.querySelector('[data-apply-auto]'), scope = ui.body.querySelector('select');
    let groups = [], busy = false;
    scope.onchange = () => { groups = []; preview.innerHTML = ''; apply.hidden = true; ui.status.textContent = ''; };
    load.onclick = async () => {
      if (busy || !ui.valid()) return; busy = true; load.disabled = true; scope.disabled = true; apply.hidden = true; groups = []; preview.innerHTML = '';
      const selected = scope.value === 'crew' ? riders : riders.filter(r => r.id === config.athleteId);
      let failures = 0;
      try {
        for (const [index,rider] of selected.entries()) {
          if (!ui.valid()) return;
          ui.status.textContent = `Checking ${index + 1} of ${selected.length} · ${rider.display_name}`;
          try {
            const data = await config.loadData(rider.id);
            if (!ui.valid()) return;
            if (data.catalogUnavailable) { failures++; continue; }
            const items = previewItems(data, config.aggregate);
            groups.push({rider,items});
          } catch (_) { failures++; }
        }
        if (!ui.valid()) return;
        preview.innerHTML = groups.filter(g => g.items.length).map((g,groupIndex) => `<section class="trick-auto-preview-group"><h3>${esc(g.rider.display_name)}</h3>${g.items.map((item,index) => `<label><input type="checkbox" checked data-preview-key="${esc(g.rider.id)}:${index}"><span><strong>${esc(item.title)}</strong><small>${esc(categories[item.category])} → ${esc(item.subcategory)}</small></span></label>`).join('')}</section>`).join('');
        const count = groups.reduce((total,g) => total+g.items.length,0);
        apply.hidden = count === 0; apply.textContent = `Apply ${count} placements`;
        ui.status.textContent = count ? `${count} suggested placements. Untick anything you want to leave. Ambiguous tricks stay in Needs sorting.` : 'No clear placements to save. Use Sort trick to choose an obstacle for unclear names.';
        if (failures) ui.status.textContent += ` ${failures} rider list${failures === 1 ? '' : 's'} could not load. Preview again to retry.`;
      } finally { busy = false; load.disabled = false; scope.disabled = false; }
    };
    apply.onclick = async () => {
      if (busy || !ui.valid()) return; busy = true; apply.disabled = load.disabled = scope.disabled = true;
      let applied = 0, unchanged = 0, skipped = 0;
      try {
        for (const group of groups) {
          const selected = group.items.filter((_,index) => [...preview.querySelectorAll('[data-preview-key]')].some(input => input.dataset.previewKey === `${group.rider.id}:${index}` && input.checked));
          for (let offset = 0; offset < selected.length; offset += 200) {
            if (!ui.valid()) return;
            const items = selected.slice(offset,offset+200);
            const result = await rpc(config,'apply_tricktionary_locations',{p_athlete_id:group.rider.id,p_items:items.map(({title,...item}) => item)});
            if (!ui.valid()) return;
            applied += Number(result.applied || 0); unchanged += Number(result.unchanged || 0); skipped += (result.skipped || []).length;
            items.forEach(item => { const index = group.items.indexOf(item); const input = [...preview.querySelectorAll('[data-preview-key]')].find(el => el.dataset.previewKey === `${group.rider.id}:${index}`); if (input) { input.checked = false; input.disabled = true; } });
          }
        }
        if (!ui.valid()) return;
        ui.status.textContent = `${applied} placements saved.${unchanged ? ` ${unchanged} already saved.` : ''}${skipped ? ` ${skipped} changed elsewhere and were left alone.` : ''} Landed totals and points are unchanged.`;
        apply.hidden = true;
        const message = ui.status.textContent;
        ui.close(); config.notify(message); await config.refresh();
      } catch (_) { if (ui.valid()) ui.status.textContent = 'Some placements could not save. Completed rows are kept; tap Apply to retry the remaining rows.'; }
      finally { busy = false; apply.disabled = load.disabled = scope.disabled = false; }
    };
  }
  function bind(config) {
    const board = config.board;
    if (!board) return;
    if (config.data.catalogUnavailable) {
      const warning = document.createElement('p'); warning.className = 'trick-auto-status';
      warning.textContent = 'The crew library is temporarily unavailable. Your saved tricks are still here. ';
      const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'secondary-btn compact-btn'; retry.textContent = 'Retry library';
      retry.onclick = () => { invalidate(); void config.refresh(); }; warning.append(retry); board.prepend(warning);
    }
    board.querySelectorAll('[data-sort-trick]').forEach(button => {
      ['pointerdown','mousedown','dragstart'].forEach(type => button.addEventListener(type,event => event.stopPropagation()));
      button.addEventListener('click',event => { event.preventDefault(); event.stopPropagation(); const entry = config.entries.find(row => row.key === button.dataset.sortTrick); if (entry) quickSort(config,entry); });
    });
    board.querySelector('[data-auto-organise]')?.addEventListener('click',()=>autoOrganise(config));
  }
  function installSuggestions(config) {
    let list = null, picker = null, sequence = 0;
    const inputSelector = 'input[name="trickName"], input[name="trick_name"], #manual-trick-form input[name="title"], #coach-manual-trick-form input[name="title"], input[name^="proposalItems."]:not([name="proposalItems.lines"])';
    const textareaSelector = 'textarea[name="assignmentLines"], textarea[name^="dailyVenueTricks:"], textarea[name="customDaily"], textarea[name="one_bang"], textarea[name="dialled"], textarea[name="percentage"], textarea[name="bonus"], textarea[data-tier-two-template]';
    const focus = async event => {
      const input = event.target;
      if ((!input.matches?.(inputSelector) && !input.matches?.(textareaSelector)) || !config.currentUser()) return;
      const userId = config.currentUser(), serial = ++sequence;
      try {
        const catalog = await loadCatalog({...config,userId});
        if (!input.isConnected || config.currentUser() !== userId || serial !== sequence) return;
        list?.remove(); picker?.remove(); list = document.createElement('datalist'); list.id = 'jkcrew-trick-suggestions';
        const titles = [...new Set(catalog.map(row => row.title).filter(Boolean))];
        list.innerHTML = titles.map(title=>`<option value="${esc(title)}"></option>`).join('');
        document.body.append(list);
        if (input.matches(inputSelector)) { input.setAttribute('list',list.id); return; }
        if (!titles.length) return;
        picker = document.createElement('div'); picker.className = 'trick-library-picker';
        picker.innerHTML = '<label>From the crew trick library<input type="text" data-library-search list="jkcrew-trick-suggestions" placeholder="Find a trick…" autocomplete="off"></label><button class="secondary-btn" type="button" data-library-add>Add to list</button><small role="status"></small>';
        input.after(picker);
        const search = picker.querySelector('input'), status = picker.querySelector('small');
        picker.querySelector('button').onclick = () => {
          if (!input.isConnected || config.currentUser() !== userId) return;
          const title = search.value.trim();
          if (!titles.includes(title)) { status.textContent = 'Choose a trick from the suggestions.'; return; }
          input.value = input.value + (input.value && !input.value.endsWith('\n') ? '\n' : '') + title;
          input.dispatchEvent(new Event('input',{bubbles:true})); input.dispatchEvent(new Event('change',{bubbles:true}));
          search.value = ''; status.textContent = 'Added to the end of your list.';
        };
      } catch (_) { /* Suggestions are optional; never interrupt a list being typed. */ }
    };
    document.addEventListener('focusin',focus);
    return () => { sequence++; list?.remove(); picker?.remove(); document.removeEventListener('focusin',focus); };
  }

  function close() { activeDialog?.close(); }
  function reset() { close(); invalidate(); }
  global.JKCrewTricktionaryTools = {loadCatalog,invalidate,toolbarHtml,cardButtonHtml,bind,teach,previewItems,installSuggestions,close,reset};
})(window);
