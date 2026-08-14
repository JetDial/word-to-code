# Word to Code

A desktop application that translates **plain-language descriptions into code**, and **code
between programming languages**. Every translation runs through one of two engines:

|                      | Rule-based (offline)                                                                                       | Claude AI                                     |
| -------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| **Describe → Code**  | Fixed phrase catalog — counting, sums, FizzBuzz, factorial, Fibonacci, countdowns, variables, greetings, times tables — in English, Spanish, French, German and Portuguese | Any sentence, in any human language           |
| **Code → Code**      | Reads a subset of Python or JavaScript (prints, variables, `for`/`while`/`if`, comments)                     | Full programs, between any pair of languages  |

**Target languages:** Python, JavaScript, TypeScript, Java, C++, C#, Go, Rust.

Every result comes with syntax highlighting, the assumptions the engine made, a line-by-line
explanation, and one-click copy or save-to-file.

## Running it

```bash
npm install
npm start
```

That opens the desktop app. Other scripts:

| Command         | What it does                                                              |
| --------------- | ------------------------------------------------------------------------- |
| `npm start`     | Launch the desktop application                                            |
| `npm test`      | Run the engine unit tests (27 tests, no network, no Electron)             |
| `npm run smoke` | Boot the real UI headlessly and drive both engines through the DOM        |
| `npm run web`   | Serve the same UI at `http://localhost:4173` to use it in a browser       |

## Docker

The desktop build is Electron and needs a display, so the container runs **browser mode** —
the same UI served over HTTP.

```bash
docker build -t word-to-code .
docker run --rm -p 4173:4173 word-to-code
```

Then open <http://localhost:4173>. Or with Compose:

```bash
docker compose up --build
```

Run the test suite in the container instead of the server:

```bash
docker build --target test .
```

The image installs nothing: the app has zero runtime dependencies, and Electron is a
devDependency that a headless container has no use for. That keeps it to the `node:22-alpine`
base plus a few source files, running as the unprivileged `node` user. The build also runs the
unit tests in an earlier stage, so a broken engine fails the image rather than shipping.

Note that **Claude AI mode in the container calls the API straight from your browser**, the same
way plain browser mode does — the key is held in the browser's `localStorage`, not in the image
or the container. Only the desktop build gets OS-keychain encryption and main-process requests.
Both offline engines work in the container with no key and no network.

`scripts/serve.js` binds to `127.0.0.1` by default so `npm run web` never exposes the app to
your network unintentionally; the container sets `HOST=0.0.0.0` so the published port works.

## Claude AI mode

Switch the engine to **Claude AI** in the header and paste an Anthropic API key from
[platform.claude.com](https://platform.claude.com). It uses the `claude-opus-5` model.

In the desktop app the key is encrypted at rest with your OS keychain (DPAPI on Windows,
Keychain on macOS) and the API request is made from Electron's main process — so the key never
sits in plaintext on disk and the request never needs the browser CORS escape hatch. In browser
mode the key lives in `localStorage` and the request goes directly from the page.

The offline rule engine needs no key and no network at all.

## Keyboard shortcuts

| Shortcut          | Action                  |
| ----------------- | ----------------------- |
| `Ctrl`+`Enter`    | Translate               |
| `Ctrl`+`S`        | Save the output to a file |
| `Ctrl`+`H`        | Toggle history          |
| `Ctrl`+`1` / `2`  | Switch tabs             |

## How it works

Both offline engines share a single intermediate representation. A description or a parsed
program is compiled into a small language-neutral statement tree — `print`, `var`, `assign`,
`for`, `while`, `if`, `input`, `comment` — and eight per-language emitters render that tree as
idiomatic source. Adding a ninth target language means writing one emitter, not touching either
front end.

```
description ──▶ intent match ──┐
                               ├──▶ statement tree ──▶ emitter ──▶ source code
source code ──▶ parser ────────┘
```

Non-English descriptions are normalized first: lowercased, accents stripped, and known foreign
keywords swapped for their English equivalents, so one set of intent patterns serves every
supported language.

```
electron/     main process, IPC handlers, preload bridge
src/core/     the engines — languages, emit, nl, codeparse, ai, highlight
src/          UI shell (index.html, styles.css, app.js) and the storage shim
scripts/      smoke test and the browser-mode static server
test/         unit tests
```

## Security notes

- The renderer runs with `contextIsolation: true` and `nodeIntegration: false`; it reaches
  privileged operations only through a narrow `contextBridge` surface.
- A Content-Security-Policy restricts the page to its own scripts and styles, and allows network
  connections to `api.anthropic.com` only.
- All model output is inserted as escaped text, never as HTML.
- External links open in the system browser rather than inside the app window.

## License

MIT
