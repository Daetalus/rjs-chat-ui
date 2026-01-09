/*jslint nomen: true, indent: 2, maxerr: 3 */
/*global window, document, rJS, RSVP */

(function (window, document, rJS, RSVP) {
  "use strict";

  var SIDEBAR_COOKIE_NAME = "sidebar_state",
    SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7,
    KEYBOARD_SHORTCUT = "b",
    THEME_STORAGE_KEY = "rag-ui-theme";

  ////////////////////////////////////////////////////////////////////////////
  // Helpers
  ////////////////////////////////////////////////////////////////////////////

  function readSidebarCookie() {
    var name = SIDEBAR_COOKIE_NAME + "=",
      decoded = document.cookie || "",
      parts = decoded.split(";"),
      i,
      c;

    for (i = 0; i < parts.length; i += 1) {
      c = parts[i].trim();
      if (c.indexOf(name) === 0) {
        return c.substring(name.length, c.length);
      }
    }
    return null;
  }

  function writeSidebarCookie(value) {
    document.cookie =
      SIDEBAR_COOKIE_NAME +
      "=" +
      value +
      "; path=/; max-age=" +
      String(SIDEBAR_COOKIE_MAX_AGE);
  }

  function isMobileWidth() {
    return window.innerWidth <= 1024;
  }

  function safeStorageGet(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (error) {
      return null;
    }
  }

  function safeStorageSet(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (error) {
      return;
    }
  }

  function applyThemePreference(gadget) {
    var root = document.documentElement;
    if (!root) {
      return;
    }
    if (gadget.is_dark_mode) {
      root.classList.add("dark");
      safeStorageSet(THEME_STORAGE_KEY, "dark");
    } else {
      root.classList.remove("dark");
      safeStorageSet(THEME_STORAGE_KEY, "light");
    }
  }

  function updateThemeSwitch(gadget) {
    var toggle = gadget.element.querySelector('[data-role="theme-switch"]');
    if (!toggle) {
      return;
    }
    if (gadget.is_dark_mode) {
      toggle.setAttribute("data-checked", "true");
      toggle.setAttribute("aria-checked", "true");
    } else {
      toggle.setAttribute("data-checked", "false");
      toggle.setAttribute("aria-checked", "false");
    }
  }

  function initializeTheme(gadget) {
    var stored = safeStorageGet(THEME_STORAGE_KEY),
      prefers_dark;

    if (stored === "dark") {
      gadget.is_dark_mode = true;
    } else if (stored === "light") {
      gadget.is_dark_mode = false;
    } else {
      prefers_dark =
        window.matchMedia &&
        window.matchMedia("(prefers-color-scheme: dark)").matches;
      gadget.is_dark_mode = prefers_dark || false;
    }
    applyThemePreference(gadget);
    updateThemeSwitch(gadget);
  }

  function notifyThemeChange(gadget) {
    if (gadget.theme_change_handler) {
      gadget.theme_change_handler(gadget.is_dark_mode);
    }
  }

  function findSessionById(gadget, id) {
    var i;
    for (i = 0; i < gadget.sessions.length; i += 1) {
      if (gadget.sessions[i].id === id) {
        return gadget.sessions[i];
      }
    }
    return null;
  }

  function setError(gadget, message) {
    gadget.sessions_error = message || "";
    renderSessions(gadget);
  }

  ////////////////////////////////////////////////////////////////////////////
  // Rendering
  ////////////////////////////////////////////////////////////////////////////

  function refreshStateBlocks(gadget, options) {
    var error_el = gadget.element.querySelector('[data-role="sessions-error"]'),
      empty_el = gadget.element.querySelector('[data-role="sessions-empty"]'),
      skeleton_el = gadget.element.querySelector(
        '[data-role="sessions-loading"]'
      );

    if (error_el) {
      if (gadget.sessions_error) {
        error_el.setAttribute("data-visible", "true");
        error_el.textContent = gadget.sessions_error;
      } else {
        error_el.setAttribute("data-visible", "false");
        error_el.textContent = "";
      }
    }

    if (skeleton_el) {
      if (gadget.is_loading_sessions) {
        skeleton_el.setAttribute("data-active", "true");
      } else {
        skeleton_el.setAttribute("data-active", "false");
      }
    }

    if (empty_el) {
      if (options && options.showEmpty) {
        empty_el.setAttribute("data-visible", "true");
      } else {
        empty_el.setAttribute("data-visible", "false");
      }
    }
  }

  function renderSessions(gadget) {
    var list = gadget.element.querySelector('[data-role="session-list"]'),
      show_empty,
      i,
      session,
      item,
      button,
      title,
      actions,
      more_btn,
      menu,
      rename_btn,
      delete_btn;

    if (!list) {
      return;
    }

    if (gadget.sessions_error) {
      refreshStateBlocks(gadget, { showEmpty: false });
      list.setAttribute("data-hidden", "true");
      list.textContent = "";
      return;
    }

    if (gadget.is_loading_sessions) {
      refreshStateBlocks(gadget, { showEmpty: false });
      list.setAttribute("data-hidden", "true");
      list.textContent = "";
      return;
    }

    show_empty = gadget.sessions.length === 0;
    refreshStateBlocks(gadget, { showEmpty: show_empty });

    if (show_empty) {
      list.setAttribute("data-hidden", "true");
      list.textContent = "";
      return;
    }

    list.removeAttribute("data-hidden");
    list.textContent = "";

    for (i = 0; i < gadget.sessions.length; i += 1) {
      session = gadget.sessions[i];

      item = document.createElement("div");
      item.className = "sidebar-session-item";

      button = document.createElement("button");
      button.type = "button";
      button.className = "sidebar-session-button";
      button.setAttribute("data-action", "session-activate");
      button.setAttribute("data-session-id", session.id);
      button.setAttribute(
        "data-active",
        gadget.active_session_id === session.id ? "true" : "false"
      );

      title = document.createElement("span");
      title.className = "sidebar-session-title";
      title.textContent = session.title || "Untitled chat";
      button.appendChild(title);

      actions = document.createElement("div");
      actions.className = "sidebar-session-actions";

      more_btn = document.createElement("button");
      more_btn.type = "button";
      more_btn.className = "sidebar-session-more-btn";
      more_btn.setAttribute("data-action", "session-more");
      more_btn.setAttribute("data-session-id", session.id);
      more_btn.innerHTML = "⋮";
      actions.appendChild(more_btn);

      menu = document.createElement("div");
      menu.className = "sidebar-session-menu";
      menu.setAttribute("data-session-id", session.id);
      if (gadget.open_menu_session_id === session.id) {
        menu.setAttribute("data-open", "true");
      } else {
        menu.setAttribute("data-open", "false");
      }

      rename_btn = document.createElement("button");
      rename_btn.type = "button";
      rename_btn.textContent = "Rename";
      rename_btn.setAttribute("data-action", "session-menu-rename");
      rename_btn.setAttribute("data-session-id", session.id);
      menu.appendChild(rename_btn);

      delete_btn = document.createElement("button");
      delete_btn.type = "button";
      delete_btn.textContent = "Delete";
      delete_btn.setAttribute("data-variant", "danger");
      delete_btn.setAttribute("data-action", "session-menu-delete");
      delete_btn.setAttribute("data-session-id", session.id);
      menu.appendChild(delete_btn);

      actions.appendChild(menu);

      item.appendChild(button);
      item.appendChild(actions);
      list.appendChild(item);
    }
  }

  ////////////////////////////////////////////////////////////////////////////
  // Sidebar state helpers
  ////////////////////////////////////////////////////////////////////////////

  function applyState(gadget) {
    var root = gadget.element.querySelector('[data-role="sidebar-root"]');
    if (!root) {
      return;
    }

    if (gadget.state === "expanded") {
      root.setAttribute("data-state", "expanded");
    } else {
      root.setAttribute("data-state", "collapsed");
    }

    if (gadget.is_mobile) {
      root.classList.add("sidebar-root--mobile");
    } else {
      root.classList.remove("sidebar-root--mobile");
    }

    if (gadget.mobile_open) {
      root.classList.add("sidebar-root--mobile-open");
    } else {
      root.classList.remove("sidebar-root--mobile-open");
    }
  }

  function toggleSidebar(gadget) {
    if (gadget.is_mobile) {
      gadget.mobile_open = !gadget.mobile_open;
      applyState(gadget);
      return;
    }

    if (gadget.state === "expanded") {
      gadget.state = "collapsed";
    } else {
      gadget.state = "expanded";
    }
    writeSidebarCookie(gadget.state);
    applyState(gadget);
  }

  function notifySessionChange(gadget) {
    if (gadget.session_change_handler && gadget.active_session_id) {
      gadget.session_change_handler(gadget.active_session_id);
    }
  }

  ////////////////////////////////////////////////////////////////////////////
  // Gadget definition
  ////////////////////////////////////////////////////////////////////////////

  rJS(window)
    .ready(function (gadget) {
      var stored = readSidebarCookie(),
        root;

      gadget.state = stored === "collapsed" ? "collapsed" : "expanded";
      gadget.is_mobile = isMobileWidth();
      gadget.mobile_open = false;

      gadget.sessions = [];
      gadget.active_session_id = null;

      gadget.open_menu_session_id = null;
      gadget.session_change_handler = null;
      gadget.session_create_handler = null;
      gadget.theme_change_handler = null;
      gadget.logout_handler = null;
      gadget.session_rename_handler = null;
      gadget.session_delete_handler = null;

      gadget.sessions_error = "";
      gadget.is_loading_sessions = false;
      gadget.is_dark_mode = false;

      initializeTheme(gadget);
      applyState(gadget);
      renderSessions(gadget);
      notifySessionChange(gadget);

      root = gadget.element.querySelector('[data-role="sidebar-root"]');
      if (root) {
        gadget.root_click_listener = rJS.loopEventListener(
          root,
          "click",
          false,
          function (event) {
            var target = event.target;
            if (!target.closest) {
              return;
            }
            if (
              gadget.open_menu_session_id &&
              !target.closest(".sidebar-session-menu") &&
              !target.closest(".sidebar-session-more-btn")
            ) {
              gadget.open_menu_session_id = null;
              renderSessions(gadget);
            }
          },
          false
        );
      }

      gadget.resize_listener = rJS.loopEventListener(
        window,
        "resize",
        false,
        function () {
          gadget.is_mobile = isMobileWidth();
          if (!gadget.is_mobile) {
            gadget.mobile_open = false;
          }
          applyState(gadget);
        },
        false
      );

      gadget.keydown_listener = rJS.loopEventListener(
        window,
        "keydown",
        false,
        function (event) {
          if (
            (event.metaKey || event.ctrlKey) &&
            event.key.toLowerCase() === KEYBOARD_SHORTCUT
          ) {
            event.preventDefault();
            toggleSidebar(gadget);
          }
        },
        false
      );
    })

    .declareMethod("setSessionChangeHandler", function (handler) {
      this.session_change_handler = handler;
      notifySessionChange(this);
    })

    .declareMethod("setSessionCreateHandler", function (handler) {
      this.session_create_handler = handler;
    })

    .declareMethod("setSessionRenameHandler", function (handler) {
      this.session_rename_handler = handler;
    })

    .declareMethod("setSessionDeleteHandler", function (handler) {
      this.session_delete_handler = handler;
    })

    .declareMethod("setThemeChangeHandler", function (handler) {
      this.theme_change_handler = handler;
      notifyThemeChange(this);
    })

    .declareMethod("getActiveSessionId", function () {
      return this.active_session_id;
    })

    .declareMethod("updateSessionTitle", function (session_id, new_title) {
      var gadget = this,
        i;

      if (!session_id || !new_title) {
        return;
      }
      new_title = String(new_title).trim();
      if (!new_title) {
        return;
      }

      for (i = 0; i < gadget.sessions.length; i += 1) {
        if (gadget.sessions[i].id === session_id) {
          gadget.sessions[i].title = new_title;
          break;
        }
      }
      renderSessions(gadget);
    })

    .declareMethod("setSessions", function (session_list) {
      var gadget = this;
      if (!session_list || !session_list.length) {
        gadget.sessions = [];
      } else {
        gadget.sessions = session_list.slice(0);
      }
      renderSessions(gadget);
    })

    .declareMethod("setSessionsLoading", function (flag) {
      this.is_loading_sessions = Boolean(flag);
      renderSessions(this);
    })

    .declareMethod("setSessionsError", function (message) {
      setError(this, message);
    })

    .declareMethod("setLogoutHandler", function (handler) {
      this.logout_handler = handler;
    })

    .declareMethod("setActiveSession", function (session_id) {
      this.active_session_id = session_id || null;
      this.open_menu_session_id = null;
      renderSessions(this);
      notifySessionChange(this);
    })

    .declareMethod("toggleSidebar", function () {
      toggleSidebar(this);
    })

    .onEvent(
      "click",
      function (evt) {
        var gadget = this,
          target = evt.target,
          action,
          session_id,
          session,
          new_title,
          i;

        if (target.closest) {
          target = target.closest("[data-action]");
        } else {
          target = null;
        }

        if (!target) {
          return;
        }

        action = target.getAttribute("data-action");

        if (action === "sidebar-toggle") {
          evt.preventDefault();
          toggleSidebar(gadget);
          return;
        }

        if (action === "sidebar-backdrop") {
          evt.preventDefault();
          if (gadget.is_mobile && gadget.mobile_open) {
            gadget.mobile_open = false;
            applyState(gadget);
          }
          return;
        }

        if (action === "new-chat") {
          evt.preventDefault();
          gadget.open_menu_session_id = null;
          if (gadget.session_create_handler) {
            gadget.session_create_handler();
          }
          return;
        }

        if (action === "toggle-theme") {
          evt.preventDefault();
          gadget.is_dark_mode = !gadget.is_dark_mode;
          applyThemePreference(gadget);
          updateThemeSwitch(gadget);
          notifyThemeChange(gadget);
          return;
        }

        if (action === "sign-out") {
          evt.preventDefault();
          if (gadget.logout_handler) {
            gadget.logout_handler();
          } else {
            window.dispatchEvent(new CustomEvent("sidebar:signout"));
          }
          return;
        }

        session_id = target.getAttribute("data-session-id");
        if (!session_id) {
          return;
        }
        session = findSessionById(gadget, session_id);

        if (action === "session-activate") {
          evt.preventDefault();
          gadget.active_session_id = session_id;
          gadget.open_menu_session_id = null;
          renderSessions(gadget);
          notifySessionChange(gadget);
          return;
        }

        if (action === "session-more") {
          evt.preventDefault();
          if (gadget.open_menu_session_id === session_id) {
            gadget.open_menu_session_id = null;
          } else {
            gadget.open_menu_session_id = session_id;
          }
          renderSessions(gadget);
          return;
        }

        if (action === "session-menu-rename") {
          evt.preventDefault();
          if (!session) {
            return;
          }
          new_title = window.prompt("Rename chat", session.title || "");
          gadget.open_menu_session_id = null;
          if (new_title) {
            new_title = new_title.trim();
            if (new_title) {
              session.title = new_title;
            }
            renderSessions(gadget);
            if (new_title && gadget.session_rename_handler) {
              RSVP.resolve(
                gadget.session_rename_handler(session_id, new_title)
              ).then(null, function (error) {
                window.alert(
                  (error && error.message) || "Unable to rename session."
                );
              });
            }
          } else {
            renderSessions(gadget);
          }
          return;
        }

        if (action === "session-menu-delete") {
          evt.preventDefault();
          gadget.open_menu_session_id = null;
          if (!window.confirm("Delete this chat?")) {
            renderSessions(gadget);
            return;
          }
          if (gadget.session_delete_handler) {
            RSVP.resolve(gadget.session_delete_handler(session_id)).then(
              null,
              function (error) {
                window.alert(
                  (error && error.message) || "Unable to delete session."
                );
              }
            );
          }
          renderSessions(gadget);
          return;
        }
      },
      false,
      true
    );
}(window, document, rJS, RSVP));
