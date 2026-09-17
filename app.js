// =====================================================
// 요리 일기 - 앱의 동작을 담당하는 파일
// =====================================================

// ----- 1. 데이터 저장/불러오기 -----
// 데이터는 브라우저 안(localStorage)에 저장됩니다.
// 레시피: { id, title, url, source, servings, tags, createdAt, logs: [...] }
// 기록:   { id, date, rating, changes, review }
const STORAGE_KEY = "recipe-notes-v1";

function loadRecipes() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function saveRecipes() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(recipes));
  } catch {
    alert("저장 공간이 가득 찼어요. 사진이 많은 기록을 지우거나 백업 후 정리해주세요.");
  }
}

// 설정 (썸네일 방식 등)
const SETTINGS_KEY = "recipe-settings-v1";
let settings = { thumb: "photo" }; // thumb: "photo"(내 사진 우선) | "youtube"(유튜브 우선)
try {
  Object.assign(settings, JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {});
} catch {}
const saveSettings = () => localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));

let recipes = loadRecipes();
let currentId = null; // 지금 보고 있는 레시피 (null이면 목록 화면)
let searchText = "";
let listFilter = "all"; // all | todo(해먹고 싶은) | done(만들어본)
// server.py로 실행 중이면 true (영상에서 레시피 가져오기 버튼 표시). 인터넷에 올린 버전에서는 false.
let serverOk = false;
fetch("api/status").then((r) => r.json()).then((s) => { serverOk = !!s.video; render(); }).catch(() => {});

// 링크의 제목 가져오기. server.py가 있으면 서버가, 없으면(폰) 유튜브 oEmbed → noembed 순으로 시도
async function fetchTitle(url) {
  if (serverOk) {
    try {
      const { title } = await fetch(`api/meta?url=${encodeURIComponent(url)}`).then((r) => r.json());
      if (title) return title;
    } catch {}
  }
  const vid = youtubeId(url);
  const tries = vid
    ? [`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${vid}`)}`]
    : [];
  tries.push(`https://noembed.com/embed?url=${encodeURIComponent(url)}`);
  for (const endpoint of tries) {
    try {
      const d = await fetch(endpoint).then((r) => r.json());
      if (d.title) return d.title;
    } catch {}
  }
  return "";
}

const app = document.getElementById("app");
const dialog = document.getElementById("dialog");

// ----- 2. 작은 도우미 함수들 -----
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const today = () => new Date().toISOString().slice(0, 10);

// 사용자가 입력한 글자를 화면에 안전하게 보여주기 위한 처리
function esc(text) {
  const div = document.createElement("div");
  div.textContent = text ?? "";
  return div.innerHTML;
}

// 유튜브 주소에서 영상 ID 뽑기 (watch?v=, youtu.be/, shorts/ 모두 지원)
function youtubeId(url) {
  const m = (url || "").match(/(?:youtu\.be\/|v=|shorts\/|embed\/)([\w-]{11})/);
  return m ? m[1] : null;
}

// 출처 종류: 링크가 있으면 주소로 자동 판단, 없으면 사용자가 고른 값
const SOURCES = {
  youtube: { icon: "▶", label: "유튜브" },
  instagram: { icon: "📷", label: "인스타그램" },
  blog: { icon: "🌐", label: "블로그·웹" },
  book: { icon: "📖", label: "책" },
  family: { icon: "🏠", label: "가족·지인" },
  mine: { icon: "✏️", label: "내 레시피" },
};

function sourceOf(r) {
  const u = (r.url || "").toLowerCase();
  if (youtubeId(u)) return "youtube";
  if (u.includes("instagram.com")) return "instagram";
  if (u) return "blog";
  return SOURCES[r.source] ? r.source : "mine";
}

// 사진 파일을 작게 줄여서(긴 쪽 800px, JPEG) 글자 형태로 바꿈 → 브라우저 저장 공간 절약
function shrinkImage(file, maxSize = 800) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(img.src);
      resolve(canvas.toDataURL("image/jpeg", 0.75));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

// 목록/추천에 쓸 대표 이미지: 설정에 따라 내 사진 또는 유튜브 썸네일
function thumbOf(r) {
  const photo = sortedLogs(r).find((l) => l.photo)?.photo;
  const vid = youtubeId(r.url);
  const yt = vid ? `https://i.ytimg.com/vi/${vid}/mqdefault.jpg` : null;
  return settings.thumb === "youtube" ? yt || photo : photo || yt;
}

const stars = (n) => "★".repeat(n) + "☆".repeat(5 - n);
const fmtDate = (d) => (d ? `${+d.slice(5, 7)}월 ${+d.slice(8, 10)}일` : "");
const sortedLogs = (r) => [...r.logs].sort((a, b) => b.date.localeCompare(a.date));
const lastCooked = (r) => sortedLogs(r)[0]?.date || "";

// ----- 3. 화면 그리기 -----
function render() {
  const backBtn = document.getElementById("backBtn");
  const addBtn = document.getElementById("addBtn");
  const title = document.getElementById("pageTitle");

  const recipe = recipes.find((r) => r.id === currentId);
  if (recipe) {
    backBtn.classList.remove("hidden");
    addBtn.classList.add("hidden");
    title.textContent = recipe.title;
    renderDetail(recipe);
  } else {
    currentId = null;
    backBtn.classList.add("hidden");
    addBtn.classList.remove("hidden");
    title.textContent = "요리 일기";
    renderList();
  }
}

// 목록 화면
function renderList() {
  if (recipes.length === 0) {
    app.innerHTML = `
      <div class="empty">
        <div class="big">🍳</div>
        <p>아직 기록한 요리가 없어요.<br>오른쪽 아래 <b>＋</b> 버튼으로 첫 요리를 추가해보세요.</p>
      </div>`;
    return;
  }

  const q = searchText.trim().toLowerCase();
  const todoCount = recipes.filter((r) => r.logs.length === 0).length;
  const filtered = recipes
    .filter((r) => !q || [r.title, r.tags].join(" ").toLowerCase().includes(q))
    .filter((r) => listFilter === "all" || (listFilter === "todo" ? r.logs.length === 0 : r.logs.length > 0))
    .sort((a, b) => (lastCooked(b) || b.createdAt).localeCompare(lastCooked(a) || a.createdAt));

  const chip = (key, label) => `<button class="chip ${listFilter === key ? "on" : ""}" data-filter="${key}">${label}</button>`;
  app.innerHTML = `
    <input class="search" id="search" type="text" placeholder="🔍 요리 이름, 태그로 검색" value="${esc(searchText)}">
    <div class="chips">
      ${chip("all", "전체")}
      ${chip("todo", `해먹고 싶은 ${todoCount ? `(${todoCount})` : ""}`)}
      ${chip("done", "만들어본")}
    </div>
    <div id="list">
      ${filtered.map(cardHtml).join("") || `<p class="empty">${listFilter === "todo" ? "해먹고 싶은 요리를 링크로 저장해두세요." : "검색 결과가 없어요."}</p>`}
    </div>`;

  app.querySelectorAll("[data-filter]").forEach((b) =>
    b.addEventListener("click", () => { listFilter = b.dataset.filter; renderList(); })
  );
  const search = document.getElementById("search");
  search.addEventListener("input", (e) => {
    searchText = e.target.value;
    renderList();
    const s = document.getElementById("search");
    s.focus();
    s.setSelectionRange(s.value.length, s.value.length);
  });
  app.querySelectorAll(".card").forEach((el) =>
    el.addEventListener("click", () => {
      currentId = el.dataset.id;
      render();
      window.scrollTo(0, 0);
    })
  );
}

function cardHtml(r) {
  const img = thumbOf(r);
  const src = SOURCES[sourceOf(r)];
  const thumb = img ? `<img class="thumb" src="${img}" alt="">` : `<div class="thumb">${src.icon}</div>`;
  const n = r.logs.length;
  const meta = n ? `${n}번 만듦 · ${fmtDate(lastCooked(r))}` : "아직 안 만듦";
  const tags = splitTags(r.tags).map((t) => `<span class="tag">${esc(t)}</span>`).join("");
  return `
    <div class="card" data-id="${r.id}">
      ${thumb}
      <div class="card-body">
        <p class="card-title">${esc(r.title)}</p>
        <div class="card-meta">${meta}</div>
        <div>${tags}</div>
      </div>
    </div>`;
}

const splitTags = (s) => (s || "").split(/[,#\s]+/).filter(Boolean);

// 상세 화면: 최근 기록이 주인공
function renderDetail(r) {
  const src = SOURCES[sourceOf(r)];
  const logs = sortedLogs(r);
  const [latest, ...older] = logs;

  const sourceLine = r.url
    ? `<a class="link" href="${esc(r.url)}" target="_blank" rel="noopener">${src.icon} 원본 보기 (${src.label})</a>`
    : `<span class="sub">${src.icon} ${src.label}</span>`;

  app.innerHTML = `
    <div class="info-line">
      ${sourceLine}
      ${r.servings ? `<span class="sub">· ${esc(r.servings)}인분</span>` : ""}
    </div>
    <div>${splitTags(r.tags).map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>

    ${serverOk && youtubeId(r.url)
      ? `<button class="btn ghost small" id="extractBtn" style="margin-top:12px">📋 영상 소개란·댓글에서 레시피 가져오기</button>`
      : ""}

    ${r.ingredients ? `<div class="section"><h2>재료</h2><div class="box log-text">${esc(r.ingredients)}</div></div>` : ""}

    ${r.steps ? `
    <details class="section">
      <summary class="sub">만드는 법</summary>
      <div class="box log-text">${esc(r.steps)}</div>
    </details>` : ""}

    <div class="section">
      ${latest
        ? `<h2>최근 기록 <span class="sub">${fmtDate(latest.date)}</span></h2>${logHtml(latest, true)}`
        : `<div class="box sub">아직 만들어본 기록이 없어요. 만들고 나서 어땠는지 남겨보세요.</div>`}
    </div>

    ${older.length ? `
    <details class="section">
      <summary class="sub">이전 기록 ${older.length}개</summary>
      ${older.map((l) => logHtml(l, false)).join("")}
    </details>` : ""}

    <button class="btn wide" id="addLog">＋ 오늘 만든 기록 남기기</button>

    <div class="section row">
      <button class="btn ghost small" id="editRecipe">레시피 수정</button>
      <button class="btn danger small" id="deleteRecipe">삭제</button>
    </div>`;

  document.getElementById("addLog").onclick = () => openLogForm(r);
  document.getElementById("editRecipe").onclick = () => openRecipeForm(r);
  document.getElementById("extractBtn")?.addEventListener("click", () => importFromVideo(r));
  document.getElementById("deleteRecipe").onclick = () => {
    if (confirm(`'${r.title}'와 기록을 모두 삭제할까요?`)) {
      recipes = recipes.filter((x) => x.id !== r.id);
      saveRecipes();
      currentId = null;
      render();
    }
  };
  app.querySelectorAll("[data-edit-log]").forEach((b) =>
    b.addEventListener("click", () => openLogForm(r, r.logs.find((l) => l.id === b.dataset.editLog)))
  );
}

function logHtml(l, big) {
  const part = (label, text) => (text ? `<div class="log-label">${label}</div><div class="log-text">${esc(text)}</div>` : "");
  return `
    <div class="box log ${big ? "latest" : "older"}">
      ${l.photo ? `<img class="log-photo ${big ? "" : "small"}" src="${l.photo}" alt="">` : ""}
      <div class="log-head">
        <span>${big ? "" : fmtDate(l.date) + " · "}<span class="stars">${stars(l.rating)}</span></span>
        <button class="btn ghost small" data-edit-log="${l.id}">수정</button>
      </div>
      ${part("바꾼 점", l.changes)}
      ${part("후기", l.review)}
    </div>`;
}

// ----- 4. 입력 창 -----
function openRecipeForm(existing, preset = {}) {
  const r = existing || preset;
  const sourceOptions = ["book", "family", "mine"]
    .map((k) => `<option value="${k}" ${r.source === k ? "selected" : ""}>${SOURCES[k].icon} ${SOURCES[k].label}</option>`)
    .join("");
  dialog.innerHTML = `
    <form method="dialog" id="form">
      <h3>${existing ? "레시피 수정" : "새 요리"}</h3>
      <label>링크 <span class="hint">유튜브·쇼츠·릴스·블로그 주소를 붙여넣으면 이름이 자동으로 채워져요</span></label>
      <input type="url" name="url" placeholder="https://youtu.be/..." value="${esc(r.url)}" ${existing ? "" : "autofocus"}>
      <label>요리 이름 * <span class="hint" id="titleHint"></span></label>
      <input type="text" name="title" required placeholder="백종원 김치찌개" value="${esc(r.title)}">
      <div id="sourceRow" class="${r.url ? "hidden" : ""}">
        <label>링크가 없다면 출처는?</label>
        <select name="source">${sourceOptions}</select>
      </div>
      <label>몇 인분</label>
      <input type="text" name="servings" inputmode="numeric" placeholder="2" value="${esc(r.servings)}">
      <label>재료 <span class="hint">한 줄에 하나씩</span></label>
      <textarea name="ingredients" placeholder="김치 1/4포기&#10;돼지고기 200g">${esc(r.ingredients)}</textarea>
      <label>만드는 법 <span class="hint">선택</span></label>
      <textarea name="steps" placeholder="1. 김치를 볶는다&#10;2. 물을 붓고 끓인다">${esc(r.steps)}</textarea>
      <label>태그 <span class="hint">쉼표로 구분</span></label>
      <input type="text" name="tags" placeholder="찌개, 한식, 자취" value="${esc(r.tags)}">
      <div class="dialog-actions">
        <button type="button" class="btn ghost" id="cancel">취소</button>
        <button type="submit" class="btn">저장</button>
      </div>
    </form>`;

  // 링크를 입력하면 출처 선택은 숨김 (주소로 자동 판단하니까)
  const urlInput = dialog.querySelector("[name=url]");
  const titleInput = dialog.querySelector("[name=title]");
  urlInput.oninput = () => document.getElementById("sourceRow").classList.toggle("hidden", !!urlInput.value.trim());

  // 링크를 넣으면 제목을 읽어와서 요리 이름을 채움 (이름이 비어 있을 때만)
  let lastFetched = "";
  const autoTitle = async () => {
    const url = urlInput.value.trim();
    if (!url || url === lastFetched || titleInput.value.trim()) return;
    lastFetched = url;
    const hint = document.getElementById("titleHint");
    hint.textContent = "제목 가져오는 중…";
    const title = await fetchTitle(url);
    if (title && !titleInput.value.trim()) { titleInput.value = title; hint.textContent = "자동 입력됨 · 고쳐도 돼요"; }
    else hint.textContent = title ? "" : "제목을 못 가져왔어요. 직접 적어주세요";
  };
  urlInput.addEventListener("change", autoTitle);
  urlInput.addEventListener("paste", () => setTimeout(autoTitle, 50));
  if (r.url && !r.title) autoTitle(); // 공유로 들어온 링크

  bindDialog((data) => {
    if (existing) {
      Object.assign(existing, data);
    } else {
      const created = { id: newId(), createdAt: today(), logs: [], ...data };
      recipes.push(created);
      currentId = created.id;
    }
  });
}

function openLogForm(recipe, existing) {
  const l = existing || { date: today(), rating: 0 };
  let rating = l.rating;
  let photo = l.photo || null;

  // 새 기록을 쓸 때는 지난번 기록을 위에 보여줌
  const prev = existing ? null : sortedLogs(recipe)[0];
  const prevHtml = prev
    ? `<div class="prev">
         <div class="log-label">지난번 (${fmtDate(prev.date)}) <span class="stars">${stars(prev.rating)}</span></div>
         ${prev.changes ? `<div>${esc(prev.changes)}</div>` : ""}
         ${prev.review ? `<div class="sub">${esc(prev.review)}</div>` : ""}
       </div>`
    : "";

  dialog.innerHTML = `
    <form method="dialog" id="form">
      <h3>${existing ? "기록 수정" : "기록 남기기"}</h3>
      ${prevHtml}
      <input type="hidden" name="date" value="${l.date}">
      <label>별점</label>
      <div class="star-pick">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-star="${n}">★</button>`).join("")}</div>
      <label>사진 <span class="hint">완성된 요리 한 장</span></label>
      <div id="photoBox" class="photo-box"></div>
      <input type="file" id="photoInput" accept="image/*" capture="environment" hidden>
      <label>재료 <span class="hint">이 요리의 재료. 고치면 레시피에 저장돼요</span></label>
      <textarea name="ingredients" placeholder="김치 1/4포기&#10;돼지고기 200g">${esc(recipe.ingredients)}</textarea>
      <label>바꾼 점 <span class="hint">레시피나 지난번과 다르게 한 것</span></label>
      <textarea name="changes" placeholder="설탕 반으로, 대파 대신 양파">${esc(l.changes)}</textarea>
      <label>후기 <span class="hint">맛, 다음에 참고할 것</span></label>
      <textarea name="review" placeholder="간이 딱 맞았음. 다음엔 고기 더">${esc(l.review)}</textarea>
      <div class="dialog-actions">
        ${existing ? `<button type="button" class="btn danger" id="deleteLog">삭제</button>` : ""}
        <button type="button" class="btn ghost" id="cancel">취소</button>
        <button type="submit" class="btn">저장</button>
      </div>
    </form>`;

  const starButtons = dialog.querySelectorAll("[data-star]");
  const paintStars = () => starButtons.forEach((b) => b.classList.toggle("on", +b.dataset.star <= rating));
  starButtons.forEach((b) => (b.onclick = () => { rating = +b.dataset.star; paintStars(); }));
  paintStars();

  // 사진: 고르면 줄여서 미리보기, 다시 누르면 교체, ✕로 삭제
  const photoBox = document.getElementById("photoBox");
  const photoInput = document.getElementById("photoInput");
  const paintPhoto = () => {
    photoBox.innerHTML = photo
      ? `<img src="${photo}" alt=""><button type="button" class="photo-remove" aria-label="사진 삭제">✕</button>`
      : `<button type="button" class="btn ghost" id="photoPick">📷 사진 추가</button>`;
    photoBox.querySelector("#photoPick")?.addEventListener("click", () => photoInput.click());
    photoBox.querySelector("img")?.addEventListener("click", () => photoInput.click());
    photoBox.querySelector(".photo-remove")?.addEventListener("click", () => { photo = null; paintPhoto(); });
  };
  photoInput.onchange = async () => {
    const file = photoInput.files[0];
    if (!file) return;
    try {
      photo = await shrinkImage(file);
      paintPhoto();
    } catch {
      alert("사진을 불러오지 못했어요.");
    }
    photoInput.value = "";
  };
  paintPhoto();

  if (existing) {
    document.getElementById("deleteLog").onclick = () => {
      if (confirm("이 기록을 삭제할까요?")) {
        recipe.logs = recipe.logs.filter((x) => x.id !== existing.id);
        saveRecipes();
        dialog.close();
        render();
      }
    };
  }

  bindDialog((data) => {
    recipe.ingredients = data.ingredients; // 재료는 레시피에 저장
    delete data.ingredients;
    data.rating = rating;
    data.photo = photo;
    if (existing) Object.assign(existing, data);
    else recipe.logs.push({ id: newId(), ...data });
  });
}

// 입력 창 공통: 저장/취소 연결
function bindDialog(onSave) {
  const form = document.getElementById("form");
  document.getElementById("cancel").onclick = () => dialog.close();
  form.onsubmit = () => {
    const data = Object.fromEntries(new FormData(form));
    for (const k in data) data[k] = data[k].trim();
    onSave(data);
    saveRecipes();
    render();
  };
  dialog.showModal();
}

// ----- 4-1. 영상 소개란·댓글에서 레시피 가져오기 (server.py가 유튜브를 읽어줌) -----
// (\b는 한글에서 안 통해서 (?![가-힣a-z])로 "재료"로 시작하는 문장과 구분)
const ING_HEADER = /^[\s\W]*(재료|준비\s*재료|준비물|필요한\s*재료|ingredients?)(?![가-힣a-z])/i;
const STEP_HEADER = /^[\s\W]*(만드는\s*법|만들기|조리\s*(법|순서|과정|방법)|요리\s*(순서|방법|과정)|레시피|순서|과정|recipe|directions?|instructions?|how to)/i;
const SECTION_END = /^(={3,}|-{3,}|_{3,}|#|http|▶|■|◆|★|※|\[|【|\*{2,})/;
const BULLET = /^[\s\-•·▪▫◦*✔✓☑▶►☆★]+/;

// 소개란/댓글 글에서 "재료"와 "만드는 법" 부분을 찾아 나눔. 못 찾으면 빈 값.
function parseRecipeText(text) {
  const lines = (text || "").replace(/\r/g, "").split("\n").map((l) => l.trim());
  const grab = (startIdx, stopAt) => {
    const out = [];
    for (let i = startIdx; i < lines.length; i++) {
      const l = lines[i];
      if (!l) { if (out.length) break; else continue; } // 항목 시작 후 첫 빈 줄에서 끝
      if (stopAt.test(l) || SECTION_END.test(l)) break;
      out.push(l.replace(BULLET, "").trim());
    }
    return out.filter(Boolean);
  };
  let ingredients = [], steps = [];
  const ingIdx = lines.findIndex((l) => ING_HEADER.test(l) && l.length <= 20);
  if (ingIdx >= 0) {
    const same = lines[ingIdx].replace(ING_HEADER, "").replace(/^[\s:：\]】)]+/, "").trim();
    ingredients = (same ? [same] : []).concat(grab(ingIdx + 1, STEP_HEADER));
    if (same && same.includes(",")) ingredients = same.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
  }
  const stepIdx = lines.findIndex((l, i) => i !== ingIdx && STEP_HEADER.test(l) && l.length <= 20);
  if (stepIdx >= 0) steps = grab(stepIdx + 1, ING_HEADER);
  if (!steps.length) { // 헤더가 없어도 "1. ..." 식으로 번호가 붙은 줄이 3개 이상이면 순서로 봄
    const numbered = lines.filter((l) => /^\d+[.)]\s*\S/.test(l));
    if (numbered.length >= 3) steps = numbered;
  }
  return { ingredients, steps };
}

async function importFromVideo(r) {
  dialog.innerHTML = `<h3>영상 읽는 중…</h3><p class="hint" style="font-size:14px">소개란과 댓글을 가져오고 있어요.</p>`;
  dialog.showModal();
  let data;
  try {
    const res = await fetch(`api/video?url=${encodeURIComponent(r.url)}`);
    data = await res.json();
    if (!res.ok) throw new Error(data.error || "실패");
  } catch (e) {
    dialog.innerHTML = `<h3>가져오지 못했어요</h3><p class="hint" style="font-size:14px">${esc(e.message)}</p>
      <div class="dialog-actions"><button class="btn ghost" id="cancel">닫기</button></div>`;
    document.getElementById("cancel").onclick = () => dialog.close();
    return;
  }

  // 후보: 소개란 + 댓글. 재료/순서가 찾아진 것을 앞으로
  const sources = [{ label: "소개란", text: data.description }]
    .concat(data.comments.map((c) => ({ label: `댓글 · ${c.author}${c.heart ? " ❤" : ""}`, text: c.text })))
    .map((s) => ({ ...s, parsed: parseRecipeText(s.text) }))
    .filter((s) => s.text?.trim());
  sources.sort((a, b) => score(b) - score(a));
  function score(s) { return (s.parsed.ingredients.length ? 2 : 0) + (s.parsed.steps.length ? 1 : 0); }
  if (!sources.length) {
    dialog.innerHTML = `<h3>소개란과 댓글이 비어 있어요</h3><div class="dialog-actions"><button class="btn ghost" id="cancel">닫기</button></div>`;
    document.getElementById("cancel").onclick = () => dialog.close();
    return;
  }

  let idx = 0;
  const paint = () => {
    const s = sources[idx];
    const found = score(s) > 0;
    dialog.innerHTML = `
      <form method="dialog" id="form">
        <h3>레시피 가져오기</h3>
        <div class="row" style="align-items:center;margin-bottom:8px">
          <select id="srcPick" style="flex:1">${sources.map((x, i) => `<option value="${i}" ${i === idx ? "selected" : ""}>${esc(x.label)}${score(x) ? " ✓" : ""}</option>`).join("")}</select>
        </div>
        ${found ? "" : `<p class="hint">여기서는 재료·순서를 자동으로 못 찾았어요. 아래 원문에서 직접 복사해 넣어도 돼요.</p>`}
        <label>재료 <span class="hint">확인하고 고칠 수 있어요</span></label>
        <textarea name="ingredients" style="min-height:120px">${esc(s.parsed.ingredients.join("\n"))}</textarea>
        <label>만드는 법</label>
        <textarea name="steps" style="min-height:120px">${esc(s.parsed.steps.join("\n"))}</textarea>
        <details style="margin-top:12px"><summary class="sub">원문 보기</summary><div class="box log-text" style="font-size:13px;max-height:200px;overflow:auto">${esc(s.text)}</div></details>
        <div class="dialog-actions">
          <button type="button" class="btn ghost" id="cancel">취소</button>
          <button type="submit" class="btn">저장</button>
        </div>
      </form>`;
    document.getElementById("srcPick").onchange = (e) => { idx = +e.target.value; paint(); };
    document.getElementById("cancel").onclick = () => dialog.close();
    document.getElementById("form").onsubmit = () => {
      const f = document.getElementById("form");
      if (f.ingredients.value.trim()) r.ingredients = f.ingredients.value.trim();
      if (f.steps.value.trim()) r.steps = f.steps.value.trim();
      saveRecipes();
      render();
    };
  };
  paint();
}

// ----- 5. 오늘 뭐 먹지? -----
// 내가 저장한 요리 중에서 하나 골라줌.
// 우선순위: 별점이 좋았고(평균 4점 이상) 최근 2주 안에 안 만든 요리 → 없으면 아무거나
let lastPick = null;

function pickRecipe() {
  const twoWeeksAgo = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
  const avg = (r) => (r.logs.length ? r.logs.reduce((s, l) => s + l.rating, 0) / r.logs.length : 0);
  const good = recipes.filter((r) => avg(r) >= 4 && lastCooked(r) < twoWeeksAgo);
  let pool = good.length ? good : recipes;
  if (pool.length > 1) pool = pool.filter((r) => r !== lastPick); // 연속으로 같은 게 안 나오게
  return pool[Math.floor(Math.random() * pool.length)];
}

function openPick() {
  if (recipes.length === 0) {
    alert("저장된 요리가 아직 없어요. 먼저 요리를 추가해보세요.");
    return;
  }
  const r = pickRecipe();
  lastPick = r;
  const latest = sortedLogs(r)[0];
  const src = SOURCES[sourceOf(r)];
  const img = thumbOf(r);
  dialog.innerHTML = `
    <h3>오늘은 이거 어때요?</h3>
    <div class="pick">
      ${img ? `<img class="pick-thumb" src="${img}" alt="">` : `<div class="pick-thumb">${src.icon}</div>`}
      <div class="pick-title">${esc(r.title)}</div>
      <div class="sub">${r.logs.length ? `${r.logs.length}번 만듦 · 마지막 ${fmtDate(latest.date)} <span class="stars">${stars(latest.rating)}</span>` : "아직 안 만들어본 요리"}</div>
      ${latest?.review ? `<div class="sub" style="margin-top:6px">"${esc(latest.review)}"</div>` : ""}
    </div>
    <div class="dialog-actions">
      <button type="button" class="btn ghost" id="cancel">닫기</button>
      <button type="button" class="btn ghost" id="again">다른 거</button>
      <button type="button" class="btn" id="go">이걸로!</button>
    </div>`;
  document.getElementById("cancel").onclick = () => dialog.close();
  document.getElementById("again").onclick = () => { dialog.close(); openPick(); };
  document.getElementById("go").onclick = () => {
    dialog.close();
    currentId = r.id;
    render();
    window.scrollTo(0, 0);
  };
  dialog.showModal();
}
document.getElementById("pickBtn").onclick = openPick;

// ----- 6. 백업 (내보내기 / 불러오기) -----
document.getElementById("menuBtn").onclick = () => {
  const used = Math.round((localStorage.getItem(STORAGE_KEY) || "").length / 1024);
  dialog.innerHTML = `
    <h3>설정</h3>
    <label>목록 썸네일</label>
    <div class="radio-row">
      <label><input type="radio" name="thumb" value="photo" ${settings.thumb === "photo" ? "checked" : ""}> 내 사진 우선</label>
      <label><input type="radio" name="thumb" value="youtube" ${settings.thumb === "youtube" ? "checked" : ""}> 유튜브 썸네일 우선</label>
    </div>
    <p class="hint">내 사진이 없으면 유튜브 썸네일을, 둘 다 없으면 출처 아이콘을 보여줘요.</p>

    <h3 style="margin-top:24px">백업</h3>
    <p class="hint" style="font-size:14px">데이터는 이 브라우저 안에만 저장돼요 (지금 약 ${used}KB, 최대 5,000KB 정도). 브라우저 기록을 지우면 사라질 수 있으니 가끔 백업 파일로 저장해두세요.</p>
    <div class="row" style="margin-top:12px">
      <button class="btn" id="exportBtn">백업 파일 저장</button>
      <button class="btn ghost" id="importBtn">백업 불러오기</button>
    </div>
    <div class="dialog-actions"><button class="btn ghost" id="cancel">닫기</button></div>`;
  dialog.querySelectorAll("[name=thumb]").forEach((el) =>
    el.addEventListener("change", () => { settings.thumb = el.value; saveSettings(); render(); })
  );
  document.getElementById("cancel").onclick = () => dialog.close();
  document.getElementById("exportBtn").onclick = () => {
    const blob = new Blob([JSON.stringify(recipes, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `요리일기백업_${today()}.json`;
    a.click();
  };
  document.getElementById("importBtn").onclick = () => document.getElementById("importFile").click();
  dialog.showModal();
};

document.getElementById("importFile").onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data)) throw new Error();
    if (confirm(`요리 ${data.length}개를 불러올까요? 지금 데이터는 대체됩니다.`)) {
      recipes = data;
      saveRecipes();
      dialog.close();
      currentId = null;
      render();
    }
  } catch {
    alert("올바른 백업 파일이 아니에요.");
  }
  e.target.value = "";
};

// ----- 7. 시작 -----
document.getElementById("addBtn").onclick = () => openRecipeForm();
document.getElementById("backBtn").onclick = () => { currentId = null; render(); };
render();

// 공유로 들어온 링크: 주소가 ?url=... 또는 ?text=... 로 열리면 바로 "새 요리" 창을 띄움
// (폰에서 유튜브 앱 "공유" → 요리 일기를 고르면 manifest.json의 share_target이 이 주소로 앱을 엶)
{
  const params = new URLSearchParams(location.search);
  const shared = [params.get("url"), params.get("text"), params.get("title")].filter(Boolean).join(" ");
  const link = shared.match(/https?:\/\/\S+/)?.[0];
  if (link) {
    history.replaceState(null, "", location.pathname); // 새로고침해도 창이 다시 안 뜨게
    fetch("api/status").then((r) => r.json()).then((s) => { serverOk = !!s.video; }).catch(() => {}).finally(() => openRecipeForm(null, { url: link }));
  }
}

// 홈 화면에 설치한 앱이 인터넷 없이도 열리게 (sw.js 등록)
if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
