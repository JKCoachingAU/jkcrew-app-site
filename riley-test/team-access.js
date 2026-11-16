(function (global) {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  const roles = { head_coach: 'Head coach', coach: 'Coach', assistant_coach: 'Assistant coach', athlete: 'Rider', parent: 'Parent viewer' };

  async function mount(config) {
    const element = config.element;
    if (!element) return;
    let generation = 0, stopped = false;
    const active = () => !stopped && element.isConnected && config.currentUser() === config.userId;
    const rpc = async (name, args = {}) => {
      if (!active()) throw Error('Your account changed. Reopen Profile.');
      const result = await config.withTimeout(config.client.rpc(name, args), 'Team access', 15000);
      if (result.error) throw result.error;
      return result.data;
    };
    const title = '<div class="panel-head"><div><div class="panel-title">Team access</div><div class="panel-meta">Membership is by invitation. Every coach needs owner approval.</div></div></div>';

    if (['athlete', 'parent'].includes(config.profileRole)) {
      element.innerHTML = '<div class="panel-head"><div><div class="panel-title">Team invitation</div><div class="panel-meta">Already have an account? Enter the code your coach gave you.</div></div></div><form data-member-team-join-form><div class="field"><label for="member-team-join-code">Team invite code</label><input id="member-team-join-code" name="code" required maxlength="100" autocomplete="off" autocapitalize="characters"></div><button class="secondary-btn" type="submit">Use invite code</button></form><p class="team-access-feedback" data-team-feedback role="status" aria-live="polite"></p>';
      element.querySelector('[data-member-team-join-form]').addEventListener('submit', async event => {
        event.preventDefault();
        const form = event.currentTarget, button = form.querySelector('button'), feedback = element.querySelector('[data-team-feedback]');
        const code = String(new FormData(form).get('code') || '').trim();
        if (!code || button.disabled || !active()) return;
        button.disabled = true; feedback.textContent = '';
        try {
          const result = await rpc('join_team_registration', { p_code: code });
          if (!active()) return;
          if (result?.status !== 'registered' || result.role !== config.profileRole || !result.team_id) throw Error('Team membership could not be confirmed. Try again.');
          feedback.textContent = config.profileRole === 'parent' ? 'Team joined. Your coach can now link your child.' : 'Team joined. Your coach can now set up your training.';
          form.reset();
          if (typeof config.onChanged === 'function') await config.onChanged();
        } catch (error) { if (active()) feedback.textContent = error.message || 'Could not use the invite. Your code is kept for correction.'; }
        finally { if (active()) button.disabled = false; }
      });
      return { destroy() { stopped = true; generation++; } };
    }

    async function load() {
      const version = ++generation;
      if (!active()) return;
      element.innerHTML = title + '<p role="status">Loading your team…</p>';
      try {
        const access = await rpc('get_my_team_access');
        if (!active() || version !== generation) return;
        const approved = access?.approval_status === 'approved';
        const status = approved ? 'Approved' : access?.approval_status === 'suspended' ? 'Suspended' : 'Pending approval';
        const team = access?.team || null;
        const coaches = approved && Array.isArray(access.coaches) ? access.coaches : [];
        const invite = approved && access.can_invite === true && team?.role === 'head_coach';
        element.innerHTML = title + `<div class="team-access-summary"><div><strong>${esc(team?.name || 'No team membership yet')}</strong><small>${esc(roles[team?.role] || 'Coach')}${team?.country_name || team?.country_code ? ` · ${esc(team.country_name || team.country_code)}` : ''}</small></div><span class="team-access-status">${status}</span></div>`
          + (!approved ? '<p class="form-note">Your account cannot use coaching features until the platform owner approves access.</p>' : '')
          + (coaches.length ? `<div class="team-access-coaches">${coaches.map(coach => `<div><strong>${esc(coach.display_name || 'Coach')}</strong><span>${esc(roles[coach.role] || 'Coach')}</span></div>`).join('')}</div>` : '')
          + (invite ? '<form data-team-invite-form><div class="field"><label for="team-invite-role">Invite a coach as</label><select id="team-invite-role" name="role"><option value="coach">Coach</option><option value="assistant_coach">Assistant coach</option></select></div><button class="secondary-btn" type="submit">Create coach invite</button></form>' : '')
          + (approved ? '<form data-team-registration-form><div class="field"><label for="team-registration-role">Invite a rider or parent</label><select id="team-registration-role" name="role"><option value="athlete">Rider</option><option value="parent">Parent viewer</option></select></div><button class="secondary-btn" type="submit">Create signup code</button></form><div data-team-invite-result></div>' : '')
          + (approved && team?.role !== 'head_coach' ? '<details class="team-access-join"><summary>Join a team with an invite</summary><form data-team-join-form><div class="field"><label for="team-join-code">Invite code</label><input id="team-join-code" name="code" required maxlength="100" autocomplete="off" autocapitalize="characters"></div><div class="field"><label for="team-join-role">Requested role</label><select id="team-join-role" name="role"><option value="coach">Coach</option><option value="assistant_coach">Assistant coach</option></select></div><button class="secondary-btn" type="submit">Join team</button></form></details>' : '')
          + '<p class="team-access-feedback" data-team-feedback role="status" aria-live="polite"></p>';
        const feedback = element.querySelector('[data-team-feedback]');
        element.querySelectorAll('[data-team-invite-form], [data-team-registration-form]').forEach(inviteForm => inviteForm.addEventListener('submit', async event => {
          event.preventDefault();
          const form = event.currentTarget, button = form.querySelector('button');
          if (button.disabled || !active()) return;
          const role = new FormData(form).get('role');
          const registration = form.hasAttribute('data-team-registration-form');
          if (!(registration ? ['athlete', 'parent'] : ['coach', 'assistant_coach']).includes(role)) return;
          button.disabled = true; feedback.textContent = '';
          try {
            const result = await rpc(registration ? 'create_team_registration_invite' : 'create_team_coach_invite', { p_role: role });
            if (!active() || version !== generation) return;
            if (!result?.code) throw Error('The invite code could not be verified. Try again.');
            const expiry = new Date(result.expires_at);
            const expiryLabel = Number.isFinite(expiry.getTime()) ? expiry.toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' }) : '';
            element.querySelector('[data-team-invite-result]').innerHTML = `<div class="team-invite-code"><label for="team-created-code">Share this code with your ${esc(roles[result.role] || 'coach').toLowerCase()}</label><div><input id="team-created-code" readonly value="${esc(result.code)}" aria-label="Team invite code"><button class="secondary-btn" type="button" data-copy-team-code>Copy code</button></div>${expiryLabel ? `<small>Expires ${esc(expiryLabel)} · your device’s local time</small>` : ''}<small>${registration ? 'Use this code at signup or under Profile. Parent-to-child links are managed separately by the coach.' : 'Every coach still needs platform-owner approval.'}</small></div>`;
            element.querySelector('[data-copy-team-code]').onclick = async () => {
              if (!active()) return;
              try { await navigator.clipboard.writeText(String(result.code)); if (active()) feedback.textContent = 'Invite code copied.'; }
              catch (_) { if (active()) feedback.textContent = 'Select the invite code above to copy it.'; }
            };
            feedback.textContent = 'Invite created. Share the code directly with the person signing up.';
          } catch (error) { if (active() && version === generation) feedback.textContent = error.message || 'Could not create the invite. Try again.'; }
          finally { if (active() && version === generation) button.disabled = false; }
        }));
        element.querySelector('[data-team-join-form]')?.addEventListener('submit', async event => {
          event.preventDefault();
          const form = event.currentTarget, button = form.querySelector('button');
          if (button.disabled || !active()) return;
          const values = new FormData(form), code = String(values.get('code') || '').trim(), role = values.get('role');
          if (!code || !['coach', 'assistant_coach'].includes(role)) return;
          button.disabled = true; feedback.textContent = '';
          try {
            await rpc('join_team_coach', { p_code: code, p_requested_role: role });
            if (!active() || version !== generation) return;
            if (typeof config.onChanged === 'function') { await config.onChanged(); return; }
            await load();
          } catch (error) { if (active() && version === generation) feedback.textContent = error.message || 'Could not join the team. Your invite code is kept.'; }
          finally { if (active() && version === generation) button.disabled = false; }
        });
      } catch (error) {
        if (!active() || version !== generation) return;
        element.innerHTML = title + '<p role="status">Team settings could not load. Your access has not changed.</p><button class="secondary-btn" type="button" data-retry-team-access>Retry</button>';
        element.querySelector('[data-retry-team-access]').onclick = load;
      }
    }
    await load();
    return { destroy() { stopped = true; generation++; } };
  }
  global.JKCTeamAccess = { mount };
})(typeof window !== 'undefined' ? window : globalThis);
