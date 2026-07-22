const STORAGE_KEY = "sf-leads-config";

const $ = (id) => document.getElementById(id);

const els = {
  instanceUrl: $("instanceUrl"),
  accessToken: $("accessToken"),
  apiVersion: $("apiVersion"),
  status: $("status"),
  testBtn: $("testConnection"),
  saveBtn: $("saveConfig"),
  createForm: $("createLeadForm"),
  updateForm: $("updateLeadForm"),
  fetchLeadBtn: $("fetchLeadBtn"),
  outputPanel: $("outputPanel"),
  outputTitle: $("outputTitle"),
  outputBody: $("outputBody"),
  closeOutput: $("closeOutput"),
};

loadConfig();

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    const target = tab.dataset.tab;
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === tab));
    document.querySelectorAll(".tab-panel").forEach((p) => {
      p.classList.toggle("active", p.id === `tab-${target}`);
    });
  });
});

els.saveBtn.addEventListener("click", () => {
  saveConfig();
  flashStatus("Saved locally", "connected");
});

els.testBtn.addEventListener("click", testConnection);
els.closeOutput.addEventListener("click", () => (els.outputPanel.hidden = true));
els.createForm.addEventListener("submit", handleCreate);
els.updateForm.addEventListener("submit", handleUpdate);
els.fetchLeadBtn.addEventListener("click", handleFetch);

function loadConfig() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    if (saved.instanceUrl) els.instanceUrl.value = saved.instanceUrl;
    if (saved.accessToken) els.accessToken.value = saved.accessToken;
    if (saved.apiVersion) els.apiVersion.value = saved.apiVersion;
  } catch (e) {}
}

function saveConfig() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      instanceUrl: els.instanceUrl.value.trim(),
      accessToken: els.accessToken.value.trim(),
      apiVersion: els.apiVersion.value.trim(),
    })
  );
}

function getConfig() {
  const instanceUrl = els.instanceUrl.value.trim().replace(/\/$/, "");
  const accessToken = els.accessToken.value.trim();
  const apiVersion = els.apiVersion.value.trim() || "v66.0";
  if (!instanceUrl || !accessToken) {
    throw new Error("Instance URL and Access Token are required.");
  }
  return { instanceUrl, accessToken, apiVersion };
}

function setStatus(text, cls) {
  els.status.textContent = text;
  els.status.className = "status" + (cls ? ` ${cls}` : "");
}

function flashStatus(text, cls) {
  const prev = { text: els.status.textContent, cls: els.status.className };
  setStatus(text, cls);
  setTimeout(() => {
    els.status.textContent = prev.text;
    els.status.className = prev.cls;
  }, 1800);
}

function showOutput(title, body, kind) {
  els.outputTitle.textContent = title;
  els.outputBody.textContent =
    typeof body === "string" ? body : JSON.stringify(body, null, 2);
  els.outputPanel.className = "output-panel" + (kind ? ` ${kind}` : "");
  els.outputPanel.hidden = false;
  els.outputPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// The frontend always calls the local proxy. The proxy forwards to Salesforce
// so we sidestep the browser CORS restrictions on the Salesforce REST API.
async function sfRequest({ method, path, body }) {
  const { instanceUrl, accessToken, apiVersion } = getConfig();
  const url = `/sf-proxy${path.startsWith("/") ? "" : "/"}${path}`;

  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-sf-instance-url": instanceUrl,
      "x-sf-access-token": accessToken,
      "x-sf-api-version": apiVersion,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch (e) {
    payload = text;
  }

  if (!res.ok) {
    const err = new Error(
      typeof payload === "string"
        ? payload
        : payload?.[0]?.message || payload?.message || `HTTP ${res.status}`
    );
    err.status = res.status;
    err.payload = payload;
    throw err;
  }
  return payload;
}

async function testConnection() {
  try {
    getConfig();
  } catch (e) {
    setStatus("Missing config", "");
    showOutput("Error", e.message, "error");
    return;
  }
  setStatus("Checking...", "checking");
  els.testBtn.disabled = true;
  try {
    // Query one lead field to validate credentials.
    await sfRequest({ method: "GET", path: "/sobjects/Lead/describe" });
    setStatus("Connected", "connected");
    showOutput("Connection successful", "Salesforce API reachable with provided credentials.", "success");
  } catch (e) {
    setStatus("Auth failed", "");
    showOutput("Connection failed", e.payload || e.message, "error");
  } finally {
    els.testBtn.disabled = false;
  }
}

function formToPayload(form, fields) {
  const data = new FormData(form);
  const payload = {};
  for (const field of fields) {
    const value = (data.get(field) || "").toString().trim();
    if (value) payload[field] = value;
  }
  return payload;
}

async function handleCreate(e) {
  e.preventDefault();
  const fields = ["FirstName", "LastName", "Company", "Email", "Phone", "Title"];
  const payload = formToPayload(els.createForm, fields);

  if (!payload.LastName || !payload.Company) {
    showOutput("Validation error", "LastName and Company are required.", "error");
    return;
  }

  const submitBtn = els.createForm.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = "Creating...";

  try {
    const result = await sfRequest({
      method: "POST",
      path: "/sobjects/Lead",
      body: payload,
    });
    showOutput("Lead created", result, "success");
    els.createForm.reset();
  } catch (e) {
    showOutput("Create failed", e.payload || e.message, "error");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Create Lead";
  }
}

async function handleFetch() {
  const id = $("updateLeadId").value.trim();
  if (!id) {
    showOutput("Missing ID", "Enter a Lead ID to load.", "error");
    return;
  }
  els.fetchLeadBtn.disabled = true;
  els.fetchLeadBtn.textContent = "Loading...";
  try {
    const lead = await sfRequest({ method: "GET", path: `/sobjects/Lead/${encodeURIComponent(id)}` });
    $("updateFirstName").value = lead.FirstName || "";
    $("updateLastName").value = lead.LastName || "";
    $("updateCompany").value = lead.Company || "";
    $("updateEmail").value = lead.Email || "";
    $("updatePhone").value = lead.Phone || "";
    $("updateTitle").value = lead.Title || "";
    showOutput("Lead loaded", lead, "success");
  } catch (e) {
    showOutput("Load failed", e.payload || e.message, "error");
  } finally {
    els.fetchLeadBtn.disabled = false;
    els.fetchLeadBtn.textContent = "Load Lead";
  }
}

async function handleUpdate(e) {
  e.preventDefault();
  const id = $("updateLeadId").value.trim();
  if (!id) {
    showOutput("Missing ID", "Enter a Lead ID.", "error");
    return;
  }

  const fields = ["FirstName", "LastName", "Company", "Email", "Phone", "Title"];
  const payload = formToPayload(els.updateForm, fields);

  if (Object.keys(payload).length === 0) {
    showOutput("Nothing to update", "Fill in at least one field.", "error");
    return;
  }

  const submitBtn = els.updateForm.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = "Updating...";

  try {
    await sfRequest({
      method: "PATCH",
      path: `/sobjects/Lead/${encodeURIComponent(id)}`,
      body: payload,
    });
    showOutput(
      "Lead updated",
      { id, updated: payload, status: "204 No Content" },
      "success"
    );
  } catch (e) {
    showOutput("Update failed", e.payload || e.message, "error");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Update Lead";
  }
}
