/*jslint nomen: true, indent: 2, maxerr: 3 */
/*global window, document, rJS */

(function (window, document, rJS) {
  "use strict";

  function updateTitle(gadget) {
    var element = gadget.element,
      label = element && element.querySelector('[data-role="header-title"]'),
      text = gadget.header_title || "Rapid.Space RAG";
    if (label) {
      label.textContent = text;
    }
  }

  function applyTheme(gadget) {
    var doc = gadget.element && gadget.element.ownerDocument,
      root = doc && doc.documentElement,
      body = doc && doc.body,
      is_dark = Boolean(gadget.is_dark_mode);
    if (root) {
      if (is_dark) {
        root.classList.add("dark");
      } else {
        root.classList.remove("dark");
      }
    }
    if (body) {
      if (is_dark) {
        body.classList.add("dark");
      } else {
        body.classList.remove("dark");
      }
    }
  }

  rJS(window)
    .ready(function (gadget) {
      gadget.toggle_handler = null;
      gadget.header_title = "Rapid.Space RAG";
      gadget.is_dark_mode = false;
      updateTitle(gadget);
      applyTheme(gadget);
    })

    .declareMethod("setTitle", function (title) {
      this.header_title = title || "Rapid.Space RAG";
      updateTitle(this);
    })

    .declareMethod("setToggleHandler", function (handler) {
      this.toggle_handler = handler;
    })

    .declareMethod("setTheme", function (is_dark) {
      this.is_dark_mode = Boolean(is_dark);
      applyTheme(this);
    })

    .onEvent(
      "click",
      function (evt) {
        var target = evt.target,
          action;
        if (target && target.closest) {
          target = target.closest("[data-action]");
        } else {
          target = null;
        }
        if (!target) {
          return;
        }
        action = target.getAttribute("data-action");
        if (action === "toggle-sidebar") {
          evt.preventDefault();
          if (this.toggle_handler) {
            this.toggle_handler();
          } else {
            window.dispatchEvent(new CustomEvent("mobile-header:toggle"));
          }
        }
      },
      false,
      true
    );
}(window, document, rJS));
