import { invoke } from '@tauri-apps/api/core';

let collections = [];
let history = [];
let environments = [];
let currentRequest = null;
let selectedEnvironment = null;
let selectedCollectionId = null;

// Load data on startup
async function loadData() {
  try {
    collections = await invoke('load_collections');
    history = await invoke('load_history');
    environments = await invoke('load_environments');
    updateUI();
  } catch (error) {
    console.error('Failed to load data:', error);
  }
}

// Save data
async function saveData() {
  try {
    await invoke('save_collections', { collections });
    await invoke('save_history', { history });
    await invoke('save_environments', { environments });
  } catch (error) {
    console.error('Failed to save data:', error);
  }
}

// Update UI
function updateUI() {
  if (!selectedCollectionId && collections.length > 0) {
    selectedCollectionId = collections[0].id;
  }
  updateCollectionsList();
  updateHistoryList();
  updateEnvironmentsList();
  updateEnvironmentSelect();
}

// Collections
function updateCollectionsList() {
  const list = document.getElementById('collections-list');
  list.innerHTML = '';
  collections.forEach(collection => {
    const div = document.createElement('div');
    div.className = 'collection-item';
    div.textContent = collection.name;
    div.onclick = () => selectCollection(collection.id);
    if (collection.id === selectedCollectionId) {
      div.style.backgroundColor = '#d0d0d0';
    }
    list.appendChild(div);
  });
  updateCollectionRequests();
}

function selectCollection(collectionId) {
  selectedCollectionId = collectionId;
  updateCollectionsList();
}

function updateCollectionRequests() {
  const containerTitle = document.getElementById('selected-collection-title');
  const list = document.getElementById('collection-requests-list');
  list.innerHTML = '';
  const selected = collections.find((c) => c.id === selectedCollectionId);

  if (!selected) {
    containerTitle.textContent = 'Select a collection to see requests';
    return;
  }

  containerTitle.textContent = `Requests in ${selected.name}`;
  if (selected.requests.length === 0) {
    list.textContent = 'No saved requests yet.';
    return;
  }

  selected.requests.forEach((request) => {
    const div = document.createElement('div');
    div.className = 'request-item';
    div.textContent = `${request.method} ${request.name || request.url}`;
    div.onclick = () => loadRequest(request);
    list.appendChild(div);
  });
}

// History
function updateHistoryList() {
  const list = document.getElementById('history-list');
  list.innerHTML = '';
  const items = history.slice(-20).reverse();
  if (items.length === 0) {
    list.textContent = 'No history yet. Send a request to create history entries.';
    return;
  }

  items.forEach(item => {
    const div = document.createElement('div');
    div.className = 'request-item';
    const date = new Date(item.timestamp).toLocaleString();
    div.textContent = `${date}: ${item.request.method} ${item.request.url} - ${item.response.status}`;
    div.onclick = () => loadRequest(item.request);
    list.appendChild(div);
  });
}

// Environments
function updateEnvironmentsList() {
  const list = document.getElementById('environments-list');
  list.innerHTML = '';
  environments.forEach(env => {
    const div = document.createElement('div');
    div.className = 'collection-item';
    div.textContent = env.name;
    div.onclick = () => selectEnvironment(env);
    list.appendChild(div);
  });
}

function updateEnvironmentSelect() {
  const select = document.getElementById('environment-select');
  select.innerHTML = '<option value="">No Environment</option>';
  environments.forEach(env => {
    const option = document.createElement('option');
    option.value = env.id;
    option.textContent = env.name;
    select.appendChild(option);
  });
  select.value = selectedEnvironment ? selectedEnvironment.id : '';
}

function selectEnvironment(env) {
  selectedEnvironment = env;
  updateEnvironmentSelect();
}

// Auth
document.getElementById('auth-type').addEventListener('change', updateAuthFields);

function updateAuthFields() {
  const authType = document.getElementById('auth-type').value;
  const fields = document.getElementById('auth-fields');
  fields.innerHTML = '';
  if (authType === 'basic') {
    fields.innerHTML = `
      <input type="text" id="auth-username" placeholder="Username (optional)">
      <input type="password" id="auth-password" placeholder="Password (optional)">
    `;
  } else if (authType === 'bearer') {
    fields.innerHTML = `
      <input type="text" id="auth-token" placeholder="Bearer Token (optional)">
    `;
  }
}

// Send request
document.getElementById('send').addEventListener('click', async () => {
  const request = getCurrentRequest();
  const envVars = selectedEnvironment ? selectedEnvironment.variables : {};

  try {
    const response = await invoke('send_request', { request, envVars });
    displayResponse(response);
    addToHistory(request, response);
    saveData();
  } catch (error) {
    const errorText = `Error: ${error}`;
    document.getElementById('response-output-pre').textContent = errorText;
    document.getElementById('response-output-raw').textContent = errorText;
    document.getElementById('response-output-preview').textContent = errorText;
  }
});

function getCurrentRequest() {
  const authData = {};
  const authType = document.getElementById('auth-type').value;
  if (authType === 'basic') {
    authData.username = document.getElementById('auth-username').value;
    authData.password = document.getElementById('auth-password').value;
  } else if (authType === 'bearer') {
    authData.token = document.getElementById('auth-token').value;
  }

  const rawUrl = document.getElementById('url').value.trim();
  const curlRequest = parseCurlCommand(rawUrl);
  const method = curlRequest ? curlRequest.method : document.getElementById('method').value;
  const url = curlRequest ? curlRequest.url : rawUrl;
  const headers = curlRequest ? curlRequest.headers : document.getElementById('headers').value;
  const body = curlRequest ? curlRequest.body : document.getElementById('body').value;
  if (curlRequest) {
    document.getElementById('method').value = method;
    document.getElementById('url').value = url;
    document.getElementById('headers').value = headers;
    document.getElementById('body').value = body;
  }

  return {
    id: Date.now().toString(),
    name: document.getElementById('request-name').value || 'Unnamed Request',
    method,
    url,
    headers,
    body,
    authType,
    authData
  };
}

function parseCurlCommand(input) {
  const trimmed = input.trim();
  if (!trimmed.startsWith('curl ')) {
    return null;
  }

  const tokens = tokenizeCurl(trimmed);
  let method = 'GET';
  let url = '';
  let headers = '';
  let body = '';

  for (let i = 1; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === '-X' || token === '--request') {
      method = tokens[++i]?.toUpperCase() || method;
    } else if (token === '-H' || token === '--header') {
      const headerValue = stripQuotes(tokens[++i] || '');
      headers += `${headerValue}\n`;
    } else if (token === '-d' || token === '--data' || token === '--data-raw' || token === '--data-binary') {
      body = stripQuotes(tokens[++i] || '');
      if (!method || method === 'GET') {
        method = 'POST';
      }
    } else if (!token.startsWith('-') && !url) {
      url = stripQuotes(token);
    }
  }

  return { method, url, headers: headers.trim(), body };
}

function tokenizeCurl(input) {
  const regex = /'[^']*'|"[^"]*"|[^\s]+/g;
  return input.match(regex) || [];
}

function stripQuotes(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function displayResponse(response) {
  let body = response.body;
  try {
    const parsed = JSON.parse(body);
    body = JSON.stringify(parsed, null, 2);
  } catch (e) {
    // Not JSON, keep as is
  }
  const responseText = `Status: ${response.status}\n\nHeaders:\n${Object.entries(response.headers).map(([k,v]) => `${k}: ${v}`).join('\n')}\n\nBody:\n${body}`;
  document.getElementById('response-output-pre').textContent = body;
  document.getElementById('response-output-raw').textContent = responseText;
  document.getElementById('response-output-preview').textContent = body;
  document.getElementById('response-headers').textContent = Object.entries(response.headers).map(([k,v]) => `${k}: ${v}`).join('\n');
}

function addToHistory(request, response) {
  const item = {
    id: Date.now().toString(),
    timestamp: Date.now(),
    request,
    response
  };
  history.push(item);
  updateHistoryList();
}

function loadRequest(request) {
  document.getElementById('request-name').value = request.name;
  document.getElementById('method').value = request.method;
  document.getElementById('url').value = request.url;
  document.getElementById('headers').value = request.headers;
  document.getElementById('body').value = request.body;
  document.getElementById('auth-type').value = request.authType;
  updateAuthFields();
  // Load auth data
  if (request.authType === 'basic') {
    document.getElementById('auth-username').value = request.authData.username || '';
    document.getElementById('auth-password').value = request.authData.password || '';
  } else if (request.authType === 'bearer') {
    document.getElementById('auth-token').value = request.authData.token || '';
  }
}

// Sidebar tabs
const sidebarTabs = document.querySelectorAll('.sidebar-tab');
sidebarTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    sidebarTabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    document.querySelectorAll('.sidebar-panel').forEach(panel => panel.classList.remove('active'));
    document.getElementById(`${tab.dataset.tab}-panel`).classList.add('active');
  });
});

// Request configuration tabs
const requestTabs = document.querySelectorAll('.config-tab');
requestTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    requestTabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.remove('active'));
    document.getElementById(`${tab.dataset.tab}-panel`).classList.add('active');
  });
});

// Response tabs
const responseTabs = document.querySelectorAll('.response-tab');
responseTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    responseTabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    document.querySelectorAll('.response-body').forEach(panel => panel.classList.remove('active'));
    document.getElementById(`response-${tab.dataset.responseTab}-panel`).classList.add('active');
  });
});

// Response body view tabs
const responseViewTabs = document.querySelectorAll('.response-view-tab');
responseViewTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    responseViewTabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const activeView = tab.dataset.viewTab;
    document.getElementById('response-output-pre').classList.toggle('hidden', activeView !== 'pretty');
    document.getElementById('response-output-raw').classList.toggle('hidden', activeView !== 'raw');
    document.getElementById('response-output-preview').classList.toggle('hidden', activeView !== 'preview');
  });
});

// Copy buttons
const copyBodyButton = document.getElementById('copy-body');
if (copyBodyButton) {
  copyBodyButton.addEventListener('click', () => {
    const body = document.getElementById('body').value;
    navigator.clipboard.writeText(body).then(() => {
      copyBodyButton.textContent = 'Copied';
      setTimeout(() => { copyBodyButton.textContent = 'Copy'; }, 1000);
    });
  });
}

const copyResponseButton = document.getElementById('copy-response');
if (copyResponseButton) {
  copyResponseButton.addEventListener('click', () => {
    const activeView = document.querySelector('.response-view-tab.active').dataset.viewTab;
    const responseText = activeView === 'raw'
      ? document.getElementById('response-output-raw').textContent
      : document.getElementById('response-output-pre').textContent;
    navigator.clipboard.writeText(responseText).then(() => {
      copyResponseButton.textContent = 'Copied';
      setTimeout(() => { copyResponseButton.textContent = 'Copy'; }, 1000);
    });
  });
}

// Add collection
document.getElementById('add-collection').addEventListener('click', () => {
  const name = prompt('Collection name:');
  if (name) {
    const newCollection = {
      id: Date.now().toString(),
      name,
      requests: []
    };
    collections.push(newCollection);
    selectedCollectionId = newCollection.id;
    updateCollectionsList();
    saveData();
  }
});

// Add environment
document.getElementById('add-environment').addEventListener('click', () => {
  const name = prompt('Environment name:');
  if (name) {
    environments.push({
      id: Date.now().toString(),
      name,
      variables: {}
    });
    updateEnvironmentsList();
    updateEnvironmentSelect();
    saveData();
  }
});

// Environment select
document.getElementById('environment-select').addEventListener('change', (e) => {
  const envId = e.target.value;
  selectedEnvironment = environments.find(env => env.id === envId) || null;
});

// Save request
document.getElementById('save-request').addEventListener('click', () => {
  if (collections.length === 0) {
    alert('Create a collection first');
    return;
  }
  if (!selectedCollectionId) {
    alert('Select a collection first');
    return;
  }
  const request = getCurrentRequest();
  const collection = collections.find((c) => c.id === selectedCollectionId);
  if (!collection) {
    alert('Selected collection not found');
    return;
  }
  collection.requests.push(request);
  saveData();
  updateCollectionRequests();
  alert('Request saved to collection');
});

// Initialize
loadData();