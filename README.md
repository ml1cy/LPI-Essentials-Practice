# LPI Essentials Practice

A practice exam for the **LPI Linux Essentials (010-160)** certification, with a
real Linux terminal beside the questions. It all runs in the browser, with no build
step and no server-side code.

- **40 random questions**, the same length as the real exam, or **all 80** in the bank
- Answer and option order is shuffled on every run
- **Flag** questions to revisit, and jump to any question from the overview grid
- **Fill-in-the-blank** questions are answered by typing, as in the real exam
- A timer that turns amber once you pass real-exam pace (60 minutes per 40 questions)
- A **results review** of every question with your answer and the correct one, filtered
  to all, missed or flagged questions
- **Retry missed questions** to drill only the ones you got wrong
- Progress is saved in the browser, so you can close the tab and resume later
- A **Linux terminal** to try commands while you answer (see below)
- Light and dark themes, keyboard shortcuts, and a layout that works on phones

## Running it

The page loads the question bank with `fetch`, so it has to be served over HTTP.
Opening `index.html` straight from disk won't work. Any static server will do:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>. It also works as-is on GitHub Pages or any other
static host.

## Keyboard shortcuts

| Key            | Action                     |
| -------------- | -------------------------- |
| `A` – `E`      | Choose an answer           |
| `←` / `→`      | Previous or next question  |
| `Enter`        | Next question              |
| `F`            | Flag for review            |
| `T`            | Open the Linux terminal    |
| `Ctrl` + `` ` `` | Switch between the terminal and the questions |

## Linux terminal

The **Terminal** button opens a real Linux system running in your browser: a Linux 6.8
kernel and BusyBox 1.36 tools, on the [v86](https://github.com/copy/v86) x86 emulator,
displayed with [xterm.js](https://xtermjs.org/). Commands really run, so permissions,
pipes, globbing, archives and environment variables behave the way they do on any Linux
machine.

- It downloads about 3 MB the first time it's opened (6 MB if your host doesn't
  compress JavaScript) and boots in a few seconds. Until then the quiz loads nothing
  extra.
- You're logged in as `student` (password `student`). The root password is `root`: use
  `su -`, or `sudo COMMAND`, which asks for the root password.
- The home directory has practice files that match exam questions, such as a script
  without the execute bit, an empty `Downloads/` and file names with spaces. Run
  `cat README` to see them all.
- The machine pauses while the panel is closed and keeps its files until you reload the
  page or press **Restart**. It has no network access.

Some commands differ from the GNU versions on a full distribution:

- BusyBox tools support fewer options. `COMMAND --help` lists what each one supports.
- There are no manual pages. `man COMMAND` and `info COMMAND` show the command's
  `--help` text instead.
- `bash` is BusyBox's `ash` shell, which runs typical scripts but not every bash feature.
- `useradd`, `userdel`, `usermod -aG`, `groupadd` and `groupdel` are small scripts
  around BusyBox's `adduser`, `deluser`, `addgroup` and `delgroup`.
- There's no `zip`, `file` or `host`, and the machine has no network.

### Rebuilding the Linux image

The kernel and root file system in `terminal/image/` are built by
`terminal/build/build.sh` from Ubuntu 24.04's `linux-source-6.8.0` and `busybox` source
packages, using the options in `kernel.config` and `busybox.config` and the files in
`terminal/build/rootfs/`. The script lists the packages it needs. To change what's in
the system, such as the practice files or users, edit `rootfs/` and run:

```bash
terminal/build/build.sh
```

### Why the binaries are `.js` files

The emulator, BIOS, kernel and file system are binary files, but they're stored as
base64 inside `.js` files: `terminal/vendor/v86/v86-wasm.js`, `seabios.js`,
`vgabios.js`, and `terminal/image/bzimage.js`, `rootfs.js`. Some web hosts refuse to
serve `.wasm`, `.bin` or extensionless files, but every host serves `.js`, and most
compress it, so the download stays small. `terminal/terminal.js` fetches and decodes
them. `terminal/build/pack.sh` makes them:

```bash
terminal/build/pack.sh v86.wasm v86.wasm terminal/vendor/v86/v86-wasm.js
```

If the terminal says a file didn't download, check that the whole `terminal/` folder
was published with the site.

## Project layout

```text
index.html          Page markup for the start, quiz and results screens
style.css           Styles, with light and dark color tokens at the top
app.js              Quiz logic: loading, rendering, scoring, saving progress
lpi_questions.json  The question bank
terminal/
  terminal.js       Terminal panel: loads and runs the emulator on first open
  image/            Linux kernel and root file system, packed as .js files
  build/            Script, configuration and files that produce image/
  vendor/           v86 emulator and BIOS (packed as .js), xterm.js
```

## Question format

`lpi_questions.json` is an array of question objects.

### Multiple choice

```json
{
  "id": 13,
  "question": "Which of the following `tar` options handle compression? (Choose two.)",
  "code": true,
  "options": ["-z", "-g", "-z2", "-bz", "-j"],
  "answer": ["-z", "-j"]
}
```

| Field      | Description |
| ---------- | ----------- |
| `id`       | Unique number. Saved progress refers to questions by `id`. |
| `question` | The prompt. Supports `` `inline code` ``, fenced ```` ``` ```` code blocks and blank lines between paragraphs. |
| `options`  | The choices, shown in random order. |
| `answer`   | The correct options, copied exactly from `options`. More than one answer turns the question into a "choose N" checkbox question. |
| `code`     | Optional. Set to `true` when the options are commands, paths or terminal output so they're shown in a monospace font. Options containing line breaks keep their column alignment. |

A `(Choose two.)` note in the question text is hidden during the quiz, because the
app shows its own hint based on the number of answers.

### Fill in the blank

```json
{
  "id": 56,
  "type": "text",
  "question": "What parameter of `ls` prints a recursive listing of a directory’s content?",
  "answer": ["-R", "--recursive"]
}
```

Typed answers are trimmed and compared case-sensitively, as on the command line.
The first entry in `answer` is shown as the correct answer, and the rest are listed
as also accepted.

## Third-party software

| Component | Version | License | Source |
| --------- | ------- | ------- | ------ |
| [v86](https://github.com/copy/v86) emulator | 0.5.473 (`315b2b0`) | BSD-2-Clause | npm package `v86` |
| SeaBIOS and VGA BIOS images from v86 | v86 `315b2b0` | LGPL-3.0 | [`bios/`](https://github.com/copy/v86/tree/315b2b0b758703ef0e6cc7b4088d6068f83f3c20/bios) in the v86 repository |
| [xterm.js](https://xtermjs.org/) and its fit add-on | 5.5.0, 0.10.0 | MIT | npm packages `@xterm/xterm`, `@xterm/addon-fit` |
| Linux kernel | 6.8.12 | GPL-2.0 | Ubuntu 24.04 package [`linux-source-6.8.0`](https://launchpad.net/ubuntu/+source/linux) |
| BusyBox | 1.36.1 | GPL-2.0 | Ubuntu 24.04 source package [`busybox` 1:1.36.1-6ubuntu3.1](https://launchpad.net/ubuntu/+source/busybox) |

License texts for the vendored files are in `terminal/vendor/`. `v86.wasm`, `seabios.bin`
and `vgabios.bin` are stored unchanged, base64-encoded, in `v86-wasm.js`, `seabios.js` and
`vgabios.js`. The kernel and BusyBox binaries can be rebuilt from the sources above with
`terminal/build/build.sh`.
