const api = messenger.globalImapSearch;
const RESULT_PAGE = messenger.runtime.getURL("results/results.html");

let resultsTabId = null;
let activeSearchId = null;
let activeWindowId = null;
let preferences = { maxHits: 250, includeJunk: false };
let state = freshState("");
let contactCache = null;
const preferencesReady = messenger.storage.local
  .get("searchPreferences")
  .then(stored => {
    const saved = stored.searchPreferences || {};
    preferences.maxHits = Math.max(
      50,
      Math.min(5000, Number(saved.maxHits) || 250)
    );
    preferences.includeJunk = Boolean(saved.includeJunk);
    state.maxHits = preferences.maxHits;
    state.includeJunk = preferences.includeJunk;
  });

function savePreferences() {
  return messenger.storage.local.set({ searchPreferences: preferences });
}

function emailsFromVCard(vCard) {
  if (!vCard) {
    return [];
  }
  return String(vCard)
    .split(/\r?\n/)
    .filter(line => /^EMAIL(?:;[^:]*)?:/i.test(line))
    .map(line => line.slice(line.indexOf(":") + 1).trim())
    .filter(Boolean);
}

async function loadContacts() {
  if (contactCache) {
    return contactCache;
  }
  const books = await messenger.addressBooks.list(true);
  const contacts = [];
  const seen = new Set();
  for (const book of books) {
    for (const contact of book.contacts || []) {
      const properties = contact.properties || {};
      const name =
        properties.DisplayName ||
        [properties.FirstName, properties.LastName].filter(Boolean).join(" ") ||
        "";
      const emails = [
        properties.PrimaryEmail,
        properties.SecondEmail,
        ...emailsFromVCard(properties.vCard),
      ].filter(Boolean);
      for (const email of emails) {
        const normalized = String(email).toLocaleLowerCase();
        if (seen.has(normalized)) {
          continue;
        }
        seen.add(normalized);
        contacts.push({ name: name || email, email: String(email) });
      }
    }
  }
  contactCache = contacts.sort((a, b) => a.name.localeCompare(b.name));
  return contactCache;
}

async function searchContacts(query) {
  const terms = String(query || "")
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const contacts = await loadContacts();
  return contacts
    .filter(contact => {
      const haystack = `${contact.name} ${contact.email}`.toLocaleLowerCase();
      return terms.every(term => haystack.includes(term));
    })
    .slice(0, 12);
}

async function searchOptions(operator, query) {
  if (operator === "from" || operator === "to") {
    const contacts = await searchContacts(query);
    return contacts.map(contact => ({
      name: contact.name,
      value: contact.email,
      detail: contact.email,
      color: "",
    }));
  }
  const options =
    operator === "folder"
      ? await api.listFolders(activeWindowId || undefined, preferences.includeJunk)
      : await api.listTags();
  const terms = String(query || "").toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return options
    .filter(option => {
      const haystack = `${option.name} ${option.value} ${option.detail}`.toLocaleLowerCase();
      return terms.every(term => haystack.includes(term));
    })
    .slice(0, 20);
}

function freshState(query) {
  return {
    query,
    searchId: null,
    accountName: "",
    scopeFolderURI: "",
    scopeFolderName: "",
    totalFolders: 0,
    searchedFolders: 0,
    folderName: "",
    results: [],
    errors: [],
    hitCount: 0,
    maxHits: preferences.maxHits,
    includeJunk: preferences.includeJunk,
    limitReached: false,
    status: query ? "starting" : "idle",
    message: query
      ? "Preparing server search…"
      : "Enter a query or choose filters to search the IMAP server.",
  };
}

function snapshot() {
  return {
    ...state,
    results: state.results.slice(),
    errors: state.errors.slice(),
  };
}

async function notifyPage(type, payload = {}) {
  if (resultsTabId === null) {
    return;
  }
  try {
    await messenger.tabs.sendMessage(resultsTabId, { type, ...payload });
  } catch (error) {
    // The tab can still be loading. Its ready message will request a snapshot.
  }
}

async function ensureResultsTab() {
  if (resultsTabId !== null) {
    try {
      await messenger.tabs.update(resultsTabId, { active: true });
      return;
    } catch (error) {
      resultsTabId = null;
    }
  }
  const tab = await messenger.tabs.create({ url: RESULT_PAGE, active: true });
  resultsTabId = tab.id;
}

async function openSearchWorkspace(windowId) {
  await preferencesReady;
  activeWindowId = windowId || activeWindowId;
  await ensureResultsTab();
  await notifyPage("state", { state: snapshot() });
  await notifyPage("focus-search");
}

async function beginSearch(
  query,
  windowId = activeWindowId,
  maxHits,
  includeJunk,
  folderURI = ""
) {
  await preferencesReady;
  const trimmed = String(query || "").trim();
  if (!trimmed) {
    return;
  }
  if (activeSearchId) {
    await api.cancelSearch(activeSearchId);
  }
  const requestedMaxHits = Math.max(
    50,
    Math.min(5000, Number(maxHits ?? preferences.maxHits) || 250)
  );
  const requestedIncludeJunk =
    includeJunk === undefined ? preferences.includeJunk : Boolean(includeJunk);
  preferences = {
    maxHits: requestedMaxHits,
    includeJunk: requestedIncludeJunk,
  };
  await savePreferences();
  state = freshState(trimmed);
  state.scopeFolderURI = folderURI || "";
  state.maxHits = requestedMaxHits;
  state.includeJunk = requestedIncludeJunk;
  activeSearchId = null;
  activeWindowId = windowId || null;
  await ensureResultsTab();
  await notifyPage("state", { state: snapshot() });
  try {
    const started = await api.startSearch(
      trimmed,
      activeWindowId || undefined,
      requestedMaxHits,
      state.includeJunk,
      folderURI || undefined
    );
    activeSearchId = started.searchId;
    state.searchId = started.searchId;
    state.accountName = started.accountName;
    state.scopeFolderURI = started.scopeFolderURI || "";
    state.scopeFolderName = started.scopeFolderName || "";
    state.totalFolders = started.totalFolders;
    state.status = "searching";
    state.message = `Searching ${started.accountName} on the IMAP server…`;
    await notifyPage("state", { state: snapshot() });
  } catch (error) {
    state.status = "error";
    state.message = error.message || String(error);
    state.errors = [{ folderName: "Search", error: state.message }];
    await notifyPage("state", { state: snapshot() });
  }
}

api.onToolbarSearch.addListener(request => {
  if (request.query) {
    beginSearch(
      request.query,
      request.windowId,
      undefined,
      undefined,
      request.folderURI || ""
    );
  } else {
    openSearchWorkspace(request.windowId);
  }
});

api.onSearchProgress.addListener(progress => {
  if (progress.searchId !== activeSearchId) {
    return;
  }
  state.status = "searching";
  state.folderName = progress.folderName;
  state.searchedFolders = progress.searchedFolders;
  state.totalFolders = progress.totalFolders;
  state.hitCount = progress.hitCount;
  state.message = `Searching ${progress.folderName}…`;
  notifyPage("progress", { progress });
});

api.onSearchResult.addListener(results => {
  if (!results.length || results[0].searchId !== activeSearchId) {
    return;
  }
  state.results.push(...results);
  state.hitCount = state.results.length;
  notifyPage("results", { results });
});

api.onSearchComplete.addListener(summary => {
  if (summary.searchId !== activeSearchId) {
    return;
  }
  state.searchedFolders = summary.searchedFolders;
  state.totalFolders = summary.totalFolders;
  state.hitCount = summary.hitCount;
  state.errors = summary.errors || [];
  state.limitReached = summary.limitReached;
  if (summary.cancelled) {
    state.status = "cancelled";
    state.message = `Search cancelled after ${summary.searchedFolders} folders.`;
  } else if (summary.limitReached) {
    state.status = "limited";
    state.message = `Stopped after reaching the ${summary.hitCount}-message limit.`;
  } else if (state.errors.length) {
    state.status = "partial";
    state.message = `Finished with ${state.errors.length} folder error${
      state.errors.length === 1 ? "" : "s"
    }.`;
  } else {
    state.status = "complete";
    state.message = summary.hitCount
      ? `Found ${summary.hitCount} message${summary.hitCount === 1 ? "" : "s"}.`
      : "No messages matched on the server.";
  }
  activeSearchId = null;
  notifyPage("complete", { summary, state: snapshot() });
});

messenger.runtime.onMessage.addListener((message, sender) => {
  switch (message.type) {
    case "ready":
      if (sender.tab) {
        resultsTabId = sender.tab.id;
      }
      return preferencesReady.then(() => ({ state: snapshot() }));
    case "start-search":
      return beginSearch(
        message.query,
        activeWindowId,
        message.maxHits,
        message.includeJunk,
        state.scopeFolderURI || ""
      ).then(() => ({ ok: true }));
    case "global-search":
      return beginSearch(
        message.query,
        activeWindowId,
        message.maxHits,
        message.includeJunk,
        ""
      ).then(() => ({ ok: true }));
    case "cancel-search":
      if (activeSearchId) {
        return api.cancelSearch(activeSearchId).then(() => ({ ok: true }));
      }
      return Promise.resolve({ ok: true });
    case "open-message":
      return api
        .openMessage(
          message.folderURI,
          message.messageKey,
          Boolean(message.openInTab)
        )
        .then(() => ({ ok: true }))
        .catch(error => ({ ok: false, error: error.message || String(error) }));
    case "search-contacts":
      return searchContacts(message.query)
        .then(contacts => ({ ok: true, contacts }))
        .catch(error => ({ ok: false, error: error.message || String(error) }));
    case "search-options":
      return searchOptions(message.operator, message.query)
        .then(options => ({ ok: true, options }))
        .catch(error => ({ ok: false, error: error.message || String(error) }));
    case "update-settings": {
      const maxHits = Math.max(
        50,
        Math.min(5000, Number(message.maxHits) || preferences.maxHits)
      );
      preferences = {
        maxHits,
        includeJunk: Boolean(message.includeJunk),
      };
      state.maxHits = preferences.maxHits;
      state.includeJunk = preferences.includeJunk;
      return savePreferences().then(() => ({ ok: true }));
    }
    default:
      return undefined;
  }
});

messenger.tabs.onRemoved.addListener(tabId => {
  if (tabId !== resultsTabId) {
    return;
  }
  resultsTabId = null;
  if (activeSearchId) {
    api.cancelSearch(activeSearchId);
  }
});

api.initialize();

for (const event of [
  messenger.contacts?.onCreated,
  messenger.contacts?.onUpdated,
  messenger.contacts?.onDeleted,
]) {
  event?.addListener?.(() => {
    contactCache = null;
  });
}
