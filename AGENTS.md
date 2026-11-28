## Repository layout

npm workspaces: the Astro site is at the root, and each tool is a package in `packages/<tool>/`.

- `packages/<tool>/` owns the whole tool: its Astro components (markup, styles and page script)
  and its logic in `src/lib/`, with tests next to the code. Code in `lib/` stays free of Astro and
  the DOM, so it can be tested and reused on its own.
- `src/pages/<tool>/` holds thin entry points only: wrap the tool's component in the site
  `Layout` and nothing else.
- `src/layouts/` and `src/components/` hold shared site chrome.

Each package declares its own dependencies. Add one with `npm install <dep> -w @workbench/<tool>`,
then check that it landed in that package's `package.json`. `npm test` runs every package's tests,
and `npm test -w @workbench/<tool>` runs one tool's.

## Development

When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)
