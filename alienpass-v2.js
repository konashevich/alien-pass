(function (global) {
  'use strict';

  const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const LOWER = 'abcdefghijklmnopqrstuvwxyz';
  const NUMS = '0123456789';
  const SYMBOLS = '!@_-';
  const MIX_DEFAULT = UPPER + LOWER + NUMS + SYMBOLS;
  const MIX_ABC = UPPER + LOWER + NUMS;
  const INPUT_REGEX = /^(?:(abc|pin)?(\d{1,2})?\:)?(.*)$/;
  const ENGINE_VERSION = 'v2.0.2';
  const DEFAULT_LENGTH = 14;
  const MIN_LENGTH = 4;
  const MAX_LENGTH = 64;
  const ITERATIONS = 600000;

  function clampLength(rawLength) {
    const parsed = Number.parseInt(rawLength, 10);
    if (!Number.isFinite(parsed)) return DEFAULT_LENGTH;
    return Math.max(MIN_LENGTH, Math.min(MAX_LENGTH, parsed));
  }

  function parseCommandString(inputString) {
    const normalized = String(inputString || '');
    const match = normalized.match(INPUT_REGEX) || [];

    return {
      alphabet: match[1] || 'default',
      length: clampLength(match[2]),
      secret: match[3] || ''
    };
  }

  function parseLoginString(loginString) {
    const normalized = String(loginString || '').trim();
    const separatorIndex = normalized.lastIndexOf(',');

    if (separatorIndex <= 0 || separatorIndex >= normalized.length - 1) {
      throw new Error('Login must end with ,<index>, for example email@example.com,1.');
    }

    const login = normalized.slice(0, separatorIndex).trim();
    const index = normalized.slice(separatorIndex + 1).trim();

    if (!login || !/^\d+$/.test(index)) {
      throw new Error('Login must end with ,<index>, for example email@example.com,1.');
    }

    return {
      login,
      index,
      salt: `${login},${index}`
    };
  }

  function getCharsetForIndex(alphabet, index) {
    if (alphabet === 'pin') return NUMS;

    if (alphabet === 'abc') {
      if (index === 0) return UPPER;
      if (index === 1) return LOWER;
      if (index === 2) return NUMS;
      return MIX_ABC;
    }

    if (index === 0) return UPPER;
    if (index === 1) return LOWER;
    if (index === 2) return NUMS;
    if (index === 3) return SYMBOLS;
    return MIX_DEFAULT;
  }

  function formatPassword(hashBytes, parsedConfig) {
    const source = hashBytes instanceof Uint8Array ? hashBytes : new Uint8Array(hashBytes);
    let password = '';

    for (let index = 0; index < parsedConfig.length; index += 1) {
      const charset = getCharsetForIndex(parsedConfig.alphabet, index);
      const charIndex = source[index] % charset.length;
      password += charset[charIndex];
    }

    return password;
  }

  async function deriveHashBytes(secret, salt) {
    if (!global.crypto || !global.crypto.subtle) {
      throw new Error('Web Crypto PBKDF2 is unavailable in this environment.');
    }

    const encoder = new TextEncoder();
    const keyMaterial = await global.crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'PBKDF2' },
      false,
      ['deriveBits']
    );

    const derivedBits = await global.crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: encoder.encode(salt),
        iterations: ITERATIONS,
        hash: 'SHA-256'
      },
      keyMaterial,
      MAX_LENGTH * 8
    );

    return new Uint8Array(derivedBits);
  }

  async function generatePassword(options) {
    const inputString = String(options && options.inputString ? options.inputString : '').trim();
    const loginInput = String(options && options.login ? options.login : '').trim();

    if (!loginInput) {
      throw new Error('Login is required.');
    }

    const parsed = parseCommandString(inputString);
    const parsedLogin = parseLoginString(loginInput);

    if (!parsed.secret) {
      throw new Error('The secret part of the command string cannot be empty.');
    }

    const hashBytes = await deriveHashBytes(parsed.secret, parsedLogin.salt);
    return {
      parsed: {
        ...parsed,
        login: parsedLogin.login,
        index: parsedLogin.index
      },
      password: formatPassword(hashBytes, parsed),
      salt: parsedLogin.salt
    };
  }

  function resolveElement(value) {
    if (!value) return null;
    if (typeof value === 'string') return global.document.querySelector(value);
    return value;
  }

  function rafTick() {
    return new Promise((resolve) => {
      if (typeof global.requestAnimationFrame !== 'function') {
        global.setTimeout(resolve, 0);
        return;
      }
      global.requestAnimationFrame(() => global.requestAnimationFrame(resolve));
    });
  }

  function init(config) {
    const elements = {
      input: resolveElement(config.input),
      repeatInput: resolveElement(config.repeatInput),
      repeatField: resolveElement(config.repeatField),
      newPassword: resolveElement(config.newPassword),
      login: resolveElement(config.login),
      generate: resolveElement(config.generate),
      clear: resolveElement(config.clear),
      result: resolveElement(config.result),
      copy: resolveElement(config.copy),
      status: resolveElement(config.status),
      preview: resolveElement(config.preview),
      previewAlpha: resolveElement(config.previewAlpha),
      previewLength: resolveElement(config.previewLength),
      resultContainer: resolveElement(config.resultContainer)
    };

    if (!elements.input || !elements.login || !elements.generate || !elements.result) {
      throw new Error('AlienPassV2.init requires input, login, generate, and result elements.');
    }

    let busy = false;
    const generateLabel = elements.generate.textContent || elements.generate.value || 'Generate Password';
    const copyLabel = elements.copy ? (elements.copy.textContent || elements.copy.value || 'Copy') : 'Copy';

    function setStatus(message, state) {
      if (!elements.status) return;
      elements.status.textContent = message || '';
      if (state) elements.status.dataset.state = state;
      else delete elements.status.dataset.state;
    }

    function showResultContainer() {
      if (!elements.resultContainer) return;
      elements.resultContainer.hidden = false;
      elements.resultContainer.classList.add('visible');
    }

    function hideResultContainer() {
      if (!elements.resultContainer) return;
      elements.resultContainer.hidden = true;
      elements.resultContainer.classList.remove('visible');
    }

    function setButtonLabel(element, text) {
      if (!element) return;
      if (element.tagName === 'INPUT') element.value = text;
      else element.textContent = text;
    }

    function updatePreview() {
      const rawValue = elements.input.value.trim();
      const parsed = parseCommandString(rawValue);

      if (elements.previewAlpha) elements.previewAlpha.textContent = parsed.alphabet;
      if (elements.previewLength) elements.previewLength.textContent = String(parsed.length);

      if (elements.preview) {
        const showPreview = rawValue.length > 0;
        elements.preview.hidden = !showPreview;
        elements.preview.classList.toggle('visible', showPreview);
      }
    }

    function stringsMatch() {
      if (!elements.newPassword || !elements.newPassword.checked) return true;
      if (!elements.repeatInput) return true;
      return elements.input.value === elements.repeatInput.value;
    }

    function validateMatchingStrings(options) {
      if (!elements.newPassword || !elements.newPassword.checked || !elements.repeatInput) {
        return true;
      }

      const shouldNotify = !options || options.notify !== false;
      const matches = stringsMatch();

      if (!matches && shouldNotify) {
        setStatus('Command string and Repeat Command string do not match.', 'error');
      } else if (matches && elements.status && elements.status.dataset.state === 'error' &&
        elements.status.textContent === 'Command string and Repeat Command string do not match.') {
        setStatus('', '');
      }

      return matches;
    }

    function syncNewPasswordUi() {
      const enabled = !!(elements.newPassword && elements.newPassword.checked);

      if (elements.repeatField) {
        elements.repeatField.hidden = !enabled;
      }

      if (elements.repeatInput) {
        elements.repeatInput.disabled = !enabled;
        if (!enabled) elements.repeatInput.value = '';
      }

      validateMatchingStrings({ notify: false });
    }

    function resetForm() {
      busy = false;
      elements.input.value = '';
      if (elements.repeatInput) elements.repeatInput.value = '';
      if (elements.newPassword) elements.newPassword.checked = false;
      elements.login.value = '';
      elements.result.value = '';
      hideResultContainer();
      setStatus('', '');
      if (elements.generate) {
        elements.generate.disabled = false;
        setButtonLabel(elements.generate, generateLabel);
      }
      syncNewPasswordUi();
      updatePreview();
      elements.input.focus();
    }

    async function handleGenerate() {
      if (busy) return;

      const inputString = elements.input.value.trim();
      const login = elements.login.value.trim();

      if (!inputString || !login) {
        elements.result.value = '';
        hideResultContainer();
        setStatus('Enter both the command string and the login.', 'error');
        return;
      }

      if (!validateMatchingStrings()) {
        elements.result.value = '';
        hideResultContainer();
        if (elements.repeatInput) elements.repeatInput.focus();
        return;
      }

      busy = true;
      setButtonLabel(elements.generate, 'Generating...');
      elements.generate.disabled = true;
      setStatus('Running PBKDF2 with 600,000 iterations...', '');
      hideResultContainer();

      try {
        await rafTick();
        const output = await generatePassword({ inputString, login });
        elements.result.value = output.password;
        showResultContainer();
        setStatus(`Password generated for index ${output.parsed.index}.`, '');
      } catch (error) {
        elements.result.value = '';
        hideResultContainer();
        setStatus(error && error.message ? error.message : 'Password generation failed.', 'error');
      } finally {
        elements.generate.disabled = false;
        setButtonLabel(elements.generate, generateLabel);
        busy = false;
      }
    }

    async function handleCopy() {
      const password = elements.result.value || '';

      if (!password) {
        setStatus('Generate a password before copying it.', 'error');
        return;
      }

      if (!global.navigator || !global.navigator.clipboard || !global.navigator.clipboard.writeText) {
        setStatus('Clipboard access is unavailable.', 'error');
        return;
      }

      try {
        await global.navigator.clipboard.writeText(password);
        setStatus('Copied to clipboard.', '');
        if (elements.copy) {
          setButtonLabel(elements.copy, 'Copied');
          global.setTimeout(() => setButtonLabel(elements.copy, copyLabel), 1500);
        }
      } catch (error) {
        setStatus('Clipboard write failed.', 'error');
      }
    }

    elements.input.addEventListener('input', updatePreview);
    elements.input.addEventListener('blur', () => validateMatchingStrings({ notify: true }));
    elements.generate.addEventListener('click', handleGenerate);

    if (elements.newPassword) {
      elements.newPassword.addEventListener('change', syncNewPasswordUi);
    }

    if (elements.repeatInput) {
      elements.repeatInput.addEventListener('blur', () => validateMatchingStrings({ notify: true }));
      elements.repeatInput.addEventListener('input', () => {
        if (elements.status && elements.status.dataset.state === 'error') {
          validateMatchingStrings({ notify: false });
        }
      });
    }

    if (elements.clear) {
      elements.clear.addEventListener('click', resetForm);
    }

    if (elements.copy) {
      elements.copy.addEventListener('click', handleCopy);
    }

    [elements.input, elements.repeatInput, elements.login].filter(Boolean).forEach((element) => {
      element.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          handleGenerate();
        }
      });
    });

    updatePreview();
    hideResultContainer();
    syncNewPasswordUi();

    return {
      handleGenerate,
      handleCopy,
      resetForm,
      updatePreview,
      generatePassword
    };
  }

  global.AlienPassV2 = {
    ENGINE_VERSION,
    ITERATIONS,
    DEFAULT_LENGTH,
    MIN_LENGTH,
    MAX_LENGTH,
    UPPER,
    LOWER,
    NUMS,
    SYMBOLS,
    MIX_DEFAULT,
    MIX_ABC,
    parseCommandString,
    parseLoginString,
    getCharsetForIndex,
    formatPassword,
    deriveHashBytes,
    generatePassword,
    init
  };
})(typeof window !== 'undefined' ? window : globalThis);
