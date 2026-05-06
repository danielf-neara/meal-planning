'use strict';

// ─── Constants ────────────────────────────────────────────────────────────────

const CFG_KEY = 'mp_config';
const CHECKED_KEY = 'mp_checked';

const DAYS = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
const DAY_SHORT = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

const CARD_COLORS = ['#4A7F65','#7B6B8E','#8E6B4A','#4A7A8E','#8B5E5E','#6B8E4A','#5E7B8B','#8B7A4A'];

// ─── State ────────────────────────────────────────────────────────────────────

const state = {
  view: 'recipes',
  data: { recipes: [], plans: {} },
  weekOffset: 0,
  search: '',
  github: { token: '', repo: '', sha: null },
};

// ─── GitHub API ───────────────────────────────────────────────────────────────

async function ghRequest(method, path, body = null) {
  const { token, repo } = state.github;
  const res = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : null,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `GitHub error ${res.status}`);
  }
  return res.json();
}

async function loadData() {
  try {
    const file = await ghRequest('GET', 'data.json');
    state.github.sha = file.sha;
    const raw = decodeURIComponent(escape(atob(file.content.replace(/\n/g, ''))));
    const parsed = JSON.parse(raw);
    state.data.recipes = parsed.recipes || [];
    state.data.plans = parsed.plans || {};
  } catch (e) {
    if (e.message && e.message.includes('Not Found')) {
      state.data = { recipes: [], plans: {} };
      await saveData();
    } else {
      throw e;
    }
  }
}

async function saveData() {
  const json = JSON.stringify(state.data, null, 2);
  const content = btoa(unescape(encodeURIComponent(json)));
  const body = { message: 'Update meal planner data', content };
  if (state.github.sha) body.sha = state.github.sha;
  const res = await ghRequest('PUT', 'data.json', body);
  state.github.sha = res.content.sha;
}

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  const cfg = JSON.parse(localStorage.getItem(CFG_KEY) || '{}');

  document.getElementById('nav').addEventListener('click', e => {
    const btn = e.target.closest('.nav-btn');
    if (btn) navigate(btn.dataset.view);
  });

  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('overlay')) closeModal();
  });

  document.getElementById('settings-btn').addEventListener('click', () => renderSetup(true));

  if (!cfg.token || !cfg.repo) {
    renderSetup();
    return;
  }

  state.github.token = cfg.token;
  state.github.repo = cfg.repo;

  try {
    setStatus('Loading...');
    await loadData();
    setStatus('');
    showApp();
    navigate('recipes');
  } catch (e) {
    setStatus('Error');
    renderSetup(false, 'Could not connect: ' + e.message);
  }
}

function showApp() {
  document.getElementById('nav').style.display = 'flex';
  document.getElementById('settings-btn').style.display = 'flex';
}

// ─── Setup ────────────────────────────────────────────────────────────────────

function renderSetup(isSettings = false, errorMsg = '') {
  const cfg = JSON.parse(localStorage.getItem(CFG_KEY) || '{}');

  document.getElementById('nav').style.display = 'none';
  document.getElementById('settings-btn').style.display = 'none';

  document.getElementById('main').innerHTML = `
    <div class="setup">
      <div class="setup-card">
        <h1>Meal Planner</h1>
        <p class="setup-intro">Connect a GitHub repository to store your recipes and meal plans. The repo must already exist on GitHub.</p>
        ${errorMsg ? `<div class="alert alert-error">${escHtml(errorMsg)}</div>` : ''}
        <div class="field">
          <label class="field-label" for="s-token">
            GitHub Personal Access Token
            <a href="https://github.com/settings/tokens/new?description=Meal+Planner&scopes=repo" target="_blank" class="help-link">(create one)</a>
          </label>
          <input type="password" id="s-token" class="input" value="${escAttr(cfg.token || '')}" placeholder="ghp_...">
        </div>
        <div class="field">
          <label class="field-label" for="s-repo">GitHub Repository</label>
          <input type="text" id="s-repo" class="input" value="${escAttr(cfg.repo || 'danielf-neara/meal-planning')}" placeholder="username/repo-name">
        </div>
        <button class="btn btn-primary btn-full" id="s-save">Connect</button>
        ${isSettings ? `<button class="btn btn-outline btn-full" id="s-cancel">Cancel</button>` : ''}
        <p class="setup-note">Your token needs repo access. Data is stored as data.json in the root of your repo.</p>
      </div>
    </div>
  `;

  document.getElementById('s-cancel')?.addEventListener('click', () => {
    showApp();
    navigate(state.view);
  });

  document.getElementById('s-save').addEventListener('click', async () => {
    const token = document.getElementById('s-token').value.trim();
    const repo = document.getElementById('s-repo').value.trim();
    if (!token || !repo) return;

    const btn = document.getElementById('s-save');
    btn.disabled = true;
    btn.textContent = 'Connecting...';

    state.github.token = token;
    state.github.repo = repo;
    state.github.sha = null;

    try {
      await loadData();
      localStorage.setItem(CFG_KEY, JSON.stringify({ token, repo }));
      setStatus('');
      showApp();
      navigate('recipes');
    } catch (e) {
      btn.disabled = false;
      btn.textContent = 'Connect';
      renderSetup(isSettings, 'Connection failed: ' + e.message);
    }
  });
}

// ─── Navigation ───────────────────────────────────────────────────────────────

function navigate(view) {
  state.view = view;
  document.querySelectorAll('.nav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.view === view);
  });
  render();
}

function render() {
  if (state.view === 'recipes') renderRecipes();
  else if (state.view === 'planner') renderPlanner();
  else if (state.view === 'shopping') renderShopping();
}

// ─── Recipes View ─────────────────────────────────────────────────────────────

function renderRecipes() {
  const q = state.search.toLowerCase();
  const recipes = state.data.recipes
    .filter(r => !q
      || r.name.toLowerCase().includes(q)
      || (r.source || '').toLowerCase().includes(q)
      || (r.tags || []).some(t => t.toLowerCase().includes(q)))
    .sort((a, b) => a.name.localeCompare(b.name));

  document.getElementById('main').innerHTML = `
    <div class="view-recipes">
      <div class="toolbar">
        <input type="search" class="search-input" id="r-search" placeholder="Search recipes..." value="${escAttr(state.search)}">
        <button class="btn btn-primary" id="add-btn">+ Add Recipe</button>
      </div>
      ${recipes.length === 0 ? `
        <div class="empty-state">
          <div class="empty-icon">&#127859;</div>
          <h2>${state.search ? 'No recipes found' : 'No recipes yet'}</h2>
          <p>${state.search ? 'Try a different search.' : 'Add your first recipe to get started.'}</p>
          ${!state.search ? '<button class="btn btn-primary" id="empty-add">Add Recipe</button>' : ''}
        </div>
      ` : `
        <div class="recipe-grid">
          ${recipes.map(r => recipeCardHtml(r)).join('')}
        </div>
      `}
    </div>
  `;

  document.getElementById('r-search').addEventListener('input', e => {
    state.search = e.target.value;
    renderRecipes();
  });

  document.getElementById('add-btn').addEventListener('click', () => showRecipeForm());
  document.getElementById('empty-add')?.addEventListener('click', () => showRecipeForm());

  document.querySelectorAll('.recipe-card').forEach(card => {
    card.addEventListener('click', () => showRecipeDetail(card.dataset.id));
  });
}

function cardColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  return CARD_COLORS[h % CARD_COLORS.length];
}

function fmtTime(mins) {
  if (!mins || mins <= 0) return '';
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function recipeCardHtml(r) {
  const total = (r.prepTime || 0) + (r.cookTime || 0);
  const color = cardColor(r.name);
  const tags = (r.tags || []).slice(0, 3);
  return `
    <div class="recipe-card" data-id="${r.id}">
      <div class="card-header" style="background:${color}">
        <span class="card-initials">${r.name.charAt(0).toUpperCase()}</span>
      </div>
      <div class="card-body">
        <h3 class="card-name">${escHtml(r.name)}</h3>
        ${r.source ? `<span class="card-source">${escHtml(r.source)}</span>` : ''}
        <div class="card-footer">
          <div class="tag-row">${tags.map(t => `<span class="tag">${escHtml(t)}</span>`).join('')}</div>
          ${total ? `<span class="card-time">${fmtTime(total)}</span>` : ''}
        </div>
      </div>
    </div>
  `;
}

// ─── Recipe Detail ────────────────────────────────────────────────────────────

function showRecipeDetail(id) {
  const r = state.data.recipes.find(x => x.id === id);
  if (!r) return;

  const total = (r.prepTime || 0) + (r.cookTime || 0);
  const color = cardColor(r.name);
  const tags = r.tags || [];
  const ings = r.ingredients || [];
  const steps = r.steps || [];

  openModal(`
    <div class="recipe-detail">
      <div class="detail-header" style="background:${color}">
        <h1 class="detail-name">${escHtml(r.name)}</h1>
        ${r.source ? `<span class="detail-source">${escHtml(r.source)}</span>` : ''}
      </div>
      <div class="detail-body">
        ${(r.servings || r.prepTime || r.cookTime) ? `
          <div class="detail-meta">
            ${r.servings ? `<div class="meta-item"><span class="meta-label">Serves</span><span class="meta-val">${r.servings}</span></div>` : ''}
            ${r.prepTime ? `<div class="meta-item"><span class="meta-label">Prep</span><span class="meta-val">${fmtTime(r.prepTime)}</span></div>` : ''}
            ${r.cookTime ? `<div class="meta-item"><span class="meta-label">Cook</span><span class="meta-val">${fmtTime(r.cookTime)}</span></div>` : ''}
            ${total > 0 && r.prepTime && r.cookTime ? `<div class="meta-item"><span class="meta-label">Total</span><span class="meta-val">${fmtTime(total)}</span></div>` : ''}
          </div>
        ` : ''}
        ${r.description ? `<p class="detail-description">${escHtml(r.description)}</p>` : ''}
        ${tags.length ? `<div class="tag-row">${tags.map(t => `<span class="tag">${escHtml(t)}</span>`).join('')}</div>` : ''}
        ${ings.length ? `
          <h2 class="detail-section-title">Ingredients</h2>
          <ul class="ingredients-list">
            ${ings.map(ing => `
              <li class="ingredient-item">
                ${ing.amount ? `<span class="ing-amount">${escHtml(ing.amount)}</span>` : ''}
                ${ing.unit ? `<span class="ing-unit">${escHtml(ing.unit)}</span>` : ''}
                <span class="ing-name">${escHtml(ing.item)}</span>
              </li>
            `).join('')}
          </ul>
        ` : ''}
        ${steps.length ? `
          <h2 class="detail-section-title">Method</h2>
          <ol class="steps-list">
            ${steps.map(s => `<li class="step-item">${escHtml(s)}</li>`).join('')}
          </ol>
        ` : ''}
        ${r.notes ? `
          <h2 class="detail-section-title">Notes</h2>
          <p class="detail-notes">${escHtml(r.notes)}</p>
        ` : ''}
        ${r.sourceUrl ? `<a href="${escAttr(r.sourceUrl)}" target="_blank" class="source-link">View original recipe &rarr;</a>` : ''}
        <div class="detail-actions">
          <button class="btn btn-outline" id="detail-edit">Edit</button>
          <button class="btn btn-danger" id="detail-delete">Delete</button>
        </div>
      </div>
    </div>
  `, 'modal-wide');

  document.getElementById('detail-edit').addEventListener('click', () => {
    closeModal();
    showRecipeForm(id);
  });

  document.getElementById('detail-delete').addEventListener('click', () => deleteRecipe(id));
}

// ─── Recipe Form ──────────────────────────────────────────────────────────────

function showRecipeForm(id = null) {
  const r = id ? state.data.recipes.find(x => x.id === id) : null;
  const ings = r?.ingredients?.length ? r.ingredients : [{ amount: '', unit: '', item: '' }];
  const steps = r?.steps?.length ? r.steps : [''];

  openModal(`
    <div class="form-view">
      <h2>${r ? 'Edit Recipe' : 'Add Recipe'}</h2>
      <form id="recipe-form" autocomplete="off">
        <div class="field">
          <label class="field-label" for="f-name">Recipe Name *</label>
          <input type="text" id="f-name" class="input" value="${escAttr(r?.name || '')}" required placeholder="e.g. Spaghetti Bolognese">
        </div>
        <div class="field">
          <label class="field-label" for="f-desc">Description</label>
          <textarea id="f-desc" class="input textarea" rows="2" placeholder="Brief description...">${escHtml(r?.description || '')}</textarea>
        </div>
        <div class="field-row">
          <div class="field">
            <label class="field-label" for="f-servings">Serves</label>
            <input type="number" id="f-servings" class="input" value="${escAttr(String(r?.servings || ''))}" min="1" max="100" placeholder="4">
          </div>
          <div class="field">
            <label class="field-label" for="f-prep">Prep (mins)</label>
            <input type="number" id="f-prep" class="input" value="${escAttr(String(r?.prepTime || ''))}" min="0" placeholder="15">
          </div>
          <div class="field">
            <label class="field-label" for="f-cook">Cook (mins)</label>
            <input type="number" id="f-cook" class="input" value="${escAttr(String(r?.cookTime || ''))}" min="0" placeholder="30">
          </div>
        </div>
        <div class="field-row-2">
          <div class="field">
            <label class="field-label" for="f-source">Source</label>
            <input type="text" id="f-source" class="input" value="${escAttr(r?.source || '')}" placeholder="e.g. Mum, Instagram">
          </div>
          <div class="field">
            <label class="field-label" for="f-url">Source URL</label>
            <input type="url" id="f-url" class="input" value="${escAttr(r?.sourceUrl || '')}" placeholder="https://...">
          </div>
        </div>
        <div class="field">
          <label class="field-label" for="f-tags">Tags <span style="font-weight:400;text-transform:none;">(comma separated)</span></label>
          <input type="text" id="f-tags" class="input" value="${escAttr((r?.tags || []).join(', '))}" placeholder="Italian, Pasta, Family favourite">
        </div>
        <div class="field">
          <label class="field-label">Ingredients</label>
          <div id="ing-list">${ings.map(i => ingRowHtml(i)).join('')}</div>
          <button type="button" class="btn btn-sm btn-outline" id="add-ing" style="margin-top:6px">+ Add Ingredient</button>
        </div>
        <div class="field">
          <label class="field-label">Method</label>
          <div id="steps-list">${steps.map(s => stepRowHtml(s)).join('')}</div>
          <button type="button" class="btn btn-sm btn-outline" id="add-step" style="margin-top:6px">+ Add Step</button>
        </div>
        <div class="field">
          <label class="field-label" for="f-notes">Notes</label>
          <textarea id="f-notes" class="input textarea" rows="3" placeholder="Tips, storage, substitutions...">${escHtml(r?.notes || '')}</textarea>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-outline" id="form-cancel">Cancel</button>
          <button type="submit" class="btn btn-primary" id="form-submit">${r ? 'Save Changes' : 'Add Recipe'}</button>
        </div>
      </form>
    </div>
  `, 'modal-wide');

  updateStepNums();
  bindRemoveHandlers();

  document.getElementById('add-ing').addEventListener('click', () => {
    document.getElementById('ing-list').insertAdjacentHTML('beforeend', ingRowHtml({ amount: '', unit: '', item: '' }));
    bindRemoveHandlers();
  });

  document.getElementById('add-step').addEventListener('click', () => {
    document.getElementById('steps-list').insertAdjacentHTML('beforeend', stepRowHtml(''));
    updateStepNums();
    bindRemoveHandlers();
  });

  document.getElementById('form-cancel').addEventListener('click', closeModal);

  document.getElementById('recipe-form').addEventListener('submit', async e => {
    e.preventDefault();
    const data = readForm();
    if (!data.name) return;

    const btn = document.getElementById('form-submit');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    try {
      await commitRecipe(data, id);
      closeModal();
      render();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = r ? 'Save Changes' : 'Add Recipe';
      alert('Save failed: ' + err.message);
    }
  });
}

function ingRowHtml(ing) {
  return `
    <div class="ing-row">
      <input type="text" class="input ing-amount" value="${escAttr(ing.amount || '')}" placeholder="Qty" style="width:64px;flex-shrink:0">
      <input type="text" class="input ing-unit" value="${escAttr(ing.unit || '')}" placeholder="Unit" style="width:80px;flex-shrink:0">
      <input type="text" class="input ing-item" value="${escAttr(ing.item || '')}" placeholder="Ingredient" style="flex:1">
      <button type="button" class="btn-remove" data-row="ing-row">&#x2715;</button>
    </div>`;
}

function stepRowHtml(text) {
  return `
    <div class="step-row">
      <span class="step-num">1</span>
      <textarea class="input step-text" rows="2" style="flex:1">${escHtml(text || '')}</textarea>
      <button type="button" class="btn-remove" data-row="step-row">&#x2715;</button>
    </div>`;
}

function bindRemoveHandlers() {
  document.querySelectorAll('.btn-remove').forEach(btn => {
    btn.onclick = () => {
      btn.closest('.' + btn.dataset.row).remove();
      updateStepNums();
    };
  });
}

function updateStepNums() {
  document.querySelectorAll('.step-row').forEach((row, i) => {
    row.querySelector('.step-num').textContent = i + 1;
  });
}

function readForm() {
  const ings = [];
  document.querySelectorAll('.ing-row').forEach(row => {
    const item = row.querySelector('.ing-item').value.trim();
    if (item) ings.push({
      amount: row.querySelector('.ing-amount').value.trim(),
      unit: row.querySelector('.ing-unit').value.trim(),
      item,
    });
  });

  const steps = [];
  document.querySelectorAll('.step-text').forEach(ta => {
    const s = ta.value.trim();
    if (s) steps.push(s);
  });

  return {
    name: document.getElementById('f-name').value.trim(),
    description: document.getElementById('f-desc').value.trim(),
    servings: parseInt(document.getElementById('f-servings').value) || null,
    prepTime: parseInt(document.getElementById('f-prep').value) || 0,
    cookTime: parseInt(document.getElementById('f-cook').value) || 0,
    source: document.getElementById('f-source').value.trim(),
    sourceUrl: document.getElementById('f-url').value.trim(),
    tags: document.getElementById('f-tags').value.split(',').map(t => t.trim()).filter(Boolean),
    ingredients: ings,
    steps,
    notes: document.getElementById('f-notes').value.trim(),
  };
}

async function commitRecipe(data, id = null) {
  const now = new Date().toISOString().split('T')[0];
  if (id) {
    const idx = state.data.recipes.findIndex(r => r.id === id);
    state.data.recipes[idx] = { ...state.data.recipes[idx], ...data, updatedAt: now };
  } else {
    state.data.recipes.push({ ...data, id: genId(), createdAt: now, updatedAt: now });
  }
  setStatus('Saving...');
  await saveData();
  flashStatus('Saved');
}

async function deleteRecipe(id) {
  if (!confirm('Delete this recipe? This cannot be undone.')) return;
  state.data.recipes = state.data.recipes.filter(r => r.id !== id);
  for (const week of Object.values(state.data.plans)) {
    for (const day of DAYS) {
      if (week[day] === id) week[day] = null;
    }
  }
  setStatus('Saving...');
  closeModal();
  await saveData();
  flashStatus('Saved');
  render();
}

// ─── Planner View ─────────────────────────────────────────────────────────────

function weekStart(offset) {
  const now = new Date();
  const dow = now.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  const mon = new Date(now);
  mon.setDate(now.getDate() + diff + offset * 7);
  mon.setHours(0, 0, 0, 0);
  return mon;
}

function weekKey(date) {
  return date.toISOString().split('T')[0];
}

function fmtDateShort(d) {
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
}

function renderPlanner() {
  const start = weekStart(state.weekOffset);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const key = weekKey(start);
  const plan = state.data.plans[key] || {};

  document.getElementById('main').innerHTML = `
    <div class="view-planner">
      <div class="planner-header">
        <button class="btn btn-outline btn-sm" id="prev-week">&larr; Prev</button>
        <span class="week-label">${fmtDateShort(start)} &ndash; ${fmtDateShort(end)}</span>
        <button class="btn btn-outline btn-sm" id="next-week">Next &rarr;</button>
      </div>
      <div class="planner-grid">
        ${DAYS.map((day, i) => {
          const date = new Date(start);
          date.setDate(start.getDate() + i);
          const recipeId = plan[day] || null;
          const recipe = recipeId ? state.data.recipes.find(r => r.id === recipeId) : null;
          return `
            <div class="day-card ${recipe ? 'has-meal' : ''}" data-day="${day}" data-key="${key}">
              <div class="day-label">${DAY_SHORT[i]}</div>
              <div class="day-date">${fmtDateShort(date)}</div>
              <div class="day-meal">
                ${recipe ? `
                  <span class="day-recipe-name">${escHtml(recipe.name)}</span>
                  <button class="btn-clear-day" data-day="${day}" data-key="${key}" title="Remove meal">&#x2715;</button>
                ` : `
                  <span class="day-empty-label">+ Add meal</span>
                `}
              </div>
            </div>
          `;
        }).join('')}
      </div>
      <div class="planner-footer">
        <button class="btn btn-primary" id="to-shopping">View Shopping List &rarr;</button>
      </div>
    </div>
  `;

  document.getElementById('prev-week').addEventListener('click', () => { state.weekOffset--; renderPlanner(); });
  document.getElementById('next-week').addEventListener('click', () => { state.weekOffset++; renderPlanner(); });
  document.getElementById('to-shopping').addEventListener('click', () => navigate('shopping'));

  document.querySelectorAll('.day-card').forEach(card => {
    card.addEventListener('click', e => {
      if (e.target.closest('.btn-clear-day')) return;
      showRecipePicker(card.dataset.day, card.dataset.key);
    });
  });

  document.querySelectorAll('.btn-clear-day').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      setMeal(btn.dataset.key, btn.dataset.day, null);
    });
  });
}

function showRecipePicker(day, key) {
  let q = '';

  function pickerHtml() {
    const matches = state.data.recipes
      .filter(r => !q || r.name.toLowerCase().includes(q.toLowerCase()))
      .sort((a, b) => a.name.localeCompare(b.name));
    return `
      <div class="picker-view">
        <h2>Pick a meal for ${DAY_SHORT[DAYS.indexOf(day)]}</h2>
        <input type="search" class="search-input" id="picker-q" placeholder="Search recipes..." value="${escAttr(q)}">
        <div class="picker-list">
          ${matches.length ? matches.map(r => `
            <div class="picker-item" data-id="${r.id}">
              <div class="picker-color" style="background:${cardColor(r.name)}"></div>
              <div class="picker-info">
                <span class="picker-name">${escHtml(r.name)}</span>
                ${r.source ? `<span class="picker-source">${escHtml(r.source)}</span>` : ''}
              </div>
            </div>
          `).join('') : '<p class="empty-text">No recipes found.</p>'}
        </div>
      </div>
    `;
  }

  function bind() {
    const searchEl = document.getElementById('picker-q');
    if (searchEl) {
      searchEl.focus();
      searchEl.addEventListener('input', e => {
        q = e.target.value;
        document.getElementById('modal-content').innerHTML = pickerHtml();
        bind();
      });
    }
    document.querySelectorAll('.picker-item').forEach(item => {
      item.addEventListener('click', async () => {
        await setMeal(key, day, item.dataset.id);
        closeModal();
        renderPlanner();
      });
    });
  }

  openModal(pickerHtml(), '');
  bind();
}

async function setMeal(key, day, recipeId) {
  if (!state.data.plans[key]) state.data.plans[key] = {};
  if (recipeId === null) {
    delete state.data.plans[key][day];
  } else {
    state.data.plans[key][day] = recipeId;
  }
  setStatus('Saving...');
  await saveData();
  flashStatus('Saved');
}

// ─── Shopping List ────────────────────────────────────────────────────────────

function renderShopping() {
  const start = weekStart(state.weekOffset);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const key = weekKey(start);
  const plan = state.data.plans[key] || {};

  const meals = DAYS
    .map((day, i) => ({ day, label: DAY_SHORT[i], recipe: plan[day] ? state.data.recipes.find(r => r.id === plan[day]) : null }))
    .filter(m => m.recipe);

  document.getElementById('main').innerHTML = `
    <div class="view-shopping">
      <div class="shopping-header">
        <h2>Shopping List</h2>
        <p class="shopping-week">${fmtDateShort(start)} &ndash; ${fmtDateShort(end)}</p>
      </div>
      ${meals.length === 0 ? `
        <div class="empty-state">
          <h3>No meals planned this week</h3>
          <p>Add meals in the Planner to generate your shopping list.</p>
          <button class="btn btn-primary" id="go-plan">Go to Planner</button>
        </div>
      ` : `
        <div class="meal-summary">
          <p class="summary-label">Meals this week</p>
          <ul class="meal-list">
            ${meals.map(m => `<li><strong>${m.label}:</strong> ${escHtml(m.recipe.name)}</li>`).join('')}
          </ul>
        </div>
        <div class="shopping-list" id="shopping-list">
          ${buildShoppingHtml(meals.map(m => m.recipe))}
        </div>
        <div class="shopping-footer">
          <button class="btn btn-outline" id="clear-checked">Clear checked items</button>
        </div>
      `}
    </div>
  `;

  document.getElementById('go-plan')?.addEventListener('click', () => navigate('planner'));

  document.getElementById('clear-checked')?.addEventListener('click', () => {
    localStorage.removeItem(CHECKED_KEY);
    document.getElementById('shopping-list').innerHTML = buildShoppingHtml(meals.map(m => m.recipe));
    bindShoppingChecks(meals.map(m => m.recipe));
  });

  bindShoppingChecks(meals.map(m => m.recipe));
}

function consolidate(recipes) {
  const map = new Map();
  for (const recipe of recipes) {
    for (const ing of (recipe.ingredients || [])) {
      if (!ing.item) continue;
      const key = ing.item.trim().toLowerCase() + '__' + (ing.unit || '').trim().toLowerCase();
      if (map.has(key)) {
        const existing = map.get(key);
        const addAmt = parseFloat(ing.amount) || 0;
        if (addAmt && parseFloat(existing.amount)) {
          existing.amount = String(parseFloat(existing.amount) + addAmt);
        } else if (!existing.amount && ing.amount) {
          existing.amount = ing.amount;
        }
      } else {
        map.set(key, {
          key,
          item: ing.item.trim(),
          unit: (ing.unit || '').trim(),
          amount: (ing.amount || '').trim(),
        });
      }
    }
  }
  return [...map.values()].sort((a, b) => a.item.localeCompare(b.item));
}

function buildShoppingHtml(recipes) {
  const items = consolidate(recipes);
  const checked = JSON.parse(localStorage.getItem(CHECKED_KEY) || '{}');

  if (items.length === 0) return '<p style="padding:20px;color:var(--text-muted)">No ingredients found. Make sure your recipes have ingredients added.</p>';

  // Group into unchecked and checked
  const unchecked = items.filter(i => !checked[i.key]);
  const chkd = items.filter(i => checked[i.key]);

  let html = '';
  if (unchecked.length) {
    html += unchecked.map(i => shopItemHtml(i, false)).join('');
  }
  if (chkd.length) {
    html += `<div class="shop-group-title">Already have (${chkd.length})</div>`;
    html += chkd.map(i => shopItemHtml(i, true)).join('');
  }
  return html;
}

function shopItemHtml(item, isChecked) {
  const qtyText = [item.amount, item.unit].filter(Boolean).join(' ');
  return `
    <div class="shop-item ${isChecked ? 'checked' : ''}">
      <input type="checkbox" class="shop-check shopping-check" data-key="${escAttr(item.key)}" ${isChecked ? 'checked' : ''}>
      <span class="shop-text">${escHtml(item.item)}</span>
      ${qtyText ? `<span class="shop-qty">${escHtml(qtyText)}</span>` : ''}
    </div>
  `;
}

function bindShoppingChecks(recipes) {
  document.querySelectorAll('.shopping-check').forEach(cb => {
    cb.addEventListener('change', e => {
      const key = e.target.dataset.key;
      const checked = JSON.parse(localStorage.getItem(CHECKED_KEY) || '{}');
      if (e.target.checked) checked[key] = true;
      else delete checked[key];
      localStorage.setItem(CHECKED_KEY, JSON.stringify(checked));
      document.getElementById('shopping-list').innerHTML = buildShoppingHtml(recipes);
      bindShoppingChecks(recipes);
    });
  });
}

// ─── Modal ────────────────────────────────────────────────────────────────────

function openModal(html, extraClass = '') {
  const overlay = document.getElementById('overlay');
  const modal = document.getElementById('modal');
  const content = document.getElementById('modal-content');
  modal.className = 'modal' + (extraClass ? ' ' + extraClass : '');
  content.innerHTML = html;
  overlay.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  document.getElementById('overlay').classList.add('hidden');
  document.getElementById('modal-content').innerHTML = '';
  document.body.style.overflow = '';
}

// ─── Status ───────────────────────────────────────────────────────────────────

function setStatus(msg) {
  document.getElementById('save-status').textContent = msg;
}

function flashStatus(msg, duration = 2000) {
  setStatus(msg);
  setTimeout(() => setStatus(''), duration);
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escAttr(str) {
  return String(str ?? '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ─── Start ────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);
