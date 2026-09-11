/* Daily finishes are explicit, saved transactions. Rendering and realtime never open this UI. */
const dailyFinishUi = { current: null, queued: [], shown: new Set(), requests: new Set(), epoch: 0 };

function dailyRpcVenue(value) {
  const venue = String(value || "").trim();
  return /^(default|default daily list)$/i.test(venue) ? "" : venue;
}

function dailyFinishNumber(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) ? Number(value) : null;
}

function normalizedDailyCandidate(candidate) {
  return candidate?.candidate_id ? { ...candidate, id: candidate.candidate_id } : null;
}

function normalizedDailyResult(result) {
  return result?.result_id ? { ...result, id: result.result_id, leaderboard_position: result.rank_number } : null;
}

function dismissDailyFinishForNavigation() {
  dailyFinishUi.epoch += 1;
  dailyFinishUi.queued = [];
  if (dailyFinishUi.current) dailyFinishUi.current.saving = false;
  closeDailyFinish({ returnFocus: false, next: false });
}

function dailyFinishContext(button, viewer = false) {
  const athleteId = viewer ? button?.dataset.finishDailyAthlete || button?.dataset.athleteId : state.user?.id;
  const athlete = viewer ? state.sessionViewerRosterCache?.find(rider => rider.id === athleteId) : state.profile;
  const group = viewer ? state.sessionViewerActiveSessionCache : null;
  const participant = group?.coach_group_session_participants?.find(rider => rider.athlete_id === athleteId);
  return {
    athleteId, riderName: athlete?.display_name || button?.dataset.riderName || "Rider",
    sessionId: viewer ? participant?.training_session_id : state.activeTraining?.id,
    groupSessionId: group?.id || null, venue: dailyRpcVenue(viewer ? state.sessionViewerVenue : state.selectedVenue),
    viewer, userId: state.user?.id, view: state.view, epoch: dailyFinishUi.epoch, tappedAt: new Date().toISOString(),
    returnFocus: button || document.activeElement,
  };
}

function dailyFinishContextIsCurrent(context) {
  return state.user?.id === context.userId && state.view === context.view && dailyFinishUi.epoch === context.epoch;
}

function closeDailyFinish({ returnFocus = true, next = true } = {}) {
  const current = dailyFinishUi.current;
  if (current?.saving) return;
  current?.element?.remove();
  if (current?.keydown) document.removeEventListener("keydown", current.keydown);
  dailyFinishUi.current = null;
  document.documentElement.classList.remove("daily-finish-open");
  if (returnFocus && current?.context?.returnFocus?.isConnected) current.context.returnFocus.focus({ preventScroll: true });
  if (next) {
    const upcoming = dailyFinishUi.queued.find(item => dailyFinishContextIsCurrent(item.context));
    if (upcoming) {
      dailyFinishUi.queued.splice(0, dailyFinishUi.queued.indexOf(upcoming) + 1);
      showDailyFinishConfirmation(upcoming.candidate, upcoming.context);
    } else dailyFinishUi.queued = [];
  }
}

function dailyFinishModal(content, context, { result = false } = {}) {
  const element = document.createElement("div");
  element.className = "daily-finish-backdrop";
  element.innerHTML = `<section class="daily-finish-dialog ${result ? "daily-result-dialog" : ""}" role="dialog" aria-modal="true" aria-labelledby="daily-finish-title" tabindex="-1">${content}</section>`;
  const current = { element, context, saving: false };
  dailyFinishUi.current = current;
  document.body.append(element);
  document.documentElement.classList.add("daily-finish-open");
  current.keydown = event => {
    if (dailyFinishUi.current !== current) return;
    if (document.querySelector("dialog.training-progress-dialog[open]")) return;
    if (event.key === "Escape" && !current.saving) { event.preventDefault(); closeDailyFinish(); }
    if (event.key !== "Tab") return;
    const targets = [...element.querySelectorAll('button:not(:disabled), [href], input:not(:disabled), [tabindex="0"]')].filter(node => node.getClientRects().length);
    if (!targets.length) { event.preventDefault(); return; }
    const first = targets[0], last = targets[targets.length - 1];
    if (event.shiftKey && (document.activeElement === first || !element.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || !element.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
  };
  document.addEventListener("keydown", current.keydown);
  // Focus the heading container, so pressing Enter cannot accidentally confirm a finish.
  element.querySelector("[role=dialog]").focus({ preventScroll: true });
  return current;
}

function showDailyFinishConfirmation(candidate, context) {
  if (!candidate || !dailyFinishContextIsCurrent(context)) return;
  const key = candidate.id;
  if (!key) return;
  if (dailyFinishUi.current) {
    if (dailyFinishUi.current.candidate?.id !== key && !dailyFinishUi.queued.some(item => item.candidate.id === key)) dailyFinishUi.queued.push({ candidate, context });
    return;
  }
  if (candidate.athlete_id !== context.athleteId) return;
  context = { ...context, riderName: candidate.rider_name || context.riderName };
  const seconds = dailyFinishNumber(candidate.seconds);
  const current = dailyFinishModal(`
    <div class="eyebrow">DAILY TRICKS · ${escapeHtml(context.riderName)}</div>
    <h2 id="daily-finish-title">Daily Tricks finished?</h2>
    <p class="daily-confirm-copy">You’ve ticked every trick. Ready to lock in your time?</p>
    ${seconds !== null ? `<div class="daily-finish-time"><strong>${formatTime(seconds)}</strong><span>${context.manual ? "Time at your finish tap" : "Time at your final trick"}</span></div>` : ""}
    <p class="daily-finish-note">Reading this popup won’t add to your result. Go back to keep the timer running and correct your list.</p>
    <div class="daily-finish-error" role="alert" hidden></div>
    <div class="daily-finish-actions"><button class="primary-btn" type="button" data-confirm-daily>Yes — finish Daily Tricks</button><button class="secondary-btn" type="button" data-cancel-daily>Go back</button></div>`, context);
  current.candidate = candidate;
  current.element.querySelector("[data-cancel-daily]").onclick = () => closeDailyFinish();
  current.element.querySelector("[data-confirm-daily]").onclick = () => confirmDailyFinish(current);
}

function dailySavedResultHtml(result, context) {
  const seconds = dailyFinishNumber(result.seconds);
  const comparable = result.pb_comparable === true;
  const previousPb = comparable ? dailyFinishNumber(result.previous_pb_seconds) : null;
  const personalBest = comparable ? dailyFinishNumber(result.pb_seconds) : null;
  const completionPoints = dailyFinishNumber(result.completion_points);
  const weeklyScore = dailyFinishNumber(result.weekly_score);
  const rank = dailyFinishNumber(result.leaderboard_position);
  const firstPb = comparable && result.is_first_pb === true;
  const newPb = comparable && result.is_new_pb === true;
  const comparison = previousPb !== null && seconds !== null
    ? seconds === previousPb ? "You matched your personal best." : `${formatTime(Math.abs(previousPb - seconds))} ${seconds < previousPb ? "faster than" : "off"} your previous best.`
    : firstPb ? "Your first recorded best for this Daily Tricks list." : "A saved result to build on.";
  return `<div class="daily-result-mark ${newPb ? "new-pb" : ""}" aria-hidden="true">✦</div>
    <div class="eyebrow">DAILY TRICKS · RESULT SAVED</div>
    <h2 id="daily-finish-title">${escapeHtml(result.rider_name || context.riderName)}</h2>
    ${newPb || firstPb ? `<strong class="daily-pb-banner">${firstPb ? "FIRST PERSONAL BEST" : "NEW PERSONAL BEST"}</strong>` : `<p class="daily-result-tagline">Daily Tricks. Done.</p>`}
    <div class="daily-finish-time"><strong>${seconds === null ? "—" : formatTime(seconds)}</strong><span>Daily Tricks completion time</span></div>
    <div class="daily-result-stats">
      <div><strong>${completionPoints === null ? "—" : `+${completionPoints}`}</strong><span>Daily completion points</span></div>
      <div><strong>${weeklyScore === null ? "—" : weeklyScore}</strong><span>Weekly score</span></div>
    </div>
    ${comparable ? `<div class="daily-pb-comparison"><div><span>Personal best · same list</span><strong>${personalBest === null ? "Not available" : formatTime(personalBest)}</strong></div><p>${escapeHtml(comparison)}</p></div>` : `<p class="daily-finish-note">Earlier saved Daily result. A compatible PB comparison and completion point breakdown aren’t available for this result.</p>`}
    ${rank !== null && rank > 0 ? `<p class="daily-result-rank">Leaderboard position <strong>#${rank}</strong></p>` : ""}
    <p class="daily-finish-note">Keep going with One Bangs, Dialled, Lines or your other training. Your Daily result is saved.</p>
    <div class="daily-finish-actions"><button class="primary-btn" type="button" data-keep-riding>Keep riding</button><button class="secondary-btn" type="button" data-share-daily>Share result</button></div>`;
}

function showSavedDailyResult(result, context) {
  result = normalizedDailyResult(result);
  if (!result || result.athlete_id !== context.athleteId) return;
  if (!dailyFinishContextIsCurrent(context)) return;
  closeDailyFinish({ returnFocus: false, next: false });
  const current = dailyFinishModal(dailySavedResultHtml(result, context), context, { result: true });
  current.result = result;
  current.element.querySelector("[data-keep-riding]").onclick = () => closeDailyFinish();
  current.element.querySelector("[data-share-daily]").onclick = () => showTrainingSharePreview({ dailyResult: result });
}

async function refreshAfterDailyFinish(result, context) {
  cacheClear(`schedule:${context.athleteId}:`);
  cacheClear("leaderboard"); cacheClear("park-king:"); cacheClear("coach-command:");
  if (context.athleteId === state.user?.id && state.activeTraining?.id === result.session_id) {
    state.activeTraining = { ...state.activeTraining, daily_completed_seconds: result.seconds, daily_completed_at: result.completed_at, daily_venue: result.venue };
    clearInterval(state.timer); state.timer = null;
    updateTimer();
  }
  if (!dailyFinishContextIsCurrent(context)) return;
  if (context.viewer) {
    clearCoachCaches({ command: true, sessionViewer: true, leaderboard: true });
    // The selected rider/list are retained. Other riders' clocks remain running.
    await renderSessionViewer();
  } else if (state.view === "home") await renderAthleteHome();
  else await renderSession();
  if (typeof refreshOpenTrainingProgress === "function") void refreshOpenTrainingProgress(context.athleteId);
}

async function confirmDailyFinish(current) {
  if (dailyFinishUi.current !== current || current.saving) return;
  if (!dailyFinishContextIsCurrent(current.context)) { closeDailyFinish(); return; }
  current.saving = true;
  const confirm = current.element.querySelector("[data-confirm-daily]");
  const cancel = current.element.querySelector("[data-cancel-daily]");
  const errorBox = current.element.querySelector(".daily-finish-error");
  errorBox.hidden = true;
  confirm.disabled = true; cancel.disabled = true;
  confirm.setAttribute("aria-busy", "true"); confirm.textContent = "Saving your result…";
  try {
    const { data, error } = await withTimeout(client.rpc("confirm_daily_finish", { p_candidate_id: current.candidate.id }), "Save Daily Tricks finish", 15000);
    if (error) throw error;
    const result = normalizedDailyResult(Array.isArray(data) ? data[0] : data);
    if (!result?.id || result.athlete_id !== current.context.athleteId || dailyFinishNumber(result.seconds) === null || result.seconds < 0) throw new Error("The finish could not be verified. Retry to check your saved result.");
    current.saving = false;
    setSyncStatus("saved");
    showSavedDailyResult(result, current.context);
    try { await refreshAfterDailyFinish(result, current.context); }
    catch (refreshError) { console.warn("Daily result saved; session refresh is pending", refreshError); }
  } catch (error) {
    current.saving = false;
    if (dailyFinishUi.current !== current) return;
    setSyncStatus("error");
    errorBox.textContent = `${messageFrom(error)} Your trick progress is kept. Retry checks this same finish, so it cannot award it twice.`;
    errorBox.hidden = false;
    confirm.disabled = false; cancel.disabled = false;
    confirm.removeAttribute("aria-busy"); confirm.textContent = "Retry finish";
  }
}

async function requestDailyFinish(button, viewer = false) {
  if (button?.disabled) return;
  const context = { ...dailyFinishContext(button, viewer), manual: true };
  if (!context.athleteId) return;
  const key = context.athleteId;
  if (dailyFinishUi.requests.has(key)) return;
  dailyFinishUi.requests.add(key);
  const restore = setButtonBusy(button, "Checking Daily Tricks…");
  try {
    const { data, error } = await withTimeout(client.rpc("prepare_daily_finish", {
      p_athlete_id: context.athleteId, p_session_id: context.sessionId || null, p_venue: context.venue, p_tapped_at: context.tappedAt,
    }), "Prepare Daily finish", 15000);
    if (error) throw error;
    const response = Array.isArray(data) ? data[0] : data;
    if (response?.result) showSavedDailyResult(response.result, context);
    else if (response?.completion_candidate) showDailyFinishConfirmation(normalizedDailyCandidate(response.completion_candidate), context);
    else notify(response?.message || "Tick every Daily Trick before finishing.", "error");
  } catch (error) { notify(messageFrom(error), "error"); }
  finally { dailyFinishUi.requests.delete(key); restore(); }
}

function handleDailyCompletionAction(result, context, action, wasComplete) {
  if (action !== "landed") {
    dailyFinishUi.queued = dailyFinishUi.queued.filter(item => item.context.athleteId !== context.athleteId);
    if (dailyFinishUi.current?.context.athleteId === context.athleteId && !dailyFinishUi.current.saving) closeDailyFinish();
    return;
  }
  // Only the response to this device's incomplete → complete action is allowed to prompt.
  const candidate = normalizedDailyCandidate(result?.completion_candidate);
  if (wasComplete || !candidate) return;
  const key = candidate.id;
  if (dailyFinishUi.shown.has(key)) return;
  dailyFinishUi.shown.add(key);
  showDailyFinishConfirmation(candidate, context);
}

async function recordDailyTrainingAction(event, viewer = false) {
  event.preventDefault(); event.stopPropagation();
  const button = event.currentTarget;
  if (button.disabled) return;
  // Capture before the network request or any optimistic rendering.
  const context = dailyFinishContext(button, viewer);
  const actionKey = viewer ? "viewerAssignmentAction" : "assignmentAction";
  const action = button.dataset[actionKey];
  const row = button.closest(viewer ? ".viewer-trick-row" : ".assignment-row");
  const wasComplete = Boolean(row?.classList.contains("complete"));
  const landed = action === "landed";
  const openSection = button.closest("[data-assignment-section]")?.dataset.assignmentSection;
  if (openSection) state.sessionOpenAssignmentSections.add(openSection);
  button.disabled = true; button.setAttribute("aria-busy", "true");
  row?.classList.toggle("complete", landed);
  button.classList.toggle("complete", landed); button.textContent = landed ? "✓" : "";
  setPendingAssignmentProgress(button.dataset.assignmentId, landed);
  let saved = false;
  try {
    const { data, error } = await withTimeout(saveProgressRpc("record_daily_trick_action", {
      p_assignment_id: button.dataset.assignmentId, p_action: action, p_venue: context.venue, p_tapped_at: context.tappedAt,
    }), "Save Daily Trick", 15000);
    if (error) throw error;
    saved = true;
    const result = Array.isArray(data) ? data[0] : data;
    button.dataset[actionKey] = landed ? "unlanded" : "landed";
    setSyncStatus("saved");
    cacheClear(`schedule:${context.athleteId}:`); cacheClear("leaderboard"); cacheClear("park-king:");
    invalidateSessionViewerData();
    handleDailyCompletionAction(result, context, action, wasComplete);
    if (!result?.completion_candidate) notify(result?.message || (landed ? "Daily Trick saved." : "Daily Trick corrected."));
    if (dailyFinishContextIsCurrent(context)) {
      if (viewer) await refreshSessionViewerLight({ force: true });
      else if (state.view === "home") await renderAthleteHome();
      else await renderSession();
    }
    if (typeof refreshOpenTrainingProgress === "function") void refreshOpenTrainingProgress(context.athleteId);
  } catch (error) {
    if (!saved) {
      clearPendingAssignmentProgress(button.dataset.assignmentId);
      row?.classList.toggle("complete", wasComplete);
      button.classList.toggle("complete", wasComplete); button.textContent = wasComplete ? "✓" : "";
      setSyncStatus("error");
      notify(`${messageFrom(error)} Refresh your list before retrying if the connection was interrupted.`, "error");
    } else console.warn("Daily Trick saved; list refresh pending", error);
  } finally {
    button.disabled = false; button.removeAttribute("aria-busy");
  }
}
