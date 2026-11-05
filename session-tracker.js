/* Coach-owned session plans. Private rider lists are kept only in memory. */
(() => {
  "use strict";
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const dateLabel = (date, opts = {}) => new Intl.DateTimeFormat("en-AU", {day:"numeric",month:"short",...opts,timeZone:"UTC"}).format(new Date(`${date}T12:00:00Z`));
  const timeLabel = time => time ? new Intl.DateTimeFormat("en-AU",{hour:"numeric",minute:"2-digit",timeZone:"UTC"}).format(new Date(`2000-01-01T${time.length===5?time+":00":time}Z`)) : "";
  const monthStart = value => value.slice(0,7)+"-01";
  const shiftMonth = (date, direction) => { const next = new Date(`${date}T12:00:00Z`); next.setUTCMonth(next.getUTCMonth()+direction); return next.toISOString().slice(0,10); };
  const shiftDay = (date, days) => { const next=new Date(`${date}T12:00:00Z`);next.setUTCDate(next.getUTCDate()+days);return next.toISOString().slice(0,10); };
  const monday = date => shiftDay(date,-((new Date(`${date}T12:00:00Z`).getUTCDay()+6)%7));
  const money = cents => new Intl.NumberFormat("en-AU",{style:"currency",currency:"AUD"}).format(cents/100);
  const feeTotal = row => (Number.isInteger(row.park_fee_cents)?row.park_fee_cents:0)*(row.park_fee_basis==="session"?1:new Set(row.rider_ids||[]).size);
  const sumFees = rows => rows.reduce((total,row)=>total+feeTotal(row),0);
  const parseFee = value => /^(?:\d{1,5})(?:\.\d{1,2})?$/.test(value.trim())&&Number(value)<=10000 ? Math.round(Number(value)*100) : value.trim()===""?0:null;
  const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value||"") && Number.isFinite(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0,10)===value;
  const fingerprint = draft => JSON.stringify([draft.session_date,draft.start_time||"",draft.venue,[...(draft.rider_ids||[])].sort(),draft.block_id||"",draft.park_fee_cents||0,draft.park_fee_basis||"per_rider",draft.name||"",draft.start_date||"",draft.session_kind||"regular",draft.session_completed===true,draft.extra_fee_cents??null,draft.park_fee_paid_by_coach===true,draft.invoice_date||"",draft.invoice_status||"expected"]);
  const message = error => error?.code === "55000" ? "This session was removed. Your edits are still here. Close this form and refresh your session list." : /stale|changed|conflict/i.test(error?.message||"") ? "This session changed elsewhere. Your edits are still here. Close this form and refresh to see the latest saved session before editing again." : ["42501","PGRST301","PGRST302"].includes(error?.code) ? "Your access could not be confirmed. Your edits are still here. Check that you’re signed in to your coach account and try again." : "We couldn’t confirm the save. Your edits are still here. Check your connection and try again; a retry won’t create another session.";

  function mount(root, config = {}) {
    if (!(root instanceof Element)) throw new Error("A session tracker container is required");
    const allowed = !!config.userId && ["coach","admin"].includes(config.role);
    const today = /^\d{4}-\d{2}-\d{2}$/.test(config.today||"") ? config.today : new Date().toISOString().slice(0,10);
    let month=monthStart(today), stopped=false, loading=false, loaded=false, loadError="", sequence=0, offset=0, hasMore=false;
    let datasetKey="";
    let sessions=[], roster=[], locations=[], blocks=[], blockId="", initialSelection=true, venue="", riderId="", editor=null, notice="", undo=null, undoBusy=false, focusBack=null;
    const pending = new Set();
    const opened = new Set();
    const active = () => !stopped && root.isConnected && (!config.isActive || config.isActive());
    const dirty = () => !!editor && (fingerprint(editor.draft)!==editor.initial || !!editor.locationDraft.trim() || (editor.kind==="session" && (editor.feeText!==editor.initialFeeText || editor.extraFeeText!==editor.initialExtraFeeText)));
    const hasUnsavedChanges = () => dirty() || !!editor?.saving || !!editor?.adding;
    const find = id => roster.find(r=>r.id===id);
    const riderName = id => find(id)?.display_name || "Previously linked rider";
    const ids = row => Array.isArray(row.rider_ids) ? [...new Set(row.rider_ids)] : [];
    const dataIdentity = () => blockId?`block:${blockId}`:`month:${month}|${venue}|${riderId}`;
    const dataReady = () => datasetKey===dataIdentity();
    const currentBlock = () => blocks.find(b=>b.id===blockId);
    const sortedBlocks = () => [...blocks].sort((a,b)=>b.start_date.localeCompare(a.start_date)||a.name.localeCompare(b.name));
    const filteredSessions = () => sessions.filter(row=>(!venue||row.venue===venue)&&(!riderId||ids(row).includes(riderId)));
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
      const selected=ids(row), status=row.session_completed?"Completed":row.session_date===today?"Today":row.session_date>today?"Planned":"Saved", fee=feeTotal(row);
      return `<details class="st-session" data-session-id="${esc(row.id)}"${opened.has(row.id)?" open":""}><summary><span class="st-date"><span>${esc(dateLabel(row.session_date,{weekday:"short",month:undefined,day:undefined}))}</span><strong>${esc(dateLabel(row.session_date,{day:"numeric",month:undefined}))}</strong></span><span class="st-session-main"><span class="st-session-title"><strong>${esc(row.venue)}</strong><span>${esc(dateLabel(row.session_date))}${row.start_time?` · ${esc(timeLabel(row.start_time))}`:""}${fee?`<b class="st-mobile-fee"> · ${money(fee)}</b>`:""}</span></span><span class="st-inline-riders">${esc(selected.map(riderName).join(", "))}</span></span><span class="st-row-meta"><span class="st-status${status==="Today"?" is-today":""}">${status}</span>${fee?`<strong class="st-row-fee">${money(fee)}</strong>`:""}</span><span class="st-chevron" aria-hidden="true">⌄</span></summary><div class="st-session-body"><div class="st-session-details"><span class="st-session-detail">${selected.length} ${selected.length===1?"rider":"riders"}${fee?` · ${money(row.park_fee_cents)} ${row.park_fee_basis==="session"?"session park fee":`park entry × ${selected.length} = ${money(fee)}`}`:" · No park fee"}</span><span class="st-cost-status">${row.session_kind==="additional"?`Additional session · Extra coaching ${row.extra_fee_cents==null?"price TBC":`${money(row.extra_fee_cents)} per rider`}`:"Regular session"} · ${row.session_completed?"Completed":"Not marked complete"}</span>${fee?`<span class="st-cost-status">Park entry: ${row.park_fee_paid_by_coach?"paid by coach":"not marked paid by coach"}</span>`:""}<span class="st-cost-status">${row.invoice_status==="paid"?"Paid recorded":row.invoice_status==="invoiced"?"Already invoiced":"Expected invoice"}${row.invoice_date?` · ${esc(dateLabel(row.invoice_date,{year:"numeric"}))}`:" · Date TBC"}</span></div>${button("edit-session","Edit session","",`data-id="${esc(row.id)}"`)}</div></details>`;
    }
    function blockHtml(block) {
      const shown=dataReady()?filteredSessions():[], filtered=!!(venue||riderId);
      return [[1,4],[5,8],[9,10]].map(([start,end],index)=>{
        const groupRows=shown.filter(row=>row.session_date>=shiftDay(block.start_date,(start-1)*7)&&row.session_date<shiftDay(block.start_date,end*7));
        return `<section class="st-week-group st-group-${index}" aria-label="Weeks ${start} to ${end}"><header class="st-group-header"><h2>Weeks ${start}–${end}</h2><span>${filtered?"Matching sessions · park fees":"Park fees"} <strong>${dataReady()?money(sumFees(groupRows)):"—"}</strong></span></header>${Array.from({length:end-start+1},(_,i)=>{
          const week=start+i, date=shiftDay(block.start_date,(week-1)*7), next=shiftDay(date,7), rows=shown.filter(row=>row.session_date>=date&&row.session_date<next);
          const days=[...new Set([date,shiftDay(date,1),shiftDay(date,2),...rows.map(row=>row.session_date)])].sort();
          return `<section class="st-week" data-week="${week}"><header class="st-week-heading"><div><h3>Week ${week}</h3><span>${esc(dateLabel(date))}–${esc(dateLabel(shiftDay(date,6)))}</span></div>${[1,4,8].includes(week)?'<span class="st-invoice">Invoice week</span>':""}<span class="st-week-total">${dataReady()?money(sumFees(rows)):"—"}</span></header><div class="st-week-sessions">${days.map(day=>{
            const matches=rows.filter(row=>row.session_date===day);
            return matches.length?matches.map(rowHtml).join(""):filtered?"":`<div class="st-day-slot"><span>${esc(dateLabel(day,{weekday:"long",day:undefined,month:undefined}))} <small>${esc(dateLabel(day))}</small></span>${button("add-day","＋ Add session","st-text",`data-date="${day}" aria-label="Add session on ${esc(dateLabel(day,{weekday:"long"}))}"${loading?" disabled":""}`)}</div>`;
          }).join("")}${filtered&&!rows.length?'<p class="st-no-match">No matching sessions</p>':""}<div class="st-extra">${button("add-day","＋ Extra session","st-text",`data-date="${date}" data-kind="additional" aria-label="Add an extra session in week ${week}"${loading?" disabled":""}`)}</div></div></section>`;
        }).join("")}</section>`;
      }).join("");
    }
    function render() {
      if (!active()) return;
      root.querySelectorAll(".st-session").forEach(el=>opened[el.open?"add":"delete"](el.dataset.sessionId));
      if (!allowed) { content.innerHTML='<div class="st-empty"><h2>Coach access required</h2><p>Sign in to your coach account to manage sessions.</p></div>'; return; }
      const block=currentBlock(), shown=block?filteredSessions():sessions;
      content.innerHTML=`<header class="st-header"><div><span class="st-eyebrow">Coach Tools</span><h1>Session Tracker</h1><p>Where you’re coaching. Who’s riding.</p></div><div class="st-header-actions">${button("new-block","＋ New block","",!loaded||loading?'disabled':"")}${button("new-session","＋ New session","is-primary",!loaded||loading?'disabled':"")}</div></header><section class="st-panel" aria-label="Your sessions"><div class="st-block-selector"><label>Training block<select data-filter="block"${loading||!loaded?" disabled":""}><option value="">All sessions · by month</option>${sortedBlocks().map(b=>`<option value="${esc(b.id)}"${b.id===blockId?" selected":""}>${esc(b.name)} · ${esc(dateLabel(b.start_date,{year:"numeric"}))}</option>`).join("")}</select></label>${block?button("edit-block","Edit block","st-text",loading?"disabled":""):""}</div><div class="st-toolbar">${block?`<div class="st-block-title"><h2>${esc(block.name)}</h2><p>${esc(dateLabel(block.start_date,{year:"numeric"}))} – ${esc(dateLabel(shiftDay(block.start_date,69),{year:"numeric"}))}</p></div>`:`<div class="st-month">${button("previous-month","‹","st-square",'aria-label="Previous month"'+(loading?' disabled':""))}<h2>${esc(dateLabel(month,{month:"long",year:"numeric",day:undefined}))}</h2>${button("next-month","›","st-square",'aria-label="Next month"'+(loading?' disabled':""))}</div>`}${button("refresh",loading?"Loading…":"↻ Refresh","",loading?'disabled aria-busy="true"':"")}</div>${block?`<div class="st-block-summary"><div><span>Block park fees · AUD</span><strong data-block-total>${dataReady()?money(sumFees(sessions)):"—"}</strong></div><div><span>Saved sessions</span><strong>${dataReady()?sessions.length:"—"}</strong></div><div class="st-invoice-summary"><span>Invoice weeks</span><strong>1 <i>·</i> 4 <i>·</i> 8</strong></div></div>`:!blocks.length&&loaded?'<p class="st-block-hint">Create a 10-week block to plan Monday, Tuesday and Wednesday sessions, with room for extras.</p>':""}<div class="st-filters"><label>Location<select data-filter="venue"${loading||!loaded?" disabled":""}><option value="">All locations</option>${[...new Set([...locations.map(l=>l.name),...sessions.map(s=>s.venue),...(venue?[venue]:[])])].sort().map(name=>`<option value="${esc(name)}"${name===venue?" selected":""}>${esc(name)}</option>`).join("")}</select></label><label>Rider<select data-filter="rider"${loading||!loaded?" disabled":""}><option value="">All riders</option>${orderedRiders().map(r=>`<option value="${esc(r.id)}"${r.id===riderId?" selected":""}>${esc(r.display_name||"Rider")}</option>`).join("")}</select></label></div><div class="st-feedback" role="status">${esc(notice)}${undo?button("undo-archive",undoBusy?"Restoring…":"Undo","st-text",undoBusy?'disabled':""):""}</div>${loadError?`<div class="st-error" role="alert">${esc(loadError)} ${button("refresh","Try again")}</div>`:""}<div class="st-list" aria-busy="${loading}">${block?blockHtml(block):shown.length?shown.map(rowHtml).join(""):loading?'<div class="st-empty" role="status">Loading sessions…</div>':loaded?`<div class="st-empty"><span aria-hidden="true">◷</span><h3>${venue||riderId?"No matching sessions":"No sessions this month"}</h3><p>${venue||riderId?"Try a different location or rider.":"Add a location, choose your riders and save your session."}</p></div>`:""}</div>${hasMore&&!block?button("load-more",loading?"Loading…":"Load more sessions","st-load-more",loading?'disabled':""):""}</section>`;
    }
    async function load(more=false,refreshContext=false) {
      if (!allowed || !active()) return false;
      const seq=++sequence, nextOffset=more?offset+30:0, block=currentBlock();
      loading=true;loadError="";render();
      try {
        const next=await request(()=>config.load({from:block?.start_date||month,to:block?shiftDay(block.start_date,70):shiftMonth(month,1),offset:nextOffset,venue:block?"":venue,riderId:block?"":riderId,refreshContext,...(blockId?{blockId}: {})}));
        if (!active()||seq!==sequence) return false;
        if (!next || !Array.isArray(next.sessions)||!Array.isArray(next.roster)||!Array.isArray(next.locations)) throw new Error("Invalid sessions");
        if(blockId&&next.hasMore)throw new Error("Incomplete training block");
        roster=next.roster;locations=next.locations;blocks=Array.isArray(next.blocks)?next.blocks:blocks;loaded=true;
        if(initialSelection){
          initialSelection=false;
          const ordered=sortedBlocks(), selected=ordered.find(b=>b.start_date<=today&&shiftDay(b.start_date,70)>today)||ordered[0];
          if(selected){blockId=selected.id;sessions=[];datasetKey="";return await load();}
        }
        if(blockId&&!currentBlock()){blockId="";sessions=[];datasetKey="";return await load();}
        sessions=[...new Map([...(more?sessions:[]),...next.sessions.filter(r=>r&&typeof r.id==="string"&&!r.archived_at&&(!blockId||r.block_id===blockId))].map(r=>[r.id,r])).values()];
        hasMore=!!next.hasMore;offset=nextOffset;loaded=true;datasetKey=dataIdentity();
        return true;
      } catch(error) {
        if(active()&&seq===sequence) {
          if (["42501","PGRST301","PGRST302"].includes(error?.code)) { sessions=[];datasetKey="";roster=[];locations=[];blocks=[];blockId="";loaded=false; }
          loadError="Your sessions couldn’t load. "+(dataReady()?"Showing the last loaded sessions and fees. ":"")+"Check your connection and try again.";
        }
        return false;
      } finally { if(active()&&seq===sequence) { loading=false;render(); } }
    }
    function locationOptions(selected) {
      return `<option value="">Choose a location</option>${[...new Set([...locations.map(l=>l.name),...(selected?[selected]:[])])].sort().map(name=>`<option value="${esc(name)}"${name===selected?" selected":""}>${esc(name)}</option>`).join("")}`;
    }
    function pickerLabel() { return editor?.draft.rider_ids.length ? `${editor.draft.rider_ids.length} ${editor.draft.rider_ids.length===1?"rider":"riders"} selected` : "Choose riders"; }
    function openEditor(row, date, sessionKind="regular") {
      if(!active()||!allowed||!loaded||editor) return;
      focusBack=document.activeElement;
      const block=currentBlock(), defaultDate=block&&(today<block.start_date||today>=shiftDay(block.start_date,70))?block.start_date:today;
      const draft={id:row?.id||crypto.randomUUID(),session_date:row?.session_date||date||defaultDate,start_time:row?.start_time?.slice(0,5)||"",venue:row?.venue||venue||"",rider_ids:row?ids(row):[],updated_at:row?.updated_at||null,block_id:row?row.block_id||null:blockId||null,park_fee_cents:row?.park_fee_cents||0,park_fee_basis:row?.park_fee_basis||"per_rider",session_kind:row?.session_kind||sessionKind,session_completed:row?.session_completed===true,extra_fee_cents:row?.extra_fee_cents??null,park_fee_paid_by_coach:row?.park_fee_paid_by_coach===true,invoice_date:row?.invoice_date||null,invoice_status:row?.invoice_status||"expected"};
      const extraFeeText=draft.extra_fee_cents==null?"":(draft.extra_fee_cents/100).toFixed(2);
      const feeText=draft.park_fee_cents?(draft.park_fee_cents/100).toFixed(2):"";
      editor={kind:"session",draft,initial:fingerprint(draft),feeText,initialFeeText:feeText,extraFeeText,initialExtraFeeText:extraFeeText,saved:!!row,saving:false,adding:false,locationDraft:"",error:""};
      const choices=[...orderedRiders(),...draft.rider_ids.filter(id=>!find(id)).map(id=>({id,display_name:"Previously linked rider"}))];
      dialog.innerHTML=`<form class="st-form"><header class="st-dialog-header"><div><span class="st-eyebrow">Session Tracker</span><h2 id="st-editor-title">${row?"Edit session":"New session"}</h2></div>${button("cancel-session","×","st-square",'aria-label="Close session form"')}</header><fieldset class="st-fields">${blocks.length?`<label class="st-block-field">Training block<select data-field="block-id"><option value="">No block · standalone session</option>${sortedBlocks().map(b=>`<option value="${esc(b.id)}"${b.id===draft.block_id?" selected":""}>${esc(b.name)}</option>`).join("")}</select></label>`:""}<div class="st-date-time"><label>Date<input type="date" data-field="session-date" value="${esc(draft.session_date)}" required></label><label>Time <small>(optional)</small><input type="time" data-field="start-time" value="${esc(draft.start_time)}"></label></div><label for="st-venue">Location</label><div class="st-location-control"><select id="st-venue" data-field="venue" required>${locationOptions(draft.venue)}</select>${button("add-location","＋","st-square",'aria-label="Add a new location" aria-expanded="false" aria-controls="st-add-location"')}</div><div id="st-add-location" class="st-add-location" hidden><label>New location<input data-field="new-location" maxlength="80" placeholder="Park or venue name" autocomplete="off"></label>${button("save-location","Add location")}<p class="st-location-error" role="alert"></p></div><label>Riders</label><details class="st-picker"><summary><span data-picker-label>${pickerLabel()}</span><span class="st-chevron" aria-hidden="true">⌄</span></summary><div class="st-picker-body"><input type="search" data-field="rider-search" placeholder="Find a rider" aria-label="Find a rider" autocomplete="off"><div class="st-rider-options">${choices.length?choices.map(r=>`<label class="st-rider-option" data-rider-name="${esc((r.display_name||"Rider").toLowerCase())}"><input type="checkbox" name="rider" value="${esc(r.id)}"${draft.rider_ids.includes(r.id)?" checked":""}><span>${esc(r.display_name||"Rider")}</span></label>`).join(""):'<p>No linked riders yet. Add riders from the Riders page first.</p>'}</div><p data-rider-empty hidden>No riders match your search.</p></div></details><p class="st-selected" data-selected-riders>${esc(draft.rider_ids.map(riderName).join(", "))}</p><div class="st-fee-control"><label>Park fee ${draft.park_fee_basis==="session"?"for this session":"per rider"} (AUD)<input type="number" inputmode="decimal" data-field="park-fee" min="0" max="10000" step="0.01" value="${esc(feeText)}" placeholder="0.00"></label><div class="st-fee-preview" aria-live="polite" data-fee-total></div></div>${parentCostsHtml(draft,extraFeeText)}</fieldset><p class="st-form-error" role="alert"></p><footer class="st-dialog-footer">${row?button("archive-session","Remove session","st-danger"):button("cancel-session","Cancel")}<button type="submit" class="st-button is-primary" data-action="save-session">Save session</button></footer></form>`;
      updateFeePreview();updateParentCosts();
      dialog.showModal();
      dialog.querySelector('[data-field="session-date"]').focus();
    }
    function parentCostsHtml(draft,extraFeeText){
      return `<details class="st-parent-costs"${draft.session_kind==="additional"?" open":""}><summary><span>Parent costs / Invoice details</span><span class="st-chevron" aria-hidden="true">⌄</span></summary><div class="st-cost-fields"><label>Session type<select data-field="session-kind"><option value="regular"${draft.session_kind==="regular"?" selected":""}>Regular session</option><option value="additional"${draft.session_kind==="additional"?" selected":""}>Additional session</option></select></label><label class="st-check-label"><input type="checkbox" data-field="session-completed"${draft.session_completed?" checked":""}><span>Session completed</span></label><div data-extra-fee-fields${draft.session_kind==="additional"?"":" hidden"}><label>Extra coaching fee per rider (AUD)<input type="number" inputmode="decimal" data-field="extra-fee" min="0" max="10000" step="0.01" value="${esc(extraFeeText)}" placeholder="Price TBC"></label><p class="st-cost-help">Leave blank if the price is still to be confirmed.</p><div class="st-extra-fee-preview" data-extra-fee-total aria-live="polite"></div></div><label class="st-check-label"><input type="checkbox" data-field="park-fee-paid"${draft.park_fee_paid_by_coach?" checked":""}><span>I paid the park entry</span></label><p class="st-cost-help" data-park-paid-help>For every rider selected in this session.</p><label><span data-invoice-date-label>${draft.invoice_status==="paid"?"Invoice date (optional)":draft.invoice_status==="invoiced"?"Invoice date":"Expected invoice date"}</span><input type="date" data-field="invoice-date" value="${esc(draft.invoice_date||"")}"></label><p class="st-cost-help" data-invoice-help></p><label>Billing status<select data-field="invoice-status"><option value="expected"${draft.invoice_status==="expected"?" selected":""}>Expected invoice</option><option value="invoiced"${draft.invoice_status==="invoiced"?" selected":""}>Already invoiced</option><option value="paid"${draft.invoice_status==="paid"?" selected":""}>Paid</option></select></label><p class="st-cost-help">Billing status applies to every rider selected and is visible to linked parents. Choose Paid only when their payment has been received. Saving does not send an invoice.</p></div></details>`;
    }
    function updateParentCosts(){
      if(editor?.kind!=="session")return;
      const draft=editor.draft,additional=draft.session_kind==="additional",cents=parseFee(editor.extraFeeText),count=draft.rider_ids.length;
      dialog.querySelector("[data-extra-fee-fields]").hidden=!additional;
      const extraInput=dialog.querySelector('[data-field="extra-fee"]');extraInput.disabled=!additional;
      dialog.querySelector("[data-extra-fee-total]").textContent=editor.extraFeeText.trim()===""?"Extra coaching total: price TBC":cents===null?"Enter a valid extra coaching fee":`${money(cents)} × ${count} ${count===1?"rider":"riders"} = ${money(cents*count)}`;
      const parkPaid=dialog.querySelector('[data-field="park-fee-paid"]'),hasParkFee=(parseFee(editor.feeText)||0)>0;
      parkPaid.disabled=!hasParkFee;parkPaid.checked=draft.park_fee_paid_by_coach===true;
      dialog.querySelector("[data-park-paid-help]").textContent=hasParkFee?"For every rider selected in this session.":"Enter a park fee above before recording a coach payment.";
      dialog.querySelector("[data-invoice-date-label]").textContent=draft.invoice_status==="paid"?"Invoice date (optional)":draft.invoice_status==="invoiced"?"Invoice date":"Expected invoice date";
      dialog.querySelector("[data-invoice-help]").textContent="Choose the invoice date for this session. Leave blank if it is still to be confirmed.";
    }
    function updateFeePreview(){
      const el=dialog.querySelector("[data-fee-total]");
      if(!el||editor?.kind!=="session")return;
      const cents=parseFee(editor.feeText),count=editor.draft.rider_ids.length;
      el.innerHTML=cents===null?'<span>Enter a valid park fee</span>':`<span>${editor.draft.park_fee_basis==="session"?"Session park fee":`${money(cents)} × ${count} ${count===1?"rider":"riders"}`}</span><strong>${money(cents*(editor.draft.park_fee_basis==="session"?1:count))}</strong>`;
    }
    function openBlockEditor(row){
      if(!active()||!allowed||!loaded||editor)return;
      focusBack=document.activeElement;
      const draft={id:row?.id||crypto.randomUUID(),name:row?.name||"",start_date:row?.start_date||monday(today),updated_at:row?.updated_at||null};
      editor={kind:"block",draft,initial:fingerprint(draft),saved:!!row,saving:false,adding:false,locationDraft:"",error:""};
      dialog.innerHTML=`<form class="st-form"><header class="st-dialog-header"><div><span class="st-eyebrow">10-week training block</span><h2 id="st-editor-title">${row?"Edit block":"New block"}</h2></div>${button("cancel-session","×","st-square",'aria-label="Close block form"')}</header><fieldset class="st-fields"><label>Block name<input data-field="block-name" maxlength="80" value="${esc(draft.name)}" placeholder="e.g. Term 1 training" required></label><label>Week 1 starts on Monday<input type="date" data-field="block-start" value="${esc(draft.start_date)}" required></label><p class="st-block-hint">10 weeks, grouped 1–4, 5–8 and 9–10. Invoice reminders appear in weeks 1, 4 and 8.</p></fieldset><p class="st-form-error" role="alert"></p><footer class="st-dialog-footer">${button("cancel-session","Cancel")}<button type="submit" class="st-button is-primary" data-action="save-block">Save block</button></footer></form>`;
      dialog.showModal();dialog.querySelector('[data-field="block-name"]').focus();
    }
    async function saveBlock(){
      if(!active()||!allowed||editor?.kind!=="block"||editor.saving)return;
      const current=editor, draft=current.draft;
      if(!draft.name.trim()||!draft.start_date){current.error="Enter a block name and start date.";editorState();return;}
      if(new Date(`${draft.start_date}T12:00:00Z`).getUTCDay()!==1){current.error="Choose a Monday for the start of week 1.";editorState();return;}
      current.saving=true;current.error="";editorState();
      try{
        const saved=await request(()=>config.saveBlock({...draft,name:draft.name.trim()}));
        if(!active()||editor!==current)return;
        if(!saved?.id||!saved.start_date)throw new Error("Save not confirmed");
        blocks=[...blocks.filter(b=>b.id!==saved.id),saved];blockId=saved.id;initialSelection=false;sessions=[];datasetKey="";venue="";riderId="";
        notice=current.saved?"Training block updated.":"Training block saved. Add sessions to the weeks below.";closeEditor(true);await load(false,true);
      }catch(error){if(active()&&editor===current)current.error=error?.code==="22023"?error.message:/stale|changed|conflict/i.test(error?.message||"")?"This block changed elsewhere. Your edits are still here. Close this form and refresh before editing again.":"We couldn’t confirm the block save. Your edits are still here. Try again; a retry won’t create another block.";}
      finally{if(active()&&editor===current){current.saving=false;editorState();}}
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
      const save=dialog.querySelector(editor.kind==="block"?'[data-action="save-block"]':'[data-action="save-session"]');
      save.textContent=editor.saving?"Saving…":editor.kind==="block"?"Save block":"Save session";
      const location=dialog.querySelector('[data-action="save-location"]');if(location)location.textContent=editor.adding?"Adding…":"Add location";
      dialog.querySelector(".st-form-error").textContent=editor.error;
      dialog.querySelector("form").setAttribute("aria-busy",String(editor.saving||editor.adding));
    }
    async function saveSession() {
      if(!active()||!allowed||editor?.kind!=="session"||editor.saving||editor.adding) return;
      const current=editor;
      if(current.locationDraft.trim()) {
        current.error="Add your new location first, or clear its name to keep the selected location.";
        dialog.querySelector("#st-add-location").hidden=false;
        dialog.querySelector('[data-action="add-location"]').setAttribute("aria-expanded","true");
        editorState();dialog.querySelector('[data-field="new-location"]').focus();return;
      }
      if(!current.draft.venue.trim()||!current.draft.session_date||!current.draft.rider_ids.length) {current.error="Choose a date, location and at least one rider.";editorState();return;}
      const block=blocks.find(b=>b.id===current.draft.block_id), cents=parseFee(current.feeText);
      if(cents===null){current.error="Enter a park fee from $0 to $10,000, with up to two decimal places.";editorState();return;}
      if(current.draft.block_id&&(!block||current.draft.session_date<block.start_date||current.draft.session_date>=shiftDay(block.start_date,70))){current.error="Choose a session date within this 10-week block, or select No block.";editorState();return;}
      const extraCents=current.extraFeeText.trim()===""?null:parseFee(current.extraFeeText);
      if(current.draft.session_kind==="additional"&&current.extraFeeText.trim()!==""&&extraCents===null){current.error="Enter an extra coaching fee from $0 to $10,000, or leave it blank for price TBC.";editorState();return;}
      if(current.draft.invoice_status==="paid"&&current.draft.session_kind==="additional"&&extraCents===null){current.error="Confirm the extra coaching price before marking this session Paid, or choose Expected invoice.";editorState();return;}
      if(current.draft.invoice_date&&!validDate(current.draft.invoice_date)){current.error="Choose a valid invoice date, or leave it blank for date TBC.";editorState();return;}
      current.draft.extra_fee_cents=current.draft.session_kind==="additional"?extraCents:null;
      current.draft.park_fee_cents=cents;
      if(!cents)current.draft.park_fee_paid_by_coach=false;
      current.saving=true;current.error="";editorState();
      try {
        const saved=await request(()=>config.save({...current.draft,rider_ids:[...current.draft.rider_ids]}));
        if(!active()||editor!==current) return;
        if(!saved?.id)throw new Error("Save not confirmed");
        month=monthStart(saved.session_date||current.draft.session_date);blockId=saved.block_id||"";initialSelection=false;venue="";riderId="";
        sessions=[];datasetKey="";notice=current.saved?"Session updated.":"Session saved.";undo=null;opened.add(saved.id);closeEditor(true);
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
        undo=saved;sessions=[];datasetKey="";notice="Session removed.";closeEditor(true);await load();
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
        month=monthStart(restored.session_date);blockId=restored.block_id||"";initialSelection=false;venue="";riderId="";undo=null;sessions=[];datasetKey="";notice="Session restored.";await load();
      } catch {if(active())notice="Couldn’t restore the session. Try Undo again.";}
      finally {if(active()){undoBusy=false;render();}}
    }
    function input(event) {
      if(!editor||!active()||editor.saving||editor.adding)return;
      const el=event.target, field=el.dataset.field;
      if(field==="block-name")editor.draft.name=el.value;
      if(field==="block-start")editor.draft.start_date=el.value;
      if(field==="block-id")editor.draft.block_id=el.value||null;
      if(field==="park-fee"){editor.feeText=el.value;editor.draft.park_fee_cents=parseFee(el.value);if(!editor.draft.park_fee_cents)editor.draft.park_fee_paid_by_coach=false;updateFeePreview();updateParentCosts();}
      if(field==="session-date")editor.draft.session_date=el.value;
      if(field==="session-kind"){editor.draft.session_kind=el.value;if(el.value==="regular")editor.draft.extra_fee_cents=null;else editor.draft.extra_fee_cents=editor.extraFeeText.trim()===""?null:parseFee(editor.extraFeeText);updateParentCosts();}
      if(field==="session-completed")editor.draft.session_completed=el.checked;
      if(field==="park-fee-paid")editor.draft.park_fee_paid_by_coach=el.checked;
      if(field==="extra-fee"){editor.extraFeeText=el.value;editor.draft.extra_fee_cents=el.value.trim()===""?null:parseFee(el.value);updateParentCosts();}
      if(field==="invoice-date"){editor.draft.invoice_date=el.value||null;updateParentCosts();}
      if(field==="invoice-status"){editor.draft.invoice_status=el.value;updateParentCosts();}
      if(field==="start-time")editor.draft.start_time=el.value;
      if(field==="venue")editor.draft.venue=el.value;
      if(field==="new-location")editor.locationDraft=el.value;
      if(el.name==="rider") {
        const next=new Set(editor.draft.rider_ids);next[el.checked?"add":"delete"](el.value);editor.draft.rider_ids=[...next];
        dialog.querySelector("[data-picker-label]").textContent=pickerLabel();
        dialog.querySelector("[data-selected-riders]").textContent=editor.draft.rider_ids.map(riderName).join(", ");updateFeePreview();updateParentCosts();
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
      if(key==="block"){blockId=event.target.value;initialSelection=false;sessions=[];datasetKey="";venue="";riderId="";notice="";load();return;}
      if(key==="venue")venue=event.target.value;else riderId=event.target.value;
      notice="";
      if(blockId){render();return;}
      sessions=[];datasetKey="";load();
    }
    function click(event) {
      const el=event.target.closest("[data-action]");
      if(!el||!root.contains(el)||el.disabled||!active()||!allowed)return;
      const action=el.dataset.action;
      if(action==="new-block")openBlockEditor();
      if(action==="edit-block")openBlockEditor(currentBlock());
      if(action==="add-day")openEditor(null,el.dataset.date,el.dataset.kind||"regular");
      if(action==="new-session")openEditor();
      if(action==="edit-session")openEditor(sessions.find(s=>s.id===el.dataset.id));
      if(action==="cancel-session")closeEditor();
      if(action==="previous-month"||action==="next-month") {month=shiftMonth(month,action==="previous-month"?-1:1);sessions=[];datasetKey="";notice="";load();}
      if(action==="refresh")load(false,true);
      if(action==="load-more")load(true);
      if(action==="archive-session")archiveSession();
      if(action==="undo-archive")restore();
      if(action==="add-location"&&editor) {const box=dialog.querySelector("#st-add-location");box.hidden=!box.hidden;el.setAttribute("aria-expanded",String(!box.hidden));if(!box.hidden)box.querySelector("input").focus();}
      if(action==="save-location")addLocation();
    }
    function submit(event){event.preventDefault();if(editor?.kind==="block")saveBlock();else saveSession();}
    function keydown(event){if(event.key!=="Enter")return;const field=event.target.dataset.field;if(field==="new-location"){event.preventDefault();addLocation();}if(field==="rider-search")event.preventDefault();}
    function cancel(event){event.preventDefault();closeEditor();}
    root.addEventListener("click",click);root.addEventListener("input",input);root.addEventListener("change",change);
    dialog.addEventListener("submit",submit);dialog.addEventListener("keydown",keydown);dialog.addEventListener("cancel",cancel);
    window.addEventListener("beforeunload",beforeUnload);
    render();
    const ready=allowed?load():Promise.resolve(false);
    return {ready,hasUnsavedChanges,destroy(){if(stopped)return;stopped=true;sequence++;for(const cancel of [...pending])cancel();if(dialog.open)dialog.close();root.removeEventListener("click",click);root.removeEventListener("input",input);root.removeEventListener("change",change);dialog.removeEventListener("submit",submit);dialog.removeEventListener("keydown",keydown);dialog.removeEventListener("cancel",cancel);window.removeEventListener("beforeunload",beforeUnload);editor=null;sessions=[];datasetKey="";roster=[];locations=[];blocks=[];root.classList.remove("session-tracker");root.innerHTML="";}};
  }
  window.JKCSessionTracker={mount};
})();
