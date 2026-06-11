const OWNER_EMAIL = "joshkhourybmx@gmail.com";
const OWNER_PASSWORD = "Mumdadloz1.";
const SESSION_KEY = "jkcommunity.session.v1";
const DATA_KEY = "jkcommunity.data.v1";
const LEGACY_SESSION_KEY = "jkcrew.ops.session.v2";
const LEGACY_DATA_KEY = "jkcrew.ops.data.v2";
let deferredInstallPrompt = null;

const state = {
  role: null,
  access: null,
  userEmail: "",
  activePanel: "command",
  activeClassId: "",
  squareLocationId: "",
  coaches: [
    { id: crypto.randomUUID(), name: "Josh Khoury", email: OWNER_EMAIL, phone: "", password: OWNER_PASSWORD, access: "owner" }
  ],
  parents: [],
  parks: [],
  classes: [],
  smsQueue: []
};

const navItems = [
  ["command", "Command"],
  ["classes", "Classes"],
  ["rosters", "Rosters"],
  ["people", "People"],
  ["parks", "Parks"],
  ["square", "Square Sync"]
];

function qs(selector) {
  return document.querySelector(selector);
}

function qsa(selector) {
  return [...document.querySelectorAll(selector)];
}

function saveData() {
  const { role, access, userEmail, activePanel, ...data } = state;
  localStorage.setItem(DATA_KEY, JSON.stringify({ ...data, activePanel: state.activePanel }));
}

function loadData() {
  try {
    const stored = JSON.parse(localStorage.getItem(DATA_KEY) || localStorage.getItem(LEGACY_DATA_KEY) || "null");
    if (stored) Object.assign(state, stored);
  } catch {
    localStorage.removeItem(DATA_KEY);
  }
}

function saveSession() {
  localStorage.setItem(SESSION_KEY, JSON.stringify({
    role: state.role,
    access: state.access,
    userEmail: state.userEmail,
    activePanel: state.activePanel
  }));
}

function restoreSession() {
  try {
    const session = JSON.parse(localStorage.getItem(SESSION_KEY) || localStorage.getItem(LEGACY_SESSION_KEY) || "null");
    if (!session?.role) return;
    Object.assign(state, session);
    unlock();
  } catch {
    localStorage.removeItem(SESSION_KEY);
  }
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(LEGACY_SESSION_KEY);
}

function isOwner() {
  return state.access === "owner";
}

function visibleClasses() {
  if (isOwner()) return state.classes;
  const coach = state.coaches.find(item => item.email.toLowerCase() === state.userEmail.toLowerCase());
  return state.classes.filter(item => item.coachId === coach?.id);
}

function classById(id) {
  return state.classes.find(item => item.id === id);
}

function coachName(id) {
  return state.coaches.find(item => item.id === id)?.name || "Unassigned coach";
}

function parkName(id) {
  return state.parks.find(item => item.id === id)?.name || "No park selected";
}

function setPanel(panel) {
  state.activePanel = panel;
  qsa(".view").forEach(view => view.classList.toggle("active", view.dataset.panel === panel));
  qsa(".nav-button").forEach(button => button.classList.toggle("active", button.dataset.panel === panel));
  qs("#pageTitle").textContent = navItems.find(item => item[0] === panel)?.[1] || "Command Centre";
  saveData();
  saveSession();
}

function renderNav() {
  const items = isOwner() ? navItems : navItems.filter(item => ["command", "rosters"].includes(item[0]));
  qs("#primaryNav").innerHTML = items.map(([panel, label]) => `
    <button class="nav-button ${state.activePanel === panel ? "active" : ""}" data-panel="${panel}" type="button">${label}</button>
  `).join("");
  qsa(".nav-button").forEach(button => button.addEventListener("click", () => setPanel(button.dataset.panel)));
}

function renderMetrics() {
  const classes = visibleClasses();
  const students = classes.reduce((total, item) => total + item.riders.length, 0);
  qs("#metricStudents").textContent = students;
  qs("#metricClasses").textContent = classes.length;
  qs("#metricCoaches").textContent = state.coaches.length;
  qs("#metricSms").textContent = state.smsQueue.length;
  qs("#syncPill").textContent = state.squareLocationId && state.classes.some(item => item.squareKey)
    ? "Square sync: mapping ready"
    : "Square sync: setup needed";
}

function renderDashboard() {
  const classes = visibleClasses();
  if (!classes.length) {
    qs("#dashboardRoster").className = "empty-state";
    qs("#dashboardRoster").textContent = "No real Term 3 classes are configured yet. Add parks, coaches and class mappings before launch.";
    return;
  }

  qs("#dashboardRoster").className = "mini-roster";
  qs("#dashboardRoster").innerHTML = classes.map(item => `
    <article>
      <strong>${item.day} · ${item.name}</strong>
      <span>${coachName(item.coachId)} · ${item.riders.length}/${item.capacity} riders · ${parkName(item.parkId)}</span>
    </article>
  `).join("");
}

function renderPipeline() {
  qs("#stepParks").classList.toggle("done", state.parks.length > 0);
  qs("#stepCoaches").classList.toggle("done", state.coaches.length > 1);
  qs("#stepClasses").classList.toggle("done", state.classes.some(item => item.squareKey));
  qs("#stepWebhook").classList.toggle("done", Boolean(state.squareLocationId));
}

function isPublicHttps() {
  return location.protocol === "https:" && !["localhost", "127.0.0.1"].includes(location.hostname);
}

function renderSelects() {
  const coachOptions = state.coaches.map(coach => `<option value="${coach.id}">${coach.name}</option>`).join("");
  const parkOptions = state.parks.map(park => `<option value="${park.id}">${park.name}</option>`).join("");
  qs("#classCoach").innerHTML = coachOptions;
  qs("#classPark").innerHTML = parkOptions;
  qs("#rosterClassSelect").innerHTML = visibleClasses().map(item => `<option value="${item.id}">${item.day} · ${item.name}</option>`).join("");
  if (!state.activeClassId || !visibleClasses().some(item => item.id === state.activeClassId)) {
    state.activeClassId = visibleClasses()[0]?.id || "";
  }
  qs("#rosterClassSelect").value = state.activeClassId;
  qs("#squareLocationId").value = state.squareLocationId;
}

function renderClasses() {
  const classes = visibleClasses();
  qs("#classList").innerHTML = classes.length ? classes.map(item => `
    <article class="class-card">
      <div>
        <span class="day-tag">${item.day}</span>
        <h3>${item.name}</h3>
        <p>${coachName(item.coachId)} · ${parkName(item.parkId)}</p>
        <p class="square-key">${item.squareKey}</p>
      </div>
      <div class="card-actions owner-only">
        <button class="mini-action" data-edit-class="${item.id}" type="button">Edit</button>
        <button class="mini-action danger" data-delete-class="${item.id}" type="button">Delete</button>
      </div>
    </article>
  `).join("") : `<div class="empty-state">No classes yet. Add your real Term 3 classes and map each one to a Square lesson product.</div>`;

  qsa("[data-edit-class]").forEach(button => button.addEventListener("click", () => editClass(button.dataset.editClass)));
  qsa("[data-delete-class]").forEach(button => button.addEventListener("click", () => deleteClass(button.dataset.deleteClass)));
}

function renderRosters() {
  const current = classById(state.activeClassId);
  if (!visibleClasses().length) {
    qs("#riderTable").innerHTML = `<div class="empty-state">No rosters yet. When Square sales import, riders will appear here automatically.</div>`;
    return;
  }
  if (!current) return;

  qs("#riderTable").innerHTML = current.riders.length ? `
    <div class="table-row table-head"><span>Rider</span><span>Parent</span><span>Status</span><span></span></div>
    ${current.riders.map(rider => `
      <div class="table-row">
        <span><strong>${rider.name}</strong></span>
        <span>${rider.parentName || "Parent pending"}<small>${rider.parentPhone || ""}</small></span>
        <span class="status-group" data-rider="${rider.id}">
          ${["present", "away", "injured", "sick"].map(status => `
            <button class="status-choice ${rider.status === status ? "active" : ""}" data-status="${status}" type="button">${status}</button>
          `).join("")}
        </span>
        <span class="card-actions">
          ${isOwner() ? `<button class="mini-action" data-edit-rider="${rider.id}" type="button">Edit</button><button class="mini-action danger" data-delete-rider="${rider.id}" type="button">Delete</button>` : ""}
        </span>
      </div>
    `).join("")}
  ` : `<div class="empty-state">This class has no riders yet.</div>`;

  qsa(".status-choice").forEach(button => button.addEventListener("click", event => {
    const rider = current.riders.find(item => item.id === event.target.closest(".status-group").dataset.rider);
    rider.status = event.target.dataset.status;
    saveData();
    renderAll();
  }));
  qsa("[data-edit-rider]").forEach(button => button.addEventListener("click", () => editRider(button.dataset.editRider)));
  qsa("[data-delete-rider]").forEach(button => button.addEventListener("click", () => deleteRider(button.dataset.deleteRider)));
}

function renderAccounts() {
  const rows = [
    ...state.coaches.map(item => ({ ...item, type: "coach" })),
    ...state.parents.map(item => ({ ...item, type: "parent" }))
  ];
  qs("#accountList").innerHTML = rows.length ? rows.map(item => `
    <article class="account-row">
      <span class="account-type">${item.type}</span>
      <div><strong>${item.name}</strong><p>${item.email || "No email"} · ${item.phone || "No mobile"}</p></div>
      <div class="card-actions owner-only">
        <button class="mini-action" data-edit-account="${item.type}:${item.id}" type="button">Edit</button>
        ${item.access === "owner" ? "" : `<button class="mini-action danger" data-delete-account="${item.type}:${item.id}" type="button">Delete</button>`}
      </div>
    </article>
  `).join("") : `<div class="empty-state">No accounts yet.</div>`;

  qsa("[data-edit-account]").forEach(button => button.addEventListener("click", () => editAccount(button.dataset.editAccount)));
  qsa("[data-delete-account]").forEach(button => button.addEventListener("click", () => deleteAccount(button.dataset.deleteAccount)));
}

function renderParks() {
  qs("#parkList").innerHTML = state.parks.length ? state.parks.map(park => `
    <article class="park-card">
      <div>
        <h3>${park.name}</h3>
        <p>${park.address}</p>
        <span>${park.bom || "BOM station not connected"} · Apple Weather not connected</span>
      </div>
      <div class="card-actions owner-only">
        <button class="mini-action" data-edit-park="${park.id}" type="button">Edit</button>
        <button class="mini-action danger" data-delete-park="${park.id}" type="button">Delete</button>
      </div>
    </article>
  `).join("") : `<div class="empty-state">No fake locations. Add the real skate parks you will use for Term 3.</div>`;

  qsa("[data-edit-park]").forEach(button => button.addEventListener("click", () => editPark(button.dataset.editPark)));
  qsa("[data-delete-park]").forEach(button => button.addEventListener("click", () => deletePark(button.dataset.deletePark)));
}

function renderSms() {
  qs("#smsQueue").innerHTML = state.smsQueue.length ? state.smsQueue.map(item => `
    <article class="sms-card ${item.sent ? "sent" : ""}"><strong>${item.to}</strong><p>${item.message}</p><span>${item.sent ? "Sent" : "Queued"}</span></article>
  `).join("") : `<div class="empty-state">No SMS messages queued yet.</div>`;
}

function renderIntegrationEndpoints() {
  const origin = location.protocol.startsWith("http") ? location.origin : "https://your-domain.com";
  qs("#webhookEndpoint").value = `${origin}/api/square-webhook`;
  qs("#smsEndpoint").value = `${origin}/api/send-sms`;

  const readyForSquare = isPublicHttps();
  qs("#connectionBanner").classList.toggle("ready", readyForSquare);
  qs("#connectionBanner strong").textContent = readyForSquare ? "Public URL ready" : "Local preview";
  qs("#connectionBanner span").textContent = readyForSquare
    ? "Step 2: paste the webhook link into Square."
    : "Step 1: put this app online first.";

  qs("#squareStepDeploy").classList.toggle("done", readyForSquare);
  qs("#squareStepKeys").classList.toggle("done", false);
  qs("#squareStepLocation").classList.toggle("done", Boolean(state.squareLocationId));
  qs("#squareStepClasses").classList.toggle("done", state.classes.some(item => item.squareKey));
  qs("#squareStepSms").classList.toggle("done", state.smsQueue.some(item => item.sent));
}

function renderOwnerVisibility() {
  document.body.classList.toggle("owner-role", isOwner());
}

function renderAll() {
  renderOwnerVisibility();
  renderNav();
  renderMetrics();
  renderDashboard();
  renderPipeline();
  renderSelects();
  renderClasses();
  renderRosters();
  renderAccounts();
  renderParks();
  renderSms();
  renderIntegrationEndpoints();
  setPanel(state.activePanel);
}

function addClass(event) {
  event.preventDefault();
  state.classes.push({
    id: crypto.randomUUID(),
    day: qs("#classDay").value,
    name: qs("#className").value.trim(),
    coachId: qs("#classCoach").value,
    parkId: qs("#classPark").value,
    squareKey: qs("#classSquareKey").value.trim(),
    capacity: Number(qs("#classCapacity").value),
    riders: []
  });
  qs("#classForm").reset();
  saveData();
  renderAll();
}

function addManualRider(event) {
  event.preventDefault();
  const current = classById(state.activeClassId);
  if (!current) return;
  current.riders.push({
    id: crypto.randomUUID(),
    name: qs("#manualRiderName").value.trim(),
    parentName: qs("#manualParentName").value.trim(),
    parentPhone: qs("#manualParentPhone").value.trim(),
    status: "enrolled",
    source: "manual"
  });
  qs("#manualRiderForm").reset();
  saveData();
  renderAll();
}

function addAccount(event) {
  event.preventDefault();
  const target = qs("#accountType").value === "coach" ? state.coaches : state.parents;
  target.push({
    id: crypto.randomUUID(),
    name: qs("#accountName").value.trim(),
    email: qs("#accountEmail").value.trim(),
    phone: qs("#accountPhone").value.trim(),
    password: qs("#accountPassword").value.trim(),
    access: qs("#accountType").value === "coach" ? "coach" : "parent"
  });
  qs("#accountForm").reset();
  saveData();
  renderAll();
}

function addPark(event) {
  event.preventDefault();
  state.parks.push({
    id: crypto.randomUUID(),
    name: qs("#parkName").value.trim(),
    address: qs("#parkAddress").value.trim(),
    bom: qs("#parkBom").value.trim()
  });
  qs("#parkForm").reset();
  saveData();
  renderAll();
}

function processSquareOrder(event) {
  event.preventDefault();
  let order;
  try {
    order = JSON.parse(qs("#squareOrderJson").value);
  } catch {
    qs("#importResult").textContent = "Invalid JSON. Paste a Square order payload or export.";
    return;
  }

  const lineItems = order.line_items || order.order?.line_items || [];
  const buyer = order.fulfillments?.[0]?.shipment_details?.recipient || order.order?.fulfillments?.[0]?.shipment_details?.recipient || {};
  const metadata = order.metadata || order.order?.metadata || {};
  const riderName = metadata.rider_name || metadata.rider || buyer.display_name || "";
  const parentName = buyer.display_name || metadata.parent_name || "";
  const parentPhone = buyer.phone_number || metadata.parent_phone || metadata.mobile || "";

  const imported = [];
  lineItems.forEach(line => {
    const keys = [line.name, line.variation_name, line.catalog_object_id].filter(Boolean).map(value => String(value).toLowerCase());
    const target = state.classes.find(item => keys.some(key => item.squareKey.toLowerCase() === key));
    if (!target) return;
    target.riders.push({
      id: crypto.randomUUID(),
      name: riderName || "Name missing from Square order",
      parentName,
      parentPhone,
      status: "enrolled",
      source: "square"
    });
    state.smsQueue.push({
      id: crypto.randomUUID(),
      to: parentPhone || "mobile missing",
      message: `Thanks for signing ${riderName || "your rider"} up for JKCoaching. Join JKCommunity for lesson info, bookings, progress and updates: https://jkcommunity.app/signup`
    });
    imported.push(target.name);
  });

  qs("#importResult").textContent = imported.length
    ? `Imported rider into: ${imported.join(", ")}`
    : "No matching class found. Check the Square product or variation name mapping.";
  qs("#squareOrderJson").value = "";
  saveData();
  renderAll();
}

async function sendQueuedSms() {
  const queued = state.smsQueue.filter(item => !item.sent);
  if (!queued.length) return;

  for (const item of queued) {
    try {
      const response = await fetch("/api/send-sms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: item.to, message: item.message })
      });
      item.sent = response.ok;
      item.error = response.ok ? "" : "SMS provider rejected the message";
    } catch {
      item.error = "SMS endpoint unavailable. Deploy with Twilio environment variables first.";
    }
  }

  saveData();
  renderAll();
}

function editClass(id) {
  const item = classById(id);
  if (!item) return;
  const name = window.prompt("Class name", item.name);
  if (!name) return;
  item.name = name.trim();
  item.squareKey = window.prompt("Square product / variation name", item.squareKey) || item.squareKey;
  saveData();
  renderAll();
}

function deleteClass(id) {
  if (!window.confirm("Delete this class and its roster?")) return;
  state.classes = state.classes.filter(item => item.id !== id);
  state.activeClassId = state.classes[0]?.id || "";
  saveData();
  renderAll();
}

function editRider(id) {
  const current = classById(state.activeClassId);
  const rider = current?.riders.find(item => item.id === id);
  if (!rider) return;
  const name = window.prompt("Rider name", rider.name);
  if (!name) return;
  rider.name = name.trim();
  rider.parentName = window.prompt("Parent name", rider.parentName || "") || rider.parentName;
  rider.parentPhone = window.prompt("Parent mobile", rider.parentPhone || "") || rider.parentPhone;
  saveData();
  renderAll();
}

function deleteRider(id) {
  const current = classById(state.activeClassId);
  if (!current || !window.confirm("Delete this rider?")) return;
  current.riders = current.riders.filter(item => item.id !== id);
  saveData();
  renderAll();
}

function editAccount(key) {
  const [type, id] = key.split(":");
  const list = type === "coach" ? state.coaches : state.parents;
  const item = list.find(account => account.id === id);
  if (!item) return;
  const name = window.prompt("Name", item.name);
  if (!name) return;
  item.name = name.trim();
  item.email = window.prompt("Email", item.email || "") || item.email;
  item.phone = window.prompt("Mobile", item.phone || "") || item.phone;
  saveData();
  renderAll();
}

function deleteAccount(key) {
  const [type, id] = key.split(":");
  if (!window.confirm("Delete this account?")) return;
  if (type === "coach") state.coaches = state.coaches.filter(item => item.id !== id || item.access === "owner");
  if (type === "parent") state.parents = state.parents.filter(item => item.id !== id);
  saveData();
  renderAll();
}

function editPark(id) {
  const park = state.parks.find(item => item.id === id);
  if (!park) return;
  const name = window.prompt("Park name", park.name);
  if (!name) return;
  park.name = name.trim();
  park.address = window.prompt("Address / suburb", park.address) || park.address;
  park.bom = window.prompt("BOM station / notes", park.bom || "") || park.bom;
  saveData();
  renderAll();
}

function deletePark(id) {
  if (!window.confirm("Delete this park?")) return;
  state.parks = state.parks.filter(item => item.id !== id);
  state.classes.forEach(item => {
    if (item.parkId === id) item.parkId = "";
  });
  saveData();
  renderAll();
}

function login(event) {
  event.preventDefault();
  const email = qs("#loginEmail").value.trim().toLowerCase();
  const password = qs("#loginPassword").value;
  const coach = state.coaches.find(item => item.email.toLowerCase() === email && item.password === password);
  if (!coach) return;
  state.role = "coach";
  state.access = coach.access;
  state.userEmail = coach.email;
  unlock();
}

function unlock() {
  document.body.classList.remove("locked");
  qs("#authScreen").setAttribute("aria-hidden", "true");
  qs("#appShell").removeAttribute("aria-hidden");
  qs("#roleLabel").textContent = isOwner() ? "Owner" : "Coach";
  saveSession();
  renderAll();
}

function logout() {
  state.role = null;
  state.access = null;
  state.userEmail = "";
  clearSession();
  document.body.classList.add("locked");
  qs("#authScreen").removeAttribute("aria-hidden");
  qs("#appShell").setAttribute("aria-hidden", "true");
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

function updateInstallUi() {
  const installButton = qs("#installAppButton");
  const installHelp = qs("#installHelp");
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;
  document.body.classList.toggle("installed-app", Boolean(isStandalone));
  if (isStandalone) {
    installButton.textContent = "App installed";
    installButton.disabled = true;
    installHelp.textContent = "JKCommunity is running as an installed app.";
  } else if (deferredInstallPrompt) {
    installButton.textContent = "Install app";
    installButton.disabled = false;
    installHelp.textContent = "Tap Install app to add JKCommunity to your Mac or home screen.";
  } else {
    installButton.textContent = "Install app";
    installButton.disabled = false;
    installHelp.textContent = "If the install prompt does not appear, use Chrome's address-bar install icon or Menu > Save and share > Install page as app.";
  }
}

async function installApp() {
  if (!deferredInstallPrompt) {
    updateInstallUi();
    return;
  }
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  updateInstallUi();
}

window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  deferredInstallPrompt = event;
  updateInstallUi();
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  updateInstallUi();
});

qs("#authForm").addEventListener("submit", login);
qs("#installAppButton").addEventListener("click", installApp);
qs("#logoutButton").addEventListener("click", logout);
qs("#classForm").addEventListener("submit", addClass);
qs("#manualRiderForm").addEventListener("submit", addManualRider);
qs("#accountForm").addEventListener("submit", addAccount);
qs("#parkForm").addEventListener("submit", addPark);
qs("#squareImportForm").addEventListener("submit", processSquareOrder);
qs("#sendQueuedSms").addEventListener("click", sendQueuedSms);
qsa("[data-copy-target]").forEach(button => button.addEventListener("click", async () => {
  const target = qs(`#${button.dataset.copyTarget}`);
  try {
    await navigator.clipboard.writeText(target.value);
    button.textContent = "Copied";
    setTimeout(() => {
      button.textContent = "Copy";
    }, 1200);
  } catch {
    target.select();
  }
}));
qs("#rosterClassSelect").addEventListener("change", event => {
  state.activeClassId = event.target.value;
  saveData();
  renderAll();
});
qs("#squareLocationId").addEventListener("change", event => {
  state.squareLocationId = event.target.value.trim();
  saveData();
  renderAll();
});

loadData();
renderAll();
restoreSession();
registerServiceWorker();
updateInstallUi();
