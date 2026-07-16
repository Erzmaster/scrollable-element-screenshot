// ==UserScript==
// @name         Scrollable Element Screenshot
// @namespace    local.scrollable-element-screenshot
// @version      1.3.0
// @description  Capture any scrollable element as a full PNG screenshot, including nested scroll containers.
// @match        http://*/*
// @match        https://*/*
// @require      https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js
// @grant        GM_registerMenuCommand
// @grant        GM_download
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';

  const UI_ATTRIBUTE = 'data-scrollable-element-screenshot-ui';
  const TARGET_ATTRIBUTE = 'data-scrollable-element-screenshot-target';
  const MAX_CANVAS_DIMENSION = 32767;
  const MAX_CANVAS_AREA = 67108864;
  const MAX_PRELOAD_STEPS = 250;
  let selecting = false;
  let capturing = false;
  let hovered = null;
  let overlay = null;
  let message = null;
  let button = null;

  const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  const colorCanvas = document.createElement('canvas');
  const colorContext = colorCanvas.getContext('2d', { willReadFrequently: true });
  colorCanvas.width = 1;
  colorCanvas.height = 1;

  function parseComputedColor(color) {
    if (!colorContext) return null;
    colorContext.clearRect(0, 0, 1, 1);
    colorContext.fillStyle = 'rgba(0, 0, 0, 0)';
    colorContext.fillStyle = color;
    colorContext.fillRect(0, 0, 1, 1);
    const [red, green, blue, alpha] = colorContext.getImageData(0, 0, 1, 1).data;
    return {
      red,
      green,
      blue,
      alpha: alpha / 255
    };
  }

  function blendColors(background, foreground) {
    const alpha = foreground.alpha + background.alpha * (1 - foreground.alpha);
    if (alpha === 0) return { red: 0, green: 0, blue: 0, alpha: 0 };
    return {
      red: (foreground.red * foreground.alpha
        + background.red * background.alpha * (1 - foreground.alpha)) / alpha,
      green: (foreground.green * foreground.alpha
        + background.green * background.alpha * (1 - foreground.alpha)) / alpha,
      blue: (foreground.blue * foreground.alpha
        + background.blue * background.alpha * (1 - foreground.alpha)) / alpha,
      alpha
    };
  }

  function determineBackgroundColor(element) {
    const layers = [];
    // html2canvas renders the selected element's own background. Only calculate
    // the backdrop behind it, otherwise translucent colors would be applied twice.
    let current = element.parentElement;
    while (current instanceof Element) {
      const color = parseComputedColor(getComputedStyle(current).backgroundColor);
      if (color && color.alpha > 0) layers.push(color);
      current = current.parentElement;
    }

    // A transparent web page is displayed on the browser's white canvas.
    let result = { red: 255, green: 255, blue: 255, alpha: 1 };
    for (const layer of layers.reverse()) result = blendColors(result, layer);
    return `rgb(${Math.round(result.red)}, ${Math.round(result.green)}, ${Math.round(result.blue)})`;
  }

  function determineScale(width, height) {
    const preferredScale = Math.min(devicePixelRatio || 1, 2);
    const dimensionScale = Math.min(
      (MAX_CANVAS_DIMENSION - 1) / width,
      (MAX_CANVAS_DIMENSION - 1) / height
    );
    const areaScale = Math.sqrt(MAX_CANVAS_AREA / (width * height));
    return Math.min(preferredScale, dimensionScale, areaScale);
  }

  function temporarilyDisableScrollEffects(element) {
    const properties = ['scroll-behavior', 'scroll-snap-type', 'overflow-anchor'];
    const originals = properties.map((property) => ({
      property,
      value: element.style.getPropertyValue(property),
      priority: element.style.getPropertyPriority(property)
    }));

    element.style.setProperty('scroll-behavior', 'auto', 'important');
    element.style.setProperty('scroll-snap-type', 'none', 'important');
    element.style.setProperty('overflow-anchor', 'none', 'important');

    return () => {
      for (const { property, value, priority } of originals) {
        if (value) element.style.setProperty(property, value, priority);
        else element.style.removeProperty(property);
      }
    };
  }

  function isScrollable(element) {
    if (!(element instanceof HTMLElement)) return false;
    const style = getComputedStyle(element);
    const vertical = /(auto|scroll|overlay)/.test(style.overflowY)
      && element.scrollHeight > element.clientHeight + 1;
    const horizontal = /(auto|scroll|overlay)/.test(style.overflowX)
      && element.scrollWidth > element.clientWidth + 1;
    return vertical || horizontal;
  }

  function findScrollableElement(start) {
    let element = start instanceof HTMLElement ? start : start?.parentElement;
    while (element && element !== document.documentElement) {
      if (!element.hasAttribute(UI_ATTRIBUTE) && isScrollable(element)) return element;
      element = element.parentElement;
    }
    return document.scrollingElement || document.documentElement;
  }

  function ensureUi() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.setAttribute(UI_ATTRIBUTE, '');
    Object.assign(overlay.style, {
      position: 'fixed', pointerEvents: 'none', zIndex: '2147483647',
      border: '3px solid #00d4ff', background: 'rgba(0, 212, 255, .10)',
      boxSizing: 'border-box', display: 'none'
    });
    message = document.createElement('div');
    message.setAttribute(UI_ATTRIBUTE, '');
    Object.assign(message.style, {
      position: 'fixed', left: '50%', top: '16px', transform: 'translateX(-50%)',
      zIndex: '2147483647', padding: '10px 14px', borderRadius: '8px',
      background: '#17191d', color: '#fff', font: '13px/1.4 system-ui, sans-serif',
      boxShadow: '0 4px 18px rgba(0,0,0,.35)', pointerEvents: 'none'
    });
    document.documentElement.append(overlay, message);
  }

  function showMessage(text) {
    ensureUi();
    message.textContent = text;
    message.style.display = 'block';
  }

  function hideUi() {
    if (overlay) overlay.style.display = 'none';
    if (message) message.style.display = 'none';
  }

  function highlight(element) {
    ensureUi();
    const rect = element.getBoundingClientRect();
    Object.assign(overlay.style, {
      display: 'block', left: `${Math.max(0, rect.left)}px`,
      top: `${Math.max(0, rect.top)}px`, width: `${Math.min(innerWidth, rect.right) - Math.max(0, rect.left)}px`,
      height: `${Math.min(innerHeight, rect.bottom) - Math.max(0, rect.top)}px`
    });
  }

  function stopSelecting() {
    selecting = false;
    hovered = null;
    removeEventListener('pointermove', onPointerMove, true);
    removeEventListener('click', onClick, true);
    removeEventListener('keydown', onKeyDown, true);
    hideUi();
  }

  function onPointerMove(event) {
    hovered = findScrollableElement(event.target);
    if (hovered) highlight(hovered);
  }

  function onKeyDown(event) {
    if (event.key === 'Escape') stopSelecting();
  }

  function onClick(event) {
    if (!selecting) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const target = hovered || findScrollableElement(event.target);
    stopSelecting();
    if (target) void capture(target);
  }

  function startSelecting() {
    if (selecting || capturing) return;
    selecting = true;
    ensureUi();
    showMessage('Move over the scrollable area, then click. Press Esc to cancel.');
    addEventListener('pointermove', onPointerMove, true);
    addEventListener('click', onClick, true);
    addEventListener('keydown', onKeyDown, true);
  }

  async function loadLazyContent(element) {
    const originalTop = element.scrollTop;
    const originalLeft = element.scrollLeft;
    const restoreScrollEffects = temporarilyDisableScrollEffects(element);
    const restore = () => {
      element.scrollTop = originalTop;
      element.scrollLeft = originalLeft;
      restoreScrollEffects();
    };

    try {
      const verticalStep = Math.max(100, Math.floor(element.clientHeight * 0.8));
      let steps = 0;
      for (let top = 0;
        top < element.scrollHeight - element.clientHeight && steps < MAX_PRELOAD_STEPS;
        top += verticalStep, steps += 1) {
        element.scrollTop = top;
        const progress = Math.min(100, Math.round(
          (top / Math.max(1, element.scrollHeight - element.clientHeight)) * 100
        ));
        showMessage(`Loading vertical content… ${progress}%`);
        await sleep(120);
      }

      element.scrollTop = element.scrollHeight;
      await sleep(250);

      const horizontalStep = Math.max(100, Math.floor(element.clientWidth * 0.8));
      steps = 0;
      for (let left = 0;
        left < element.scrollWidth - element.clientWidth && steps < MAX_PRELOAD_STEPS;
        left += horizontalStep, steps += 1) {
        element.scrollLeft = left;
        const progress = Math.min(100, Math.round(
          (left / Math.max(1, element.scrollWidth - element.clientWidth)) * 100
        ));
        showMessage(`Loading horizontal content… ${progress}%`);
        await sleep(120);
      }

      element.scrollLeft = element.scrollWidth;
      await sleep(250);
      element.scrollTop = 0;
      element.scrollLeft = 0;
      await sleep(100);
      return restore;
    } catch (error) {
      restore();
      throw error;
    }
  }

  async function downloadCanvas(canvas) {
    const filename = `scrollable-element-screenshot-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((result) => {
        if (result) resolve(result);
        else reject(new Error('The browser could not create the PNG.'));
      }, 'image/png');
    });
    const url = URL.createObjectURL(blob);
    if (typeof GM_download === 'function') {
      GM_download({ url, name: filename, saveAs: true, onload: () => URL.revokeObjectURL(url),
        onerror: () => URL.revokeObjectURL(url) });
    } else {
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }

  async function capture(element) {
    if (capturing) return;
    capturing = true;
    if (button) button.disabled = true;
    let restoreScroll = () => {};
    const captureId = `scrollable-element-screenshot-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      showMessage('Preparing the complete scrollable area…');
      restoreScroll = await loadLazyContent(element);
      const width = element.scrollWidth;
      const height = element.scrollHeight;
      if (width < 1 || height < 1) throw new Error('The selected element has no visible size.');
      const scale = determineScale(width, height);
      if (scale < 0.1) {
        throw new Error('The selected element is too large to capture as one browser canvas.');
      }
      const backgroundColor = determineBackgroundColor(element);
      const outputWidth = Math.floor(width * scale);
      const outputHeight = Math.floor(height * scale);
      showMessage(`Rendering ${outputWidth} × ${outputHeight} pixels on ${backgroundColor}…`);
      element.setAttribute(TARGET_ATTRIBUTE, captureId);
      const canvas = await html2canvas(element, {
        backgroundColor,
        useCORS: true,
        allowTaint: false,
        logging: false,
        scale,
        width,
        height,
        windowWidth: Math.max(document.documentElement.clientWidth, width),
        windowHeight: Math.max(document.documentElement.clientHeight, height),
        ignoreElements: (node) => node instanceof Element && node.hasAttribute(UI_ATTRIBUTE),
        onclone: (clonedDocument) => {
          const clone = clonedDocument.querySelector(`[${TARGET_ATTRIBUTE}="${captureId}"]`);
          if (!clone) throw new Error('Could not find the selected element in the cloned page.');
          clone.scrollTop = 0;
          clone.scrollLeft = 0;
          clone.style.setProperty('overflow', 'visible', 'important');
          clone.style.setProperty('max-height', 'none', 'important');
          clone.style.setProperty('max-width', 'none', 'important');
          clone.style.width = `${width}px`;
          clone.style.height = `${height}px`;
        }
      });
      showMessage('Creating PNG…');
      await downloadCanvas(canvas);
      showMessage('PNG ready. Choose where to save it.');
      setTimeout(hideUi, 1800);
    } catch (error) {
      console.error('[Scrollable Element Screenshot]', error);
      showMessage(`Capture failed: ${error.message || error}`);
      setTimeout(hideUi, 7000);
    } finally {
      element.removeAttribute(TARGET_ATTRIBUTE);
      try {
        restoreScroll();
      } finally {
        capturing = false;
        if (button) button.disabled = false;
      }
    }
  }

  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('Capture a scrollable element', startSelecting);
  }

  button = document.createElement('button');
  button.setAttribute(UI_ATTRIBUTE, '');
  button.setAttribute('aria-keyshortcuts', 'Alt+Shift+S');
  button.type = 'button';
  button.textContent = '📷';
  button.title = 'Capture a scrollable element (Alt+Shift+S)';
  Object.assign(button.style, {
    position: 'fixed', right: '18px', bottom: '18px', zIndex: '2147483646',
    width: '42px', height: '42px', border: '0', borderRadius: '50%',
    background: '#17191d', color: '#fff', fontSize: '20px', cursor: 'pointer',
    boxShadow: '0 3px 14px rgba(0,0,0,.35)'
  });
  document.documentElement.append(button);

  function shieldCameraPointerEvent(event) {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    if (event.target !== button && !path.includes(button)) return;

    // Outside-click handlers commonly listen on document during pointerdown or
    // mousedown. Intercept at window before the event reaches those handlers.
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    if (event.type === 'pointerdown' && event.button === 0) startSelecting();
  }

  for (const eventName of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
    addEventListener(eventName, shieldCameraPointerEvent, true);
  }

  addEventListener('keydown', (event) => {
    const buttonKey = event.target === button && (event.key === 'Enter' || event.key === ' ');
    const shortcut = event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey
      && event.code === 'KeyS';
    if (!buttonKey && !shortcut) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    startSelecting();
  }, true);
})();
