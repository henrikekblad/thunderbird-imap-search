/* global ExtensionCommon, Services, Cc, Ci, Cr, ChromeUtils */

var globalImapSearch = class extends ExtensionCommon.ExtensionAPI {
  constructor(extension) {
    super(extension);
    this._windows = new Map();
    this._searches = new Map();
    this._eventSinks = {
      toolbar: new Set(),
      progress: new Set(),
      result: new Set(),
      complete: new Set(),
    };
    this._windowListener = null;
    this._initialized = false;
    this._serial = 0;
  }

  _mailServices() {
    if (!this.__mailServices) {
      try {
        this.__mailServices = ChromeUtils.importESModule(
          "resource:///modules/MailServices.sys.mjs"
        ).MailServices;
      } catch (error) {
        this.__mailServices = ChromeUtils.import(
          "resource:///modules/MailServices.jsm"
        ).MailServices;
      }
    }
    return this.__mailServices;
  }

  _mailUtils() {
    if (!this.__mailUtils) {
      try {
        this.__mailUtils = ChromeUtils.importESModule(
          "resource:///modules/MailUtils.sys.mjs"
        ).MailUtils;
      } catch (error) {
        this.__mailUtils = ChromeUtils.import(
          "resource:///modules/MailUtils.jsm"
        ).MailUtils;
      }
    }
    return this.__mailUtils;
  }

  _emit(kind, value) {
    for (const fire of this._eventSinks[kind]) {
      fire.async(value).catch(console.error);
    }
  }

  _event(context, kind, name) {
    return new ExtensionCommon.EventManager({
      context,
      name: `globalImapSearch.${name}`,
      register: fire => {
        this._eventSinks[kind].add(fire);
        return () => this._eventSinks[kind].delete(fire);
      },
    }).api();
  }

  _windowId(window) {
    try {
      return window.docShell.outerWindowID;
    } catch (error) {
      return 0;
    }
  }

  _walkOpenRoots(root, callback) {
    callback(root);
    for (const element of root.querySelectorAll("*")) {
      if (element.shadowRoot) {
        this._walkOpenRoots(element.shadowRoot, callback);
      }
    }
  }

  _findSearchControls(window) {
    const controls = [];
    this._walkOpenRoots(window.document, root => {
      const modern = root.querySelectorAll?.("global-search-bar") || [];
      for (const element of modern) {
        controls.push({ element, modern: true });
      }
      const legacy = root.querySelector?.("#searchBox");
      if (legacy) {
        controls.push({ element: legacy, modern: false });
      }
      const container = root.querySelector?.("#widget-search-container");
      if (container && !modern.length) {
        const input = container.querySelector("input[type='search'], input");
        if (input) {
          controls.push({ element: input, modern: false });
        }
      }
    });
    return controls.filter(
      (item, index) =>
        controls.findIndex(other => other.element === item.element) === index
    );
  }

  _findQuickFilterControls(window) {
    const documents = new Set([window.document]);
    const about3Pane =
      window.gTabmail?.currentAbout3Pane || window.currentAbout3Pane || null;
    if (about3Pane?.document) {
      documents.add(about3Pane.document);
    }
    for (const browser of window.document.querySelectorAll("browser")) {
      try {
        if (browser.contentDocument) {
          documents.add(browser.contentDocument);
        }
      } catch (error) {}
    }
    const controls = [];
    for (const document of documents) {
      for (const selector of [
        "#qfb-qs-textbox",
        "#quick-filter-bar input[type='search']",
        "#quickFilterBar input[type='search']",
      ]) {
        const element = document.querySelector(selector);
        if (element) {
          controls.push(element);
          break;
        }
      }
    }
    return controls.filter(
      (element, index) => controls.indexOf(element) === index
    );
  }

  _attachWindow(window) {
    if (
      !window ||
      window.closed ||
      window.document.documentElement.getAttribute("windowtype") !== "mail:3pane"
    ) {
      return;
    }
    if (this._windows.has(window)) {
      this._scanWindow(window);
      return;
    }
    const state = {
      controls: new Map(),
      quickFilterControls: new Map(),
      hiddenToolbars: new Map(),
      observer: null,
      timer: null,
    };
    state.observer = new window.MutationObserver(() => {
      window.clearTimeout(state.timer);
      state.timer = window.setTimeout(() => this._scanWindow(window), 50);
    });
    state.observer.observe(window.document.documentElement, {
      childList: true,
      subtree: true,
    });
    this._windows.set(window, state);
    this._scanWindow(window);
  }

  _scanWindow(window) {
    const state = this._windows.get(window);
    if (!state) {
      return;
    }
    this._hideResultsNavigation(window, state);
    for (const { element, modern } of this._findSearchControls(window)) {
      if (state.controls.has(element)) {
        continue;
      }
      const oldPlaceholder = element.getAttribute("placeholder");
      const oldTitle = element.getAttribute("title");
      const listeners = [];
      let injectedLabel = null;
      let injectedStyle = null;
      let injectedButton = null;
      let oldButtonTitle = null;
      if (modern) {
        const searchListener = event => {
          const query = String(event.detail || element.value || "").trim();
          if (!query) {
            return;
          }
          event.preventDefault();
          event.stopImmediatePropagation();
          this._emit("toolbar", {
            query,
            windowId: this._windowId(window),
          });
        };
        const autocompleteListener = event => {
          event.stopImmediatePropagation();
          const popup = window.document.getElementById("PopupGlodaAutocomplete");
          popup?.closePopup?.();
        };
        element.addEventListener("search", searchListener, true);
        element.addEventListener("autocomplete", autocompleteListener, true);
        listeners.push(
          ["search", searchListener, element],
          ["autocomplete", autocompleteListener, element]
        );
        const button = element.shadowRoot?.querySelector("#search-button");
        if (button) {
          injectedButton = button;
          oldButtonTitle = button.getAttribute("title");
          const buttonListener = event => {
            const query = String(element.value || "").trim();
            if (query) {
              return;
            }
            event.preventDefault();
            event.stopImmediatePropagation();
            this._emit("toolbar", {
              query: "",
              windowId: this._windowId(window),
            });
          };
          button.addEventListener("click", buttonListener, true);
          listeners.push(["click", buttonListener, button]);
          injectedLabel = window.document.createElement("span");
          injectedLabel.className = "global-imap-search-label";
          injectedLabel.slot = "search-button";
          injectedLabel.textContent = "IMAP search";
          element.append(injectedLabel);
          injectedStyle = window.document.createElement("style");
          injectedStyle.textContent = `
            form {
              --search-buttons-padding: 148px;
            }
            form:has(#clear-button[hidden]) {
              --search-buttons-padding: 126px;
            }
            #search-button {
              width: 112px;
              inset-inline-end: 6px;
              box-sizing: border-box;
              padding-inline: 8px;
              flex-direction: row;
              align-items: center;
              justify-content: center;
              gap: 5px;
            }
            #clear-button.button {
              inset-inline-end: 118px;
            }
            ::slotted(.search-button-icon) {
              width: 16px;
              min-width: 16px;
              max-width: 16px;
              height: 16px;
              min-height: 16px;
              max-height: 16px;
              object-fit: contain;
            }
            ::slotted(.global-imap-search-label) {
              display: inline;
              font: menu;
              line-height: 1;
              white-space: nowrap;
            }
          `;
          element.shadowRoot.append(injectedStyle);
          button.setAttribute("title", "Open IMAP server search");
        }
      } else {
        const keyListener = event => {
          if (event.key !== "Enter" || event.isComposing) {
            return;
          }
          const query = String(element.value || "").trim();
          if (!query) {
            return;
          }
          event.preventDefault();
          event.stopImmediatePropagation();
          this._emit("toolbar", {
            query,
            windowId: this._windowId(window),
          });
        };
        const inputListener = event => event.stopImmediatePropagation();
        element.addEventListener("keydown", keyListener, true);
        element.addEventListener("input", inputListener, true);
        listeners.push(
          ["keydown", keyListener, element],
          ["input", inputListener, element]
        );
      }
      const oldAutocompleteSearch = element.getAttribute("autocompletesearch");
      element.removeAttribute("autocompletesearch");
      element.setAttribute("placeholder", "Search this IMAP account on the server");
      element.setAttribute(
        "title",
        "Global IMAP server search (does not use the local index)"
      );
      element.setAttribute("data-global-imap-search", "true");
      state.controls.set(element, {
        listeners,
        oldPlaceholder,
        oldTitle,
        oldAutocompleteSearch,
        injectedLabel,
        injectedStyle,
        injectedButton,
        oldButtonTitle,
      });
    }
    for (const element of this._findQuickFilterControls(window)) {
      if (state.quickFilterControls.has(element)) {
        continue;
      }
      const oldTitle = element.getAttribute("title");
      const keyListener = event => {
        if (event.key !== "Enter" || event.isComposing) {
          return;
        }
        const query = String(element.value || "").trim();
        const folder = this._activeFolder(window);
        if (!query || folder?.server?.type !== "imap" || !folder.URI) {
          return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        this._emit("toolbar", {
          query,
          windowId: this._windowId(window),
          folderURI: folder.URI,
        });
      };
      element.addEventListener("keydown", keyListener, true);
      element.setAttribute(
        "title",
        "Press Enter to search this folder on the IMAP server"
      );
      element.setAttribute("data-global-imap-folder-search", "true");
      state.quickFilterControls.set(element, { keyListener, oldTitle });
    }
  }

  _hideResultsNavigation(window, state) {
    let resultsURL = "";
    try {
      resultsURL =
        this.extension.baseURI?.resolve?.("results/results.html") ||
        this.extension.rootURI?.resolve?.("results/results.html") ||
        "";
    } catch (error) {}
    if (!resultsURL) {
      return;
    }
    for (const tab of window.gTabmail?.tabInfo || []) {
      let currentURL = "";
      try {
        currentURL = tab.browser?.currentURI?.spec || "";
      } catch (error) {}
      if (!currentURL.startsWith(resultsURL)) {
        continue;
      }
      const toolbox = tab.root?.firstElementChild;
      if (!toolbox || state.hiddenToolbars.has(toolbox)) {
        continue;
      }
      state.hiddenToolbars.set(toolbox, {
        hidden: toolbox.hasAttribute("hidden"),
      });
      toolbox.setAttribute("hidden", "true");
      toolbox.setAttribute("data-global-imap-results-toolbar", "true");
    }
  }

  _detachWindow(window) {
    const state = this._windows.get(window);
    if (!state) {
      return;
    }
    state.observer.disconnect();
    window.clearTimeout(state.timer);
    for (const [element, saved] of state.controls) {
      for (const [eventName, listener, target] of saved.listeners) {
        target.removeEventListener(eventName, listener, true);
      }
      saved.injectedLabel?.remove();
      saved.injectedStyle?.remove();
      if (saved.injectedButton) {
        if (saved.oldButtonTitle === null) {
          saved.injectedButton.removeAttribute("title");
        } else {
          saved.injectedButton.setAttribute("title", saved.oldButtonTitle);
        }
      }
      if (saved.oldPlaceholder === null) {
        element.removeAttribute("placeholder");
      } else {
        element.setAttribute("placeholder", saved.oldPlaceholder);
      }
      if (saved.oldTitle === null) {
        element.removeAttribute("title");
      } else {
        element.setAttribute("title", saved.oldTitle);
      }
      if (saved.oldAutocompleteSearch === null) {
        element.removeAttribute("autocompletesearch");
      } else {
        element.setAttribute("autocompletesearch", saved.oldAutocompleteSearch);
      }
      element.removeAttribute("data-global-imap-search");
    }
    for (const [element, saved] of state.quickFilterControls) {
      element.removeEventListener("keydown", saved.keyListener, true);
      if (saved.oldTitle === null) {
        element.removeAttribute("title");
      } else {
        element.setAttribute("title", saved.oldTitle);
      }
      element.removeAttribute("data-global-imap-folder-search");
    }
    for (const [toolbox, saved] of state.hiddenToolbars) {
      if (!saved.hidden) {
        toolbox.removeAttribute("hidden");
      }
      toolbox.removeAttribute("data-global-imap-results-toolbar");
    }
    this._windows.delete(window);
  }

  async _initialize() {
    if (this._initialized) {
      return;
    }
    this._initialized = true;
    for (const window of Services.wm.getEnumerator("mail:3pane")) {
      this._attachWindow(window);
    }
    this._windowListener = {
      onOpenWindow: xulWindow => {
        const window = xulWindow.docShell.domWindow;
        window.addEventListener(
          "load",
          () => this._attachWindow(window),
          { once: true }
        );
      },
      onCloseWindow: xulWindow => this._detachWindow(xulWindow.docShell.domWindow),
    };
    Services.wm.addListener(this._windowListener);
  }

  async _shutdown() {
    if (!this._initialized) {
      return;
    }
    this._initialized = false;
    if (this._windowListener) {
      Services.wm.removeListener(this._windowListener);
      this._windowListener = null;
    }
    for (const search of this._searches.values()) {
      this._cancel(search);
    }
    for (const window of [...this._windows.keys()]) {
      this._detachWindow(window);
    }
  }

  _asArray(collection, iface) {
    if (!collection) {
      return [];
    }
    try {
      return Array.from(collection);
    } catch (error) {
      const result = [];
      const length = collection.length ?? collection.Count?.() ?? 0;
      for (let index = 0; index < length; index++) {
        try {
          result.push(
            collection.queryElementAt
              ? collection.queryElementAt(index, iface)
              : collection.GetElementAt(index).QueryInterface(iface)
          );
        } catch (itemError) {
          console.error(itemError);
        }
      }
      return result;
    }
  }

  _accounts() {
    return this._asArray(this._mailServices().accounts.accounts, Ci.nsIMsgAccount);
  }

  _windowForId(windowId) {
    for (const window of Services.wm.getEnumerator("mail:3pane")) {
      if (!windowId || this._windowId(window) === windowId) {
        return window;
      }
    }
    return Services.wm.getMostRecentWindow("mail:3pane");
  }

  _activeFolder(window) {
    if (!window) {
      return null;
    }
    return (
      window.gFolderDisplay?.displayedFolder ||
      window.gTabmail?.currentAbout3Pane?.gFolder ||
      window.currentAbout3Pane?.gFolder ||
      null
    );
  }

  _chooseAccount(windowId) {
    const accounts = this._accounts();
    const activeFolder = this._activeFolder(this._windowForId(windowId));
    if (activeFolder?.server?.type === "imap") {
      const active = accounts.find(
        account => account.incomingServer?.key === activeFolder.server.key
      );
      if (active) {
        return active;
      }
    }
    const defaultAccount = this._mailServices().accounts.defaultAccount;
    if (defaultAccount?.incomingServer?.type === "imap") {
      return defaultAccount;
    }
    return accounts.find(account => account.incomingServer?.type === "imap") || null;
  }

  _childFolders(folder) {
    try {
      return this._asArray(folder.subFolders, Ci.nsIMsgFolder);
    } catch (error) {
      return [];
    }
  }

  _searchableFolders(root, includeJunk = false) {
    const result = [];
    const stack = [...this._childFolders(root)].reverse();
    const virtualFlag = Ci.nsMsgFolderFlags.Virtual || 0;
    const noSelectFlag = Ci.nsMsgFolderFlags.ImapNoselect || 0;
    const junkFlag = Ci.nsMsgFolderFlags.Junk || 0;
    const trashFlag = Ci.nsMsgFolderFlags.Trash || 0;
    while (stack.length) {
      const folder = stack.pop();
      let flags = 0;
      try {
        flags = folder.flags;
      } catch (error) {}
      const isJunkOrTrash =
        Boolean(flags & (junkFlag | trashFlag)) ||
        /^(junk|spam|trash|deleted(?: messages| items)?)$/i.test(
          folder.prettyName || ""
        );
      if (!includeJunk && isJunkOrTrash) {
        continue;
      }
      const children = this._childFolders(folder);
      stack.push(...children.reverse());
      if (
        folder.server?.type === "imap" &&
        !(flags & virtualFlag) &&
        !(flags & noSelectFlag) &&
        folder.canFileMessages !== false
      ) {
        result.push(folder);
      }
    }
    return result;
  }

  _folderPath(folder, root) {
    const parts = [];
    let current = folder;
    while (current && current !== root && !current.isServer) {
      parts.unshift(current.prettyName || current.name);
      current = current.parent;
    }
    return parts.join("/");
  }

  async _listFolders(windowId, includeJunk = false) {
    const account = this._chooseAccount(windowId);
    if (!account) {
      return [];
    }
    const root = account.incomingServer.rootFolder;
    return this._searchableFolders(root, includeJunk).map(folder => {
      const path = this._folderPath(folder, root);
      return {
        name: folder.prettyName || folder.name,
        value: path,
        detail: path,
      };
    });
  }

  async _listTags() {
    return this._asArray(this._mailServices().tags.getAllTags(), Ci.nsIMsgTag).map(
      tag => ({
        name: tag.tag,
        value: tag.tag,
        detail: "",
        color: tag.color || "",
      })
    );
  }

  _tagKey(value) {
    const wanted = value.toLocaleLowerCase();
    for (const tag of this._asArray(
      this._mailServices().tags.getAllTags(),
      Ci.nsIMsgTag
    )) {
      if (
        tag.tag.toLocaleLowerCase() === wanted ||
        tag.key.toLocaleLowerCase() === wanted
      ) {
        return tag.key;
      }
    }
    return value;
  }

  _tokenize(query) {
    const tokens = [];
    let value = "";
    let quote = false;
    for (let index = 0; index < query.length; index++) {
      const character = query[index];
      if (character === "\\" && quote && index + 1 < query.length) {
        value += query[++index];
      } else if (character === '"') {
        quote = !quote;
      } else if (/\s/.test(character) && !quote) {
        if (value) {
          tokens.push(value);
          value = "";
        }
      } else {
        value += character;
      }
    }
    if (quote) {
      throw new Error("The query contains an unterminated quoted phrase.");
    }
    if (value) {
      tokens.push(value);
    }
    return tokens;
  }

  _parseQuery(query) {
    const tokens = this._tokenize(query.trim());
    if (!tokens.length) {
      throw new Error("Enter a search query.");
    }
    const clauses = [[]];
    const postFilters = [];
    const folderFilters = [];
    for (const rawToken of tokens) {
      if (rawToken.toUpperCase() === "OR") {
        if (!clauses.at(-1).length) {
          throw new Error("OR must appear between two search expressions.");
        }
        clauses.push([]);
        continue;
      }
      let token = rawToken;
      let negative = false;
      if (token.startsWith("-") && token.length > 1) {
        negative = true;
        token = token.slice(1);
      }
      const separator = token.indexOf(":");
      const field = separator > 0 ? token.slice(0, separator).toLowerCase() : null;
      const text = separator > 0 ? token.slice(separator + 1) : token;
      if (!text) {
        throw new Error(`Missing value for ${field || "search term"}.`);
      }
      let atom;
      switch (field) {
        case null:
          atom = { type: "text", text, negative };
          break;
        case "from":
        case "to":
        case "subject":
        case "body":
          atom = { type: field, text, negative };
          break;
        case "before":
        case "after": {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
            throw new Error(`${field}: requires a date in YYYY-MM-DD form.`);
          }
          const date = Date.parse(`${text}T00:00:00Z`);
          if (!Number.isFinite(date)) {
            throw new Error(`Invalid date: ${text}`);
          }
          atom = { type: field, date, negative };
          break;
        }
        case "is":
          if (!["read", "unread", "starred"].includes(text.toLowerCase())) {
            throw new Error("is: supports read, unread, or starred.");
          }
          atom = { type: "status", status: text.toLowerCase(), negative };
          break;
        case "has":
          if (text.toLowerCase() !== "attachment") {
            throw new Error("has: currently supports attachment only.");
          }
          atom = { type: "attachment", negative };
          postFilters.push(atom);
          break;
        case "folder":
          atom = { type: "folder", text, negative };
          folderFilters.push(atom);
          break;
        case "tag":
          atom = {
            type: "tag",
            text: this._tagKey(text),
            negative,
          };
          break;
        default:
          throw new Error(`Unsupported search operator: ${field}:`);
      }
      clauses.at(-1).push(atom);
    }
    if (!clauses.at(-1).length) {
      throw new Error("OR must appear between two search expressions.");
    }
    if (
      clauses.length > 1 &&
      clauses.some(clause => clause.some(atom => atom.type === "attachment"))
    ) {
      throw new Error(
        "has:attachment cannot be used with OR because IMAP has no portable attachment predicate."
      );
    }
    const statusClauses = clauses.map(clause =>
      clause.filter(atom => atom.type === "status")
    );
    return { clauses, postFilters, folderFilters, statusClauses };
  }

  _term(session, attribute, operation, valueType, value, booleanAnd) {
    const term = session.createTerm();
    term.attrib = attribute;
    term.op = operation;
    term.booleanAnd = booleanAnd;
    const searchValue = term.value;
    searchValue.attrib = attribute;
    searchValue[valueType] = value;
    term.value = searchValue;
    return term;
  }

  _atomTerms(session, atom, booleanAnd) {
    const contains = atom.negative
      ? Ci.nsMsgSearchOp.DoesntContain
      : Ci.nsMsgSearchOp.Contains;
    const attributes = {
      from: Ci.nsMsgSearchAttrib.Sender,
      to: Ci.nsMsgSearchAttrib.To,
      subject: Ci.nsMsgSearchAttrib.Subject,
      body: Ci.nsMsgSearchAttrib.Body,
    };
    if (atom.type === "text") {
      const fields = [
        Ci.nsMsgSearchAttrib.Subject,
        Ci.nsMsgSearchAttrib.Sender,
        Ci.nsMsgSearchAttrib.To,
        Ci.nsMsgSearchAttrib.Body,
      ];
      const terms = fields.map((attribute, index) =>
        this._term(
          session,
          attribute,
          contains,
          "str",
          atom.text,
          index === 0 ? booleanAnd : atom.negative
        )
      );
      terms[0].beginsGrouping = true;
      terms.at(-1).endsGrouping = true;
      return terms;
    }
    if (attributes[atom.type] !== undefined) {
      return [
        this._term(
          session,
          attributes[atom.type],
          contains,
          "str",
          atom.text,
          booleanAnd
        ),
      ];
    }
    if (atom.type === "before" || atom.type === "after") {
      let operation =
        atom.type === "before"
          ? Ci.nsMsgSearchOp.IsBefore
          : Ci.nsMsgSearchOp.IsAfter;
      if (atom.negative) {
        operation =
          atom.type === "before"
            ? Ci.nsMsgSearchOp.IsAfter
            : Ci.nsMsgSearchOp.IsBefore;
      }
      return [
        this._term(
          session,
          Ci.nsMsgSearchAttrib.Date,
          operation,
          "date",
          atom.date * 1000,
          booleanAnd
        ),
      ];
    }
    if (atom.type === "status") {
      const flag =
        atom.status === "starred"
          ? Ci.nsMsgMessageFlags.Marked
          : Ci.nsMsgMessageFlags.Read;
      let isSet = atom.status !== "unread";
      if (atom.negative) {
        isSet = !isSet;
      }
      return [
        this._term(
          session,
          Ci.nsMsgSearchAttrib.MsgStatus,
          isSet ? Ci.nsMsgSearchOp.Is : Ci.nsMsgSearchOp.Isnt,
          "status",
          flag,
          booleanAnd
        ),
      ];
    }
    if (atom.type === "tag") {
      return [
        this._term(
          session,
          Ci.nsMsgSearchAttrib.Keywords,
          atom.negative
            ? Ci.nsMsgSearchOp.DoesntContain
            : Ci.nsMsgSearchOp.Contains,
          "str",
          atom.text,
          booleanAnd
        ),
      ];
    }
    return [];
  }

  _appendTerms(session, parsed) {
    const sourceClauses = parsed.clauses
      .map(clause =>
        clause.filter(
          atom => atom.type !== "attachment" && atom.type !== "folder"
        )
      )
      .filter(clause => clause.length);
    const serverClauses = [];
    for (const sourceClause of sourceClauses) {
      let expanded = [[]];
      for (const atom of sourceClause) {
        if (atom.type === "text" && !atom.negative) {
          const variants = ["subject", "from", "to", "body"].map(type => ({
            type,
            text: atom.text,
            negative: false,
          }));
          expanded = expanded.flatMap(clause =>
            variants.map(variant => [...clause, variant])
          );
        } else if (atom.type === "text" && atom.negative) {
          expanded = expanded.map(clause => [
            ...clause,
            ...["subject", "from", "to", "body"].map(type => ({
              type,
              text: atom.text,
              negative: true,
            })),
          ]);
        } else {
          expanded = expanded.map(clause => [...clause, atom]);
        }
        if (expanded.length > 256) {
          throw new Error(
            "This query expands to too many server expressions; use field-specific terms."
          );
        }
      }
      serverClauses.push(...expanded);
    }
    if (!serverClauses.length) {
      const all = session.createTerm();
      all.matchAll = true;
      all.booleanAnd = true;
      session.appendTerm(all);
      return;
    }
    for (let clauseIndex = 0; clauseIndex < serverClauses.length; clauseIndex++) {
      const emitted = [];
      const clause = serverClauses[clauseIndex];
      for (let atomIndex = 0; atomIndex < clause.length; atomIndex++) {
        emitted.push(
          ...this._atomTerms(
            session,
            clause[atomIndex],
            clauseIndex === 0 && atomIndex === 0
              ? true
              : atomIndex === 0
                ? false
                : true
          )
        );
      }
      if (serverClauses.length > 1 && emitted.length) {
        emitted[0].beginsGrouping = true;
        emitted.at(-1).endsGrouping = true;
      }
      for (const term of emitted) {
        session.appendTerm(term);
      }
    }
  }

  _statusMatches(header, filter) {
    const flags = header.flags;
    let matches;
    if (filter.status === "starred") {
      matches = Boolean(flags & Ci.nsMsgMessageFlags.Marked);
    } else {
      const isRead = Boolean(flags & Ci.nsMsgMessageFlags.Read);
      matches = filter.status === "read" ? isRead : !isRead;
    }
    return filter.negative ? !matches : matches;
  }

  _passesPostFilters(header, filters, statusClauses) {
    for (const filter of filters) {
      const attachmentFlag = Ci.nsMsgMessageFlags.Attachment || 0x10000000;
      const hasAttachment = Boolean(header.flags & attachmentFlag);
      if (filter.negative ? hasAttachment : !hasAttachment) {
        return false;
      }
    }
    return statusClauses.some(clause =>
      clause.every(filter => this._statusMatches(header, filter))
    );
  }

  _result(search, header, folder) {
    if (search.cancelled || search.limitReached) {
      return;
    }
    if (!search.allowedFolderURIs.has(folder.URI)) {
      return;
    }
    const identity = `${folder.URI}#${header.messageKey}`;
    if (
      search.seen.has(identity) ||
      !this._passesPostFilters(
        header,
        search.parsed.postFilters,
        search.parsed.statusClauses
      )
    ) {
      return;
    }
    search.seen.add(identity);
    search.hitCount++;
    search.pendingResults.push({
      searchId: search.id,
      folderURI: folder.URI,
      messageKey: header.messageKey,
      subject: header.mime2DecodedSubject || header.subject || "(no subject)",
      author: header.mime2DecodedAuthor || header.author || "",
      recipients: header.mime2DecodedRecipients || header.recipients || "",
      date: Math.floor(Number(header.date) / 1000),
      folderName:
        this._folderPath(folder, folder.server.rootFolder) ||
        folder.prettyName ||
        folder.name ||
        folder.URI,
      read: Boolean(header.flags & Ci.nsMsgMessageFlags.Read),
      starred: Boolean(header.flags & Ci.nsMsgMessageFlags.Marked),
      hasAttachment: Boolean(
        header.flags & (Ci.nsMsgMessageFlags.Attachment || 0x10000000)
      ),
    });
    if (search.pendingResults.length >= 50) {
      this._flushResults(search);
    }
    if (search.hitCount >= search.maxHits) {
      search.limitReached = true;
      try {
        search.session?.interruptSearch();
      } catch (error) {}
    }
  }

  _flushResults(search) {
    if (!search.pendingResults.length) {
      return;
    }
    const results = search.pendingResults;
    search.pendingResults = [];
    this._emit("result", results);
  }

  _searchFolder(search, folder) {
    return new Promise(resolve => {
      if (search.cancelled) {
        resolve({ cancelled: true });
        return;
      }
      const session = Cc["@mozilla.org/messenger/searchSession;1"].createInstance(
        Ci.nsIMsgSearchSession
      );
      search.session = session;
      const listener = {
        QueryInterface: ChromeUtils.generateQI(["nsIMsgSearchNotify"]),
        onNewSearch() {},
        onSearchHit: (header, hitFolder) =>
          this._result(search, header, hitFolder || folder),
        onSearchDone: status => {
          search.session = null;
          resolve({ status, cancelled: search.cancelled });
        },
      };
      try {
        this._appendTerms(session, search.parsed);
        const onlineScope =
          folder.server?.searchScope ??
          Ci.nsMsgSearchScope.onlineMail ??
          Ci.nsMsgSearchScope.onlineManual;
        session.addScopeTerm(onlineScope, folder);
        try {
          session.registerListener(listener, Ci.nsIMsgSearchSession.allNotifications);
        } catch (error) {
          session.registerListener(listener);
        }
        session.search(null);
      } catch (error) {
        search.session = null;
        resolve({ error: String(error) });
      }
    });
  }

  async _runSearch(search) {
    for (let index = 0; index < search.folders.length; index++) {
      if (search.cancelled || search.limitReached) {
        break;
      }
      const folder = search.folders[index];
      this._emit("progress", {
        searchId: search.id,
        state: "searching",
        folderName: folder.prettyName || folder.name,
        searchedFolders: index,
        totalFolders: search.folders.length,
        hitCount: search.hitCount,
        errorCount: search.errors.length,
      });
      const outcome = await this._searchFolder(search, folder);
      if (
        outcome.error ||
        (outcome.status && !outcome.cancelled && !search.limitReached)
      ) {
        search.errors.push({
          folderName: folder.prettyName || folder.name,
          error: outcome.error || `Search failed with status ${outcome.status}`,
        });
      }
      search.searchedFolders = index + 1;
    }
    this._flushResults(search);
    this._emit("complete", {
      searchId: search.id,
      query: search.query,
      cancelled: search.cancelled,
      searchedFolders: search.searchedFolders,
      totalFolders: search.folders.length,
      hitCount: search.hitCount,
      limitReached: search.limitReached,
      errors: search.errors,
    });
    this._searches.delete(search.id);
  }

  async _startSearch(
    query,
    windowId,
    maxHits = 250,
    includeJunk = false,
    folderURI = ""
  ) {
    const parsed = this._parseQuery(query);
    let scopedFolder = null;
    if (folderURI) {
      try {
        scopedFolder = this._mailServices().folderLookup.getFolderForURL(folderURI);
      } catch (error) {}
      if (scopedFolder?.server?.type !== "imap" || scopedFolder.isServer) {
        throw new Error("The selected folder is not a searchable IMAP folder.");
      }
    }
    const account = scopedFolder
      ? this._accounts().find(
          candidate =>
            candidate.incomingServer?.key === scopedFolder.server?.key
        )
      : this._chooseAccount(windowId);
    if (!account) {
      throw new Error("No IMAP account is configured in Thunderbird.");
    }
    let folders = scopedFolder
      ? [scopedFolder]
      : this._searchableFolders(account.incomingServer.rootFolder, includeJunk);
    if (parsed.folderFilters.length) {
      const root = account.incomingServer.rootFolder;
      const positives = parsed.folderFilters.filter(filter => !filter.negative);
      const negatives = parsed.folderFilters.filter(filter => filter.negative);
      const matches = (folder, filter) => {
        const path = this._folderPath(folder, root).toLocaleLowerCase();
        const name = (folder.prettyName || folder.name).toLocaleLowerCase();
        const wanted = filter.text.toLocaleLowerCase();
        return path === wanted || name === wanted;
      };
      folders = folders.filter(
        folder =>
          (!positives.length || positives.some(filter => matches(folder, filter))) &&
          !negatives.some(filter => matches(folder, filter))
      );
    }
    if (!folders.length) {
      throw new Error("The selected IMAP account has no searchable folders.");
    }
    const id = `imap-search-${Date.now()}-${++this._serial}`;
    maxHits = Math.max(50, Math.min(5000, Number(maxHits) || 250));
    const search = {
      id,
      query,
      parsed,
      folders,
      session: null,
      cancelled: false,
      searchedFolders: 0,
      hitCount: 0,
      maxHits,
      includeJunk,
      limitReached: false,
      pendingResults: [],
      errors: [],
      seen: new Set(),
      allowedFolderURIs: new Set(folders.map(folder => folder.URI)),
    };
    this._searches.set(id, search);
    Services.tm.dispatchToMainThread(() => this._runSearch(search));
    return {
      searchId: id,
      query,
      accountName:
        account.incomingServer.prettyName || account.incomingServer.hostName,
      accountKey: account.key,
      scopeFolderURI: scopedFolder?.URI || "",
      scopeFolderName: scopedFolder
        ? this._folderPath(scopedFolder, account.incomingServer.rootFolder) ||
          scopedFolder.prettyName ||
          scopedFolder.name
        : "",
      totalFolders: folders.length,
      maxHits,
      includeJunk,
    };
  }

  _cancel(search) {
    search.cancelled = true;
    try {
      search.session?.interruptSearch();
    } catch (error) {}
  }

  async _openMessage(folderURI, messageKey, openInTab = false) {
    const folder = this._mailServices().folderLookup.getFolderForURL(folderURI);
    if (!folder) {
      throw new Error("The message folder no longer exists.");
    }
    const header = folder.msgDatabase?.getMsgHdrForKey(messageKey);
    if (!header) {
      throw new Error("The message no longer exists in this folder.");
    }
    const window = Services.wm.getMostRecentWindow("mail:3pane");
    if (openInTab) {
      this._mailUtils().displayMessages(
        [header],
        undefined,
        window?.document.getElementById("tabmail"),
        true
      );
    } else if (window?.MsgDisplayMessageInFolderTab) {
      window.MsgDisplayMessageInFolderTab(header);
    } else {
      this._mailUtils().displayMessage(header);
    }
  }

  onStartup() {
    this._initialize();
  }

  onShutdown(isAppShutdown) {
    this._shutdown();
    if (!isAppShutdown) {
      Services.obs.notifyObservers(null, "startupcache-invalidate");
    }
  }

  getAPI(context) {
    return {
      globalImapSearch: {
        initialize: () => this._initialize(),
        shutdown: () => this._shutdown(),
        startSearch: (query, windowId, maxHits, includeJunk, folderURI) =>
          this._startSearch(
            query,
            windowId,
            maxHits,
            includeJunk,
            folderURI
          ),
        cancelSearch: async searchId => {
          const search = this._searches.get(searchId);
          if (search) {
            this._cancel(search);
          }
        },
        openMessage: (folderURI, messageKey, openInTab) =>
          this._openMessage(folderURI, messageKey, openInTab),
        listFolders: (windowId, includeJunk) =>
          this._listFolders(windowId, includeJunk),
        listTags: () => this._listTags(),
        onToolbarSearch: this._event(context, "toolbar", "onToolbarSearch"),
        onSearchProgress: this._event(context, "progress", "onSearchProgress"),
        onSearchResult: this._event(context, "result", "onSearchResult"),
        onSearchComplete: this._event(context, "complete", "onSearchComplete"),
      },
    };
  }
};
