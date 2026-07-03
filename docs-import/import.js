#!/usr/bin/env node
/**
 * Import de la documentation Obliance dans BookStack via son API REST.
 *
 * Securite (voir README.md) :
 *  - Dry-run par defaut. Rien n'est cree tant que --apply n'est pas passe.
 *  - Aucune fonction de suppression n'existe dans ce fichier : il ne peut
 *    litteralement pas supprimer quoi que ce soit sur ton BookStack.
 *  - Create-only : seuls des GET (lecture) et des POST/PUT de creation sont
 *    emis, jamais de DELETE.
 *  - Idempotent : chaque objet cree (etagere/livre/chapitre/page) est trace
 *    dans .bookstack-import-state.json. Relancer le script ne duplique rien.
 *  - Si un livre/chapitre/page du meme nom existe deja sur ton BookStack
 *    SANS avoir ete cree par ce script, le script s'arrete et te previent
 *    au lieu d'y toucher — sauf si tu passes explicitement --force-reuse.
 *
 * Usage :
 *   node import.js                # dry-run : affiche le plan, ne cree rien
 *   node import.js --apply        # cree reellement le contenu
 *   node import.js --apply --force-reuse   # + reutilise un objet existant homonyme
 *
 * Variables d'environnement requises :
 *   BOOKSTACK_URL           ex: https://doc.exemple.com
 *   BOOKSTACK_TOKEN_ID      Parametres > Jetons API sur ton compte BookStack
 *   BOOKSTACK_TOKEN_SECRET
 *
 * Necessite Node.js 18+ (fetch natif).
 */

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const MANIFEST_PATH = path.join(ROOT, 'manifest.json');
const STATE_PATH = path.join(ROOT, '.bookstack-import-state.json');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const FORCE_REUSE = args.includes('--force-reuse');

const BASE_URL = process.env.BOOKSTACK_URL;
const TOKEN_ID = process.env.BOOKSTACK_TOKEN_ID;
const TOKEN_SECRET = process.env.BOOKSTACK_TOKEN_SECRET;

if (!BASE_URL || !TOKEN_ID || !TOKEN_SECRET) {
  console.error('Variables d\'environnement manquantes : BOOKSTACK_URL, BOOKSTACK_TOKEN_ID, BOOKSTACK_TOKEN_SECRET.');
  console.error('Voir le README.md de ce dossier pour savoir comment les obtenir.');
  process.exit(1);
}

function loadJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return fallback; }
}
function saveJson(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), 'utf-8');
}

const state = loadJson(STATE_PATH, { shelfId: null, books: {}, chapters: {}, pages: {} });

async function api(method, endpoint, body) {
  const res = await fetch(`${BASE_URL.replace(/\/$/, '')}/api${endpoint}`, {
    method,
    headers: {
      Authorization: `Token ${TOKEN_ID}:${TOKEN_SECRET}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${method} ${endpoint} -> HTTP ${res.status}: ${text}`);
  }
  return res.status === 204 ? null : res.json();
}

// ---- Lecture seule (toujours safe, meme en dry-run) ----
async function findByName(endpoint, name) {
  const data = await api('GET', `${endpoint}?filter[name]=${encodeURIComponent(name)}&count=50`);
  return (data.data || []).find((x) => x.name === name) || null;
}

// ---- Creation uniquement (bloque tant que --apply n'est pas passe) ----
async function createBook(name, description) {
  return api('POST', '/books', { name, description: description || '' });
}
async function createChapter(bookId, name) {
  return api('POST', '/chapters', { book_id: bookId, name });
}
async function createPage(bookId, chapterId, name, markdown) {
  const body = { name, markdown };
  if (chapterId) body.chapter_id = chapterId;
  else body.book_id = bookId;
  return api('POST', '/pages', body);
}
async function createShelf(name, description, bookIds) {
  return api('POST', '/shelves', { name, description: description || '', books: bookIds || [] });
}
async function attachBooksToShelf(shelfId, name, bookIds) {
  return api('PUT', `/shelves/${shelfId}`, { name, books: bookIds });
}

function log(...a) { console.log(...a); }

async function ensureBook(manifestBook) {
  const trackedId = state.books[manifestBook.slug];
  if (trackedId) {
    log(`  [livre] "${manifestBook.title}" deja cree par ce script (id=${trackedId}) — reutilise.`);
    return trackedId;
  }

  const existing = await findByName('/books', manifestBook.title);
  if (existing) {
    if (!FORCE_REUSE) {
      throw new Error(
        `Un livre nomme "${manifestBook.title}" existe deja sur ce BookStack (id=${existing.id}) et n'a pas ete cree par ce script. ` +
        `Abandon pour eviter d'y toucher par erreur. Renomme le livre dans manifest.json, ou relance avec --force-reuse si tu es sur que c'est le bon.`,
      );
    }
    log(`  [livre] "${manifestBook.title}" existe deja (id=${existing.id}), --force-reuse actif — reutilise.`);
    state.books[manifestBook.slug] = existing.id;
    saveJson(STATE_PATH, state);
    return existing.id;
  }

  if (!APPLY) {
    log(`  [livre] (dry-run) creerait le livre "${manifestBook.title}"`);
    return null;
  }
  const created = await createBook(manifestBook.title, `Documentation Obliance — ${manifestBook.title}`);
  log(`  [livre] cree "${manifestBook.title}" (id=${created.id})`);
  state.books[manifestBook.slug] = created.id;
  saveJson(STATE_PATH, state);
  return created.id;
}

async function ensureChapter(bookId, bookSlug, chapter) {
  const key = `${bookSlug}/${chapter.slug}`;
  const trackedId = state.chapters[key];
  if (trackedId) {
    log(`    [chapitre] "${chapter.title}" deja cree (id=${trackedId}) — reutilise.`);
    return trackedId;
  }

  if (!APPLY) {
    log(`    [chapitre] (dry-run) creerait le chapitre "${chapter.title}"`);
    return null;
  }
  const created = await createChapter(bookId, chapter.title);
  log(`    [chapitre] cree "${chapter.title}" (id=${created.id})`);
  state.chapters[key] = created.id;
  saveJson(STATE_PATH, state);
  return created.id;
}

async function ensurePage(bookId, chapterId, bookSlug, chapterSlug, page) {
  const key = `${bookSlug}/${chapterSlug}/${page.slug}`;
  if (state.pages[key]) {
    log(`      [page] "${page.title}" deja creee (id=${state.pages[key]}) — ignoree.`);
    return;
  }
  const markdown = fs.readFileSync(path.join(ROOT, page.file), 'utf-8');

  if (!APPLY) {
    log(`      [page] (dry-run) creerait la page "${page.title}" (${markdown.length} caracteres)`);
    return;
  }
  const created = await createPage(bookId, chapterId, page.title, markdown);
  log(`      [page] creee "${page.title}" (id=${created.id})`);
  state.pages[key] = created.id;
  saveJson(STATE_PATH, state);
}

async function main() {
  const manifest = loadJson(MANIFEST_PATH, null);
  if (!manifest) {
    console.error('manifest.json introuvable a cote de ce script.');
    process.exit(1);
  }

  log(`Mode : ${APPLY ? 'APPLICATION REELLE (--apply)' : 'DRY-RUN — rien ne sera cree. Relance avec --apply pour creer reellement.'}`);
  log('');

  const bookIds = [];
  for (const book of manifest.books) {
    log(`Livre : ${book.title}`);
    const bookId = await ensureBook(book);
    if (bookId) bookIds.push(bookId);

    for (const chapter of book.chapters) {
      log(`  Chapitre : ${chapter.title}`);
      const chapterId = bookId ? await ensureChapter(bookId, book.slug, chapter) : null;
      for (const page of chapter.pages) {
        await ensurePage(bookId, chapterId, book.slug, chapter.slug, page);
      }
    }
    log('');
  }

  // L'etagere est creee/mise a jour en dernier, une fois les livres connus.
  if (state.shelfId) {
    log(`Etagere "${manifest.shelf.name}" deja creee (id=${state.shelfId}).`);
    if (APPLY && bookIds.length) await attachBooksToShelf(state.shelfId, manifest.shelf.name, bookIds);
  } else {
    const existingShelf = await findByName('/shelves', manifest.shelf.name);
    if (existingShelf && !FORCE_REUSE) {
      throw new Error(
        `Une etagere nommee "${manifest.shelf.name}" existe deja (id=${existingShelf.id}) et n'a pas ete creee par ce script. ` +
        `Abandon. Renomme l'etagere dans manifest.json, ou relance avec --force-reuse.`,
      );
    }
    if (!APPLY) {
      log(`[etagere] (dry-run) creerait l'etagere "${manifest.shelf.name}" avec ${manifest.books.length} livre(s)`);
    } else {
      let shelf;
      if (existingShelf) {
        shelf = existingShelf;
        await attachBooksToShelf(existingShelf.id, manifest.shelf.name, bookIds);
      } else {
        shelf = await createShelf(manifest.shelf.name, manifest.shelf.description, bookIds);
      }
      state.shelfId = shelf.id;
      saveJson(STATE_PATH, state);
      log(`[etagere] "${manifest.shelf.name}" prete (id=${shelf.id})`);
    }
  }

  log('');
  log(APPLY ? 'Import termine.' : 'Dry-run termine — relance avec --apply pour creer reellement le contenu.');
}

main().catch((err) => {
  console.error('ERREUR :', err.message);
  process.exit(1);
});
