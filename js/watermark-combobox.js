// ── SEARCHABLE WATERMARK COMBOBOX ────────────────────────────────────────────
// A text-input + filtered dropdown list (set icon + name side by side, like
// scryfall.com/sets) standing in for a plain <select> — the watermark list
// runs to 150+ entries, too many to scan by scrolling a native dropdown.
// Exposes a <select>-like API (value get/set, options, addEventListener)
// so callers don't need to know it isn't a real <select>.

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function createWatermarkCombobox(root) {
  const input = root.querySelector('.wm-combo-input');
  const list  = root.querySelector('.wm-combo-list');

  let items = [];   // [{key, label, image}], already sorted by caller (newest first)
  let value = '';
  let filtered = items;
  let activeIndex = -1;
  // Tracks what the user has actually TYPED, separately from input.value —
  // focus() selects the current label's text (so typing replaces it), but
  // that shouldn't itself act as a filter query, or the list would collapse
  // to just the already-selected item until a keystroke changes it.
  let filterText = '';

  function labelFor(key) {
    return items.find(i => i.key === key)?.label ?? '';
  }

  function renderList() {
    const q = filterText.trim().toLowerCase();
    filtered = q ? items.filter(i => i.label.toLowerCase().includes(q)) : items;
    if (activeIndex >= filtered.length) activeIndex = filtered.length - 1;
    list.innerHTML = filtered.map((it, i) => `
      <li class="wm-combo-option${i === activeIndex ? ' active' : ''}${it.key === value ? ' selected' : ''}"
          role="option" aria-selected="${it.key === value}" data-key="${it.key}">
        ${it.image ? `<img class="wm-combo-icon" src="${it.image}" alt="" loading="lazy">` : '<span class="wm-combo-icon wm-combo-icon--blank"></span>'}
        <span class="wm-combo-label">${escapeHtml(it.label)}</span>
      </li>
    `).join('') || '<li class="wm-combo-empty">No sets match</li>';
  }

  function openList() {
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }

  function closeList() {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    activeIndex = -1;
  }

  function scrollActiveIntoView() {
    const el = list.children[activeIndex];
    if (el) el.scrollIntoView({ block: 'nearest' });
  }

  function selectKey(key) {
    value = key;
    input.value = labelFor(key);
    closeList();
    root.dispatchEvent(new Event('change'));
  }

  input.addEventListener('input', () => {
    filterText = input.value;
    activeIndex = -1;
    renderList();
    openList();
  });

  input.addEventListener('focus', () => {
    input.select();
    filterText = '';
    renderList();
    openList();
  });

  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (list.hidden) { openList(); renderList(); }
      if (filtered.length) {
        activeIndex = e.key === 'ArrowDown'
          ? Math.min(filtered.length - 1, activeIndex + 1)
          : Math.max(0, activeIndex - 1);
        renderList();
        scrollActiveIntoView();
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (!list.hidden && activeIndex >= 0 && filtered[activeIndex]) selectKey(filtered[activeIndex].key);
    } else if (e.key === 'Escape') {
      closeList();
      input.value = labelFor(value);
    }
  });

  // mousedown (not click) so this fires before the input's blur/focusout closes the list
  list.addEventListener('mousedown', e => {
    const li = e.target.closest('.wm-combo-option');
    if (!li) return;
    e.preventDefault();
    selectKey(li.dataset.key);
  });

  root.addEventListener('focusout', e => {
    if (!root.contains(e.relatedTarget)) {
      closeList();
      input.value = labelFor(value);
    }
  });

  return {
    get value() { return value; },
    set value(v) {
      value = v;
      input.value = labelFor(v);
    },
    get options() { return items.map(i => ({ value: i.key })); },
    get input() { return input; },
    setItems(newItems) {
      items = newItems;
      renderList();
      input.value = labelFor(value);
    },
    addEventListener(type, fn) { root.addEventListener(type, fn); },
  };
}
