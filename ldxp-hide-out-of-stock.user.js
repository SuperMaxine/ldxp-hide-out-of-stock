// ==UserScript==
// @name         链动小铺增强工具
// @namespace    https://github.com/SuperMaxine/ldxp-hide-out-of-stock
// @version      1.3.1
// @description  隐藏链动小铺缺货商品、按价格排序，并在购买页或订单确认弹窗中自动填写联系方式和安全密码。
// @author       SuperMaxine
// @homepageURL  https://github.com/SuperMaxine/ldxp-hide-out-of-stock
// @supportURL   https://github.com/SuperMaxine/ldxp-hide-out-of-stock/issues
// @updateURL    https://raw.githubusercontent.com/SuperMaxine/ldxp-hide-out-of-stock/main/ldxp-hide-out-of-stock.user.js
// @downloadURL  https://raw.githubusercontent.com/SuperMaxine/ldxp-hide-out-of-stock/main/ldxp-hide-out-of-stock.user.js
// @match        https://pay.ldxp.cn/shop/*
// @match        https://pay.ldxp.cn/item/*
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// ==/UserScript==

(function () {
  'use strict';

  const MASONRY_CARD_SELECTOR = '.goods_item';
  const LIST_CARD_SELECTOR = '.goods-item';
  const CONTAINER_SELECTOR = '[item-selector=".goods_item"]';
  const LIST_CONTAINER_SELECTOR = '.goods-list';
  const HIDDEN_ATTRIBUTE = 'data-ldxp-oos-hidden';
  const HIDDEN_STYLE_ID = 'ldxp-hide-out-of-stock-style';
  const CONTROLS_ID = 'ldxp-product-controls';
  const ROOT_STATE_ATTRIBUTE = 'data-ldxp-hide-oos';
  const CONTACT_SELECTORS = [
    '.contact_box input',
    'input[placeholder="请输入联系方式方便查询订单"]',
    'input[placeholder="请输入手机号（11位）"]',
    'input[placeholder="请输入QQ号（5-12位数字）"]',
    'input[placeholder="请输入微信号（6-20位）"]',
    'input[placeholder="请输入邮箱地址"]',
  ];
  const SAFETY_PASSWORD_SELECTORS = [
    'input[placeholder="为保障您的卡密安全，请设置安全密码"]',
  ];
  const STORAGE_KEYS = {
    hideOutOfStock: 'hideOutOfStock',
    sortOrder: 'sortOrder',
    contact: 'checkoutContact',
    safetyPassword: 'checkoutSafetyPassword',
  };
  const isShopPage = location.pathname.startsWith('/shop/');
  const isItemPage = location.pathname.startsWith('/item/');

  function readSetting(key, fallbackValue) {
    try {
      return GM_getValue(key, fallbackValue);
    } catch (error) {
      console.warn('[链动小铺增强工具] 读取设置失败：', error);
      return fallbackValue;
    }
  }

  function writeSetting(key, value) {
    try {
      GM_setValue(key, value);
    } catch (error) {
      console.warn('[链动小铺增强工具] 保存设置失败：', error);
    }
  }

  function deleteSetting(key) {
    try {
      GM_deleteValue(key);
    } catch (error) {
      console.warn('[链动小铺增强工具] 清除设置失败：', error);
    }
  }

  const savedSortOrder = readSetting(STORAGE_KEYS.sortOrder, 'default');

  const state = {
    hideOutOfStock: readSetting(STORAGE_KEYS.hideOutOfStock, true) !== false,
    sortOrder: ['default', 'asc', 'desc'].includes(savedSortOrder)
      ? savedSortOrder
      : 'default',
  };

  const originalOrders = new WeakMap();
  let nextOriginalOrder = 0;
  let controls;
  let productStats = { total: 0, outOfStock: 0 };
  let autofillMessage = '';

  let layoutTimer;
  let settleTimer;
  let autofillTimer;
  let autofillSettleTimer;

  function installStyle() {
    let style = document.getElementById(HIDDEN_STYLE_ID);
    if (!style) {
      style = document.createElement('style');
      style.id = HIDDEN_STYLE_ID;
      (document.head || document.documentElement).appendChild(style);
    }

    style.textContent = `
      html[${ROOT_STATE_ATTRIBUTE}="true"] ${MASONRY_CARD_SELECTOR}:has(.stock.rank0),
      html[${ROOT_STATE_ATTRIBUTE}="true"] ${LIST_CARD_SELECTOR}:has(.stock.rank0) {
        visibility: hidden !important;
      }

      ${MASONRY_CARD_SELECTOR}[${HIDDEN_ATTRIBUTE}="true"],
      ${LIST_CARD_SELECTOR}[${HIDDEN_ATTRIBUTE}="true"] {
        display: none !important;
      }

      #${CONTROLS_ID} {
        position: fixed;
        right: 16px;
        bottom: 16px;
        z-index: 999;
        width: 304px;
        box-sizing: border-box;
        padding: 12px;
        color: #f7f7f8;
        font: 12px/1.4 "JetBrains Mono", "IBM Plex Mono", Consolas, monospace;
        font-variant-numeric: tabular-nums;
        background: #000;
        border: 1px solid #c6ff4a;
        border-left-width: 4px;
        max-height: calc(100vh - 32px);
        overflow-y: auto;
      }

      #${CONTROLS_ID} * {
        box-sizing: border-box;
        font-family: inherit;
      }

      #${CONTROLS_ID} .ldxp-controls-title {
        margin: 0;
        color: #f7f7f8;
        font-weight: 700;
        font-size: 13px;
      }

      #${CONTROLS_ID} .ldxp-control-section-title {
        margin: 10px 0 3px;
        color: #c6ff4a;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.08em;
      }

      #${CONTROLS_ID} .ldxp-control-row {
        display: grid;
        grid-template-columns: 92px minmax(0, 1fr);
        gap: 8px;
        align-items: center;
        min-height: 34px;
        border-top: 1px solid #2a2a2a;
      }

      #${CONTROLS_ID} .ldxp-control-label {
        color: #b8b8b8;
      }

      #${CONTROLS_ID} .ldxp-checkbox-label {
        display: inline-flex;
        align-items: center;
        justify-content: flex-start;
        gap: 8px;
        color: #f7f7f8;
        cursor: pointer;
      }

      #${CONTROLS_ID} input[type="checkbox"] {
        width: 16px;
        height: 16px;
        margin: 0;
        accent-color: #c6ff4a;
      }

      #${CONTROLS_ID} select,
      #${CONTROLS_ID} input[type="text"],
      #${CONTROLS_ID} input[type="password"] {
        width: 100%;
        min-width: 0;
        padding: 5px 6px;
        color: #f7f7f8;
        font-size: 12px;
        background: #000;
        border: 1px solid #c6ff4a;
        border-radius: 0;
        outline: none;
      }

      #${CONTROLS_ID} input::placeholder {
        color: #737373;
      }

      #${CONTROLS_ID} select:focus-visible,
      #${CONTROLS_ID} input:focus-visible {
        outline: 2px solid #c6ff4a;
        outline-offset: 2px;
      }

      #${CONTROLS_ID} .ldxp-autofill-actions {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 84px;
        gap: 8px;
        margin-top: 8px;
      }

      #${CONTROLS_ID} .ldxp-button {
        min-height: 30px;
        padding: 5px 8px;
        color: #000;
        font-size: 12px;
        font-weight: 700;
        background: #c6ff4a;
        border: 1px solid #c6ff4a;
        border-radius: 0;
        cursor: pointer;
      }

      #${CONTROLS_ID} .ldxp-button-secondary {
        color: #f7f7f8;
        background: #000;
      }

      #${CONTROLS_ID} .ldxp-button:hover {
        filter: brightness(0.9);
      }

      #${CONTROLS_ID} .ldxp-local-note {
        margin: 7px 0 0;
        color: #8e8e8e;
        font-size: 10px;
      }

      #${CONTROLS_ID} .ldxp-controls-status {
        margin-top: 9px;
        padding-top: 8px;
        color: #c6ff4a;
        border-top: 1px solid #c6ff4a;
        white-space: pre-line;
      }

      @media (max-width: 560px) {
        #${CONTROLS_ID} {
          right: 12px;
          bottom: 12px;
          width: min(304px, calc(100vw - 24px));
        }
      }
    `;
  }

  function isOutOfStock(card) {
    const stock = card.querySelector('.stock');
    if (!stock) return false;

    return (
      stock.classList.contains('rank0') ||
      stock.textContent.trim() === '缺货'
    );
  }

  function toPixels(value) {
    const number = Number.parseFloat(value);
    return Number.isFinite(number) ? number : 0;
  }

  function getOuterWidth(card) {
    const computed = getComputedStyle(card);
    const measuredWidth =
      card.getBoundingClientRect().width ||
      toPixels(computed.width) ||
      toPixels(computed.minWidth);

    return (
      measuredWidth +
      toPixels(computed.marginLeft) +
      toPixels(computed.marginRight)
    );
  }

  function getSavedCheckoutDetails() {
    const contact = readSetting(STORAGE_KEYS.contact, '');
    const safetyPassword = readSetting(STORAGE_KEYS.safetyPassword, '');

    return {
      contact: typeof contact === 'string' ? contact : '',
      safetyPassword:
        typeof safetyPassword === 'string' ? safetyPassword : '',
    };
  }

  function findInput(selectors) {
    for (const selector of selectors) {
      const input = document.querySelector(selector);
      if (input?.tagName === 'INPUT') return input;
    }
    return null;
  }

  function setNativeInputValue(input, value) {
    const valueSetter = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(input),
      'value',
    )?.set;

    if (valueSetter) {
      valueSetter.call(input, value);
    } else {
      input.value = value;
    }

    const EventConstructor = input.ownerDocument.defaultView?.Event || Event;
    input.dispatchEvent(new EventConstructor('input', { bubbles: true }));
    input.dispatchEvent(new EventConstructor('change', { bubbles: true }));
  }

  function fillCheckoutFields({ overwrite = false } = {}) {
    const details = getSavedCheckoutDetails();
    const fields = [
      { input: findInput(CONTACT_SELECTORS), value: details.contact },
      {
        input: findInput(SAFETY_PASSWORD_SELECTORS),
        value: details.safetyPassword,
      },
    ];
    const result = {
      savedCount: 0,
      foundCount: 0,
      readyCount: 0,
      preservedCount: 0,
    };

    for (const field of fields) {
      if (!field.value) continue;
      result.savedCount += 1;

      if (!field.input) continue;
      result.foundCount += 1;

      if (field.input.value === field.value) {
        result.readyCount += 1;
        continue;
      }

      if (field.input.value && !overwrite) {
        result.preservedCount += 1;
        continue;
      }

      setNativeInputValue(field.input, field.value);
      result.readyCount += 1;
    }

    return result;
  }

  function getAutofillMessage(result) {
    if (result.savedCount === 0) return '购买信息：未配置';
    if (result.savedCount < 2) {
      return `购买信息：已保存 ${result.savedCount} / 2 项`;
    }
    if (result.foundCount === 0) return '购买信息：等待表单加载';
    if (result.preservedCount > 0) {
      return '购买信息：页面已有内容，未覆盖';
    }
    return `购买信息：已自动填写 ${result.readyCount} / 2 项`;
  }

  function updateControlsStatus() {
    if (!controls) return;

    const lines = [];
    if (isShopPage) {
      lines.push(
        state.hideOutOfStock
          ? `已隐藏 ${productStats.outOfStock} / ${productStats.total}`
          : `显示全部 ${productStats.total}`,
      );
    }

    if (autofillMessage) {
      lines.push(autofillMessage);
    } else {
      const details = getSavedCheckoutDetails();
      const savedCount =
        Number(Boolean(details.contact)) +
        Number(Boolean(details.safetyPassword));
      lines.push(`购买信息：已保存 ${savedCount} / 2 项`);
    }

    const statusText = lines.join('\n');
    if (controls.status.textContent !== statusText) {
      controls.status.textContent = statusText;
    }
  }

  function saveCheckoutDetails() {
    const contact = controls.contactInput.value.trim();
    const safetyPassword = controls.safetyPasswordInput.value;

    if (!contact || !safetyPassword.trim()) {
      autofillMessage = '购买信息：请完整填写联系方式和安全密码';
      updateControlsStatus();
      return;
    }

    writeSetting(STORAGE_KEYS.contact, contact);
    writeSetting(STORAGE_KEYS.safetyPassword, safetyPassword);
    controls.contactInput.value = contact;

    if (isItemPage) {
      autofillMessage = getAutofillMessage(
        fillCheckoutFields({ overwrite: true }),
      );
    } else {
      autofillMessage = '购买信息：已保存 2 / 2 项';
    }
    updateControlsStatus();
  }

  function clearCheckoutDetails() {
    deleteSetting(STORAGE_KEYS.contact);
    deleteSetting(STORAGE_KEYS.safetyPassword);
    controls.contactInput.value = '';
    controls.safetyPasswordInput.value = '';
    autofillMessage = '购买信息：已清除保存内容';
    updateControlsStatus();
  }

  function ensureControls() {
    if (controls?.panel?.isConnected || !document.body) return;
    controls = undefined;

    const panel = document.createElement('section');
    panel.id = CONTROLS_ID;
    panel.setAttribute('aria-label', '链动小铺增强设置');
    panel.innerHTML = `
      <h2 class="ldxp-controls-title">链动小铺增强</h2>
      <div class="ldxp-control-section-title">商品显示</div>
      <div class="ldxp-control-row">
        <span class="ldxp-control-label">库存筛选</span>
        <label class="ldxp-checkbox-label">
          <input class="ldxp-hide-checkbox" type="checkbox">
          <span>隐藏缺货商品</span>
        </label>
      </div>
      <label class="ldxp-control-row">
        <span class="ldxp-control-label">价格排序</span>
        <select class="ldxp-sort-select">
          <option value="default">默认顺序</option>
          <option value="asc">价格从低到高</option>
          <option value="desc">价格从高到低</option>
        </select>
      </label>
      <div class="ldxp-control-section-title">购买信息</div>
      <label class="ldxp-control-row">
        <span class="ldxp-control-label">联系方式</span>
        <input class="ldxp-contact-input" type="text" autocomplete="off"
          spellcheck="false" placeholder="请输入联系方式">
      </label>
      <label class="ldxp-control-row">
        <span class="ldxp-control-label">安全密码</span>
        <input class="ldxp-password-input" type="password" autocomplete="off"
          spellcheck="false" placeholder="请输入安全密码">
      </label>
      <div class="ldxp-autofill-actions">
        <button class="ldxp-button ldxp-save-button" type="button">保存并填写</button>
        <button class="ldxp-button ldxp-button-secondary ldxp-clear-button"
          type="button">清除保存</button>
      </div>
      <p class="ldxp-local-note">四项设置均保存在油猴本地；脚本不会自动提交订单。</p>
      <div class="ldxp-controls-status" aria-live="polite"></div>
    `;

    document.body.appendChild(panel);

    controls = {
      panel,
      checkbox: panel.querySelector('.ldxp-hide-checkbox'),
      sortSelect: panel.querySelector('.ldxp-sort-select'),
      contactInput: panel.querySelector('.ldxp-contact-input'),
      safetyPasswordInput: panel.querySelector('.ldxp-password-input'),
      saveButton: panel.querySelector('.ldxp-save-button'),
      clearButton: panel.querySelector('.ldxp-clear-button'),
      status: panel.querySelector('.ldxp-controls-status'),
    };

    const details = getSavedCheckoutDetails();
    controls.checkbox.checked = state.hideOutOfStock;
    controls.sortSelect.value = state.sortOrder;
    controls.contactInput.value = details.contact;
    controls.safetyPasswordInput.value = details.safetyPassword;

    controls.checkbox.addEventListener('change', () => {
      state.hideOutOfStock = controls.checkbox.checked;
      writeSetting(STORAGE_KEYS.hideOutOfStock, state.hideOutOfStock);
      document.documentElement.setAttribute(
        ROOT_STATE_ATTRIBUTE,
        String(state.hideOutOfStock),
      );
      if (isShopPage) processProducts();
      else updateControlsStatus();
    });

    controls.sortSelect.addEventListener('change', () => {
      state.sortOrder = controls.sortSelect.value;
      writeSetting(STORAGE_KEYS.sortOrder, state.sortOrder);
      if (isShopPage) processProducts();
      else updateControlsStatus();
    });

    controls.saveButton.addEventListener('click', saveCheckoutDetails);
    controls.clearButton.addEventListener('click', clearCheckoutDetails);
    for (const input of [
      controls.contactInput,
      controls.safetyPasswordInput,
    ]) {
      input.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        saveCheckoutDetails();
      });
    }

    updateControlsStatus();
  }

  function rememberOriginalOrder(cards) {
    for (const card of cards) {
      if (originalOrders.has(card)) continue;
      originalOrders.set(card, nextOriginalOrder);
      nextOriginalOrder += 1;
    }
  }

  function getPrice(card) {
    const priceElement =
      card.querySelector('.nowPrice') || card.querySelector('.goods-price');
    const priceText = priceElement?.textContent.trim() || '';

    if (/免费|free/i.test(priceText)) return 0;

    const match = priceText.replace(/,/g, '').match(/\d+(?:\.\d+)?/);
    return match ? Number.parseFloat(match[0]) : null;
  }

  function getOrderedCards(cards) {
    rememberOriginalOrder(cards);

    return [...cards].sort((first, second) => {
      if (state.sortOrder === 'default') {
        return originalOrders.get(first) - originalOrders.get(second);
      }

      const firstPrice = getPrice(first);
      const secondPrice = getPrice(second);

      if (firstPrice === null && secondPrice === null) {
        return originalOrders.get(first) - originalOrders.get(second);
      }
      if (firstPrice === null) return 1;
      if (secondPrice === null) return -1;

      const priceDifference = firstPrice - secondPrice;
      if (priceDifference === 0) {
        return originalOrders.get(first) - originalOrders.get(second);
      }

      return state.sortOrder === 'asc' ? priceDifference : -priceDifference;
    });
  }

  function setCardVisibility(card) {
    const shouldHide = state.hideOutOfStock && isOutOfStock(card);

    if (shouldHide) {
      card.setAttribute(HIDDEN_ATTRIBUTE, 'true');
      card.style.setProperty('display', 'none', 'important');
      return true;
    }

    if (card.hasAttribute(HIDDEN_ATTRIBUTE)) {
      card.removeAttribute(HIDDEN_ATTRIBUTE);
      card.style.removeProperty('display');
    }
    return false;
  }

  function processListCards() {
    const container = document.querySelector(LIST_CONTAINER_SELECTOR);
    if (!container) return { total: 0, outOfStock: 0 };

    const cards = Array.from(container.children).filter((element) =>
      element.matches(LIST_CARD_SELECTOR),
    );
    const orderedCards = getOrderedCards(cards);

    const currentCards = Array.from(container.children).filter((element) =>
      element.matches(LIST_CARD_SELECTOR),
    );
    const orderChanged = orderedCards.some(
      (card, index) => card !== currentCards[index],
    );

    if (orderChanged) {
      for (const card of orderedCards) container.appendChild(card);
    }

    for (const card of orderedCards) setCardVisibility(card);

    return {
      total: cards.length,
      outOfStock: cards.filter(isOutOfStock).length,
    };
  }

  function layoutAvailableCards() {
    const container = document.querySelector(CONTAINER_SELECTOR);
    if (!container) return { total: 0, outOfStock: 0 };

    const cards = Array.from(container.children).filter((element) =>
      element.matches(MASONRY_CARD_SELECTOR),
    );
    if (cards.length === 0) return { total: 0, outOfStock: 0 };

    const orderedCards = getOrderedCards(cards);

    const availableCards = [];
    const standardWidths = [];
    const fallbackWidths = [];

    for (const card of orderedCards) {
      const outerWidth = getOuterWidth(card);
      if (outerWidth > 48) fallbackWidths.push(outerWidth);
      if (card.classList.contains('has_image') && outerWidth > 48) {
        standardWidths.push(outerWidth);
      }

      if (setCardVisibility(card)) continue;

      // 清掉网站 Masonry 留下的位移动画，后面直接写入新的坐标。
      card.style.setProperty('transform', 'none', 'important');
      card.style.setProperty('transition', 'none', 'important');
      availableCards.push(card);
    }

    if (availableCards.length === 0) {
      container.style.height = '0px';
      return {
        total: cards.length,
        outOfStock: cards.filter(isOutOfStock).length,
      };
    }

    const columnWidth =
      standardWidths.length > 0
        ? Math.max(...standardWidths)
        : fallbackWidths.length > 0
          ? Math.min(...fallbackWidths)
        : container.clientWidth || 1;

    const columnCount = Math.max(
      1,
      Math.floor((container.clientWidth + 0.5) / columnWidth),
    );
    const columnHeights = new Array(columnCount).fill(0);

    for (const card of availableCards) {
      const columnSpan = Math.min(
        columnCount,
        Math.max(1, Math.ceil((getOuterWidth(card) - 1) / columnWidth)),
      );

      let column = 0;
      let top = Number.POSITIVE_INFINITY;
      for (
        let candidate = 0;
        candidate <= columnCount - columnSpan;
        candidate += 1
      ) {
        const candidateTop = Math.max(
          ...columnHeights.slice(candidate, candidate + columnSpan),
        );
        if (candidateTop < top) {
          column = candidate;
          top = candidateTop;
        }
      }

      const computed = getComputedStyle(card);
      const outerHeight =
        card.getBoundingClientRect().height +
        toPixels(computed.marginTop) +
        toPixels(computed.marginBottom);

      card.style.left = `${column * columnWidth}px`;
      card.style.top = `${top}px`;
      for (let index = column; index < column + columnSpan; index += 1) {
        columnHeights[index] = top + outerHeight;
      }
    }

    container.style.height = `${Math.max(...columnHeights)}px`;

    return {
      total: cards.length,
      outOfStock: cards.filter(isOutOfStock).length,
    };
  }

  function processProducts() {
    ensureControls();

    const listStats = processListCards();
    const masonryStats = layoutAvailableCards();
    const total = listStats.total + masonryStats.total;
    const outOfStock = listStats.outOfStock + masonryStats.outOfStock;
    productStats = { total, outOfStock };

    if (!controls) return;

    controls.checkbox.checked = state.hideOutOfStock;
    controls.sortSelect.value = state.sortOrder;
    updateControlsStatus();
  }

  function scheduleLayout() {
    clearTimeout(layoutTimer);
    clearTimeout(settleTimer);

    // 先等待 Vue 完成本轮渲染，再覆盖网站 Masonry 写入的绝对坐标。
    layoutTimer = setTimeout(() => {
      requestAnimationFrame(() => requestAnimationFrame(processShopPage));
    }, 50);

    // 图片加载、加载更多或购买弹窗渲染可能稍后完成，做一次最终校正。
    settleTimer = setTimeout(processShopPage, 450);
  }

  function processAutofill() {
    ensureControls();
    const result = fillCheckoutFields();
    autofillMessage =
      isShopPage && result.foundCount === 0
        ? ''
        : getAutofillMessage(result);
    updateControlsStatus();
  }

  function processShopPage() {
    processProducts();
    processAutofill();
  }

  function scheduleAutofill() {
    clearTimeout(autofillTimer);
    clearTimeout(autofillSettleTimer);

    autofillTimer = setTimeout(processAutofill, 50);
    autofillSettleTimer = setTimeout(processAutofill, 450);
  }

  function start() {
    document.documentElement.setAttribute(
      ROOT_STATE_ATTRIBUTE,
      String(state.hideOutOfStock),
    );
    installStyle();

    const observer = new MutationObserver(
      isShopPage ? scheduleLayout : scheduleAutofill,
    );
    observer.observe(document.documentElement, {
      childList: true,
      characterData: isShopPage,
      subtree: true,
    });

    if (isShopPage) {
      window.addEventListener('resize', scheduleLayout, { passive: true });
      window.addEventListener('load', scheduleLayout, true);
      scheduleLayout();
    } else if (isItemPage) {
      window.addEventListener('load', scheduleAutofill, true);
      scheduleAutofill();
    }
  }

  if (document.documentElement) {
    start();
  } else {
    const bootstrapObserver = new MutationObserver(() => {
      if (!document.documentElement) return;
      bootstrapObserver.disconnect();
      start();
    });
    bootstrapObserver.observe(document, { childList: true });
  }
})();
