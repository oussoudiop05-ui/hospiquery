/* ============================================================
   dom.js — aides au DOM. Aucune règle métier ici.
   Expose HQ.dom
   ============================================================ */
(function () {
  'use strict';

  window.HQ = window.HQ || {};

  /* Sélection ------------------------------------------------ */
  function qs(sel, root) { return (root || document).querySelector(sel); }
  function qsa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function byId(id) { return document.getElementById(id); }

  /* Création --------------------------------------------------
     el('div.card', {aria-label:'x'}, [enfants ou texte])
     Le sélecteur accepte tag, .classes et #id.               */
  function el(spec, attrs, children) {
    var m = String(spec).match(/^([a-zA-Z0-9-]+)?((?:[.#][^.#]+)*)$/);
    var tag = (m && m[1]) || 'div';
    var node = document.createElement(tag);

    if (m && m[2]) {
      m[2].match(/[.#][^.#]+/g).forEach(function (tok) {
        if (tok.charAt(0) === '.') node.classList.add(tok.slice(1));
        else node.id = tok.slice(1);
      });
    }

    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'text') { node.textContent = v; return; }
        if (k === 'html') { node.innerHTML = v; return; }
        if (k === 'dataset') { Object.keys(v).forEach(function (d) { node.dataset[d] = v[d]; }); return; }
        if (k === 'style') { Object.keys(v).forEach(function (p) { node.style.setProperty(p, v[p]); }); return; }
        if (v === true) { node.setAttribute(k, ''); return; }
        node.setAttribute(k, v);
      });
    }

    append(node, children);
    return node;
  }

  function append(node, children) {
    if (children === null || children === undefined) return node;
    if (!Array.isArray(children)) children = [children];
    children.forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      if (typeof c === 'string' || typeof c === 'number') node.appendChild(document.createTextNode(String(c)));
      else node.appendChild(c);
    });
    return node;
  }

  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); return node; }

  function replace(node, children) { return append(clear(node), children); }

  /* Événements ----------------------------------------------- */
  function on(node, type, handler, opts) {
    node.addEventListener(type, handler, opts);
    return function off() { node.removeEventListener(type, handler, opts); };
  }

  /* Délégation : on(root,'click','.sel',fn) */
  function delegate(root, type, sel, handler) {
    return on(root, type, function (ev) {
      var t = ev.target.closest(sel);
      if (t && root.contains(t)) handler.call(t, ev, t);
    });
  }

  /* Divers --------------------------------------------------- */
  /* Le minimum l'emporte si les bornes sont incohérentes (hi < lo),
     ce qui arrive quand une mesure de fenêtre vaut 0 au chargement. */
  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

  function fmtInt(n) {
    return Number(n).toLocaleString('fr-FR');
  }

  HQ.dom = {
    qs: qs, qsa: qsa, byId: byId,
    el: el, append: append, clear: clear, replace: replace,
    on: on, delegate: delegate,
    clamp: clamp, fmtInt: fmtInt
  };
})();
