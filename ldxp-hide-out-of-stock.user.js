// ==UserScript==
// @name         链动小铺 - 自动隐藏缺货商品
// @namespace    https://github.com/SuperMaxine/ldxp-hide-out-of-stock
// @version      1.2.1
// @description  动态隐藏链动小铺缺货商品，并支持按价格排序。
// @author       SuperMaxine
// @homepageURL  https://github.com/SuperMaxine/ldxp-hide-out-of-stock
// @supportURL   https://github.com/SuperMaxine/ldxp-hide-out-of-stock/issues
// @updateURL    https://raw.githubusercontent.com/SuperMaxine/ldxp-hide-out-of-stock/main/ldxp-hide-out-of-stock.user.js
// @downloadURL  https://raw.githubusercontent.com/SuperMaxine/ldxp-hide-out-of-stock/main/ldxp-hide-out-of-stock.user.js
// @match        https://pay.ldxp.cn/shop/*
// @run-at       document-start
// @grant        none
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

  const state = {
    hideOutOfStock: true,
    sortOrder: 'default',
  };

  const originalOrders = new WeakMap();
  let nextOriginalOrder = 0;
  let controls;

  let layoutTimer;
  let settleTimer;

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
        width: 272px;
        box-sizing: border-box;
        padding: 12px;
        color: #f7f7f8;
        font: 12px/1.4 "JetBrains Mono", "IBM Plex Mono", Consolas, monospace;
        font-variant-numeric: tabular-nums;
        background: #000;
        border: 1px solid #c6ff4a;
        border-left-width: 4px;
      }

      #${CONTROLS_ID} * {
        box-sizing: border-box;
        font-family: inherit;
      }

      #${CONTROLS_ID} .ldxp-controls-title {
        margin: 0 0 10px;
        color: #f7f7f8;
        font-weight: 700;
        font-size: 13px;
      }

      #${CONTROLS_ID} .ldxp-control-row {
        display: grid;
        grid-template-columns: 88px minmax(0, 1fr);
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

      #${CONTROLS_ID} select {
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

      #${CONTROLS_ID} select:focus-visible,
      #${CONTROLS_ID} input:focus-visible {
        outline: 2px solid #c6ff4a;
        outline-offset: 2px;
      }

      #${CONTROLS_ID} .ldxp-controls-status {
        margin-top: 9px;
        padding-top: 8px;
        color: #c6ff4a;
        border-top: 1px solid #c6ff4a;
      }

      @media (max-width: 560px) {
        #${CONTROLS_ID} {
          right: 12px;
          bottom: 12px;
          width: min(272px, calc(100vw - 24px));
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

  function ensureControls() {
    if (controls || !document.body) return;

    const panel = document.createElement('section');
    panel.id = CONTROLS_ID;
    panel.setAttribute('aria-label', '商品显示设置');
    panel.innerHTML = `
      <h2 class="ldxp-controls-title">商品显示</h2>
      <div class="ldxp-control-row">
        <span class="ldxp-control-label">库存筛选</span>
        <label class="ldxp-checkbox-label">
          <input class="ldxp-hide-checkbox" type="checkbox" checked>
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
      <div class="ldxp-controls-status" aria-live="polite"></div>
    `;

    document.body.appendChild(panel);

    controls = {
      checkbox: panel.querySelector('.ldxp-hide-checkbox'),
      sortSelect: panel.querySelector('.ldxp-sort-select'),
      status: panel.querySelector('.ldxp-controls-status'),
    };

    controls.checkbox.addEventListener('change', () => {
      state.hideOutOfStock = controls.checkbox.checked;
      document.documentElement.setAttribute(
        ROOT_STATE_ATTRIBUTE,
        String(state.hideOutOfStock),
      );
      processProducts();
    });

    controls.sortSelect.addEventListener('change', () => {
      state.sortOrder = controls.sortSelect.value;
      processProducts();
    });
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
    let columnWidth = 0;

    for (const card of orderedCards) {
      const computed = getComputedStyle(card);
      const measuredWidth =
        card.getBoundingClientRect().width || toPixels(computed.width);
      const outerWidth =
        measuredWidth +
        toPixels(computed.marginLeft) +
        toPixels(computed.marginRight);

      columnWidth = Math.max(columnWidth, outerWidth);

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

    if (columnWidth <= 0) {
      columnWidth = container.clientWidth || 1;
    }

    const columnCount = Math.max(
      1,
      Math.floor((container.clientWidth + 0.5) / columnWidth),
    );
    const columnHeights = new Array(columnCount).fill(0);

    for (const card of availableCards) {
      let column = 0;
      for (let index = 1; index < columnHeights.length; index += 1) {
        if (columnHeights[index] < columnHeights[column]) column = index;
      }

      const computed = getComputedStyle(card);
      const outerHeight =
        card.getBoundingClientRect().height +
        toPixels(computed.marginTop) +
        toPixels(computed.marginBottom);

      card.style.left = `${column * columnWidth}px`;
      card.style.top = `${columnHeights[column]}px`;
      columnHeights[column] += outerHeight;
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

    if (!controls) return;

    controls.checkbox.checked = state.hideOutOfStock;
    controls.sortSelect.value = state.sortOrder;

    const statusText = state.hideOutOfStock
      ? `已隐藏 ${outOfStock} / ${total}`
      : `显示全部 ${total}`;
    if (controls.status.textContent !== statusText) {
      controls.status.textContent = statusText;
    }
  }

  function scheduleLayout() {
    clearTimeout(layoutTimer);
    clearTimeout(settleTimer);

    // 先等待 Vue 完成本轮渲染，再覆盖网站 Masonry 写入的绝对坐标。
    layoutTimer = setTimeout(() => {
      requestAnimationFrame(() => requestAnimationFrame(processProducts));
    }, 50);

    // 图片加载、加载更多等操作可能稍后再次触发原布局，做一次最终校正。
    settleTimer = setTimeout(processProducts, 450);
  }

  function start() {
    document.documentElement.setAttribute(
      ROOT_STATE_ATTRIBUTE,
      String(state.hideOutOfStock),
    );
    installStyle();

    const observer = new MutationObserver(scheduleLayout);
    observer.observe(document.documentElement, {
      childList: true,
      characterData: true,
      subtree: true,
    });

    window.addEventListener('resize', scheduleLayout, { passive: true });
    window.addEventListener('load', scheduleLayout, true);
    scheduleLayout();
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
