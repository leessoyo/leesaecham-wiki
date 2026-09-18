const form = document.getElementById("page-find");
const input = document.getElementById("site-search");
const countEl = document.getElementById("search-count");
const prevBtn = document.getElementById("search-prev");
const content = document.getElementById("page-content");

let lastQuery = "";
let currentIndex = -1;

function getHits() {
  return Array.from(content.querySelectorAll("mark.search-hit"));
}

function unwrapMarks() {
  getHits().forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    parent.replaceChild(document.createTextNode(mark.textContent), mark);
    parent.normalize();
  });
}

function updateCount() {
  const hits = getHits();
  if (!input.value.trim() || hits.length === 0) {
    countEl.textContent = lastQuery ? "0/0" : "";
    return;
  }
  countEl.textContent = `${currentIndex + 1}/${hits.length}`;
}

function setCurrent(index) {
  const hits = getHits();
  hits.forEach((hit) => hit.classList.remove("search-hit-current"));
  if (hits.length === 0) {
    currentIndex = -1;
    updateCount();
    return;
  }

  currentIndex = ((index % hits.length) + hits.length) % hits.length;
  const hit = hits[currentIndex];
  hit.classList.add("search-hit-current");
  hit.scrollIntoView({ block: "center", behavior: "smooth" });
  updateCount();
}

function highlight(query) {
  unwrapMarks();
  lastQuery = query;

  if (!query) {
    currentIndex = -1;
    updateCount();
    return;
  }

  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(escaped, "gi");
  const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
  const nodes = [];

  while (walker.nextNode()) {
    nodes.push(walker.currentNode);
  }

  nodes.forEach((textNode) => {
    const text = textNode.nodeValue;
    if (!text || !regex.test(text)) return;
    regex.lastIndex = 0;

    const frag = document.createDocumentFragment();
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(text)) !== null) {
      if (match[0].length === 0) break;
      if (match.index > lastIndex) {
        frag.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
      }

      const mark = document.createElement("mark");
      mark.className = "search-hit";
      mark.textContent = match[0];
      frag.appendChild(mark);

      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < text.length) {
      frag.appendChild(document.createTextNode(text.slice(lastIndex)));
    }

    textNode.parentNode.replaceChild(frag, textNode);
  });
}

function findInPage(direction) {
  const query = input.value.trim();
  if (!query) {
    highlight("");
    return;
  }

  if (query !== lastQuery || getHits().length === 0) {
    highlight(query);
    setCurrent(0);
    return;
  }

  setCurrent(currentIndex + direction);
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  findInPage(1);
});

prevBtn.addEventListener("click", () => {
  findInPage(-1);
});

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && event.shiftKey) {
    event.preventDefault();
    findInPage(-1);
  }

  if (event.key === "Escape") {
    if (lightbox && !lightbox.hidden) return;
    highlight("");
    input.blur();
  }
});

const lightbox = document.getElementById("lightbox");
const lightboxImage = document.getElementById("lightbox-image");
const lightboxClose = document.querySelector(".lightbox-close");
const paintCanvas = document.getElementById("paint-canvas");
const paintCtx = paintCanvas.getContext("2d");
const paintToolbar = document.getElementById("paint-toolbar");
const paintSizeInput = document.getElementById("paint-size");
const paintColorInput = document.getElementById("paint-color");
const paintSave = document.getElementById("paint-save");

let paintTool = "pen";
let paintDrawing = false;
let paintLast = null;
let paintHistory = [];
let paintIndex = -1;
let paintDotCarry = 0;

function fitPaintCanvas(preserve) {
  const width = lightboxImage.clientWidth;
  const height = lightboxImage.clientHeight;
  if (!width || !height) return;

  const backup = preserve && paintCanvas.width && paintCanvas.height
    ? paintCtx.getImageData(0, 0, paintCanvas.width, paintCanvas.height)
    : null;

  paintCanvas.width = width;
  paintCanvas.height = height;
  paintCanvas.style.width = `${width}px`;
  paintCanvas.style.height = `${height}px`;

  if (backup) {
    const temp = document.createElement("canvas");
    temp.width = backup.width;
    temp.height = backup.height;
    temp.getContext("2d").putImageData(backup, 0, 0);
    paintCtx.drawImage(temp, 0, 0, width, height);
  }
}

function updateSaveButton() {
  paintSave.hidden = paintIndex <= 0;
}

function snapshotPaint() {
  if (!paintCanvas.width || !paintCanvas.height) return;
  paintHistory = paintHistory.slice(0, paintIndex + 1);
  paintHistory.push(paintCtx.getImageData(0, 0, paintCanvas.width, paintCanvas.height));
  paintIndex = paintHistory.length - 1;
  updateSaveButton();
}

function restorePaint(index) {
  const data = paintHistory[index];
  if (!data) return;
  paintCtx.putImageData(data, 0, 0);
}

function resetPaintHistory() {
  paintHistory = [];
  paintIndex = -1;
  snapshotPaint();
}

function undoPaint() {
  if (paintIndex <= 0) return;
  paintIndex -= 1;
  restorePaint(paintIndex);
  updateSaveButton();
}

function redoPaint() {
  if (paintIndex >= paintHistory.length - 1) return;
  paintIndex += 1;
  restorePaint(paintIndex);
  updateSaveButton();
}

function clearPaintCanvas() {
  paintCtx.clearRect(0, 0, paintCanvas.width, paintCanvas.height);
}

function canvasPoint(event) {
  const rect = paintCanvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function setPaintStyle() {
  const size = Number(paintSizeInput.value) || 10;
  const isGlow = paintTool === "marker" || paintTool === "deco";
  paintCtx.lineCap = "round";
  paintCtx.lineJoin = "round";
  paintCtx.setLineDash([]);
  paintCtx.globalCompositeOperation = paintTool === "eraser" ? "destination-out" : "source-over";
  paintCtx.globalAlpha = isGlow ? 0.28 : 1;
  paintCtx.strokeStyle = paintColorInput.value;
  paintCtx.fillStyle = paintColorInput.value;
  paintCtx.lineWidth = isGlow ? size * 2.2 : size;
}

function walkStroke(from, to, spacing, onPoint) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  if (dist === 0) {
    onPoint(from.x, from.y);
    return;
  }

  let pos = spacing - paintDotCarry;
  const total = paintDotCarry + dist;
  while (pos <= total) {
    const t = (pos - paintDotCarry) / dist;
    onPoint(from.x + dx * t, from.y + dy * t);
    pos += spacing;
  }
  paintDotCarry = total % spacing;
}

function dotsAlong(from, to) {
  const size = Number(paintSizeInput.value) || 10;
  paintCtx.globalCompositeOperation = "source-over";
  paintCtx.globalAlpha = 1;
  paintCtx.fillStyle = paintColorInput.value;
  walkStroke(from, to, Math.max(6, size * 1.7), (x, y) => {
    paintCtx.beginPath();
    paintCtx.arc(x, y, size / 2, 0, Math.PI * 2);
    paintCtx.fill();
  });
}

function decoAlong(from, to) {
  setPaintStyle();
  paintCtx.beginPath();
  paintCtx.moveTo(from.x, from.y);
  paintCtx.lineTo(to.x, to.y);
  paintCtx.stroke();

  const size = Number(paintSizeInput.value) || 10;
  const sparkles = ["#ffffff", "#ffe56a", "#ff9ad5", "#7bff00"];
  paintCtx.globalAlpha = 0.95;
  walkStroke(from, to, Math.max(8, size * 1.3), (x, y) => {
    paintCtx.fillStyle = sparkles[Math.floor(Math.random() * sparkles.length)];
    paintCtx.beginPath();
    paintCtx.arc(
      x + (Math.random() - 0.5) * size,
      y + (Math.random() - 0.5) * size,
      Math.max(1.2, size / 6),
      0,
      Math.PI * 2
    );
    paintCtx.fill();
  });
}

function sprayAt(point) {
  const size = Number(paintSizeInput.value) || 10;
  const radius = size * 1.6;
  const count = Math.max(8, Math.round(size * 1.4));
  paintCtx.globalCompositeOperation = "source-over";
  paintCtx.globalAlpha = 0.35;
  paintCtx.fillStyle = paintColorInput.value;
  for (let i = 0; i < count; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const dist = Math.random() * radius;
    paintCtx.beginPath();
    paintCtx.arc(
      point.x + Math.cos(angle) * dist,
      point.y + Math.sin(angle) * dist,
      Math.max(1, size / 8),
      0,
      Math.PI * 2
    );
    paintCtx.fill();
  }
}

function drawPaint(point) {
  if (paintTool === "spray") {
    sprayAt(point);
    paintLast = point;
    return;
  }

  if (paintTool === "dots") {
    dotsAlong(paintLast, point);
    paintLast = point;
    return;
  }

  if (paintTool === "deco") {
    decoAlong(paintLast, point);
    paintLast = point;
    return;
  }

  setPaintStyle();
  paintCtx.beginPath();
  paintCtx.moveTo(paintLast.x, paintLast.y);
  paintCtx.lineTo(point.x, point.y);
  paintCtx.stroke();
  paintLast = point;
}

let lightboxIndex = 0;

function galleryImages() {
  return Array.from(document.querySelectorAll(".center-image, .mail-photo"));
}

function loadLightboxImage(img) {
  lightboxImage.src = img.currentSrc || img.src;
  lightboxImage.alt = img.alt || "확대 이미지";
  paintSave.hidden = true;
  const ready = () => {
    fitPaintCanvas(false);
    resetPaintHistory();
  };
  if (lightboxImage.complete && lightboxImage.naturalWidth) {
    ready();
  } else {
    lightboxImage.addEventListener("load", ready, { once: true });
  }
}

function openLightbox(img) {
  const images = galleryImages();
  lightboxIndex = Math.max(0, images.indexOf(img));
  document.body.classList.add("lightbox-open");
  window.setTimeout(() => {
    lightbox.hidden = false;
    loadLightboxImage(images[lightboxIndex] || img);
  }, 0);
}

function stepLightbox(direction) {
  const images = galleryImages();
  if (images.length === 0) return;
  lightboxIndex = (lightboxIndex + direction + images.length) % images.length;
  loadLightboxImage(images[lightboxIndex]);
}

function closeLightbox() {
  lightbox.hidden = true;
  lightboxImage.removeAttribute("src");
  clearPaintCanvas();
  paintHistory = [];
  paintIndex = -1;
  paintSave.hidden = true;
  document.body.classList.remove("lightbox-open");
}

document.querySelectorAll(".center-image, .mail-photo").forEach((img) => {
  img.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openLightbox(img);
  });
});

lightbox.addEventListener("click", (event) => {
  if (event.target === event.currentTarget) {
    closeLightbox();
  }
});

lightboxClose.addEventListener("click", closeLightbox);

document.getElementById("lightbox-prev").addEventListener("click", (event) => {
  event.stopPropagation();
  stepLightbox(-1);
});

document.getElementById("lightbox-next").addEventListener("click", (event) => {
  event.stopPropagation();
  stepLightbox(1);
});

paintToolbar.addEventListener("click", (event) => {
  event.stopPropagation();

  const swatch = event.target.closest(".paint-swatch");
  if (swatch) {
    paintColorInput.value = swatch.dataset.color;
  }
});

document.getElementById("paint-tools").addEventListener("click", (event) => {
  event.stopPropagation();
  const toolButton = event.target.closest("[data-tool]");
  if (!toolButton) return;
  paintTool = toolButton.dataset.tool;
  document.querySelectorAll(".paint-tool").forEach((button) => {
    button.classList.toggle("is-active", button === toolButton);
  });
});

document.getElementById("paint-undo").addEventListener("click", (event) => {
  event.stopPropagation();
  undoPaint();
});

document.getElementById("paint-redo").addEventListener("click", (event) => {
  event.stopPropagation();
  redoPaint();
});

document.getElementById("paint-clear").addEventListener("click", (event) => {
  event.stopPropagation();
  clearPaintCanvas();
  snapshotPaint();
});

function savePaintedImage() {
  const width = lightboxImage.naturalWidth || paintCanvas.width;
  const height = lightboxImage.naturalHeight || paintCanvas.height;
  if (!width || !height) return;

  const output = document.createElement("canvas");
  output.width = width;
  output.height = height;
  const ctx = output.getContext("2d");
  ctx.drawImage(lightboxImage, 0, 0, width, height);
  ctx.drawImage(paintCanvas, 0, 0, width, height);

  const link = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  link.download = `saecham-${stamp}.png`;
  link.href = output.toDataURL("image/png");
  link.click();
}

paintSave.addEventListener("click", (event) => {
  event.stopPropagation();
  savePaintedImage();
});

paintCanvas.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  paintCanvas.setPointerCapture(event.pointerId);
  paintDrawing = true;
  paintLast = canvasPoint(event);
  paintDotCarry = 0;
  if (paintTool === "spray") {
    sprayAt(paintLast);
  } else if (paintTool === "dots") {
    dotsAlong(paintLast, paintLast);
  } else if (paintTool === "deco") {
    decoAlong(paintLast, paintLast);
  } else {
    setPaintStyle();
    paintCtx.beginPath();
    paintCtx.arc(paintLast.x, paintLast.y, paintCtx.lineWidth / 2, 0, Math.PI * 2);
    paintCtx.fill();
  }
});

paintCanvas.addEventListener("pointermove", (event) => {
  if (!paintDrawing) return;
  drawPaint(canvasPoint(event));
});

function stopPaint() {
  const wasDrawing = paintDrawing;
  paintDrawing = false;
  paintLast = null;
  paintDotCarry = 0;
  paintCtx.globalAlpha = 1;
  paintCtx.globalCompositeOperation = "source-over";
  if (wasDrawing) {
    snapshotPaint();
  }
}

paintCanvas.addEventListener("pointerup", stopPaint);
paintCanvas.addEventListener("pointercancel", stopPaint);
paintCanvas.addEventListener("pointerleave", () => {
  if (paintDrawing) stopPaint();
});

document.addEventListener("keydown", (event) => {
  if (lightbox.hidden) return;
  if (event.key === "Escape") {
    closeLightbox();
  }
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    stepLightbox(-1);
  }
  if (event.key === "ArrowRight") {
    event.preventDefault();
    stepLightbox(1);
  }
});

function matchTextBoxToImages() {
  const stack = document.querySelector(".image-stack");
  const notes = document.querySelector(".note-stack");
  const box = document.getElementById("page-content");
  if (!stack || !box) return;
  const target = Math.max(stack.offsetHeight, notes ? notes.offsetHeight : 0);
  box.style.height = `${target}px`;
}

function whenImagesReady(callback) {
  const images = Array.from(document.querySelectorAll(".center-image, .mail-photo"));
  if (images.length === 0) {
    callback();
    return;
  }

  let remaining = images.length;
  const done = () => {
    remaining -= 1;
    if (remaining <= 0) callback();
  };

  images.forEach((img) => {
    if (img.complete) {
      done();
      return;
    }
    img.addEventListener("load", done, { once: true });
    img.addEventListener("error", done, { once: true });
  });
}

whenImagesReady(matchTextBoxToImages);
window.addEventListener("load", matchTextBoxToImages);
window.addEventListener("resize", matchTextBoxToImages);

const cursorDot = document.getElementById("cursor-dot");
const lensScene = document.getElementById("cursor-lens-scene");
const lensZoom = 2.2;

function getLensSize() {
  if (cursorDot.classList.contains("is-clickable") || (lightbox && !lightbox.hidden)) {
    return 18;
  }

  const base = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue("--lens-size")
  ) || 132;

  return lightbox && !lightbox.hidden ? base * 2 : base;
}

function buildLensScene() {
  const header = document.querySelector(".page-header");
  const main = document.querySelector(".page-main");
  lensScene.replaceChildren();

  if (header) {
    lensScene.appendChild(header.cloneNode(true));
  }
  if (main) {
    lensScene.appendChild(main.cloneNode(true));
  }

  lensScene.style.width = `${document.documentElement.clientWidth}px`;
}

function clearImageZoom() {
  cursorDot.classList.remove("is-image-zoom");
  cursorDot.style.backgroundImage = "";
  cursorDot.style.backgroundSize = "";
  cursorDot.style.backgroundPosition = "";
}

function zoomImageInLens(img, x, y, size) {
  const rect = img.getBoundingClientRect();
  const src = img.currentSrc || img.src;
  if (!src || rect.width === 0 || rect.height === 0) {
    return false;
  }

  const relX = Math.min(1, Math.max(0, (x - rect.left) / rect.width));
  const relY = Math.min(1, Math.max(0, (y - rect.top) / rect.height));
  const zoomW = rect.width * lensZoom;
  const zoomH = rect.height * lensZoom;

  cursorDot.classList.add("is-image-zoom");
  cursorDot.style.backgroundImage = `url("${src}")`;
  cursorDot.style.backgroundSize = `${zoomW}px ${zoomH}px`;
  cursorDot.style.backgroundPosition = `${size / 2 - relX * zoomW}px ${size / 2 - relY * zoomH}px`;
  return true;
}

function isOverElement(el, x, y) {
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function updateLens(x, y) {
  cursorDot.style.left = `${x}px`;
  cursorDot.style.top = `${y}px`;

  if (lightbox && !lightbox.hidden) {
    clearImageZoom();
    return;
  }

  const size = getLensSize();

  const hoverEl = document.elementFromPoint(x, y);
  const galleryImage = hoverEl && hoverEl.closest ? hoverEl.closest(".center-image") : null;
  if (galleryImage && zoomImageInLens(galleryImage, x, y, size)) {
    return;
  }

  clearImageZoom();
  const pageX = x + window.scrollX;
  const pageY = y + window.scrollY;
  lensScene.style.transform = `translate(${size / 2 - pageX * lensZoom}px, ${size / 2 - pageY * lensZoom}px) scale(${lensZoom})`;
}

function isClickableTarget(el) {
  if (!el || el === document.body || el === document.documentElement) {
    return false;
  }

  if (el.closest(".center-image, .lightbox-image, .cursor-dot")) {
    return false;
  }

  return Boolean(
    el.closest("a, button, input, textarea, select, label, summary, [role='button'], [href], .quiz-box, .paint-toolbar, .paint-canvas")
  );
}

document.addEventListener("mousemove", (event) => {
  const target = document.elementFromPoint(event.clientX, event.clientY);
  const inLightbox = lightbox && !lightbox.hidden;
  cursorDot.classList.toggle("is-clickable", inLightbox || isClickableTarget(target));
  updateLens(event.clientX, event.clientY);
});

document.addEventListener("scroll", () => {
  const left = Number.parseFloat(cursorDot.style.left) || 0;
  const top = Number.parseFloat(cursorDot.style.top) || 0;
  updateLens(left, top);
}, { passive: true });

document.addEventListener("mouseleave", () => {
  cursorDot.style.opacity = "0";
});

document.addEventListener("mouseenter", () => {
  cursorDot.style.opacity = "1";
});

buildLensScene();
window.addEventListener("resize", () => {
  buildLensScene();
  matchTextBoxToImages();
  if (!lightbox.hidden) {
    fitPaintCanvas(true);
  }
});
whenImagesReady(buildLensScene);

function resizeMailMessage(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = `${Math.max(72, textarea.scrollHeight)}px`;
}

document.querySelectorAll(".mail-form").forEach((mailForm) => {
  const mailMessage = mailForm.querySelector(".mail-message");
  const status = mailForm.querySelector(".mail-status");
  const isQuiz = mailForm.classList.contains("quiz-form");

  if (mailMessage) {
    mailMessage.addEventListener("input", () => resizeMailMessage(mailMessage));
    resizeMailMessage(mailMessage);
  }

  mailForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (isQuiz) {
      const groups = [...new Set(
        [...mailForm.querySelectorAll("input[type='radio']")].map((input) => input.name)
      )];
      const allCorrect = groups.every((name) => {
        const checked = mailForm.querySelector(
          `input[type='radio'][name="${CSS.escape(name)}"]:checked`
        );
        return checked && checked.hasAttribute("data-correct");
      });

      status.textContent = allCorrect
        ? "정답이에요! 새참이를 잘 알고 있군요."
        : "오답이에요. 위키를 다시 읽고 도전해 주세요.";
      return;
    }

    const to = (mailForm.dataset.formsubmit || mailForm.dataset.gmail || "").trim();
    const data = new FormData(mailForm);
    const name = data.get("name").toString().trim();
    const reply = data.get("reply").toString().trim();
    const message = data.get("message").toString().trim();
    const sendButton = mailForm.querySelector(".mail-send");

    if (!to || to.includes("YOUR_GMAIL")) {
      status.textContent = "받는 사람 메일을 HTML의 data-gmail에 넣어 주세요.";
      return;
    }

    status.textContent = "보내는 중...";
    sendButton.disabled = true;

    try {
      const response = await fetch(`https://formsubmit.co/ajax/${encodeURIComponent(to)}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          name,
          email: reply,
          _replyto: reply,
          message,
          _subject: `[새참이 위키] ${name}님의 메시지`,
          _captcha: "false",
          _template: "box",
        }),
      });

      const result = await response.json().catch(() => ({}));
      const ok = response.ok && result.success !== false && result.success !== "false";

      if (!ok) {
        status.textContent = result.message || "전송에 실패했어요. 잠시 후 다시 시도해 주세요.";
        return;
      }

      mailForm.reset();
      if (mailMessage) {
        resizeMailMessage(mailMessage);
      }
      status.textContent = /activat|confirm|one step/i.test(String(result.message || ""))
        ? "활성화 메일이 갔을 수 있어요. 받은편지함에서 Activate Form을 누른 뒤, 여기서 한 번 더 보내 주세요."
        : "메시지를 보냈어요. 곧 회신드리겠습니다.";
    } catch (error) {
      status.textContent = "전송에 실패했어요. 잠시 후 다시 시도해 주세요.";
    } finally {
      sendButton.disabled = false;
    }
  });
});
