/* Shared, versioned cosmetic choices. Normalisation never writes a saved build. */
const JKCrewBikeConfig = (() => {
  'use strict';
  const legacyParts = ['frame','fork','bars','grips','rims','hubs','seat','pedals','cranks','sprocket'];
  const hardwareParts = ['seatpost','stem','headset','spokes','nipples','pegs'];
  const metalParts = Object.freeze(['frame','fork','bars','rims','hubs','cranks','sprocket','seatpost','stem','headset','pegs']);
  const finishOptions = Object.freeze(['gloss','matte','chrome','raw','jetfuel']);
  const seatDesignIds = Object.freeze(['solid', ...Array.from({length:50}, (_, index) => `design-${String(index + 1).padStart(2,'0')}`)]);
  const options = Object.freeze({
    barStyle: ['two-piece','four-piece'], tyreStyle: ['white','black','tan-wall','white-wall'],
    seatStyle: ['slim','padded'], pegs: ['none','rear','both','four'], decal: ['none','jkcrew','lightning'],
    framePaint: ['solid','fade'], pedalMaterial: ['plastic','metal'], brakeStyle: ['none','rear','dual'],
    spokeStyle: ['standard','rainbow'], stemStyle: ['top-load','front-load'], seatDesign: seatDesignIds
  });
  const defaults = Object.freeze({
    version: 2,
    colors: Object.freeze(Object.fromEntries([
      ...legacyParts.map(part => [part, '#F1F4F8']),
      ...hardwareParts.map(part => [part, '#BCC7D6'])
    ])),
    barStyle: 'two-piece', tyreStyle: 'white', seatStyle: 'slim', pegs: 'none', decal: 'none',
    finishes: Object.freeze(Object.fromEntries(metalParts.map(part => [part, hardwareParts.includes(part) ? 'chrome' : 'gloss']))),
    framePaint: 'solid', frameFadeColor: '#AD8AFF', pedalMaterial: 'plastic',
    brakeStyle: 'none', spokeStyle: 'standard', stemStyle: 'top-load', seatDesign: 'solid'
  });
  const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key) ? value[key] : undefined;
  const colour = (value, fallback) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toUpperCase() : fallback;
  function normalize(value) {
    const source = object(value), colors = object(own(source, 'colors')), finishes = object(own(source, 'finishes'));
    const result = { ...defaults, colors: {}, finishes: {} };
    for (const [part, fallback] of Object.entries(defaults.colors)) result.colors[part] = colour(own(colors, part), fallback);
    for (const part of metalParts) {
      const finish = own(finishes, part);
      result.finishes[part] = finishOptions.includes(finish) ? finish : defaults.finishes[part];
    }
    for (const [key, values] of Object.entries(options)) {
      const choice = own(source, key);
      result[key] = values.includes(choice) ? choice : defaults[key];
    }
    result.frameFadeColor = colour(own(source, 'frameFadeColor'), defaults.frameFadeColor);
    return result;
  }
  return Object.freeze({defaults, normalize, metalParts, finishOptions, seatDesignIds});
})();
globalThis.JKCrewBikeConfig = JKCrewBikeConfig;
