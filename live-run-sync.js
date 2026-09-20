(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.JKLiveRunSync = api;
})(typeof globalThis === 'object' ? globalThis : this, function (root) {
  'use strict';
  const fields = Object.freeze(['title','venue','planType','notes','contestItemId','courseSource','imageDataUrl','view']);
  const courseFields = ['contestItemId','courseSource','imageDataUrl'];
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  function equal(a, b) {
    if (a === b) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) return a.length === b.length && a.every((value, index) => equal(value, b[index]));
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every(key => own(b, key) && equal(a[key], b[key]));
  }
  function clone(value) {
    if (Array.isArray(value)) return value.map(clone);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
    return value;
  }
  function uuid() {
    if (typeof root.crypto?.randomUUID === 'function') return root.crypto.randomUUID();
    if (typeof root.crypto?.getRandomValues === 'function') {
      const bytes = root.crypto.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 15) | 64;bytes[8] = (bytes[8] & 63) | 128;
      const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
      return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
    }
    throw new Error('This browser cannot assign a secure route dot ID. Please reopen the app.');
  }
  function pointArray(value) {
    if (value === undefined) return [];
    if (!Array.isArray(value)) throw new Error('Route dots must be an array.');
    if (value.some(point => !point || typeof point !== 'object' || Array.isArray(point))) throw new Error('Each route dot must be an object.');
    return value;
  }
  function ensureIds(points) {
    const source = pointArray(points), reserved = new Set(source.map(point => point.id).filter(id => typeof id === 'string' && id.trim()));
    const used = new Set();
    return source.map(point => {
      const result = clone(point);
      if (typeof result.id !== 'string' || !result.id.trim() || used.has(result.id)) {
        do { result.id = uuid(); } while (reserved.has(result.id) || used.has(result.id));
        reserved.add(result.id);
      }
      used.add(result.id);return result;
    });
  }
  function points(draft) {
    const rows = pointArray(draft?.points), ids = new Set();
    for (const point of rows) {
      if (typeof point.id !== 'string' || !point.id.trim() || ids.has(point.id)) throw new Error('Route dots need unique stable IDs before syncing.');
      ids.add(point.id);
    }
    return rows;
  }
  const rootValue = (draft, key) => draft?.[key] === undefined ? null : draft[key];
  const propertyEqual = (a, b, key) => own(a, key) === own(b, key) && (!own(a, key) || equal(a[key], b[key]));
  function setProperty(target, source, key) {
    if (own(source, key)) Object.defineProperty(target, key, {value:clone(source[key]),writable:true,enumerable:true,configurable:true});
    else delete target[key];
  }
  function retainedOrder(before, after) {
    const oldIds = new Set(before.map(point => point.id)), newIds = new Set(after.map(point => point.id));
    if (!equal(before.filter(point => newIds.has(point.id)).map(point => point.id), after.filter(point => oldIds.has(point.id)).map(point => point.id))) {
      throw new Error('Reordering existing route dots is not supported during live editing.');
    }
  }
  function diff(base, draft) {
    const before = points(base), after = points(draft), oldById = new Map(before.map(point => [point.id, point])), newById = new Map(after.map(point => [point.id, point]));
    retainedOrder(before, after);
    const operations = [];
    for (const key of fields) if (!equal(rootValue(base, key), rootValue(draft, key))) operations.push({op:'set',key,before:clone(rootValue(base,key)),value:clone(rootValue(draft,key))});
    for (const point of before) if (!newById.has(point.id)) operations.push({op:'delete',id:point.id,before:clone(point)});
    after.forEach((point, index) => {
      const previous = oldById.get(point.id);
      if (!previous) operations.push({op:'insert',after:index ? after[index - 1].id : null,value:clone(point)});
      else if (!equal(previous, point)) operations.push({op:'point',id:point.id,before:clone(previous),value:clone(point)});
    });
    return operations;
  }
  function sharedEqual(a, b) {
    return fields.every(key => equal(rootValue(a,key), rootValue(b,key))) && equal(points(a), points(b));
  }
  function routeEqual(a, b) {
    return [...courseFields,'view'].every(key => equal(rootValue(a,key),rootValue(b,key))) && equal(points(a),points(b));
  }
  function rebase(base, local, remote) {
    const before = points(base), desired = points(local), received = points(remote);
    retainedOrder(before, desired);
    const draft = clone(remote || {}), sharedDraft = clone(remote || {}), conflicts = [], marked = new Set();
    draft.points = clone(received);sharedDraft.points = clone(received);
    const conflict = path => {if (!marked.has(path)) {marked.add(path);conflicts.push(path);}};
    for (const key of fields) {
      const oldValue = rootValue(base,key), localValue = rootValue(local,key), remoteValue = rootValue(remote,key);
      if (equal(oldValue,localValue)) continue;
      draft[key] = clone(localValue);
      if (equal(oldValue,remoteValue) || equal(localValue,remoteValue)) sharedDraft[key] = clone(localValue);
      else conflict(key);
    }
    const localCourseChanged = courseFields.some(key => !equal(rootValue(base,key), rootValue(local,key)));
    const remoteCourseChanged = courseFields.some(key => !equal(rootValue(base,key), rootValue(remote,key)));
    const localRouteChanged = !equal(before,desired) || !equal(rootValue(base,'view'),rootValue(local,'view'));
    // The server accepts a course replacement only at its exact global version.
    // Old-photo dot coordinates must never silently land on a different photo.
    const routeConflict = (localCourseChanged && !sharedEqual(base,remote) && !routeEqual(local,remote)) || (remoteCourseChanged && localRouteChanged && !routeEqual(local,remote));
    if (routeConflict) {
      conflict('course');
      for (const key of [...courseFields,'view']) {draft[key] = clone(rootValue(local,key));sharedDraft[key] = clone(rootValue(remote,key));}
      draft.points = clone(desired);sharedDraft.points = clone(received);
      return {draft,sharedDraft,conflicts};
    }
    const oldById = new Map(before.map(point => [point.id, point])), localById = new Map(desired.map(point => [point.id, point]));
    const indexOf = (output, id) => output.points.findIndex(point => point.id === id);
    const remove = (output, id) => {const index = indexOf(output,id);if (index !== -1) output.points.splice(index,1);};
    // If an anchor vanished, retain the local dot at its nearest surviving
    // neighbour in the local-choice draft, and flag the insertion for review.
    function insert(output, point, position, report = true) {
      const anchor = position ? desired[position-1].id : null;
      let index = anchor === null ? 0 : indexOf(output,anchor) + 1;
      if (anchor !== null && index === 0) {
        if (report) conflict(`points.${point.id}.after`);
        for (let i = position - 2; i >= 0; i--) {const found = indexOf(output,desired[i].id);if (found !== -1) {index = found + 1;break;}}
        if (!index) {
          const next = desired.slice(position + 1).map(row => indexOf(output,row.id)).find(found => found !== -1);
          index = next === undefined ? output.points.length : next;
        }
      }
      output.points.splice(index,0,clone(point));
    }
    for (const oldPoint of before) {
      if (localById.has(oldPoint.id)) continue;
      const remotePoint = received.find(point => point.id === oldPoint.id);
      remove(draft,oldPoint.id);
      if (!remotePoint || equal(oldPoint,remotePoint)) remove(sharedDraft,oldPoint.id);
      else conflict(`points.${oldPoint.id}`);
    }
    desired.forEach((localPoint, position) => {
      const oldPoint = oldById.get(localPoint.id), remotePoint = received.find(point => point.id === localPoint.id);
      if (!oldPoint) {
        if (remotePoint) {
          if (!equal(localPoint,remotePoint)) {conflict(`points.${localPoint.id}`);draft.points[indexOf(draft,localPoint.id)] = clone(localPoint);}
          return;
        }
        const anchor = position ? desired[position-1].id : null;
        insert(draft,localPoint,position);
        if (anchor === null || indexOf(sharedDraft,anchor) !== -1) insert(sharedDraft,localPoint,position,false);
        else conflict(`points.${localPoint.id}.after`);
        return;
      }
      if (equal(oldPoint,localPoint)) return;
      if (!remotePoint) {conflict(`points.${localPoint.id}`);insert(draft,localPoint,position);return;}
      const mine = draft.points[indexOf(draft,localPoint.id)], shared = sharedDraft.points[indexOf(sharedDraft,localPoint.id)];
      const keys = new Set([...Object.keys(oldPoint),...Object.keys(localPoint)]);
      for (const key of keys) {
        if (key === 'id' || propertyEqual(oldPoint,localPoint,key)) continue;
        setProperty(mine,localPoint,key);
        if (propertyEqual(oldPoint,remotePoint,key) || propertyEqual(localPoint,remotePoint,key)) setProperty(shared,localPoint,key);
        else conflict(`points.${localPoint.id}.${key}`);
      }
    });
    return {draft,sharedDraft,conflicts};
  }
  return Object.freeze({equal,ensureIds,diff,rebase});
});
