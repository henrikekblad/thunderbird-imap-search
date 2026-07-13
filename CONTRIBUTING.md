# Contributing

Bug reports and focused pull requests are welcome.

## Development

1. Use a dedicated Thunderbird or Betterbird test profile.
2. Open **Add-ons and Themes**, then **Debug Add-ons**.
3. Choose **Load Temporary Add-on** and select `manifest.json`.
4. Use Thunderbird's Browser Console for Experiment errors and the add-on debugger for background/results-page errors.

Run the local validation and packaging command before submitting a pull request:

```sh
./scripts/package.sh
```

Do not commit XPIs, generated files, minified code, vendored dependencies, or unrelated formatting changes. Changes to the Experiment API must preserve shutdown cleanup and compatibility with every Thunderbird version declared in `manifest.json`.

## Reporting bugs

Please include:

- Thunderbird or Betterbird version and operating system.
- IMAP server implementation when known.
- Whether the problem occurs in global or current-folder search.
- The smallest query that reproduces the problem.
- Relevant Browser Console errors with private message data removed.

