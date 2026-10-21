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
  const MOBILE_LAYOUT = false;
  const MOBILE_TEXT_PX = 17;
  const CAPTION_GAP = 60; // зазор между текстами, px макета
  // Основной текст крупнее макета. Увеличенные тексты раздвигаются
  // и сцены удлиняются так же, как в мобильной раскладке.
  const CAPTION_SCALE = 1.2;         // компьютер
  const CAPTION_SCALE_NARROW = 1.45; // узкий экран (телефон горизонтально)

  function fitCaptions() {
    const scale = phone
      ? Math.min(2.8, Math.max(1, MOBILE_TEXT_PX / (24 * unit)))
      : (root.clientWidth <= 1000 ? CAPTION_SCALE_NARROW : CAPTION_SCALE);
    root.style.setProperty('--cap-scale', scale.toFixed(3));
    const num = (el, name) => parseFloat(el.style.getPropertyValue(name)) || 0;
    for (const scene of scenes) {
      scene.style.removeProperty('--dh');
      const layers = [...scene.querySelectorAll('.el')];
      layers.forEach((el) => el.style.removeProperty('--dy'));
      const items = layers
        .filter((el) => el.querySelector('.caption'))
        .map((el) => {
          const caption = el.querySelector('.caption');
          const h = caption.offsetHeight / unit; // уже увеличенная высота
          return { el, y: num(el, '--y'), h, h0: h / scale };
        });
      if (scale === 1 || !items.length) continue;
      items.sort((a, b) => a.y - b.y);

      // Высота картинки слоя в px макета
      const layerH = (el) => {
        const img = el.querySelector('img');
        if (!img) return num(el, '--h');
        const w = img.naturalWidth || +img.getAttribute('width');
        const h = img.naturalHeight || +img.getAttribute('height');
        return (num(el, '--w') * h) / w;
      };

      // 1. Раскладываем сверху вниз тексты и картинки в центре экрана
      //    (персонажи, гифки между абзацами), чтобы ничего не наезжало.
      //    Картинки по краям (цветы, декор) остаются где были.
      //    Вне мобильной раскладки картинки не трогаем: текст и так поверх них.
      const central = !phone ? [] : layers.filter((el) => {
        if (el.classList.contains('bg') || el.querySelector('.caption')) return false;
        const x = num(el, '--x'), w = num(el, '--w');
        return w < 1000 && x + w / 2 > 250 && x + w / 2 < 950;
      });
      const flow = [
        ...items.map((it) => ({ ...it, caption: true })),
        ...central.map((el) => ({ el, y: num(el, '--y'), h: layerH(el), caption: false })),
      ].sort((a, b) => a.y - b.y);
      let allBottom = -Infinity, capBottom = -Infinity;
      for (const item of flow) {
        const shift = item.caption
          ? Math.max(0, allBottom + CAPTION_GAP - item.y)
          : Math.max(0, capBottom + CAPTION_GAP - item.y);
        if (shift) item.el.style.setProperty('--dy', shift.toFixed(1));
        const bottomNow = item.y + shift + item.h;
        allBottom = Math.max(allBottom, bottomNow);
        if (item.caption) {
          capBottom = bottomNow;
          const it = items.find((i) => i.el === item.el);
          it.bottom = bottomNow;
        }
      }
      let sceneBottom = allBottom;

      // 2. Остальные картинки, стоявшие в макете под текстом, сдвигаем вниз
      //    вслед за выросшим текстом. Фон сцены не двигаем.
      for (const el of layers) {
        if (el.classList.contains('bg') || el.querySelector('.caption') || central.includes(el)) continue;
        const y = num(el, '--y');
        let dy = 0;
        for (const item of items) {
          const originalBottom = item.y + item.h0;
          if (y >= originalBottom - 10) dy = Math.max(dy, item.bottom + CAPTION_GAP - originalBottom);
        }
        if (dy > 0) {
          el.style.setProperty('--dy', dy.toFixed(1));
          sceneBottom = Math.max(sceneBottom, y + dy + layerH(el));
        }
      }

      const height = num(scene, '--h');
      if (sceneBottom + 40 > height) scene.style.setProperty('--dh', (sceneBottom + 40 - height).toFixed(1));
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
      text: !!el.querySelector('.caption'),
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

  // Телефон: узкий экран. Там триггеры анимаций считаются от высоты экрана,
  // а сглаживание прокрутки выключено (у телефона своя инерция).
  let phone = false;

  function measure() {
    unit = root.clientWidth / DESIGN_WIDTH;
    viewH = window.innerHeight;
    // Отдельная мобильная раскладка выключена: на телефоне показываем
    // ту же вёрстку, что на компьютере, и просим повернуть телефон.
    // Чтобы включить её обратно, поставь MOBILE_LAYOUT = true.
    phone = MOBILE_LAYOUT && root.clientWidth < 760;
    root.classList.toggle('phone', phone);
    root.style.setProperty('--u', unit + 'px');
    fitCaptions();

    for (const scene of scenes) {
      sceneTop.set(scene, scene.getBoundingClientRect().top + window.scrollY);
    }

    for (const layer of scrollLayers) {
      const top = sceneTop.get(layer.scene) + layerY(layer.el) * unit;
      const pinned = layer.steps.some((step) => step.pin);
      // На телефоне экран вмещает намного больше макета по высоте, поэтому
      // появление/исчезание без «прилипания» считаем в долях экрана —
      // иначе текст проявляется, когда его уже пролистали.
      const offsetPx = phone && !pinned
        ? Math.min(layer.offset * viewH / 750, viewH * 0.85)
        : layer.offset * unit;
      layer.line = triggerLine(offsetPx, layer.trigger, top);
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

    if (easedTop === null || !SMOOTHING || phone || reducedMotion.matches) {
      easedTop = scrollTop;
    } else {
      const dt = settled ? 1 / 60 : Math.min(0.05, (now - lastFrame) / 1000);
      easedTop += (scrollTop - easedTop) * (1 - Math.exp(-dt / SMOOTHING));
      if (Math.abs(scrollTop - easedTop) < 0.3) easedTop = scrollTop;
    }
    lastFrame = now;
    settled = easedTop === scrollTop;

    for (const layer of scrollLayers) {
      // На телефоне тексты не анимируются: стоят на месте и всегда видны
      if (phone && layer.text) {
        if (layer.last !== 'static') {
          layer.last = 'static';
          layer.fx.removeAttribute('style');
        }
        continue;
      }
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
        // читатель обогнал фоновую загрузку — картинки этой сцены грузим сразу, без очереди
        if (!root.classList.contains('loading')) {
          for (const img of entry.target.querySelectorAll('img[data-src]')) {
            img.src = img.dataset.src;
            img.removeAttribute('data-src');
          }
        }
      }
    },
    { rootMargin: '150% 0px' }
  );
  scenes.forEach((scene) => nearObserver.observe(scene));

  /* ---------- Появление ----------
     Слой проявляется, когда заходит на экран. На телефоне — как только
     показался на 10% снизу, на компьютере — с отступом из макета. */
  let revealObservers = [];
  function setupReveal() {
    revealObservers.forEach((observer) => observer.disconnect());
    revealObservers = [];
    for (const el of document.querySelectorAll('[data-in]:not(.in)')) {
      // на телефоне тексты появляются сразу, без анимации
      if (phone && el.querySelector('.caption')) {
        el.classList.add('in');
        continue;
      }
      const margin = phone
        ? Math.round(viewH * 0.1)
        : Math.round((parseFloat(el.dataset.inOffset) || 0) * Math.min(1, unit));
      const observer = new IntersectionObserver(
        (entries) => {
          if (!entries.some((entry) => entry.isIntersecting)) return;
          el.classList.add('in');
          observer.disconnect();
        },
        { rootMargin: `0px 0px -${margin}px 0px` }
      );
      observer.observe(el);
      revealObservers.push(observer);
    }
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
    // мягкость букв: размытие внутри SVG, одинаковое у всех блоков
    const art = document.createElementNS(SVG_NS, 'g');
    const blur = number('--blur');
    if (blur > 0) {
      const height = top + rows * lineHeight;
      const filter = document.createElementNS(SVG_NS, 'filter');
      filter.id = id + '-soft';
      filter.setAttribute('filterUnits', 'userSpaceOnUse'); // с запасом: строки и подложка выходят за слой
      filter.setAttribute('x', -width);
      filter.setAttribute('y', -2 * size);
      filter.setAttribute('width', 3 * width);
      filter.setAttribute('height', (height + 4 * size).toFixed(2));
      const fe = document.createElementNS(SVG_NS, 'feGaussianBlur');
      fe.setAttribute('stdDeviation', blur);
      filter.append(fe);
      defs.append(filter);
      art.setAttribute('filter', `url(#${filter.id})`);
    }
    for (const layer of ['halo', 'halo-fill', 'stroke', 'ink']) {
      const use = document.createElementNS(SVG_NS, 'use');
      use.setAttribute('class', layer);
      use.setAttribute('href', '#' + id);
      art.append(use);
    }
    svg.append(art);
    caption.prepend(svg);
    caption.classList.add('drawn');
  });

  /* ---------- Текст в стиле лонгрида вне сцен (.tv-text) ----------
     Рисуем SVG-контуры как у .caption, но в настоящих пикселях:
     data-size — кегль, обводка и подложка пропорциональны ему. */
  function drawTvText(el) {
    const size = parseFloat(el.dataset.size) || 24;
    el.style.fontSize = size + 'px';
    el.querySelector('svg')?.remove();
    // исходные строки запоминаем один раз, до того как в блок добавится SVG
    if (!el.dataset.lines) {
      el.dataset.lines = JSON.stringify(el.innerHTML.split(/<br\s*\/?>/i).map((part) => {
        const tmp = document.createElement('div');
        tmp.innerHTML = part;
        return tmp.textContent.trim();
      }));
    }
    const lines = JSON.parse(el.dataset.lines);
    const lineHeight = size * 1.21;
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    const id = 'tv-' + Math.random().toString(36).slice(2, 8);
    const group = document.createElementNS(SVG_NS, 'g');
    group.id = id;
    lines.forEach((line, i) => {
      const text = document.createElementNS(SVG_NS, 'text');
      text.setAttribute('x', '50%');
      text.setAttribute('y', (i * lineHeight + (lineHeight - 1.21 * size) / 2 + 0.96875 * size + 0.12 * size).toFixed(2));
      text.setAttribute('font-size', size);
      text.style.fontFamily = 'inherit';
      text.textContent = line;
      group.append(text);
    });
    const defs = document.createElementNS(SVG_NS, 'defs');
    defs.append(group);
    svg.append(defs);
    const widths = { halo: (9.4 / 24) * size * 2, stroke: (3.1 / 24) * size * 2, ink: 0 };
    for (const layer of ['halo', 'stroke', 'ink']) {
      const use = document.createElementNS(SVG_NS, 'use');
      use.setAttribute('class', layer);
      use.setAttribute('href', '#' + id);
      if (widths[layer]) use.setAttribute('stroke-width', widths[layer].toFixed(2));
      svg.append(use);
    }
    el.prepend(svg);
    el.classList.add('drawn');
  }

  function setTvText(el, text) {
    el.textContent = text;
    el.dataset.lines = JSON.stringify([text]);
    drawTvText(el);
  }

  document.querySelectorAll('.tv-text').forEach(drawTvText);
  if (document.fonts) document.fonts.ready.then(() => document.querySelectorAll('.tv-text').forEach(drawTvText));

  /* ---------- Экран загрузки ----------
     Сначала грузим все картинки и только потом показываем страницу,
     чтобы при прокрутке ничего не догружалось и не выскакивало.
     Если какая-то картинка не грузится дольше LOADER_TIMEOUT, страница
     всё равно откроется. */
  const LOADER_TIMEOUT = 25000;
  // Ждём только первую половину картинок (по весу) — у них в HTML обычный src.
  // У второй половины data-src: они начинают грузиться после открытия страницы,
  // по порядку сверху вниз, пока человек читает начало.
  const LATER_PARALLEL = 4;
  function loadLaterImages() {
    const queue = [...document.querySelectorAll('img[data-src]')];
    const next = () => {
      const img = queue.shift();
      if (!img) return;
      if (!img.dataset.src) return next(); // уже грузится: сцена оказалась рядом с экраном
      img.loading = 'eager';
      img.addEventListener('load', next, { once: true });
      img.addEventListener('error', next, { once: true });
      img.src = img.dataset.src;
      img.removeAttribute('data-src');
    };
    for (let i = 0; i < LATER_PARALLEL; i++) next();
  }

  function preloadImages() {
    const loader = document.getElementById('loader');
    const pct = loader && loader.querySelector('.loader-pct');
    const images = [...document.images].filter((img) => !img.dataset.src);
    images.forEach((img) => { img.loading = 'eager'; });
    let done = 0;
    const show = () => {
      const p = images.length ? done / images.length : 1;
      if (pct) setTvText(pct, Math.round(p * 100) + '%');
    };
    const waits = images.map((img) => new Promise((resolve) => {
      const finish = () => { done++; show(); resolve(); };
      if (img.complete) return finish();
      img.addEventListener('load', finish, { once: true });
      img.addEventListener('error', finish, { once: true });
    }));
    show();
    const fonts = document.fonts ? document.fonts.ready : Promise.resolve();
    const timeout = new Promise((resolve) => setTimeout(resolve, LOADER_TIMEOUT));
    return Promise.race([Promise.all([...waits, fonts]), timeout]);
  }

  /* ---------- Запуск ---------- */
  let lastWidth = root.clientWidth;
  refresh();
  setupReveal();
  preloadImages().then(() => {
    loadLaterImages();
    window.scrollTo(0, 0);
    refresh();
    root.classList.remove('loading');
    const loader = document.getElementById('loader');
    if (loader) {
      loader.classList.add('done');
      setTimeout(() => loader.remove(), 700);
    }
  });
  window.addEventListener('scroll', requestUpdate, { passive: true });
  window.addEventListener('load', refresh);
  // На телефоне панель браузера при прокрутке то прячется, то появляется,
  // меняя высоту окна. Полностью пересчитываем всё только при смене ширины,
  // иначе закреплённые слои «прыгают».
  window.addEventListener('resize', () => {
    if (root.clientWidth !== lastWidth) return; // это обработает ResizeObserver
    if (!phone) refresh();
  });
  new ResizeObserver(() => {
    // реагируем только на смену ширины: высота меняется и от наших же правок
    if (root.clientWidth === lastWidth) return;
    lastWidth = root.clientWidth;
    refresh();
    setupReveal();
  }).observe(root);
})();
