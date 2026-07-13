# Reviewer notes

## Purpose

Global IMAP Server Search performs searches through Thunderbird's online IMAP search scope instead of Gloda. It searches all selectable folders in the active IMAP account or one explicitly selected folder and streams matching message headers into an extension results tab.

## Why an Experiment API is required

Thunderbird's public MailExtension APIs do not expose `nsIMsgSearchSession` with `nsMsgSearchScope.onlineMail`, nor do they provide supported hooks for replacing submission from the native global search and Quick Filter controls. The Experiment is limited to:

- Discovering and instrumenting those search controls.
- Selecting and enumerating IMAP folders.
- Running online `nsIMsgSearchSession` searches.
- Opening selected messages through Thunderbird's native display.
- Hiding the navigation toolbar of the extension-owned results content tab.

All listeners, observers, injected nodes, attributes, styles, and hidden native UI state are restored during shutdown. A running search is interrupted when cancelled or when the extension shuts down.

## Network and data behavior

- No remote code or third-party library is used.
- No request is made to a developer-operated service.
- Search traffic goes only through Thunderbird to the user's configured IMAP server.
- Address-book data is read locally for `from:` and `to:` suggestions.
- The extension does not use Gloda and does not download bodies to build an index.

See `PRIVACY.md` for the complete disclosure.

## Build

The XPI contains the source files directly. There is no transpilation, bundling, minification, dependency installation, or generated JavaScript. Run:

```sh
./scripts/package.sh
```

This requires a POSIX shell and 7-Zip (`7z`). The resulting file is written to `dist/global-imap-server-search-1.0.1.xpi`.

## Suggested functional test

1. Install the add-on in a Thunderbird profile with an IMAP account.
2. Type a term in the top global search field and press Enter.
3. Confirm that the extension results tab opens and folder progress is shown.
4. Open a result with Enter, single click, or double click.
5. Open a mail folder, type a term in Quick Filter, and press Enter.
6. Confirm that the results are scoped to that exact folder.
7. Use **Global Search** to rerun the same expression across the account.
8. Start a broad search and verify that **Stop** cancels it.

No special server software is required. Dovecot FTS improves server performance but is not a dependency.

## Compatibility testing

The complete search workflow has been exercised successfully on Thunderbird 152 with an IMAP account. A clean installation using the production ID `imap-search@sensnology.se` has also been approved and exercised successfully on Betterbird 140.12 ESR, including global and current-folder searches, cancellation, results, and message opening. The manifest remains capped at `152.*` because the Experiment integrates with version-sensitive internal APIs and native UI elements.
