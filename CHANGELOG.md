# Changelog

All notable changes to this project will be documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.0.1] - 2026-07-14

### Fixed

- Verify starred, read, and unread state against returned Thunderbird message headers so ignored server-side status predicates cannot produce incorrect results.
- Preserve status-filter semantics across explicit `OR` branches during defensive post-filtering.

## [1.0.0] - 2026-07-13

### Added

- Account-wide server-side IMAP search without Gloda.
- Native global-toolbar interception and branded IMAP search action.
- Current-folder searches from Thunderbird's Quick Filter field.
- Incremental, sortable results with native message opening and cancellation.
- Configurable result limits and optional Spam/Junk/Trash inclusion.
- Gmail-like filters for fields, dates, state, attachments, folders, and tags.
- Address-book people picker, folder picker, tag picker, and ISO date picker.
- Persistent search preferences and folder-scoped/global search switching.
- Declared and tested compatibility through Thunderbird 152, with an additional clean production-ID test on Betterbird 140.12 ESR.

[Unreleased]: https://github.com/henrikekblad/thunderbird-imap-search/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/henrikekblad/thunderbird-imap-search/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/henrikekblad/thunderbird-imap-search/releases/tag/v1.0.0
