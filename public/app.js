(function () {
  const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

  function defaultConfig() {
    const target = new Date();
    target.setDate(target.getDate() + 3);
    target.setHours(18, 0, 0, 0);
    return {
      target: target.toISOString(),
      numbers: { color: '#C4FF3D', fontFamily: 'sans', fontWeight: 'bold' },
      numberBox: { color: '#111111', shape: 'square' },
      labels: { enabled: true, fontFamily: 'sans', fontWeight: 'normal', color: '#6b7280' },
      background: { style: 'solid', color: '#ffffff' },
    };
  }

  let config = defaultConfig();

  const previewImg = document.getElementById('previewImg');
  const embedCode = document.getElementById('embedCode');
  const copyBtn = document.getElementById('copyBtn');
  const previewPanel = document.getElementById('previewPanel');
  const embedPanel = document.getElementById('embedPanel');
  const tabButtons = document.querySelectorAll('.tab-btn[data-tab]');

  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      tabButtons.forEach((b) => {
        b.classList.toggle('active', b === btn);
        b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
      });
      previewPanel.hidden = tab !== 'preview';
      embedPanel.hidden = tab !== 'embed';
    });
  });

  // ---------- Rendering ----------

  function buildImageUrl(cfg, format) {
    const params = new URLSearchParams({ config: JSON.stringify(cfg) });
    return `${window.location.origin}/timer.${format}?${params.toString()}`;
  }

  function render() {
    // The browser preview keeps using a single-frame PNG that we manually
    // refresh every second (see refreshPreviewTick) -- it's cheap to
    // regenerate on every settings change, which the animated GIF is not.
    previewImg.src = buildImageUrl(config, 'png');
    // The actual embed uses the animated GIF, since it's the only format
    // that can visibly tick down while an email is open (email clients
    // block JavaScript, so a live-refreshing <img> like the preview isn't
    // possible there).
    const embedUrl = buildImageUrl(config, 'gif');
    embedCode.value = `<div style="text-align:center;"><img src="${embedUrl}" alt="Countdown timer" width="480" style="max-width:100%; display:inline-block;" /></div>`;
  }

  function refreshPreviewTick() {
    // Force a reload every second so the live preview visibly counts down,
    // without changing the underlying config.
    const url = new URL(buildImageUrl(config, 'png'));
    url.searchParams.set('t', Date.now());
    previewImg.src = url.toString();
  }

  // ---------- Settings form ----------

  const FIELD_SETTERS = {
    numbersFontFamily: (v) => { config.numbers.fontFamily = v; },
    numbersFontWeight: (v) => { config.numbers.fontWeight = v; },
    labelsEnabled: (v) => { config.labels.enabled = v === 'on'; updateLabelFieldsVisibility(); },
    labelsFontFamily: (v) => { config.labels.fontFamily = v; },
    labelsFontWeight: (v) => { config.labels.fontWeight = v; },
    numberBoxShape: (v) => { config.numberBox.shape = v; },
    backgroundStyle: (v) => { config.background.style = v; updateBackgroundColorVisibility(); },
  };

  const FIELD_GETTERS = {
    numbersFontFamily: () => config.numbers.fontFamily,
    numbersFontWeight: () => config.numbers.fontWeight,
    labelsEnabled: () => (config.labels.enabled ? 'on' : 'off'),
    labelsFontFamily: () => config.labels.fontFamily,
    labelsFontWeight: () => config.labels.fontWeight,
    numberBoxShape: () => config.numberBox.shape,
    backgroundStyle: () => config.background.style,
  };

  const toggleGroups = document.querySelectorAll('.field-toggle[data-field]');

  function syncToggleGroup(group) {
    const field = group.dataset.field;
    const value = FIELD_GETTERS[field]();
    group.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.value === value);
    });
  }

  toggleGroups.forEach((group) => {
    const field = group.dataset.field;
    syncToggleGroup(group);
    group.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        FIELD_SETTERS[field](btn.dataset.value);
        syncToggleGroup(group);
        render();
      });
    });
  });

  const backgroundColorGroup = document.getElementById('backgroundColorGroup');
  function updateBackgroundColorVisibility() {
    backgroundColorGroup.hidden = config.background.style === 'transparent';
  }

  const labelColorGroup = document.getElementById('labelColorGroup');
  const labelStyleGroup = document.getElementById('labelStyleGroup');
  const labelWeightGroup = document.getElementById('labelWeightGroup');
  function updateLabelFieldsVisibility() {
    labelColorGroup.hidden = !config.labels.enabled;
    labelStyleGroup.hidden = !config.labels.enabled;
    labelWeightGroup.hidden = !config.labels.enabled;
  }

  function bindHexInput(id, getValue, setValue) {
    const input = document.getElementById(id);
    input.value = getValue();
    input.addEventListener('input', () => {
      const value = input.value.trim();
      input.classList.toggle('invalid', value.length > 0 && !HEX_RE.test(value));
      if (HEX_RE.test(value)) {
        setValue(value);
        render();
      }
    });
  }

  bindHexInput('numbersColor', () => config.numbers.color, (v) => { config.numbers.color = v; });
  bindHexInput('numberBoxColor', () => config.numberBox.color, (v) => { config.numberBox.color = v; });
  bindHexInput('labelsColor', () => config.labels.color, (v) => { config.labels.color = v; });
  bindHexInput('backgroundColor', () => config.background.color, (v) => { config.background.color = v; });

  function toLocalDatetimeValue(isoString) {
    const d = new Date(isoString);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  const targetInput = document.getElementById('targetInput');
  targetInput.value = toLocalDatetimeValue(config.target);
  targetInput.addEventListener('change', () => {
    const parsed = new Date(targetInput.value);
    if (!isNaN(parsed.getTime())) {
      config.target = parsed.toISOString();
      render();
    }
  });

  updateBackgroundColorVisibility();
  updateLabelFieldsVisibility();

  // ---------- Preview backdrop (light/dark) ----------

  const previewFrame = document.getElementById('previewPanel');
  const modeButtons = document.querySelectorAll('.mode-btn[data-mode]');
  modeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      modeButtons.forEach((b) => b.classList.toggle('active', b === btn));
      previewFrame.classList.toggle('dark-backdrop', mode === 'dark');
    });
  });

  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(embedCode.value);
      copyBtn.textContent = 'Copied';
      copyBtn.classList.add('copied');
      setTimeout(() => {
        copyBtn.textContent = 'Copy';
        copyBtn.classList.remove('copied');
      }, 1500);
    } catch (e) {
      embedCode.select();
      document.execCommand('copy');
    }
  });

  // ---------- Init ----------

  render();
  setInterval(refreshPreviewTick, 1000);
})();
