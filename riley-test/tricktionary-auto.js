/* Presentation-only sorting. Historical names, evidence and totals are never merged or rewritten. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.JKCrewTricktionaryAuto = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const categories = new Set(['new', 'box', 'spine', 'hip', 'air']);
  const labels = { box: 'Box', spine: 'Spine', hip: 'Hip', air: 'Air' };
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
  const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const key = value => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  const titleOf = entry => String(entry.title || entry.trick_name || entry.name || '').trim();
  const patterns = {
    box: /\b(?:box(?:[\s-]*jump)?|jump[\s-]*box)\b/gi,
    spine: /\bspine\b/gi,
    hip: /\bhip\b/gi,
    air: /\b(?:air|quarter(?:[\s-]*pipe)?|vert|fly[\s-]*out)\b/gi,
  };
  const isFoam = value => /\bfoam(?:[\s-]*pit)?\b/i.test(String(value || ''));

  function obstacles(value) {
    const text = String(value || '');
    return Object.entries(patterns).filter(([, pattern]) => {
      pattern.lastIndex = 0;
      return pattern.test(text);
    }).map(([category]) => category);
  }

  function baseKey(value) {
    let text = String(value || '');
    for (const pattern of Object.values(patterns)) text = text.replace(pattern, ' ');
    // Only obstacle qualifiers and their separators are removed. Rotation,
    // direction and every trick in a combination remain part of the key.
    return key(text.replace(/[()[\]·|]/g, ' ').replace(/^\s*[-–—:]+|[-–—:]+\s*$/g, ''));
  }

  function resolve(value, aliases) {
    let current = key(value);
    const path = [], seen = new Map();
    while (current && own(aliases, current) && path.length < 50) {
      if (seen.has(current)) return path.slice(seen.get(current)).sort()[0] || current;
      seen.set(current, path.length); path.push(current);
      const next = key(aliases[current]);
      if (!next || next === current) break;
      current = next;
    }
    return current;
  }

  function metadata(profile) {
    const saved = object(profile?.tricktionary_meta);
    const legacy = { aliases: {}, categories: {}, titles: {} };
    for (const entry of Array.isArray(profile?.manual_tricktionary) ? profile.manual_tricktionary : []) {
      if (entry?.source !== 'merged' || !Array.isArray(entry.mergedFrom) || entry.mergedFrom.length < 2) continue;
      const title = titleOf(entry), canonical = key(title);
      if (!canonical) continue;
      for (const name of entry.mergedFrom) {
        const source = key(name);
        if (source && source !== canonical) legacy.aliases[source] = canonical;
      }
      legacy.titles[canonical] = title;
      const category = key(entry.tricktionaryCategory || entry.categoryOverride || 'new');
      legacy.categories[canonical] = categories.has(category) ? category : 'new';
    }
    return {
      aliases: { ...legacy.aliases, ...object(saved.aliases) },
      categories: { ...legacy.categories, ...object(saved.categories) },
      titles: { ...legacy.titles, ...object(saved.titles) },
      subcategories: object(saved.subcategories), hidden: object(saved.hidden),
    };
  }

  function validSubcategory(value, category) {
    return (category === 'air' ? ['flips', 'spins', 'alleyoop', 'other']
      : category === 'box' ? ['flips', 'spins', 'transfers', 'other']
        : ['box', 'spine', 'hip'].includes(category) ? ['flips', 'spins', 'other'] : []).includes(value);
  }

  function subcategoryFor(title, category) {
    if (!labels[category]) return null;
    const name = key(title);
    if (/\b(?:alley|ali)[\s-]?oop\b/.test(name)) {
      if (category === 'air') return 'alleyoop';
      if (category === 'box') return 'transfers';
    }
    if (/\b(?:flair|(?:back|front|backward|forward)[\s-]*flip|flip)(?:s)?\b/.test(name)) return 'flips';
    if (/\btruck(?:[\s-]*driver)?\b/.test(name)) return 'spins';
    if (/(^|\D)(90|180|270|360|450|540|630|720|810|900|1080|1260|1440)(?!\d)/.test(name)) return 'spins';
    return 'other';
  }

  function catalogRows(catalog) {
    return (Array.isArray(catalog) ? catalog : Array.isArray(catalog?.entries) ? catalog.entries : [])
      .filter(row => {
        if (!row || !labels[key(row.category)] || !titleOf(row) || row.approved === false || row.active === false) return false;
        // An incorrectly labelled catalog row must not override explicit
        // obstacle wording or offer that contradiction as a new sheet name.
        return [titleOf(row), row.source_key, ...(Array.isArray(row.aliases) ? row.aliases : [])].filter(Boolean).every(name => {
          const context = obstacles(name);
          return !isFoam(name) && context.length <= 1 && (!context.length || context[0] === key(row.category));
        });
      });
  }

  function rowKeys(row) {
    return [...new Set([row.source_key, titleOf(row), ...(Array.isArray(row.aliases) ? row.aliases : [])]
      .filter(Boolean).flatMap(name => [key(name), baseKey(name)]).filter(Boolean))];
  }

  function compileCatalog(catalog) {
    const index = new Map();
    for (const row of catalogRows(catalog)) for (const name of rowKeys(row)) {
      const lookup = `${key(row.category)}\u0000${name}`;
      const matches = index.get(lookup) || [];
      matches.push(row); index.set(lookup, matches);
    }
    return index;
  }

  function approvedMatches(title, category, catalog, preparedIndex) {
    const index = preparedIndex || compileCatalog(catalog);
    return [...new Set([key(title), baseKey(title)].filter(Boolean)
      .flatMap(name => index.get(`${category}\u0000${name}`) || []))];
  }

  function result(category, subcategory, status, source, reason, confidence, extra = {}) {
    return { category, subcategory, status, source, reason, confidence, ...extra };
  }

  function classify(entry = {}, { profile = {}, catalog = [] } = {}, prepared = null) {
    const title = titleOf(entry), meta = prepared?.meta || metadata(profile);
    const sourceKey = key(entry.key || title), canonical = resolve(sourceKey, meta.aliases);
    const members = Array.isArray(entry.memberKeys) ? entry.memberKeys : [];
    const lookup = [...new Set([canonical, sourceKey, key(title), ...members.map(key)].filter(Boolean))];
    if (entry.hidden === true || own(meta.hidden, canonical) && Boolean(meta.hidden[canonical])) {
      return result('new', null, 'excluded', 'personal', 'Hidden by a rider or coach.', 1);
    }
    if (entry.category === 'foam_pit' || entry.tricktionaryCategory === 'foam' || entry.categoryOverride === 'foam'
      || lookup.some(name => meta.categories[name] === 'foam') || isFoam(title) || isFoam(entry.notes)) {
      return result('foam', null, 'excluded', 'evidence', 'Foam-pit landings stay outside the Tricktionary.', 1);
    }
    const personalKey = lookup.find(name => own(meta.categories, name) && categories.has(key(meta.categories[name])));
    const explicit = categories.has(key(entry.categoryOverride)) ? key(entry.categoryOverride) : null;
    const preservedCategory = personalKey ? key(meta.categories[personalKey]) : explicit;
    const savedSubcategory = lookup.map(name => meta.subcategories[name]).find(value => typeof value === 'string')
      || entry.subcategoryOverride || entry.tricktionarySubcategory;
    if (preservedCategory) {
      const subcategory = preservedCategory === 'new' ? null : validSubcategory(key(savedSubcategory), preservedCategory)
        ? key(savedSubcategory) : subcategoryFor(title, preservedCategory);
      return result(preservedCategory, subcategory, 'preserved', personalKey ? 'personal' : 'entry',
        'Keep the placement chosen for this rider.', 1);
    }

    // Aggregation can provide all obstacle contexts without replacing the
    // original evidence notes used by the existing landing/foam filters.
    const titleContext = obstacles(title), notesContext = obstacles(entry.tricktionaryContextNotes ?? entry.notes);
    if (titleContext.length > 1) return result('new', null, 'needs_sorting', 'title', 'The name mentions more than one obstacle.', 0);
    let category = titleContext[0], source = 'title', confidence = .99;
    if (!category) {
      if (notesContext.length > 1) return result('new', null, 'needs_sorting', 'notes', 'The notes mention more than one obstacle.', 0);
      category = notesContext[0]; source = 'notes'; confidence = .9;
    }
    if (!category) {
      // Explicit structured context is allowed. The old aggregate's guessed
      // tricktionaryCategory and a park's venue name are not obstacle evidence.
      category = [entry.obstacleCategory, entry.tricktionaryContextCategory, entry.category].map(key).find(value => labels[value]);
      source = 'context'; confidence = .99;
    }
    if (!category) return result('new', null, 'needs_sorting', 'none', 'Choose an obstacle; the trick name alone does not establish one.', 0);

    const matches = approvedMatches(title, category, catalog, prepared?.catalog);
    const placements = new Set(matches.map(row => key(row.subcategory) || subcategoryFor(titleOf(row), category)));
    const names = new Set(matches.map(row => key(catalogTitle(titleOf(row), category))));
    const matchingSubcategory = placements.size === 1 ? [...placements][0] : null;
    const chosen = placements.size === 1 && names.size === 1 ? matches[0] : null;
    const subcategory = validSubcategory(key(savedSubcategory), category) ? key(savedSubcategory)
      : validSubcategory(matchingSubcategory, category) ? matchingSubcategory : subcategoryFor(title, category);
    return result(category, subcategory, 'classified', chosen ? 'catalog' : source,
      chosen ? 'Matches an approved crew name for this obstacle.'
        : source === 'title' ? 'The trick name identifies the obstacle.'
          : source === 'notes' ? 'The notes identify the obstacle.' : 'The entry specifies the obstacle.',
      chosen ? 1 : confidence,
      chosen ? { ...(chosen.id ? { catalogId: chosen.id } : {}), suggestedTitle: catalogTitle(titleOf(chosen), category) } : {});
  }

  function organise(entries = [], options = {}) {
    // Compile once per snapshot, with no cross-account or stale-reference cache.
    const prepared = { meta: metadata(options.profile || {}), catalog: compileCatalog(options.catalog || []) };
    return entries.flatMap(entry => {
      const classification = classify(entry, options, prepared);
      if (classification.status === 'excluded') return [];
      return [{ ...entry, tricktionaryCategory: classification.category,
        tricktionarySubcategory: classification.subcategory || '', tricktionaryAuto: classification }];
    });
  }

  function catalogTitle(title, category) {
    const name = String(title || '').trim().replace(/\s+/g, ' ');
    return name && labels[key(category)] && !obstacles(name).length && !isFoam(name)
      ? `${name} · ${labels[key(category)]}` : name;
  }

  function suggestionKey(value) {
    // These equivalents help users select a name; they never merge history.
    return key(value).replace(/\bt[\s-]*bog\b|\btoboggan\b/g, 'toboggan')
      .replace(/\bbar[\s-]*spin\b/g, 'barspin').replace(/\btail[\s-]*whip\b/g, 'tailwhip');
  }

  function suggest(title, catalog = []) {
    const context = obstacles(title);
    if (isFoam(title) || context.length > 1) return [];
    const query = suggestionKey(baseKey(title));
    if (!query) return [];
    return catalogRows(catalog).filter(row => (!context.length || key(row.category) === context[0])
      && rowKeys(row).some(name => suggestionKey(baseKey(name)).startsWith(query)))
      .map(row => ({ ...row, suggestedTitle: catalogTitle(titleOf(row), key(row.category)) }))
      .sort((left, right) => left.suggestedTitle.localeCompare(right.suggestedTitle))
      .slice(0, 12);
  }

  return { classify, organise, suggest, catalogTitle };
});
