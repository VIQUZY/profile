/*
  Движок лонгрида. Без библиотек.

  Что он делает:
  1. Считает масштаб: макет нарисован в ширину 1200, страница растягивается
     на всю ширину окна. Один «пиксель макета» = var(--u).
  2. data-scroll — анимация, привязанная к прокрутке.
       offset   — на каком расстоянии от верха окна (в px макета) должен
                  оказаться верх слоя, чтобы анимация началась;
       trigger  — 0.5 или 1, если отсчитывать от центра / низа окна;
       steps    — шаги по очереди. У шага:
                    dist    сколько px прокрутки он длится
                    pin     true — слой на это время «прилипает» к экрану
                    hold    пауза перед шагом (px прокрутки)
                    x, y    сдвиг, scale — масштаб, rotate — поворот,
                    opacity — прозрачность. Это состояние, в которое слой
                    приходит к концу шага; что не указано — «как было в макете».
                  Первый шаг с dist 0 задаёт исходный вид слоя — он держится,
                  пока анимация не началась.
  3. data-play — зацикленное движение (сама анимация описана в CSS).
       "block" — стартует, когда до верха окна доезжает сцена,
       "self"  — когда доезжает сам слой; data-play-offset — отступ.
  4. data-in — разовое появление, когда слой показывается на экране.
*/
(() => {
  const DESIGN_WIDTH = 1200;
  const root = document.documentElement;
  const scenes = [...document.querySelectorAll('.scene')];
  const sceneTop = new Map();

  let unit = 1; // настоящих px в одном px макета
  let viewH = 0;

  const layerY = (el) =>
    (parseFloat(el.style.getPropertyValue('--y')) || 0) +
    (parseFloat(el.style.getPropertyValue('--dy')) || 0);

  /* ---------- Мобильная версия ----------
     Макет на телефоне сжимается целиком, и текст стал бы мелким. Поэтому
     на узких экранах тексты с обводкой увеличиваются так, чтобы кегль был
     около MOBILE_TEXT_PX настоящих пикселей. Если увеличенные тексты
     наезжают друг на друга, нижний сдвигается вниз, а сцена при нужде
     удлиняется. На компьютере ничего не меняется. */
  const MOBILE_TEXT_PX = 15;
  const CAPTION_GAP = 30; // зазор между текстами, px макета

  function fitCaptions() {
    const scale = Math.min(2.2, Math.max(1, MOBILE_TEXT_PX / (24 * unit)));
    root.style.setProperty('--cap-scale', scale.toFixed(3));
    for (const scene of scenes) {
      scene.style.removeProperty('--dh');
      const items = [...scene.querySelectorAll('.caption')].map((caption) => {
        const el = caption.closest('.el');
        el.style.removeProperty('--dy');
        return { el, y: parseFloat(el.style.getPropertyValue('--y')) || 0, h: caption.offsetHeight / unit * scale };
      });
      if (scale === 1 || !items.length) continue;
      items.sort((a, b) => a.y - b.y);
      let bottom = -Infinity;
      for (const item of items) {
        const shift = Math.max(0, bottom + CAPTION_GAP - item.y);
        if (shift) item.el.style.setProperty('--dy', shift.toFixed(1));
        bottom = item.y + shift + item.h;
      }
      const height = parseFloat(scene.style.getPropertyValue('--h')) || 0;
      if (bottom + 40 > height) scene.style.setProperty('--dh', (bottom + 40 - height).toFixed(1));
    }
  }

  /* ---------- Анимации по скроллу ---------- */

  // Разворачиваем шаги: пауза (hold) становится отдельным шагом,
  // сдвиг и поворот пересчитываются в «на сколько изменилось за шаг».
  function prepareSteps(steps) {
    const list = [];
    let prev = { x: 0, y: 0, scale: 1, rotate: 0, opacity: 1, pin: false };
    for (const raw of steps) {
      const step = {
        dist: raw.dist || 0,
        pin: !!raw.pin,
        x: raw.x || 0,
        y: raw.y || 0,
        scale: raw.scale ?? 1,
        rotate: raw.rotate || 0,
        opacity: raw.opacity ?? 1,
      };
      if (raw.hold) list.push({ ...prev, dist: raw.hold });
      list.push(step);
      prev = step;
    }
    let before = { x: 0, y: 0, rotate: 0 };
    for (const step of list) {
      step.dx = step.x - before.x;
      step.dy = step.y - before.y;
      step.dr = step.rotate - before.rotate;
      before = step;
    }
    return list;
  }

  const scrollLayers = [...document.querySelectorAll('[data-scroll]')].map((el) => {
    const config = JSON.parse(el.dataset.scroll);
    return {
      el,
      fx: el.querySelector('.fx'),
      scene: el.closest('.scene'),
      offset: config.offset || 0,
      trigger: config.trigger || 0,
      steps: prepareSteps(config.steps),
      last: '',
    };
  });

  const playLayers = [...document.querySelectorAll('[data-play]')].map((el) => ({
    el,
    fx: el.querySelector('.fx'),
    scene: el.closest('.scene'),
    byBlock: el.dataset.play === 'block',
    offset: parseFloat(el.dataset.playOffset) || 0,
    trigger: parseFloat(el.dataset.playTrigger) || 0,
    started: false,
  }));

  // Линия срабатывания: расстояние от верха окна в настоящих px
  function triggerLine(offsetPx, trigger, top) {
    let line = offsetPx;
    if (trigger) {
      line += viewH * trigger;
      if (line > top && line <= viewH * trigger) line = top;
    }
    return line;
  }

  function measure() {
    unit = root.clientWidth / DESIGN_WIDTH;
    viewH = window.innerHeight;
    root.style.setProperty('--u', unit + 'px');
    fitCaptions();

    for (const scene of scenes) {
      sceneTop.set(scene, scene.getBoundingClientRect().top + window.scrollY);
    }

    for (const layer of scrollLayers) {
      const top = sceneTop.get(layer.scene) + layerY(layer.el) * unit;
      layer.line = triggerLine(layer.offset * unit, layer.trigger, top);
      let position = top;
      let unpinned = 0;
      for (const step of layer.steps) {
        step.length = step.dist * unit;
        step.start = position;
        step.end = position + step.length;
        step.unpinnedBefore = unpinned;
        position = step.end;
        if (!step.pin) unpinned += step.length;
      }
      layer.last = '';
    }

    for (const layer of playLayers) {
      layer.top = layer.byBlock
        ? sceneTop.get(layer.scene)
        : sceneTop.get(layer.scene) + layerY(layer.el) * unit;
      layer.line = triggerLine(layer.offset * Math.min(1, unit), layer.trigger, layer.top);
    }
  }

  // Сглаживание: движение, масштаб и прозрачность не прыгают вслед за
  // колесом мыши, а плавно догоняют прокрутку — у всех слоёв с одной
  // и той же скоростью. SMOOTHING — время «догона» в секундах, 0 выключает.
  const SMOOTHING = 0.16;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let easedTop = null; // сглаженная позиция прокрутки
  let lastFrame = 0;
  let settled = true;

  function update(now = performance.now()) {
    const scrollTop = Math.max(0, window.scrollY);

    if (easedTop === null || !SMOOTHING || reducedMotion.matches) {
      easedTop = scrollTop;
    } else {
      const dt = settled ? 1 / 60 : Math.min(0.05, (now - lastFrame) / 1000);
      easedTop += (scrollTop - easedTop) * (1 - Math.exp(-dt / SMOOTHING));
      if (Math.abs(scrollTop - easedTop) < 0.3) easedTop = scrollTop;
    }
    lastFrame = now;
    settled = easedTop === scrollTop;

    for (const layer of scrollLayers) {
      const at = scrollTop + layer.line; // настоящая прокрутка: закрепление слоя
      const eased = easedTop + layer.line; // сглаженная: всё, что анимируется
      let x = 0, y = 0, scale = 1, rotate = 0, opacity = 1;
      let shift = 0; // на сколько слой «отстал», пока был закреплён
      let pinned = null;

      for (const [index, step] of layer.steps.entries()) {
        // Нулевой первый шаг — это исходный вид слоя: он действует и до
        // начала анимации (например, текст или картинка сначала скрыты).
        const initial = index === 0 && step.length === 0;
        if (at < step.start && eased < step.start && !initial) break;

        if (step.pin && at >= step.start) {
          if (at >= step.end) {
            shift += step.dist;
          } else {
            pinned = step;
            shift = 0;
          }
        }

        if (eased < step.start && !initial) continue;
        const progress = initial || eased >= step.end ? 1 : (eased - step.start) / step.length;
        x += progress * step.dx;
        y += progress * step.dy;
        rotate += progress * step.dr;
        scale += progress * (step.scale - scale);
        opacity += progress * (step.opacity - opacity);
      }

      const transform =
        `translate(${(x * unit).toFixed(2)}px, ${((y + shift) * unit).toFixed(2)}px) ` +
        `scale(${+scale.toFixed(4)}) rotate(${+rotate.toFixed(3)}deg)`;
      const top = pinned ? (layer.line - pinned.unpinnedBefore).toFixed(2) + 'px' : '';
      const state = transform + '|' + opacity.toFixed(3) + '|' + top;
      if (state === layer.last) continue;
      layer.last = state;

      const style = layer.fx.style;
      style.transform = transform;
      style.opacity = +opacity.toFixed(3);
      style.position = pinned ? 'fixed' : '';
      style.top = top;
    }

    for (const layer of playLayers) {
      if (layer.started || scrollTop + layer.line < layer.top) continue;
      layer.started = true;
      layer.fx.classList.add('playing');
    }

    if (!settled) requestUpdate(); // продолжаем, пока анимация догоняет
  }

  let queued = false;
  function requestUpdate() {
    if (queued) return;
    queued = true;
    requestAnimationFrame((now) => {
      queued = false;
      update(now);
    });
  }

  function refresh() {
    measure();
    easedTop = null; // после изменения размеров — без догона
    update();
  }

  /* ---------- Сцены рядом с экраном: грузим картинки, крутим циклы ---------- */
  const nearObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        entry.target.classList.toggle('near', entry.isIntersecting);
        if (!entry.isIntersecting) continue;
        for (const img of entry.target.querySelectorAll('img[loading="lazy"]')) {
          img.loading = 'eager';
        }
      }
    },
    { rootMargin: '150% 0px' }
  );
  scenes.forEach((scene) => nearObserver.observe(scene));

  /* ---------- Появление ---------- */
  for (const el of document.querySelectorAll('[data-in]')) {
    const margin = Math.round((parseFloat(el.dataset.inOffset) || 0) * Math.min(1, unit));
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        el.classList.add('in');
        observer.disconnect();
      },
      { rootMargin: `0px 0px -${margin}px 0px` }
    );
    observer.observe(el);
  }

  /* ---------- Текст с обводкой ----------
     Из строк блока .caption собираем SVG: один и тот же текст рисуется
     слоями — жёлтая подложка, чёрная обводка, белые буквы. Обводки
     векторные, со скруглёнными углами, поэтому края гладкие.
     SVG живёт в координатах макета и масштабируется вместе со слоем. */
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const FONT_ASCENT = 0.96875; // метрики Inter: верх и низ строки в долях кегля
  const FONT_DESCENT = 0.2412;

  function captionLines(caption) {
    // Абзацы — <p>, строки внутри разделены <br>
    return [...caption.querySelectorAll(':scope > p')].map((p) => {
      const lines = [''];
      for (const node of p.childNodes) {
        if (node.nodeName === 'BR') lines.push('');
        else lines[lines.length - 1] += node.textContent;
      }
      return lines.map((line) => line.replace(/\s+/g, ' ').trim());
    });
  }

  document.querySelectorAll('.caption').forEach((caption, index) => {
    const style = getComputedStyle(caption);
    const number = (name) => parseFloat(style.getPropertyValue(name)) || 0;
    const size = number('--size');
    const lineHeight = size * number('--leading');
    const width = parseFloat(caption.closest('.el').style.getPropertyValue('--w'));
    const id = 'caption-' + (index + 1);

    const group = document.createElementNS(SVG_NS, 'g');
    group.id = id;
    // базовая линия первой строки
    const top = number('--pad');
    let y = top + (lineHeight - (FONT_ASCENT + FONT_DESCENT) * size) / 2 + FONT_ASCENT * size;
    let rows = -1; // строки плюс пустые строки между абзацами
    for (const paragraph of captionLines(caption)) {
      rows += paragraph.length + 1;
      for (const line of paragraph) {
        const text = document.createElementNS(SVG_NS, 'text');
        text.setAttribute('x', width / 2);
        text.setAttribute('y', y.toFixed(2));
        text.textContent = line;
        group.append(text);
        y += lineHeight;
      }
      y += lineHeight; // пустая строка между абзацами
    }

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'caption-art');
    svg.setAttribute('viewBox', `0 0 ${width} ${(top + rows * lineHeight).toFixed(2)}`);
    svg.setAttribute('aria-hidden', 'true');
    const defs = document.createElementNS(SVG_NS, 'defs');
    defs.append(group);
    svg.append(defs);
    for (const layer of ['halo', 'halo-fill', 'stroke', 'ink']) {
      const use = document.createElementNS(SVG_NS, 'use');
      use.setAttribute('class', layer);
      use.setAttribute('href', '#' + id);
      svg.append(use);
    }
    caption.prepend(svg);
    caption.classList.add('drawn');
  });

  /* ---------- Запуск ---------- */
  refresh();
  window.addEventListener('scroll', requestUpdate, { passive: true });
  window.addEventListener('resize', refresh);
  window.addEventListener('load', refresh);
  let lastWidth = root.clientWidth;
  new ResizeObserver(() => {
    // реагируем только на смену ширины: высота меняется и от наших же правок
    if (root.clientWidth === lastWidth) return;
    lastWidth = root.clientWidth;
    refresh();
  }).observe(root);
})();
