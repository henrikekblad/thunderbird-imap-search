const queryInput = document.getElementById("query");
const form = document.getElementById("search-form");
const searchButton = document.getElementById("search-button");
const globalSearchButton = document.getElementById("global-search-button");
const cancelButton = document.getElementById("cancel-button");
const maxHits = document.getElementById("max-hits");
const includeJunk = document.getElementById("include-junk");
const junkOption = document.getElementById("junk-option");
const folderFilterButton = document.getElementById("folder-filter-button");
const datePickerPanel = document.getElementById("date-picker-panel");
const datePickerLabel = document.getElementById("date-picker-label");
const datePicker = document.getElementById("date-picker");
const dateToday = document.getElementById("date-today");
const datePickerError = document.getElementById("date-picker-error");
const calendarPrevious = document.getElementById("calendar-previous");
const calendarNext = document.getElementById("calendar-next");
const calendarYearButton = document.getElementById("calendar-year");
const calendarMonthButton = document.getElementById("calendar-month");
const calendarDayView = document.getElementById("calendar-day-view");
const calendarDays = document.getElementById("calendar-days");
const calendarOptions = document.getElementById("calendar-options");
const peoplePickerPanel = document.getElementById("people-picker-panel");
const peoplePickerTitle = document.getElementById("people-picker-title");
const peoplePickerStatus = document.getElementById("people-picker-status");
const peoplePickerResults = document.getElementById("people-picker-results");
const heading = document.getElementById("heading");
const statusElement = document.getElementById("status");
const hitCount = document.getElementById("hit-count");
const folderCount = document.getElementById("folder-count");
const progressBar = document.getElementById("progress");
const resultBody = document.getElementById("result-body");
const emptyState = document.getElementById("empty-state");
const errorsBox = document.getElementById("errors");
const errorsSummary = document.getElementById("errors-summary");
const errorsList = document.getElementById("errors-list");

let results = [];
let selectedKey = null;
let sortField = "date";
let sortDirection = -1;
let renderTimer = null;
let clickTimer = null;
let activeDateToken = null;
let calendarMonth = null;
let calendarMode = "days";
let yearPageStart = 0;
let activePeopleToken = null;
let peopleSearchTimer = null;
let peopleRequestSerial = 0;

function positionPopup(panel, tokenStart, width) {
  const inputRect = queryInput.getBoundingClientRect();
  const style = getComputedStyle(queryInput);
  const canvas = positionPopup.canvas ||
    (positionPopup.canvas = document.createElement("canvas"));
  const context = canvas.getContext("2d");
  context.font = style.font;
  const textBeforeToken = queryInput.value.slice(0, tokenStart);
  const textWidth = context.measureText(textBeforeToken).width;
  const paddingLeft = Number.parseFloat(style.paddingLeft) || 0;
  const desiredLeft = inputRect.left + paddingLeft + textWidth - queryInput.scrollLeft;
  const left = Math.max(8, Math.min(desiredLeft, window.innerWidth - width - 8));
  panel.style.left = `${left}px`;
  panel.style.top = `${inputRect.bottom + 6}px`;
}

function positionDatePicker() {
  if (!activeDateToken || datePickerPanel.hidden) {
    return;
  }
  positionPopup(datePickerPanel, activeDateToken.start, 292);
}

function positionPeoplePicker() {
  if (!activePeopleToken || peoplePickerPanel.hidden) {
    return;
  }
  positionPopup(peoplePickerPanel, activePeopleToken.start, 340);
}

function applyPerson(value) {
  if (!activePeopleToken) {
    return;
  }
  const encodedValue = /\s/.test(value) ? `"${value.replaceAll('"', '\\"')}"` : value;
  const replacement = `${activePeopleToken.operator}:${encodedValue}`;
  queryInput.value =
    queryInput.value.slice(0, activePeopleToken.start) +
    replacement +
    queryInput.value.slice(activePeopleToken.end);
  const caret = activePeopleToken.start + replacement.length;
  queryInput.focus();
  queryInput.setSelectionRange(caret, caret);
  activePeopleToken = null;
  peoplePickerPanel.hidden = true;
}

function renderPeople(contacts) {
  peoplePickerResults.replaceChildren();
  peoplePickerStatus.hidden = contacts.length > 0;
  peoplePickerStatus.textContent = contacts.length
    ? ""
    : "No matching contacts in your address books.";
  const fragment = document.createDocumentFragment();
  for (const contact of contacts) {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "option");
    const name = document.createElement("span");
    name.className = "contact-name";
    if (contact.color) {
      name.style.setProperty("--tag-color", contact.color);
      name.classList.add("tag-choice");
    }
    name.textContent = contact.name;
    const email = document.createElement("span");
    email.className = "contact-email";
    email.textContent = contact.detail || contact.email || "";
    button.append(name);
    if (email.textContent) {
      button.append(email);
    } else {
      button.classList.add("single-column");
    }
    button.addEventListener("click", () =>
      applyPerson(contact.value || contact.email)
    );
    fragment.append(button);
  }
  peoplePickerResults.append(fragment);
}

function requestPeople(query) {
  clearTimeout(peopleSearchTimer);
  const serial = ++peopleRequestSerial;
  peoplePickerStatus.hidden = false;
  peoplePickerStatus.textContent = "Searching address books…";
  peopleSearchTimer = setTimeout(async () => {
    const response = await messenger.runtime.sendMessage({
      type: "search-options",
      operator: activePeopleToken.operator,
      query,
    });
    if (serial !== peopleRequestSerial || !activePeopleToken) {
      return;
    }
    if (!response?.ok) {
      peoplePickerStatus.hidden = false;
      peoplePickerStatus.textContent = response?.error || "Address-book search failed.";
      peoplePickerResults.replaceChildren();
      return;
    }
    renderPeople(response.options);
  }, 120);
}

function syncPeoplePicker(openPicker = false) {
  const caret = queryInput.selectionStart ?? queryInput.value.length;
  const beforeCaret = queryInput.value.slice(0, caret);
  const match = beforeCaret.match(/(^|\s)(from|to|folder|tag):([^\s]*)$/i);
  if (!match) {
    activePeopleToken = null;
    peoplePickerPanel.hidden = true;
    return;
  }
  const leadingLength = match[1].length;
  activePeopleToken = {
    start: match.index + leadingLength,
    end: caret,
    operator: match[2].toLowerCase(),
  };
  const pickerTitles = {
    from: "Choose sender",
    to: "Choose recipient",
    folder: "Choose folder",
    tag: "Choose tag",
  };
  peoplePickerTitle.textContent = pickerTitles[activePeopleToken.operator];
  peoplePickerPanel.hidden = false;
  datePickerPanel.hidden = true;
  positionPeoplePicker();
  requestPeople(match[3]);
  if (openPicker) {
    queryInput.focus();
  }
}

function localISODate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function renderCalendar() {
  if (!calendarMonth) {
    return;
  }
  const year = calendarMonth.getFullYear();
  const month = calendarMonth.getMonth();
  calendarYearButton.textContent = String(year);
  calendarMonthButton.textContent = String(month + 1).padStart(2, "0");
  calendarDayView.hidden = calendarMode !== "days";
  calendarOptions.hidden = calendarMode === "days";
  if (calendarMode !== "days") {
    renderCalendarOptions();
    return;
  }
  const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7;
  const dayCount = new Date(year, month + 1, 0).getDate();
  const today = localISODate(new Date());
  const fragment = document.createDocumentFragment();
  for (let index = 0; index < firstWeekday; index++) {
    const blank = document.createElement("span");
    blank.className = "calendar-blank";
    fragment.append(blank);
  }
  for (let day = 1; day <= dayCount; day++) {
    const value = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = String(day);
    button.dataset.date = value;
    button.setAttribute("role", "gridcell");
    button.setAttribute("aria-label", value);
    button.classList.toggle("today", value === today);
    button.classList.toggle("selected", value === datePicker.value);
    button.addEventListener("click", () => {
      datePicker.value = value;
      applyPickedDate();
    });
    fragment.append(button);
  }
  calendarDays.replaceChildren(fragment);
}

function renderCalendarOptions() {
  const fragment = document.createDocumentFragment();
  if (calendarMode === "years") {
    for (let year = yearPageStart; year < yearPageStart + 12; year++) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = String(year);
      button.classList.toggle("selected", year === calendarMonth.getFullYear());
      button.addEventListener("click", () => {
        calendarMonth.setFullYear(year);
        calendarMode = "days";
        renderCalendar();
      });
      fragment.append(button);
    }
  } else {
    for (let month = 0; month < 12; month++) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = String(month + 1).padStart(2, "0");
      button.setAttribute("aria-label", `${calendarMonth.getFullYear()}-${button.textContent}`);
      button.classList.toggle("selected", month === calendarMonth.getMonth());
      button.addEventListener("click", () => {
        calendarMonth.setMonth(month);
        calendarMode = "days";
        renderCalendar();
      });
      fragment.append(button);
    }
  }
  calendarOptions.replaceChildren(fragment);
}

function syncDatePicker(openPicker = false) {
  const caret = queryInput.selectionStart ?? queryInput.value.length;
  const beforeCaret = queryInput.value.slice(0, caret);
  const match = beforeCaret.match(/(^|\s)(before|after):([0-9-]*)$/i);
  if (!match) {
    activeDateToken = null;
    datePickerPanel.hidden = true;
    return;
  }
  peoplePickerPanel.hidden = true;
  const leadingLength = match[1].length;
  activeDateToken = {
    start: match.index + leadingLength,
    end: caret,
    operator: match[2].toLowerCase(),
  };
  datePickerLabel.textContent =
    activeDateToken.operator === "before" ? "Before date" : "After date";
  datePicker.value = /^\d{4}-\d{2}-\d{2}$/.test(match[3]) ? match[3] : "";
  const initialDate = validISODate(datePicker.value)
    ? new Date(`${datePicker.value}T12:00:00`)
    : new Date();
  calendarMonth = new Date(initialDate.getFullYear(), initialDate.getMonth(), 1);
  calendarMode = "days";
  renderCalendar();
  datePickerError.hidden = true;
  datePickerPanel.hidden = false;
  positionDatePicker();
  if (openPicker) {
    datePicker.focus();
    datePicker.select();
  }
}

function validISODate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function applyPickedDate() {
  if (!activeDateToken) {
    return;
  }
  if (!validISODate(datePicker.value)) {
    datePickerError.hidden = false;
    datePicker.focus();
    return;
  }
  const replacement = `${activeDateToken.operator}:${datePicker.value}`;
  queryInput.value =
    queryInput.value.slice(0, activeDateToken.start) +
    replacement +
    queryInput.value.slice(activeDateToken.end);
  const caret = activeDateToken.start + replacement.length;
  queryInput.focus();
  queryInput.setSelectionRange(caret, caret);
  activeDateToken = null;
  datePickerPanel.hidden = true;
}

function text(value) {
  return value == null ? "" : String(value);
}

function resultKey(result) {
  return `${result.folderURI}#${result.messageKey}`;
}

function formatDate(timestamp) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

function sortedResults() {
  return results.slice().sort((left, right) => {
    let a = left[sortField];
    let b = right[sortField];
    if (sortField !== "date") {
      a = text(a).toLocaleLowerCase();
      b = text(b).toLocaleLowerCase();
    }
    return (a < b ? -1 : a > b ? 1 : 0) * sortDirection;
  });
}

function makeCell(value, className) {
  const cell = document.createElement("td");
  cell.textContent = value;
  cell.title = value;
  if (className) {
    cell.className = className;
  }
  return cell;
}

function renderResults() {
  clearTimeout(renderTimer);
  renderTimer = null;
  const fragment = document.createDocumentFragment();
  for (const result of sortedResults()) {
    const row = document.createElement("tr");
    const key = resultKey(result);
    row.dataset.key = key;
    row.tabIndex = 0;
    row.classList.toggle("unread", !result.read);
    row.classList.toggle("selected", key === selectedKey);
    const flags = `${result.starred ? "★" : ""}${result.hasAttachment ? "📎" : ""}`;
    row.append(
      makeCell(flags, "flags"),
      makeCell(text(result.subject)),
      makeCell(text(result.author || result.recipients)),
      makeCell(formatDate(result.date)),
      makeCell(text(result.folderName))
    );
    row.addEventListener("click", event => {
      if (event.detail > 1) {
        return;
      }
      selectedKey = key;
      clearTimeout(clickTimer);
      clickTimer = setTimeout(() => openResult(result, false), 250);
    });
    row.addEventListener("dblclick", event => {
      event.preventDefault();
      clearTimeout(clickTimer);
      openResult(result, true);
    });
    row.addEventListener("keydown", event => {
      if (event.key === "Enter") {
        openResult(result, false);
      }
    });
    fragment.append(row);
  }
  resultBody.replaceChildren(fragment);
  emptyState.hidden = results.length > 0;
  hitCount.textContent = results.length.toLocaleString();
}

function scheduleRender() {
  if (renderTimer !== null) {
    return;
  }
  renderTimer = setTimeout(renderResults, 75);
}

async function openResult(result, openInTab) {
  const response = await messenger.runtime.sendMessage({
    type: "open-message",
    folderURI: result.folderURI,
    messageKey: result.messageKey,
    openInTab,
  });
  if (!response?.ok) {
    statusElement.textContent = response?.error || "The message could not be opened.";
  }
}

function renderErrors(errors) {
  errorsList.replaceChildren();
  errorsBox.hidden = !errors?.length;
  if (!errors?.length) {
    return;
  }
  errorsSummary.textContent = `${errors.length} folder error${errors.length === 1 ? "" : "s"}`;
  for (const item of errors) {
    const row = document.createElement("li");
    row.textContent = `${item.folderName}: ${item.error}`;
    errorsList.append(row);
  }
}

function renderState(state) {
  if (!state) {
    return;
  }
  queryInput.value = state.query || "";
  maxHits.value = String(state.maxHits || 250);
  includeJunk.checked = Boolean(state.includeJunk);
  const folderScoped = Boolean(state.scopeFolderURI);
  junkOption.hidden = folderScoped;
  folderFilterButton.hidden = folderScoped;
  globalSearchButton.hidden = !folderScoped;
  searchButton.textContent = state.scopeFolderName
    ? `Search ${state.scopeFolderName}`
    : "Search";
  searchButton.title = state.scopeFolderName
    ? `Search only ${state.scopeFolderName}`
    : "Search all folders in this IMAP account";
  heading.textContent = state.scopeFolderName
    ? `Results in ${state.scopeFolderName}`
    : state.accountName
    ? `Results in ${state.accountName}`
    : "IMAP Server Search";
  statusElement.textContent = state.message || "";
  folderCount.textContent = `${state.searchedFolders || 0} / ${state.totalFolders || 0} folders`;
  const running = state.status === "starting" || state.status === "searching";
  cancelButton.disabled = !running;
  cancelButton.hidden = !running;
  progressBar.hidden = !running;
  progressBar.max = Math.max(1, state.totalFolders || 1);
  progressBar.value = state.searchedFolders || 0;
  results = state.results || [];
  renderErrors(state.errors || []);
  renderResults();
}

form.addEventListener("submit", async event => {
  event.preventDefault();
  if (!queryInput.value.trim()) {
    queryInput.focus();
    return;
  }
  results = [];
  selectedKey = null;
  renderResults();
  cancelButton.disabled = false;
  cancelButton.hidden = false;
  statusElement.textContent = "Preparing server search…";
  progressBar.hidden = false;
  progressBar.removeAttribute("value");
  renderErrors([]);
  await messenger.runtime.sendMessage({
    type: "start-search",
    query: queryInput.value.trim(),
    maxHits: Number(maxHits.value),
    includeJunk: includeJunk.checked,
  });
});

cancelButton.addEventListener("click", async () => {
  cancelButton.disabled = true;
  statusElement.textContent = "Cancelling…";
  await messenger.runtime.sendMessage({ type: "cancel-search" });
});

globalSearchButton.addEventListener("click", async () => {
  if (!queryInput.value.trim()) {
    queryInput.focus();
    return;
  }
  results = [];
  selectedKey = null;
  renderResults();
  cancelButton.disabled = false;
  cancelButton.hidden = false;
  statusElement.textContent = "Preparing global server search…";
  progressBar.hidden = false;
  progressBar.removeAttribute("value");
  renderErrors([]);
  await messenger.runtime.sendMessage({
    type: "global-search",
    query: queryInput.value.trim(),
    maxHits: Number(maxHits.value),
    includeJunk: includeJunk.checked,
  });
});

function persistSearchSettings() {
  messenger.runtime.sendMessage({
    type: "update-settings",
    maxHits: Number(maxHits.value),
    includeJunk: includeJunk.checked,
  });
}

maxHits.addEventListener("change", persistSearchSettings);
includeJunk.addEventListener("change", persistSearchSettings);

for (const button of document.querySelectorAll("th button[data-sort]")) {
  button.addEventListener("click", () => {
    const field = button.dataset.sort;
    if (sortField === field) {
      sortDirection *= -1;
    } else {
      sortField = field;
      sortDirection = field === "date" ? -1 : 1;
    }
    renderResults();
  });
}

for (const button of document.querySelectorAll(".syntax button[data-insert]")) {
  button.addEventListener("click", () => {
    const insertion = button.dataset.insert;
    const start = queryInput.selectionStart ?? queryInput.value.length;
    const end = queryInput.selectionEnd ?? start;
    const before = queryInput.value.slice(0, start);
    const after = queryInput.value.slice(end);
    const leadingSpace = before && !/\s$/.test(before) ? " " : "";
    const trailingSpace = after && !/^\s/.test(after) ? " " : "";
    const inserted = `${leadingSpace}${insertion}${trailingSpace}`;
    queryInput.value = before + inserted + after;
    const caret = before.length + inserted.length - trailingSpace.length;
    queryInput.focus();
    queryInput.setSelectionRange(caret, caret);
    if (insertion === "before:" || insertion === "after:") {
      syncDatePicker(true);
    } else if (["from:", "to:", "folder:", "tag:"].includes(insertion)) {
      syncPeoplePicker(true);
    } else {
      syncDatePicker(false);
      syncPeoplePicker(false);
    }
  });
}

queryInput.addEventListener("input", () => {
  syncDatePicker(false);
  if (!activeDateToken) {
    syncPeoplePicker(false);
  }
});
queryInput.addEventListener("click", () => {
  syncDatePicker(false);
  if (!activeDateToken) {
    syncPeoplePicker(false);
  }
});
queryInput.addEventListener("keyup", event => {
  if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
    syncDatePicker(false);
    if (!activeDateToken) {
      syncPeoplePicker(false);
    }
  }
});
datePicker.addEventListener("change", applyPickedDate);
datePicker.addEventListener("keydown", event => {
  if (event.key === "Enter") {
    event.preventDefault();
    applyPickedDate();
  } else if (event.key === "Escape") {
    datePickerPanel.hidden = true;
    queryInput.focus();
  }
});
dateToday.addEventListener("click", () => {
  datePicker.value = localISODate(new Date());
  applyPickedDate();
});
calendarPrevious.addEventListener("click", () => {
  if (calendarMode === "years") {
    yearPageStart -= 12;
  } else if (calendarMode === "months") {
    calendarMonth.setFullYear(calendarMonth.getFullYear() - 1);
  } else {
    calendarMonth.setMonth(calendarMonth.getMonth() - 1);
  }
  renderCalendar();
});
calendarNext.addEventListener("click", () => {
  if (calendarMode === "years") {
    yearPageStart += 12;
  } else if (calendarMode === "months") {
    calendarMonth.setFullYear(calendarMonth.getFullYear() + 1);
  } else {
    calendarMonth.setMonth(calendarMonth.getMonth() + 1);
  }
  renderCalendar();
});
calendarYearButton.addEventListener("click", () => {
  calendarMode = "years";
  yearPageStart = Math.floor(calendarMonth.getFullYear() / 12) * 12;
  renderCalendar();
});
calendarMonthButton.addEventListener("click", () => {
  calendarMode = "months";
  renderCalendar();
});
window.addEventListener("resize", positionDatePicker);
window.addEventListener("resize", positionPeoplePicker);

messenger.runtime.onMessage.addListener(message => {
  if (message.type === "state") {
    renderState(message.state);
  } else if (message.type === "progress") {
    const item = message.progress;
    statusElement.textContent = `Searching ${item.folderName}…`;
    folderCount.textContent = `${item.searchedFolders} / ${item.totalFolders} folders`;
    progressBar.hidden = false;
    progressBar.max = Math.max(1, item.totalFolders);
    progressBar.value = item.searchedFolders;
  } else if (message.type === "results") {
    results.push(...message.results);
    hitCount.textContent = results.length.toLocaleString();
    scheduleRender();
  } else if (message.type === "complete") {
    renderState(message.state);
  } else if (message.type === "focus-search") {
    queryInput.focus();
    queryInput.select();
  }
});

messenger.runtime.sendMessage({ type: "ready" }).then(response => {
  renderState(response?.state);
  if (!response?.state?.query) {
    queryInput.focus();
  }
});
