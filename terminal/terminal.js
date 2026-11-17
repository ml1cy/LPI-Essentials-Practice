'use strict';

/*
 * Practice terminal: a real 32-bit Linux (kernel + BusyBox, see terminal/build/)
 * running in the v86 x86 emulator, shown through xterm.js.
 *
 * Nothing is downloaded until the terminal is opened for the first time. The
 * machine keeps running while the panel is open and pauses while it's closed,
 * so files made during a quiz are still there when it's reopened.
 *
 * Serial port 0 is the console. Serial port 1 is a small control channel: the
 * guest says "ready" on it after boot, and the page sends "ROWS COLS" lines on
 * it to keep the console size in step with the panel (terminal/build/rootfs/
 * usr/libexec/term-resize).
 */
(() => {
  const BASE = 'terminal/';
  const SCRIPTS = ['vendor/xterm/xterm.js', 'vendor/xterm/addon-fit.js', 'vendor/v86/libv86.js'];
  const STYLES = ['vendor/xterm/xterm.css'];
  const MACHINE = {
    wasm_path: `${BASE}vendor/v86/v86.wasm`,
    bios: { url: `${BASE}vendor/v86/seabios.bin` },
    vga_bios: { url: `${BASE}vendor/v86/vgabios.bin` },
    bzimage: { url: `${BASE}image/bzImage` },
    initrd: { url: `${BASE}image/rootfs.cpio.gz` },
    cmdline: 'console=ttyS0 quiet',
    // v86 loads the initrd at the 64 MB mark, so the machine needs more than that.
    memory_size: 96 * 1024 * 1024,
    vga_memory_size: 2 * 1024 * 1024,
    uart1: true,
    autostart: true,
    disable_keyboard: true,
    disable_mouse: true,
    disable_speaker: true,
  };
  // Dark in both page themes, in the page's navy and amber.
  const THEME = {
    background: '#0f1a30',
    foreground: '#e7ecf5',
    cursor: '#f2a93b',
    cursorAccent: '#0f1a30',
    selectionBackground: 'rgba(242, 169, 59, 0.35)',
    black: '#1a2a47',
    red: '#f4707f',
    green: '#4cc79e',
    yellow: '#f2a93b',
    blue: '#6ea8fe',
    magenta: '#c49cf4',
    cyan: '#5fd0e0',
    white: '#c9d2e3',
    brightBlack: '#6b7a96',
    brightRed: '#ff97a3',
    brightGreen: '#74e0bb',
    brightYellow: '#ffc773',
    brightBlue: '#94c0ff',
    brightMagenta: '#dcbcff',
    brightCyan: '#8de6f2',
    brightWhite: '#ffffff',
  };

  const $ = id => document.getElementById(id);
  const panel = $('terminalPanel');
  const screen = $('terminalScreen');
  const mount = $('terminalMount');
  const status = $('terminalStatus');
  const toggleBtn = $('terminalBtn');
  const encoder = new TextEncoder();

  let term = null;
  let fit = null;
  let emulator = null;
  let machineReady = false; // v86 has finished initialising and can be paused
  let starting = null;   // promise while the libraries load and the machine boots
  let ready = false;     // guest control channel is up
  let control = '';      // partial line received on the control channel
  let pending = [];      // console bytes waiting to be drawn
  let returnFocus = null;

  /* ---------- Loading ---------- */

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = BASE + src;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`${src} didn't load`));
      document.head.append(script);
    });
  }

  function loadStyle(href) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = BASE + href;
    document.head.append(link);
  }

  function setStatus(text, state = '') {
    status.textContent = text;
    status.dataset.state = state;
  }

  async function start() {
    if (location.protocol === 'file:') {
      throw new Error('The terminal needs the page to be served over HTTP. Run “python3 -m http.server” in the project folder and open http://localhost:8000.');
    }
    if (typeof WebAssembly !== 'object') {
      throw new Error('This browser doesn’t support WebAssembly, which the terminal needs.');
    }

    setStatus('Downloading', 'busy');
    STYLES.forEach(loadStyle);
    for (const src of SCRIPTS) await loadScript(src);
    await document.fonts?.load('14px "Atkinson Hyperlegible Mono"').catch(() => {});

    term = new window.Terminal({
      theme: THEME,
      fontFamily: '"Atkinson Hyperlegible Mono", ui-monospace, Menlo, Consolas, monospace',
      fontSize: matchMedia('(max-width: 34rem)').matches ? 13 : 14,
      lineHeight: 1.15,
      cursorBlink: true,
      scrollback: 2000,
      convertEol: false,
    });
    fit = new window.FitAddon.FitAddon();
    term.loadAddon(fit);
    term.open(mount);
    fit.fit();

    // Ctrl+` belongs to the page (switches focus), not to the shell.
    term.attachCustomKeyEventHandler(e => !(e.ctrlKey && e.code === 'Backquote'));
    term.onData(data => emulator?.serial_send_bytes(0, encoder.encode(data)));
    term.onResize(sendSize);
    new ResizeObserver(() => { if (!panel.hidden) fit.fit(); }).observe(screen);

    term.write('\x1b[2mStarting Linux in your browser…\x1b[0m\r\n');
    boot();
  }

  function boot() {
    ready = false;
    control = '';
    emulator = new window.V86(MACHINE);
    emulator.add_listener('emulator-ready', () => {
      machineReady = true;
      if (!isOpen()) pause();
    });
    emulator.add_listener('download-progress', e => {
      if (!e.file_count) return;
      const fraction = (e.file_index + (e.lengthComputable && e.total ? e.loaded / e.total : 0)) / e.file_count;
      setStatus(`Downloading ${Math.round(fraction * 100)}%`, 'busy');
    });
    emulator.add_listener('download-error', () => setStatus('Download failed. Reload the page to try again.', 'error'));
    emulator.add_listener('emulator-started', () => { if (!ready) setStatus('Booting', 'busy'); });
    emulator.add_listener('serial0-output-byte', byte => {
      if (!pending.length) requestAnimationFrame(flush);
      pending.push(byte);
    });
    emulator.add_listener('serial1-output-byte', byte => {
      if (byte !== 10) {
        control += String.fromCharCode(byte);
        return;
      }
      if (control.trim() === 'ready') {
        ready = true;
        setStatus('Running', 'ok');
        sendSize();
      }
      control = '';
    });
  }

  function pause() {
    if (machineReady && emulator.is_running()) emulator.stop();
  }

  function resume() {
    if (machineReady && !emulator.is_running()) emulator.run();
  }

  function flush() {
    term.write(Uint8Array.from(pending));
    pending = [];
  }

  function sendSize() {
    if (!ready || !term) return;
    emulator.serial_send_bytes(1, encoder.encode(`${term.rows} ${term.cols}\n`));
  }

  /* ---------- Panel ---------- */

  function isOpen() {
    return !panel.hidden;
  }

  // Where focus goes when leaving the terminal: back where it came from, or the
  // heading of the screen that's showing.
  function pageFocusTarget() {
    const usable = returnFocus && returnFocus !== document.body && document.contains(returnFocus)
      && !panel.contains(returnFocus) && !returnFocus.closest('[hidden]');
    return usable ? returnFocus : document.querySelector('main > section:not([hidden]) [tabindex="-1"]') || toggleBtn;
  }

  async function open({ focus = true } = {}) {
    if (!isOpen()) {
      returnFocus = document.activeElement;
      panel.hidden = false;
      document.body.classList.add('has-terminal');
      toggleBtn.setAttribute('aria-expanded', 'true');
    }
    if (!starting) {
      starting = start().catch(err => {
        setStatus(err.message, 'error');
        starting = null;
      });
    }
    await starting;
    if (!term || !isOpen()) return; // failed to start, or closed while loading
    fit.fit();
    resume();
    if (focus) term.focus();
  }

  function close() {
    if (!isOpen()) return;
    panel.hidden = true;
    document.body.classList.remove('has-terminal');
    toggleBtn.setAttribute('aria-expanded', 'false');
    if (emulator) pause();
    pageFocusTarget().focus({ preventScroll: true });
  }

  function restart() {
    if (!machineReady) return;
    term.reset();
    term.write('\x1b[2mRestarting…\x1b[0m\r\n');
    ready = false;
    setStatus('Booting', 'busy');
    emulator.restart();
    term.focus();
  }

  // Ctrl+`: open the terminal, or move focus between it and the questions.
  function switchFocus() {
    if (!isOpen()) {
      open();
    } else if (panel.contains(document.activeElement)) {
      pageFocusTarget().focus({ preventScroll: true });
    } else {
      returnFocus = document.activeElement;
      term?.focus();
    }
  }

  toggleBtn.addEventListener('click', () => (isOpen() ? close() : open()));
  $('terminalClose').addEventListener('click', close);
  $('terminalRestart').addEventListener('click', restart);
  document.addEventListener('keydown', e => {
    if (e.ctrlKey && e.code === 'Backquote') {
      e.preventDefault();
      switchFocus();
    }
  }, true);

  window.lpiTerminal = { open, close, isOpen };
})();
