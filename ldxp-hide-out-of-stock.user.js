// ==UserScript==
// @name         链动小铺 - 自动隐藏缺货商品
// @namespace    https://pay.ldxp.cn/
// @version      1.1.0
// @description  在链动小铺中隐藏缺货商品，并兼容瀑布流与纵向列表布局。
// @author       Codex
// @match        https://pay.ldxp.cn/shop/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const MASONRY_CARD_SELECTOR = '.goods_item';
  const LIST_CARD_SELECTOR = '.goods-item';
  const CONTAINER_SELECTOR = '[item-selector=".goods_item"]';
  const HIDDEN_ATTRIBUTE = 'data-ldxp-oos-hidden';
  const HIDDEN_STYLE_ID = 'ldxp-hide-out-of-stock-style';

  let layoutTimer;
  let settleTimer;

  function installStyle() {
    if (document.getElementById(HIDDEN_STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = HIDDEN_STYLE_ID;
    style.textContent = `
      ${MASONRY_CARD_SELECTOR}:has(.stock.rank0),
      ${LIST_CARD_SELECTOR}:has(.stock.rank0) {
        visibility: hidden !important;
      }

      ${MASONRY_CARD_SELECTOR}[${HIDDEN_ATTRIBUTE}="true"],
      ${LIST_CARD_SELECTOR}[${HIDDEN_ATTRIBUTE}="true"] {
        display: none !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
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

  function hideOutOfStockListCards() {
    const cards = document.querySelectorAll(
      `.goods-list > ${LIST_CARD_SELECTOR}`,
    );

    for (const card of cards) {
      if (isOutOfStock(card)) {
        card.setAttribute(HIDDEN_ATTRIBUTE, 'true');
        card.style.setProperty('display', 'none', 'important');
        continue;
      }

      if (card.hasAttribute(HIDDEN_ATTRIBUTE)) {
        card.removeAttribute(HIDDEN_ATTRIBUTE);
        card.style.removeProperty('display');
      }
    }
  }

  function layoutAvailableCards() {
    const container = document.querySelector(CONTAINER_SELECTOR);
    if (!container) return;

    const cards = Array.from(container.children).filter((element) =>
      element.matches(MASONRY_CARD_SELECTOR),
    );
    if (cards.length === 0) return;

    const availableCards = [];
    let columnWidth = 0;

    for (const card of cards) {
      const computed = getComputedStyle(card);
      const measuredWidth =
        card.getBoundingClientRect().width || toPixels(computed.width);
      const outerWidth =
        measuredWidth +
        toPixels(computed.marginLeft) +
        toPixels(computed.marginRight);

      columnWidth = Math.max(columnWidth, outerWidth);

      if (isOutOfStock(card)) {
        card.setAttribute(HIDDEN_ATTRIBUTE, 'true');
        card.style.setProperty('display', 'none', 'important');
        continue;
      }

      if (card.hasAttribute(HIDDEN_ATTRIBUTE)) {
        card.removeAttribute(HIDDEN_ATTRIBUTE);
        card.style.removeProperty('display');
      }

      // 清掉网站 Masonry 留下的位移动画，后面直接写入新的坐标。
      card.style.setProperty('transform', 'none', 'important');
      card.style.setProperty('transition', 'none', 'important');
      availableCards.push(card);
    }

    if (availableCards.length === 0) {
      container.style.height = '0px';
      return;
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
  }

  function processProducts() {
    hideOutOfStockListCards();
    layoutAvailableCards();
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
