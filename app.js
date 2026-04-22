const STORAGE_KEY = 'todo_data';
const ARCHIVE_DAYS = 14;

let state = { tasks: [], archive: [] };
let draggedId = null;
let dropTarget = null;
let placeholder = null;
let archiveOpen = false;

// ---------- Persistence ----------

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) state = JSON.parse(raw);
  } catch (_) {
    state = { tasks: [], archive: [] };
  }
  purgeOldArchive();
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// ---------- Core logic ----------

function purgeOldArchive() {
  const cutoff = Date.now() - ARCHIVE_DAYS * 24 * 60 * 60 * 1000;
  state.archive = state.archive.filter(a => new Date(a.archivedAt).getTime() > cutoff);
  saveState();
}

function addTask(text) {
  const maxOrder = state.tasks.length > 0
    ? Math.max(...state.tasks.map(t => t.order))
    : -1;
  state.tasks.push({
    id: crypto.randomUUID(),
    text: text.trim(),
    status: 'current',
    order: maxOrder + 1,
  });
  saveState();
  render();
}

function deleteTask(id) {
  const task = state.tasks.find(t => t.id === id);
  if (!task) return;
  state.tasks = state.tasks.filter(t => t.id !== id);
  state.archive.unshift({ ...task, archivedAt: new Date().toISOString() });
  saveState();
  render();
}

function toggleStatus(id) {
  const task = state.tasks.find(t => t.id === id);
  if (!task) return;
  task.status = task.status === 'current' ? 'later' : 'current';

  // Assign order at the end of the new group
  const groupOrders = state.tasks
    .filter(t => t.id !== id && t.status === task.status)
    .map(t => t.order);
  task.order = groupOrders.length > 0 ? Math.max(...groupOrders) + 1 : 0;

  saveState();
  render();
}

function permanentDelete(id) {
  state.archive = state.archive.filter(a => a.id !== id);
  saveState();
  render();
}

function reorder(draggedId, targetId, insertBefore) {
  const dragged = state.tasks.find(t => t.id === draggedId);
  const target = state.tasks.find(t => t.id === targetId);
  if (!dragged || !target || dragged.status !== target.status) return;

  const group = state.tasks
    .filter(t => t.status === dragged.status)
    .sort((a, b) => a.order - b.order);

  const fromIdx = group.findIndex(t => t.id === draggedId);
  group.splice(fromIdx, 1);

  const toIdx = group.findIndex(t => t.id === targetId);
  group.splice(insertBefore ? toIdx : toIdx + 1, 0, dragged);

  group.forEach((t, i) => { t.order = i; });
}

// ---------- Archive toggle ----------

function toggleArchive() {
  archiveOpen = !archiveOpen;
  const section = document.getElementById('archive-section');
  const btn = document.getElementById('archive-toggle');
  section.style.display = archiveOpen ? 'block' : 'none';
  btn.classList.toggle('open', archiveOpen);
}

// ---------- Helpers ----------

function daysSince(iso) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000));
}

function handleAdd() {
  const input = document.getElementById('task-input');
  const text = input.value.trim();
  if (!text) return;
  addTask(text);
  input.value = '';
  input.focus();
}

// ---------- DOM building ----------

function makeTaskEl(task) {
  const li = document.createElement('li');
  li.className = `task-item status-${task.status}`;
  li.dataset.id = task.id;
  li.draggable = true;

  // X button (left)
  const btnDel = document.createElement('button');
  btnDel.className = 'btn-delete';
  btnDel.innerHTML = '&times;';
  btnDel.title = 'Usuń zadanie';
  btnDel.addEventListener('click', () => deleteTask(task.id));

  // Drag handle
  const handle = document.createElement('span');
  handle.className = 'drag-handle';
  handle.textContent = '≡';
  handle.title = 'Przeciągnij, aby zmienić kolejność';

  // Text
  const span = document.createElement('span');
  span.className = 'task-text';
  span.textContent = task.text;

  // Status toggle
  const btnStatus = document.createElement('button');
  btnStatus.className = 'btn-status';
  btnStatus.textContent = task.status === 'current' ? 'Teraz' : 'Potem';
  btnStatus.title = task.status === 'current'
    ? 'Przesuń na potem'
    : 'Oznacz jako bieżące';
  btnStatus.addEventListener('click', () => toggleStatus(task.id));

  li.appendChild(btnDel);
  li.appendChild(handle);
  li.appendChild(span);
  li.appendChild(btnStatus);

  // Drag & drop events
  li.addEventListener('dragstart', e => {
    draggedId = task.id;
    e.dataTransfer.effectAllowed = 'move';
    placeholder = document.createElement('li');
    placeholder.className = 'drag-placeholder';
    placeholder.style.height = li.offsetHeight + 'px';
    placeholder.addEventListener('dragover', ev => ev.preventDefault());
    placeholder.addEventListener('drop', ev => {
      ev.preventDefault();
      if (!draggedId || !dropTarget) return;
      reorder(draggedId, dropTarget.id, dropTarget.before);
      saveState();
      render();
    });
    requestAnimationFrame(() => li.classList.add('dragging'));
  });

  li.addEventListener('dragend', () => {
    li.classList.remove('dragging');
    if (placeholder && placeholder.parentNode) placeholder.parentNode.removeChild(placeholder);
    draggedId = null;
    dropTarget = null;
    placeholder = null;
  });

  li.addEventListener('dragover', e => {
    e.preventDefault();
    if (!draggedId || draggedId === task.id || !placeholder) return;
    const dragged = state.tasks.find(t => t.id === draggedId);
    if (!dragged || dragged.status !== task.status) return;

    const rect = li.getBoundingClientRect();
    const before = e.clientY < rect.top + rect.height / 2;
    const insertRef = before ? li : li.nextSibling;

    if (placeholder.nextSibling === insertRef || insertRef === placeholder) return;

    const siblings = [...li.parentNode.querySelectorAll('.task-item:not(.dragging)')];
    const tops = siblings.map(el => el.getBoundingClientRect().top);

    dropTarget = { id: task.id, before };
    li.parentNode.insertBefore(placeholder, insertRef);

    siblings.forEach((el, i) => {
      const delta = tops[i] - el.getBoundingClientRect().top;
      if (delta === 0) return;
      el.style.transition = 'none';
      el.style.transform = `translateY(${delta}px)`;
      requestAnimationFrame(() => {
        el.style.transition = 'transform 0.18s ease';
        el.style.transform = '';
      });
    });

    e.dataTransfer.dropEffect = 'move';
  });

  li.addEventListener('drop', e => {
    e.preventDefault();
    if (!draggedId || draggedId === task.id || !dropTarget) return;
    const dragged = state.tasks.find(t => t.id === draggedId);
    if (!dragged || dragged.status !== task.status) return;
    reorder(draggedId, dropTarget.id, dropTarget.before);
    saveState();
    render();
  });

  // Touch drag & drop (mobile)
  let touchPending = false;

  li.addEventListener('touchstart', () => {
    touchPending = true;
  }, { passive: true });

  li.addEventListener('touchmove', e => {
    if (!touchPending && draggedId !== task.id) return;

    const touch = e.touches[0];

    // Activate drag on first move
    if (touchPending) {
      touchPending = false;
      draggedId = task.id;
      placeholder = document.createElement('li');
      placeholder.className = 'drag-placeholder';
      placeholder.style.height = li.offsetHeight + 'px';
      placeholder.addEventListener('dragover', ev => ev.preventDefault());
      placeholder.addEventListener('drop', ev => {
        ev.preventDefault();
        if (!draggedId || !dropTarget) return;
        reorder(draggedId, dropTarget.id, dropTarget.before);
        saveState();
        render();
      });
      li.classList.add('dragging');
    }

    if (draggedId !== task.id || !placeholder) return;
    e.preventDefault();

    // Find element under finger (hide dragged item so it doesn't block hit-test)
    li.style.visibility = 'hidden';
    const target = document.elementFromPoint(touch.clientX, touch.clientY);
    li.style.visibility = '';

    const targetItem = target && target.closest('.task-item');
    if (!targetItem || targetItem === li || targetItem === placeholder) return;

    const targetId = targetItem.dataset.id;
    const targetTask = state.tasks.find(t => t.id === targetId);
    const draggedTask = state.tasks.find(t => t.id === draggedId);
    if (!targetTask || !draggedTask || targetTask.status !== draggedTask.status) return;

    const rect = targetItem.getBoundingClientRect();
    const before = touch.clientY < rect.top + rect.height / 2;
    const insertRef = before ? targetItem : targetItem.nextSibling;

    if (placeholder.nextSibling === insertRef || insertRef === placeholder) return;

    const siblings = [...targetItem.parentNode.querySelectorAll('.task-item:not(.dragging)')];
    const tops = siblings.map(el => el.getBoundingClientRect().top);

    dropTarget = { id: targetId, before };
    targetItem.parentNode.insertBefore(placeholder, insertRef);

    siblings.forEach((el, i) => {
      const delta = tops[i] - el.getBoundingClientRect().top;
      if (delta === 0) return;
      el.style.transition = 'none';
      el.style.transform = `translateY(${delta}px)`;
      requestAnimationFrame(() => {
        el.style.transition = 'transform 0.18s ease';
        el.style.transform = '';
      });
    });
  }, { passive: false });

  const finishTouch = () => {
    touchPending = false;
    if (draggedId !== task.id) return;
    li.classList.remove('dragging');
    if (placeholder && placeholder.parentNode) placeholder.parentNode.removeChild(placeholder);
    if (dropTarget) {
      const dragged = state.tasks.find(t => t.id === draggedId);
      const target = state.tasks.find(t => t.id === dropTarget.id);
      if (dragged && target && dragged.status === target.status) {
        reorder(draggedId, dropTarget.id, dropTarget.before);
        saveState();
        render();
      }
    }
    draggedId = null;
    dropTarget = null;
    placeholder = null;
  };

  li.addEventListener('touchend', finishTouch);
  li.addEventListener('touchcancel', finishTouch);

  return li;
}

function makeArchiveEl(task) {
  const li = document.createElement('li');
  li.className = 'task-item';

  const btnDel = document.createElement('button');
  btnDel.className = 'btn-delete';
  btnDel.innerHTML = '&times;';
  btnDel.title = 'Usuń na stałe';
  btnDel.addEventListener('click', () => permanentDelete(task.id));

  const span = document.createElement('span');
  span.className = 'task-text';
  span.textContent = task.text;

  const meta = document.createElement('span');
  meta.className = 'archive-meta';
  const days = daysSince(task.archivedAt);
  meta.textContent = days === 0 ? 'dziś' : `${days} d. temu`;

  li.appendChild(btnDel);
  li.appendChild(span);
  li.appendChild(meta);
  return li;
}


// ---------- Render ----------

function render() {
  const currentList = document.getElementById('list-current');
  const laterList   = document.getElementById('list-later');
  const archiveList = document.getElementById('list-archive');

  currentList.innerHTML = '';
  laterList.innerHTML   = '';
  archiveList.innerHTML = '';

  const current = state.tasks
    .filter(t => t.status === 'current')
    .sort((a, b) => a.order - b.order);

  const later = state.tasks
    .filter(t => t.status === 'later')
    .sort((a, b) => a.order - b.order);

  if (current.length === 0) {
    const hint = document.createElement('li');
    hint.className = 'empty-hint';
    hint.textContent = 'Brak bieżących zadań';
    currentList.appendChild(hint);
  } else {
    current.forEach(task => currentList.appendChild(makeTaskEl(task)));
  }

  if (later.length === 0) {
    const hint = document.createElement('li');
    hint.className = 'empty-hint';
    hint.textContent = 'Brak zadań na potem';
    laterList.appendChild(hint);
  } else {
    later.forEach(task => laterList.appendChild(makeTaskEl(task)));
  }

  state.archive.forEach(task => archiveList.appendChild(makeArchiveEl(task)));

  document.getElementById('count-current').textContent = current.length;
  document.getElementById('count-later').textContent   = later.length;
  document.getElementById('count-archive').textContent = state.archive.length;
}

// ---------- Init ----------

document.getElementById('task-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') handleAdd();
});

loadState();
render();
