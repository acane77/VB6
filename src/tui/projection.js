const CONTROL = '.vb-control,.vb-form';
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const owned = (node, selector) => [...node.querySelectorAll(selector)].filter(child => child.closest(CONTROL) === node);

/** Convert live DOM client geometry back to layout pixels before quantizing.
 * Neither the model's twips nor hit targets are rounded or moved. */
export function projectionGrid(node, columns, rows, metrics = {}) {
  const rect = node.getBoundingClientRect();
  const scaleX = rect.width / Math.max(1, node.offsetWidth || node.clientWidth || rect.width);
  const scaleY = rect.height / Math.max(1, node.offsetHeight || node.clientHeight || rect.height);
  const width = metrics.cellWidth || node.clientWidth / columns || 8;
  const height = metrics.cellHeight || node.clientHeight / rows || 16;
  const x = rect.left + (node.clientLeft || 0) * scaleX;
  const y = rect.top + (node.clientTop || 0) * scaleY;
  const pitchX = width * scaleX, pitchY = height * scaleY;
  return {
    rect, x, y, pitchX, pitchY,
    project(bounds) {
      const left = Math.floor((bounds.left - x) / pitchX);
      const top = Math.floor((bounds.top - y) / pitchY);
      return {x: left, y: top, width: Math.ceil((bounds.right - x) / pitchX) - left,
        height: Math.ceil((bounds.bottom - y) / pitchY) - top};
    }
  };
}

function visibleRect(element, limit) {
  if (element.closest('[hidden]') || !element.getClientRects().length) return null;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && rect.bottom > limit.top && rect.top < limit.bottom &&
    rect.right > limit.left && rect.left < limit.right ? rect : null;
}

/** A paint snapshot of the canonical materialized control, not a second model.
 * TextBox.value/selectedIndex and collection rows come from their real input
 * targets; names, VB6 properties and event dispatch never flow in reverse. */
export function captureControl(node, columns, rows, metrics) {
  const type = node.dataset.type || '';
  const input = owned(node, 'input,textarea,select,[contenteditable]')[0];
  const grid = projectionGrid(node, columns, rows, metrics);
  const style = node.ownerDocument.defaultView.getComputedStyle(node);
  const captionElement = owned(node, '.vb-frame-legend,.vb-command-caption')[0];
  const caption = captionElement?.textContent || node.getAttribute('aria-label') || node.dataset.control || '';
  const value = input?.value ?? input?.textContent ?? '';
  const state = {
    type, mnemonics: false, name: node.dataset.control || type, caption,
    text: String(value), checked: !!input?.checked, indeterminate: !!input?.indeterminate,
    password: input?.type === 'password',
    disabled: node.classList.contains('disabled') || !!input?.disabled,
    focused: node.contains(node.ownerDocument.activeElement), pressed: node.matches(':active'),
    min: finite(input?.min), max: finite(input?.max, 100), value: finite(input?.value),
    vertical: type === 'VScrollBar' || input?.getAttribute('aria-orientation') === 'vertical' ||
      input?.classList.contains('vb-vrange'),
    alignment: style.textAlign === 'right' ? 'right' : style.textAlign === 'center' ? 'center' : 'left',
    scrollColumn: Math.max(0, Math.floor((input?.scrollLeft || 0) / (metrics?.cellWidth || 8))),
    scrollRow: Math.max(0, Math.floor((input?.scrollTop || 0) / (metrics?.cellHeight || 16))),
    rows: []
  };
  if (type === 'Label') state.caption = node.textContent;
  if (type === 'ProgressBar') {
    const fill = node.querySelector('.vb-progress-fill'), track = fill?.parentElement;
    state.min = 0; state.max = 100;
    state.value = fill && track ? fill.getBoundingClientRect().width / Math.max(1, track.getBoundingClientRect().width) * 100 : 0;
  }
  if (type === 'HScrollBar' || type === 'VScrollBar') {
    const range = node.matches('[role=scrollbar]') ? node : node.querySelector('[role=scrollbar]');
    state.min = finite(range?.getAttribute('aria-valuemin'));
    state.max = finite(range?.getAttribute('aria-valuemax'), 100);
    state.value = finite(range?.getAttribute('aria-valuenow'));
  }
  state.reverse = type === 'Slider' && state.vertical;
  const addRow = (element, text = element.textContent || '', selected = false, separator = false) => {
    const rect = visibleRect(element, grid.rect);
    if (!rect) return;
    const bounds = grid.project(rect);
    if (bounds.width <= 0 || bounds.height <= 0 || bounds.x >= columns || bounds.y >= rows) return;
    state.rows.push({...bounds, text, selected, separator, disabled: !!element.disabled || element.getAttribute('aria-disabled') === 'true'});
  };
  if (input?.tagName === 'SELECT') {
    state.text = input.selectedOptions?.[0]?.textContent || '';
    // Listbox option rectangles are exposed by current browser engines. A
    // collapsed native select has no visible option rectangles; its selected
    // text is painted instead. Focused selects always retain their native UI.
    for (const option of input.options) addRow(option, option.textContent || '', option.selected);
  } else {
    const selectors = type === 'Toolbar' || type === 'Data' || type === 'Adodc' || type === 'UpDown'
      ? 'button,.vb-data-label'
      : type === 'MonthView' ? '.vb-month-header>span,.vb-month-header>button,th,td'
      : type === 'ListView' ? '.vb-lv-row>div,.vb-lv-header>div'
      : 'td:not(.vb-grid-spacer),th,.vb-tree-row,.vb-status-panel,button[role=tab]';
    for (const element of owned(node, selectors)) {
      let text = element.textContent || '';
      const row = element.closest('.vb-lv-row') || element;
      if (element.classList.contains('vb-tree-row')) {
        text = ' '.repeat(Math.min(128, Math.max(0, finite(element.getAttribute('aria-level'), 1) - 1) * 2)) +
          (element.getAttribute('aria-expanded') === null ? '├─' : element.getAttribute('aria-expanded') === 'true' ? '[-]' : '[+]') +
          (element.querySelector('.vb-tree-label')?.textContent || text);
      }
      addRow(element, text, row.classList.contains('selected') || row.classList.contains('active') ||
        row.getAttribute('aria-selected') === 'true', element.matches('td,th,.vb-lv-row>div,.vb-lv-header>div'));
    }
  }
  return state;
}
