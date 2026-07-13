# Thunderbird Add-ons listing draft

## Name

Global IMAP Server Search

## Summary

Fast server-side IMAP search across folders, without relying on Thunderbird's local Gloda index.

## Description

Global IMAP Server Search sends searches through Thunderbird directly to your configured IMAP server. Search the active account from Thunderbird's top search field, or press Enter in a folder's Quick Filter field to run an exact current-folder server search.

Results arrive incrementally in a sortable tab and open in Thunderbird's native message display. Broad searches can be stopped and have a configurable result limit. Spam, Junk, and Trash are excluded by default.

Supported expressions include ordinary words and phrases, `from:`, `to:`, `subject:`, `body:`, `folder:`, `tag:`, `has:attachment`, `before:`, `after:`, message state, negation, and explicit `OR`. Built-in pickers help select contacts, folders, tags, and ISO dates.

The extension never uses Gloda and does not create another local full-text index. A server-side full-text index such as Dovecot FTS can improve performance but is not required.

This extension uses a privileged Thunderbird Experiment API because online IMAP search sessions and native search-bar integration are not exposed by the standard MailExtension APIs. It therefore displays Thunderbird's unrestricted-access warning. The source is public and contains no remote code, telemetry, advertising, or external service.

## Release notes — 1.0.0

Initial public release with global account search, current-folder search, incremental sortable results, cancellation, result limits, Gmail-like query operators, contact/folder/tag/date pickers, native message opening, and persistent preferences.

## Release notes — 1.0.1

Fixes `is:starred`, `is:read`, and `is:unread` returning messages with the wrong state when an IMAP adapter ignores an online status predicate. Returned message headers are now defensively verified while preserving explicit `OR` semantics.

## Support URL

https://github.com/henrikekblad/thunderbird-imap-search/issues

## Homepage and source

https://github.com/henrikekblad/thunderbird-imap-search

## Privacy policy

https://github.com/henrikekblad/thunderbird-imap-search/blob/main/PRIVACY.md

## License

Mozilla Public License 2.0

## Categories

- Message and News Reading
- Search Tools

## Reviewer notes

Use the contents of `REVIEWER_NOTES.md`. The add-on has no build transformation; `./scripts/package.sh` validates and packages the exact readable files included in the XPI.
