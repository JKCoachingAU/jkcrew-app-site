/* Coach-owned session plans. Private rider lists are kept only in memory. */
(() => {
  "use strict";
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const dateLabel = (date, opts = {}) => new Intl.DateTimeFormat("en-AU", {day:"numeric",month:"short",...opts,timeZone:"UTC"}).format(new Date(`${date}T12:00:00Z`));
  const timeLabel = time => time ? new Intl.DateTimeFormat("en-AU",{hour:"numeric",minute:"2-digit",timeZone:"UTC"}).format(new Date(`2000-01-01T${time.length===5?time+":00":time}Z`)) : "";
  const monthStart = value => value.slice(0,7)+"-01";
  const shiftMonth = (date, direction) => { const next = new Date(`${date}T12:00:00Z`); next.setUTCMonth(next.getUTCMonth()+direction); return next.toISOString().slice(0,10); };
  const fingerprint = draft => JSON.stringify([draft.session_date,draft.start_time||"",draft.venue,[...draft.rider_ids].sort()]);
  const message = error => error?.code === "55000" ? "This session was removed. Your edits are still here. Close this form and refresh your session list." : /stale|changed|conflict/i.test(error?.message||"") ? "This session changed elsewhere. Your edits are still here. Close this form and refresh to see the latest saved session before editing again." : ["42501","PGRST301","PGRST302"].includes(error?.code) ? "Your access could not be confirmed. Your edits are still here. Check that you’re signed in to your coach account and try again." : "We couldn’t confirm the save. Your edits are still here. Check your connection and try again; a retry won’t create another session.";

  function mount(root, config = {}) {
    if (!(root instanceof Element)) throw new Error("A session tracker container is required");
    const allowed = !!config.userId && ["coach","admin"].includes(config.role);
    const today = /^\d{4}-\d{2}-\d{2}$/.test(config.today||"") ? config.today : new Date().toISOString().slice(0,10);
    let month=monthStart(today), stopped=false, loading=false, loaded=false, loadError="", sequence=0, offset=0, hasMore=false;
    let sessions=[], roster=[], locations=[], venue="", riderId="", editor=null, notice="", undo=null, undoBusy=false, focusBack=null;
    const pending = new Set();
    const opened = new Set();
    const active = () => !stopped && root.isConnected && (!config.isActive || config.isActive());
    const dirty = () => !!editor && (fingerprint(editor.draft)!==editor.initial || !!editor.locationDraft.trim());
    const hasUnsavedChanges = () => dirty() || !!editor?.saving || !!editor?.adding;
    const find = id => roster.find(r=>r.id===id);
    const riderName = id => find(id)?.display_name || "Previously linked rider";
    const ids = row => Array.isArray(row.rider_ids) ? [...new Set(row.rider_ids)] : [];
    const orderedRiders = () => [...roster].sort((a,b)=>(a.display_name||"").localeCompare(b.display_name||""));
    const button = (action, label, classes="", attrs="") => `<button type="button" class="st-button ${classes}" data-action="${action}" ${attrs}>${label}</button>`;
    function request(fn) {
      return new Promise((resolve,reject) => {
        const cancel=()=>{clearTimeout(timer);pending.delete(cancel);reject(new Error("Tracker closed"));};
        const timer=setTimeout(()=>{pending.delete(cancel);reject(new Error("Request timed out"));},18000);
        pending.add(cancel);
        Promise.resolve().then(fn).then(value=>{clearTimeout(timer);pending.delete(cancel);resolve(value);},error=>{clearTimeout(timer);pending.delete(cancel);reject(error);});
      });
    }
    function beforeUnload(event) { if (hasUnsavedChanges()) { event.preventDefault(); event.returnValue=""; } }
    root.classList.add("session-tracker");
    root.innerHTML=`<div data-session-tracker-content></div><dialog class="st-dialog" aria-labelledby="st-editor-title"></dialog>`;
    const content=root.querySelector("[data-session-tracker-content]");
    const dialog=root.querySelector("dialog");

    function rowHtml(row) {
      const selected=ids(row), status=row.session_date===today?"Today":row.session_date>today?"Planned":"Saved";
      return `<details class="st-session" data-session-id="${esc(row.id)}"${opened.has(row.id)?" open":""}><summary><span class="st-date"><span>${esc(dateLabel(row.session_date,{month:"short",day:undefined}))}</span><strong>${esc(dateLabel(row.session_date,{day:"numeric",month:undefined}))}</strong></span><span class="st-session-title"><strong>${esc(row.venue)}</strong><span>${esc(dateLabel(row.session_date,{weekday:"short"}))}${row.start_time?` · ${esc(timeLabel(row.start_time))}`:""} · ${selected.length} ${selected.length===1?"rider":"riders"}</span></span><span class="st-status${status==="Today"?" is-today":""}">${status}</span><span class="st-chevron" aria-hidden="true">⌄</span></summary><div class="st-session-body"><div class="st-rider-names">${selected.map(id=>`<span>${esc(riderName(id))}</span>`).join("")}</div>${button("edit-session","Edit session","",`data-id="${esc(row.id)}"`)}</div></details>`;
    }
    function render() {
      if (!active()) return;
      root.querySelectorAll(".st-session").forEach(el=>opened[el.open?"add":"delete"](el.dataset.sessionId));
      if (!allowed) { content.innerHTML='<div class="st-empty"><h2>Coach access required</h2><p>Sign in to your coach account to manage sessions.</p></div>'; return; }
      content.innerHTML=`<header class="st-header"><div><span class="st-eyebrow">Coach Tools</span><h1>Session Tracker</h1><p>Where you’re coaching. Who’s riding.</p></div>${button("new-session","＋ New session","is-primary",!loaded?'disabled':"")}</header><section class="st-panel" aria-label="Your sessions"><div class="st-toolbar"><div class="st-month">${button("previous-month","‹","st-square",'aria-label="Previous month"'+(loading?' disabled':""))}<h2>${esc(dateLabel(month,{month:"long",year:"numeric",day:undefined}))}</h2>${button("next-month","›","st-square",'aria-label="Next month"'+(loading?' disabled':""))}</div>${button("refresh",loading?"Loading…":"↻ Refresh","",loading?'disabled aria-busy="true"':"")}</div><div class="st-filters"><label>Location<select data-filter="venue"${loading||!loaded?" disabled":""}><option value="">All locations</option>${[...new Set([...locations.map(l=>l.name),...sessions.map(s=>s.venue),...(venue?[venue]:[])])].sort().map(name=>`<option value="${esc(name)}"${name===venue?" selected":""}>${esc(name)}</option>`).join("")}</select></label><label>Rider<select data-filter="rider"${loading||!loaded?" disabled":""}><option value="">All riders</option>${orderedRiders().map(r=>`<option value="${esc(r.id)}"${r.id===riderId?" selected":""}>${esc(r.display_name||"Rider")}</option>`).join("")}</select></label></div><div class="st-feedback" role="status">${esc(notice)}${undo?button("undo-archive",undoBusy?"Restoring…":"Undo","st-text",undoBusy?'disabled':""):""}</div>${loadError?`<div class="st-error" role="alert">${esc(loadError)} ${button("refresh","Try again")}</div>`:""}<div class="st-list" aria-busy="${loading}">${sessions.length?sessions.map(rowHtml).join(""):loading?'<div class="st-empty" role="status">Loading sessions…</div>':loaded?`<div class="st-empty"><span aria-hidden="true">◷</span><h3>${venue||riderId?"No matching sessions":"No sessions this month"}</h3><p>${venue||riderId?"Try a different location or rider.":"Add a location, choose your riders and save your session."}</p></div>`:""}</div>${hasMore?button("load-more",loading?"Loading…":"Load more sessions","st-load-more",loading?'disabled':""):""}</section>`;
    }
    async function load(more=false,refreshContext=false) {
      if (!allowed || !active()) return false;
      const seq=++sequence, nextOffset=more?offset+30:0;
      loading=true;loadError="";render();
      try {
        const next=await request(()=>config.load({from:month,to:shiftMonth(month,1),offset:nextOffset,venue,riderId,refreshContext}));
        if (!active()||seq!==sequence) return false;
        if (!next || !Array.isArray(next.sessions)||!Array.isArray(next.roster)||!Array.isArray(next.locations)) throw new Error("Invalid sessions");
        sessions=[...new Map([...(more?sessions:[]),...next.sessions.filter(r=>r&&typeof r.id==="string"&&!r.archived_at)].map(r=>[r.id,r])).values()];
        roster=next.roster;locations=next.locations;hasMore=!!next.hasMore;offset=nextOffset;loaded=true;
        return true;
      } catch(error) {
        if(active()&&seq===sequence) {
          if (["42501","PGRST301","PGRST302"].includes(error?.code)) { sessions=[];roster=[];locations=[];loaded=false; }
          loadError="Your sessions couldn’t load. Check your connection and try again.";
        }
        return false;
      } finally { if(active()&&seq===sequence) { loading=false;render(); } }
    }
    function locationOptions(selected) {
      return `<option value="">Choose a location</option>${[...new Set([...locations.map(l=>l.name),...(selected?[selected]:[])])].sort().map(name=>`<option value="${esc(name)}"${name===selected?" selected":""}>${esc(name)}</option>`).join("")}`;
    }
    function pickerLabel() { return editor?.draft.rider_ids.length ? `${editor.draft.rider_ids.length} ${editor.draft.rider_ids.length===1?"rider":"riders"} selected` : "Choose riders"; }
    function openEditor(row) {
      if(!active()||!allowed||!loaded||editor) return;
      focusBack=document.activeElement;
      const draft={id:row?.id||crypto.randomUUID(),session_date:row?.session_date||today,start_time:row?.start_time?.slice(0,5)||"",venue:row?.venue||venue||"",rider_ids:row?ids(row):[],updated_at:row?.updated_at||null};
      editor={draft,initial:fingerprint(draft),saved:!!row,saving:false,adding:false,locationDraft:"",error:""};
      const choices=[...orderedRiders(),...draft.rider_ids.filter(id=>!find(id)).map(id=>({id,display_name:"Previously linked rider"}))];
      dialog.innerHTML=`<form class="st-form"><header class="st-dialog-header"><div><span class="st-eyebrow">Session Tracker</span><h2 id="st-editor-title">${row?"Edit session":"New session"}</h2></div>${button("cancel-session","×","st-square",'aria-label="Close session form"')}</header><fieldset class="st-fields"><div class="st-date-time"><label>Date<input type="date" data-field="session-date" value="${esc(draft.session_date)}" required></label><label>Time <small>(optional)</small><input type="time" data-field="start-time" value="${esc(draft.start_time)}"></label></div><label for="st-venue">Location</label><div class="st-location-control"><select id="st-venue" data-field="venue" required>${locationOptions(draft.venue)}</select>${button("add-location","＋","st-square",'aria-label="Add a new location" aria-expanded="false" aria-controls="st-add-location"')}</div><div id="st-add-location" class="st-add-location" hidden><label>New location<input data-field="new-location" maxlength="80" placeholder="Park or venue name" autocomplete="off"></label>${button("save-location","Add location")}<p class="st-location-error" role="alert"></p></div><label>Riders</label><details class="st-picker"><summary><span data-picker-label>${pickerLabel()}</span><span class="st-chevron" aria-hidden="true">⌄</span></summary><div class="st-picker-body"><input type="search" data-field="rider-search" placeholder="Find a rider" aria-label="Find a rider" autocomplete="off"><div class="st-rider-options">${choices.length?choices.map(r=>`<label class="st-rider-option" data-rider-name="${esc((r.display_name||"Rider").toLowerCase())}"><input type="checkbox" name="rider" value="${esc(r.id)}"${draft.rider_ids.includes(r.id)?" checked":""}><span>${esc(r.display_name||"Rider")}</span></label>`).join(""):'<p>No linked riders yet. Add riders from the Riders page first.</p>'}</div><p data-rider-empty hidden>No riders match your search.</p></div></details><p class="st-selected" data-selected-riders>${esc(draft.rider_ids.map(riderName).join(", "))}</p></fieldset><p class="st-form-error" role="alert"></p><footer class="st-dialog-footer">${row?button("archive-session","Remove session","st-danger"):button("cancel-session","Cancel")}<button type="submit" class="st-button is-primary" data-action="save-session">Save session</button></footer></form>`;
      dialog.showModal();
      dialog.querySelector('[data-field="session-date"]').focus();
    }
    function closeEditor(force=false) {
      if(!editor) return true;
      if(!force && (editor.saving||editor.adding)) return false;
      if(!force && dirty()&&!window.confirm("Discard your unsaved session changes?")) return false;
      dialog.close();dialog.innerHTML="";editor=null;
      if(focusBack?.isConnected) focusBack.focus();
      return true;
    }
    function editorState() {
      if(!editor||!active())return;
      dialog.querySelector("fieldset").disabled=editor.saving||editor.adding;
      dialog.querySelectorAll("button").forEach(b=>b.disabled=editor.saving||editor.adding);
      dialog.querySelector('[data-action="save-session"]').textContent=editor.saving?"Saving…":"Save session";
      dialog.querySelector('[data-action="save-location"]').textContent=editor.adding?"Adding…":"Add location";
      dialog.querySelector(".st-form-error").textContent=editor.error;
      dialog.querySelector("form").setAttribute("aria-busy",String(editor.saving||editor.adding));
    }
    async function saveSession() {
      if(!active()||!allowed||!editor||editor.saving||editor.adding) return;
      const current=editor;
      if(current.locationDraft.trim()) {
        current.error="Add your new location first, or clear its name to keep the selected location.";
        dialog.querySelector("#st-add-location").hidden=false;
        dialog.querySelector('[data-action="add-location"]').setAttribute("aria-expanded","true");
        editorState();dialog.querySelector('[data-field="new-location"]').focus();return;
      }
      if(!current.draft.venue.trim()||!current.draft.session_date||!current.draft.rider_ids.length) {current.error="Choose a date, location and at least one rider.";editorState();return;}
      current.saving=true;current.error="";editorState();
      try {
        const saved=await request(()=>config.save({...current.draft,rider_ids:[...current.draft.rider_ids]}));
        if(!active()||editor!==current) return;
        if(!saved?.id)throw new Error("Save not confirmed");
        month=monthStart(saved.session_date||current.draft.session_date);venue="";riderId="";
        notice=current.saved?"Session updated.":"Session saved.";undo=null;opened.add(saved.id);closeEditor(true);
        await load();
      } catch(error) { if(active()&&editor===current)current.error=message(error); }
      finally { if(active()&&editor===current){current.saving=false;editorState();} }
    }
    async function addLocation() {
      if(!active()||!allowed||!editor||editor.saving||editor.adding) return;
      const current=editor, name=current.locationDraft.trim().replace(/\s+/g," "),errorEl=dialog.querySelector(".st-location-error");
      if(!name) {errorEl.textContent="Enter a location name.";return;}
      current.adding=true;errorEl.textContent="";editorState();
      try {
        const saved=await request(()=>config.addLocation(name));
        if(!active()||editor!==current) return;
        if(!saved?.name)throw new Error("Location not confirmed");
        if(!locations.some(l=>l.name===saved.name))locations.push(saved);
        current.draft.venue=saved.name;current.locationDraft="";
        dialog.querySelector('[data-field="venue"]').innerHTML=locationOptions(saved.name);
        dialog.querySelector('[data-field="new-location"]').value="";
        dialog.querySelector("#st-add-location").hidden=true;
        dialog.querySelector('[data-action="add-location"]').setAttribute("aria-expanded","false");
      } catch { if(active()&&editor===current)errorEl.textContent="That location couldn’t be saved. Your name is still here—try again."; }
      finally { if(active()&&editor===current){current.adding=false;editorState();} }
    }
    async function archiveSession() {
      if(!active()||!allowed||!editor?.saved||editor.saving||editor.adding) return;
      if(!window.confirm("Remove this session from the tracker? You can undo this after removing it."))return;
      const current=editor;current.saving=true;current.error="";editorState();
      try {
        const saved=await request(()=>config.archive({...current.draft},true));
        if(!active()||editor!==current)return;
        if(!saved?.id)throw new Error("Removal not confirmed");
        undo=saved;notice="Session removed.";closeEditor(true);await load();
      } catch(error) {if(active()&&editor===current)current.error=message(error);}
      finally {if(active()&&editor===current){current.saving=false;editorState();}}
    }
    async function restore() {
      if(!active()||!allowed||!undo||undoBusy)return;
      undoBusy=true;render();
      try {
        const restored=await request(()=>config.archive(undo,false));
        if(!active())return;
        if(!restored?.id)throw new Error("Restore not confirmed");
        month=monthStart(restored.session_date);venue="";riderId="";undo=null;notice="Session restored.";await load();
      } catch {if(active())notice="Couldn’t restore the session. Try Undo again.";}
      finally {if(active()){undoBusy=false;render();}}
    }
    function input(event) {
      if(!editor||!active()||editor.saving||editor.adding)return;
      const el=event.target, field=el.dataset.field;
      if(field==="session-date")editor.draft.session_date=el.value;
      if(field==="start-time")editor.draft.start_time=el.value;
      if(field==="venue")editor.draft.venue=el.value;
      if(field==="new-location")editor.locationDraft=el.value;
      if(el.name==="rider") {
        const next=new Set(editor.draft.rider_ids);next[el.checked?"add":"delete"](el.value);editor.draft.rider_ids=[...next];
        dialog.querySelector("[data-picker-label]").textContent=pickerLabel();
        dialog.querySelector("[data-selected-riders]").textContent=editor.draft.rider_ids.map(riderName).join(", ");
      }
      if(field==="rider-search") {
        let shown=0;
        dialog.querySelectorAll(".st-rider-option").forEach(row=>{row.hidden=!row.dataset.riderName.includes(el.value.toLowerCase().trim());if(!row.hidden)shown++;});
        dialog.querySelector("[data-rider-empty]").hidden=shown>0;
      }
    }
    function change(event) {
      const key=event.target.dataset.filter;
      if(!key||!active()||!allowed)return;
      if(key==="venue")venue=event.target.value;else riderId=event.target.value;
      sessions=[];notice="";load();
    }
    function click(event) {
      const el=event.target.closest("[data-action]");
      if(!el||!root.contains(el)||el.disabled||!active()||!allowed)return;
      const action=el.dataset.action;
      if(action==="new-session")openEditor();
      if(action==="edit-session")openEditor(sessions.find(s=>s.id===el.dataset.id));
      if(action==="cancel-session")closeEditor();
      if(action==="previous-month"||action==="next-month") {month=shiftMonth(month,action==="previous-month"?-1:1);sessions=[];notice="";load();}
      if(action==="refresh")load(false,true);
      if(action==="load-more")load(true);
      if(action==="archive-session")archiveSession();
      if(action==="undo-archive")restore();
      if(action==="add-location"&&editor) {const box=dialog.querySelector("#st-add-location");box.hidden=!box.hidden;el.setAttribute("aria-expanded",String(!box.hidden));if(!box.hidden)box.querySelector("input").focus();}
      if(action==="save-location")addLocation();
    }
    function submit(event){event.preventDefault();saveSession();}
    function keydown(event){if(event.key!=="Enter")return;const field=event.target.dataset.field;if(field==="new-location"){event.preventDefault();addLocation();}if(field==="rider-search")event.preventDefault();}
    function cancel(event){event.preventDefault();closeEditor();}
    root.addEventListener("click",click);root.addEventListener("input",input);root.addEventListener("change",change);
    dialog.addEventListener("submit",submit);dialog.addEventListener("keydown",keydown);dialog.addEventListener("cancel",cancel);
    window.addEventListener("beforeunload",beforeUnload);
    render();
    const ready=allowed?load():Promise.resolve(false);
    return {ready,hasUnsavedChanges,destroy(){if(stopped)return;stopped=true;sequence++;for(const cancel of [...pending])cancel();if(dialog.open)dialog.close();root.removeEventListener("click",click);root.removeEventListener("input",input);root.removeEventListener("change",change);dialog.removeEventListener("submit",submit);dialog.removeEventListener("keydown",keydown);dialog.removeEventListener("cancel",cancel);window.removeEventListener("beforeunload",beforeUnload);editor=null;sessions=[];roster=[];locations=[];root.classList.remove("session-tracker");root.innerHTML="";}};
  }
  window.JKCSessionTracker={mount};
})();
