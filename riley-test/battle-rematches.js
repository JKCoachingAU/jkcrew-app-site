/* Reviewed rematches share the existing battle builders and creation API. */
const JKCrewBattleRematches = (() => {
  const reviews = new WeakMap();
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const formatValue = draft => draft.teamCount === 3 ? Array(3).fill(draft.size).join('v') : String(draft.size);
  const countActive = battles => battles.filter(battle => ['pending', 'accepted'].includes(battle.status)).length;

  function draftFromBattle(battle, viewerId, coach = false) {
    if (!battle || battle.status !== 'completed') return null;
    const size = Number(battle.battle_size), teamCount = Number(battle.team_count || 2);
    const durationDays = Number(battle.duration_days || 7), rewardPoints = Number(battle.reward_points || 5);
    if (!Number.isInteger(size) || size < 1 || size > 6 || ![2, 3].includes(teamCount)
      || !Number.isInteger(durationDays) || durationDays < 1 || durationDays > 7
      || !Number.isInteger(rewardPoints) || rewardPoints < 1 || rewardPoints > 20) return null;
    const participants = battle.participants || [];
    const teams = Array.from({ length: teamCount }, (_, index) => participants.filter(person => Number(person.team_number) === index + 1).map(person => person.athlete_id));
    if (teams.some(team => team.length !== size) || teams.flat().some(id => !id)
      || new Set(teams.flat()).size !== size * teamCount || participants.length !== size * teamCount) return null;
    if (!coach) {
      const own = teams.findIndex(team => team.includes(viewerId));
      if (own < 0) return null;
      teams.unshift(...teams.splice(own, 1));
      teams[0] = [viewerId, ...teams[0].filter(id => id !== viewerId)];
    }
    return { battleId: battle.id, size, teamCount, durationDays, rewardPoints, teams, participants };
  }

  function actionHtml(battle, viewerId, coach = false) {
    return draftFromBattle(battle, viewerId, coach)
      ? `<button type="button" class="secondary-btn compact-btn battle-rematch-action" data-rematch-battle="${escape(battle.id)}"><span aria-hidden="true">↻</span> Rematch</button>` : '';
  }

  async function loadOptions(client) {
    const { data, error } = await client.rpc('get_battle_match_options');
    if (error) throw error;
    if (!data || !Array.isArray(data.riders)) throw new Error('Battle options could not load.');
    return data;
  }

  function eligibility(ids, options, participants = []) {
    const byId = new Map((options?.riders || []).map(rider => [rider.athlete_id, rider]));
    const names = new Map(participants.map(rider => [rider.athlete_id, rider.display_name || 'A rider']));
    return [...new Set(ids)].flatMap(id => {
      const rider = byId.get(id), name = rider?.display_name || names.get(id) || 'A selected rider';
      if (!rider) return [`${name} is unavailable. Choose a replacement.`];
      if (Number(rider.active_battle_count) >= 3) return [`${name} has 3 active battles. Choose someone else or wait for a battle to finish.`];
      return [];
    });
  }

  function suggestedOpponent(options, viewerId, battles = []) {
    const own = options?.riders?.find(rider => rider.athlete_id === viewerId);
    const ownPoints = Number(own?.recent_training_points);
    if (!own || !Number.isFinite(ownPoints) || ownPoints <= 0 || Number(own.active_battle_count) >= 3) return null;
    const alreadyCompeting = new Set(battles.filter(battle => ['pending', 'accepted'].includes(battle.status))
      .flatMap(battle => (battle.participants || []).map(person => person.athlete_id)));
    const candidates = options.riders.filter(rider => {
      const points = Number(rider.recent_training_points);
      return rider.athlete_id !== viewerId && Number(rider.active_battle_count) < 3 && !alreadyCompeting.has(rider.athlete_id)
        && Number.isFinite(points) && points > 0 && Math.abs(points - ownPoints) <= Math.max(3, ownPoints * 0.35);
    }).sort((a, b) => Math.abs(Number(a.recent_training_points) - ownPoints) - Math.abs(Number(b.recent_training_points) - ownPoints)
      || String(a.display_name).localeCompare(String(b.display_name)) || String(a.athlete_id).localeCompare(String(b.athlete_id)));
    return candidates.length ? { rider: candidates[0], ownPoints, explanation: `Last 7 days: you earned ${ownPoints} training points; ${candidates[0].display_name} earned ${Number(candidates[0].recent_training_points)}.` } : null;
  }

  function reviewNotice(form, text, warnings = []) {
    let note = form.querySelector('.battle-rematch-review');
    if (!note) { note = document.createElement('div'); note.className = 'battle-rematch-review'; form.prepend(note); }
    note.setAttribute('role', 'status');
    note.innerHTML = `<strong>${escape(text)}</strong><p>Review the riders, length and points. Invitations are sent only when you tap Send.</p>${warnings.length ? `<ul>${warnings.map(warning => `<li>${escape(warning)}</li>`).join('')}</ul>` : ''}`;
  }

  function prepareRider(form, draft, config, options) {
    form.classList.remove('hidden');
    form.querySelector('[name="battleSize"]').value = formatValue(draft);
    form.querySelector('[name="durationDays"]').value = String(draft.durationDays);
    form.querySelector('[name="rewardPoints"]').value = String(draft.rewardPoints);
    const names = ['teammateIds', 'opponentIds', 'thirdTeamIds'];
    names.forEach((name, index) => {
      const selected = new Set((draft.teams[index] || []).filter(id => index !== 0 || id !== config.viewerId));
      form.querySelectorAll(`[name="${name}"]`).forEach(input => { input.checked = selected.has(input.value); });
    });
    reviews.set(form, { draft, config });
    reviewNotice(form, draft.battleId ? 'Review your rematch' : 'Suggested matchup', eligibility(draft.teams.flat(), options, draft.participants));
    const toggle = config.view.querySelector('#toggle-battle-rider-list');
    if (toggle) toggle.textContent = 'Close rider list';
    config.updatePicker();
    form.scrollIntoView({ behavior: 'auto', block: 'start' });
    form.querySelector('[name="battleSize"]').focus({ preventScroll: true });
  }

  function prepareCoach(form, draft, config, updateSlots) {
    form.querySelector('[name="battleSize"]').value = formatValue(draft);
    form.querySelector('[name="durationDays"]').value = String(draft.durationDays);
    form.querySelector('[name="rewardPoints"]').value = String(draft.rewardPoints);
    ['One', 'Two', 'Three'].forEach((team, index) => {
      form.querySelectorAll(`[name="team${team}Rider"]`).forEach((select, slot) => {
        const id = draft.teams[index]?.[slot] || '';
        if (id && ![...select.options].some(option => option.value === id)) {
          const option = document.createElement('option'); option.value = id;
          option.textContent = `${draft.participants.find(person => person.athlete_id === id)?.display_name || 'Previous rider'} — unavailable`;
          select.append(option);
        }
        select.value = id;
      });
    });
    reviews.set(form, { draft, config });
    reviewNotice(form, draft.battleId ? 'Review this rematch' : 'Review this matchup', eligibility(draft.teams.flat(), draft.options, draft.participants));
    updateSlots();
    form.querySelector('[name="battleSize"]').focus({ preventScroll: true });
  }

  async function validateSubmission(form, ids) {
    const review = reviews.get(form);
    if (!review) return true; // The existing custom builder retains its creation rules.
    const { config, draft } = review;
    try {
      const options = await loadOptions(config.client);
      if (!form.isConnected || config.currentViewer() !== config.viewerId) return false;
      const warnings = eligibility(ids, options, draft.participants);
      if (warnings.length) { reviewNotice(form, 'Update this matchup before sending', warnings); config.notify(warnings[0], 'error'); return false; }
      return true;
    } catch (error) {
      reviewNotice(form, 'Eligibility check could not finish', ['Your selections are still here. Try Send again to recheck before inviting anyone.']);
      config.notify(config.messageFrom(error), 'error');
      return false;
    }
  }

  function bindRider(config) {
    const { view, battles } = config;
    view.querySelectorAll('[data-rematch-battle]').forEach(button => button.addEventListener('click', async () => {
      const draft = draftFromBattle(battles.find(battle => battle.id === button.dataset.rematchBattle), config.viewerId);
      if (!draft || button.disabled) return;
      if (countActive(battles) >= 3) return config.notify('You have 3 active battles. Finish one before sending a rematch.', 'error');
      button.disabled = true;
      try {
        const options = await loadOptions(config.client);
        if (!button.isConnected || config.currentViewer() !== config.viewerId) return;
        prepareRider(view.querySelector('#battle-request-form'), draft, config, options);
      } catch (error) { config.notify(`Could not check the rematch. ${config.messageFrom(error)}`, 'error'); }
      finally { button.disabled = false; }
    }));
    const trigger = document.createElement('button');
    trigger.type = 'button'; trigger.className = 'secondary-btn wide battle-suggest-trigger'; trigger.textContent = 'Find a suggested opponent';
    trigger.disabled = countActive(battles) >= 3;
    const result = document.createElement('div'); result.className = 'battle-suggestion'; result.setAttribute('role', 'status');
    const custom = view.querySelector('#toggle-battle-rider-list');
    custom?.after(trigger, result);
    trigger.addEventListener('click', async () => {
      if (trigger.disabled) return;
      trigger.disabled = true; result.textContent = 'Looking at recent training points…';
      try {
        const options = await loadOptions(config.client);
        if (!trigger.isConnected || config.currentViewer() !== config.viewerId) return;
        const suggested = suggestedOpponent(options, config.viewerId, battles);
        if (!suggested) { result.textContent = 'No comparable matchup from recent training yet. You can still choose riders yourself.'; return; }
        result.innerHTML = `<strong>${escape(suggested.rider.display_name)}</strong><p>${escape(suggested.explanation)}</p><button type="button" class="secondary-btn compact-btn">Review 1v1 matchup</button>`;
        result.querySelector('button').addEventListener('click', () => prepareRider(view.querySelector('#battle-request-form'), {
          battleId: null, size: 1, teamCount: 2, durationDays: 7, rewardPoints: 5,
          teams: [[config.viewerId], [suggested.rider.athlete_id]], participants: options.riders,
        }, config, options));
      } catch (error) { result.textContent = 'Suggestions could not load. Your custom battle builder is still available.'; }
      finally { trigger.disabled = false; }
    });
  }

  function bindCoach(config) {
    config.view.querySelectorAll('[data-rematch-battle]').forEach(button => button.addEventListener('click', async () => {
      const draft = draftFromBattle(config.battles.find(battle => battle.id === button.dataset.rematchBattle), config.viewerId, true);
      if (!draft || button.disabled) return;
      button.disabled = true;
      try {
        const options = await loadOptions(config.client);
        if (!button.isConnected || config.currentViewer() !== config.viewerId) return;
        draft.options = options;
        config.openBuilder(options.riders.map(rider => ({ ...rider, id: rider.athlete_id })), draft);
      } catch (error) { config.notify(`Could not check the rematch. ${config.messageFrom(error)}`, 'error'); }
      finally { button.disabled = false; }
    }));
  }

  function bindCoachSuggestion(form, config, updateSlots) {
    const button = document.createElement('button'); button.type = 'button';
    button.className = 'secondary-btn compact-btn battle-suggest-trigger'; button.textContent = 'Suggest an opponent for Team 1';
    const result = document.createElement('div'); result.className = 'battle-suggestion'; result.setAttribute('role', 'status');
    form.querySelector('.battle-builder-matchup-head')?.after(button, result);
    button.addEventListener('click', async () => {
      if (button.disabled) return;
      if (form.querySelector('[name="battleSize"]').value !== '1') { result.textContent = 'Choose 1v1 to suggest an opponent, or keep building your custom teams.'; return; }
      const riderId = form.querySelector('[name="teamOneRider"]').value;
      if (!riderId) { result.textContent = 'Choose the rider for Team 1 first.'; return; }
      button.disabled = true; result.textContent = 'Looking at recent training points…';
      try {
        const options = await loadOptions(config.client);
        if (!form.isConnected || config.currentViewer() !== config.viewerId) return;
        const suggested = suggestedOpponent(options, riderId);
        const own = options.riders.find(rider => rider.athlete_id === riderId);
        if (!suggested || !own) { result.textContent = 'No comparable available opponent from recent training yet. You can still choose riders yourself.'; return; }
        result.innerHTML = `<strong>${escape(suggested.rider.display_name)}</strong><p>Last 7 days: ${escape(own.display_name)} earned ${suggested.ownPoints} training points; ${escape(suggested.rider.display_name)} earned ${Number(suggested.rider.recent_training_points)}.</p><button type="button" class="secondary-btn compact-btn">Use this opponent</button>`;
        result.querySelector('button').addEventListener('click', () => prepareCoach(form, {
          battleId: null, size: 1, teamCount: 2, durationDays: Number(form.querySelector('[name="durationDays"]').value),
          rewardPoints: Number(form.querySelector('[name="rewardPoints"]').value), teams: [[riderId], [suggested.rider.athlete_id]],
          participants: options.riders, options,
        }, config, updateSlots));
      } catch (error) { result.textContent = 'Suggestions could not load. You can still choose riders yourself.'; }
      finally { button.disabled = false; }
    });
  }

  return { actionHtml, draftFromBattle, suggestedOpponent, eligibility, prepareCoach, validateSubmission, bindRider, bindCoach, bindCoachSuggestion };
})();
