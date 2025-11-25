/*jslint nomen: true, indent: 2, maxerr: 3 */
/*global window, document, rJS, RSVP */

(function (window, document, rJS, RSVP) {
  "use strict";

  var SIDEBAR_COOKIE_NAME = "sidebar_state",
    SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7, // 7 days
    KEYBOARD_SHORTCUT = "b";

  ////////////////////////////////////////////////////////////////////////////
  // Cookie helpers
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
    return window.innerWidth <= 768;
  }

  ////////////////////////////////////////////////////////////////////////////
  // Session helpers
  ////////////////////////////////////////////////////////////////////////////

  function findSessionById(gadget, id) {
    var i;
    for (i = 0; i < gadget.sessions.length; i += 1) {
      if (gadget.sessions[i].id === id) {
        return gadget.sessions[i];
      }
    }
    return null;
  }

  function renderSessions(gadget) {
    var list = gadget.element.querySelector('[data-role="session-list"]'),
      i,
      session,
      item,
      main_button,
      main_content,
      title,
      more_btn,
      menu,
      rename_btn,
      delete_btn;

    if (!list) {
      return;
    }

    list.textContent = "";

    for (i = 0; i < gadget.sessions.length; i += 1) {
      session = gadget.sessions[i];

      item = document.createElement("div");
      item.className = "sidebar-session-item";
      if (gadget.open_menu_session_id === session.id) {
        item.className += " sidebar-session-item--menu-open";
      }

      // Full row button: title + three dots
      main_button = document.createElement("button");
      main_button.type = "button";
      main_button.className = "sidebar-session-button";
      main_button.setAttribute("data-session-id", session.id);
      main_button.setAttribute("data-action", "session-activate");

      if (gadget.active_session_id === session.id) {
        main_button.setAttribute("data-active", "true");
      } else {
        main_button.setAttribute("data-active", "false");
      }

      // Left title
      main_content = document.createElement("div");
      main_content.className = "sidebar-session-main";

      title = document.createElement("span");
      title.className = "sidebar-session-title";
      title.textContent = session.title || "Untitled";
      main_content.appendChild(title);

      main_button.appendChild(main_content);

      // Right three dots button
      more_btn = document.createElement("button");
      more_btn.type = "button";
      more_btn.className = "sidebar-session-more-btn";
      more_btn.setAttribute("data-action", "session-more");
      more_btn.setAttribute("data-session-id", session.id);
      more_btn.textContent = "⋯";
      main_button.appendChild(more_btn);

      item.appendChild(main_button);

      // Inline menu: Rename + Delete
      menu = document.createElement("div");
      menu.className = "sidebar-session-menu";

      rename_btn = document.createElement("button");
      rename_btn.type = "button";
      rename_btn.className = "sidebar-session-menu-item";
      rename_btn.setAttribute("data-action", "session-menu-rename");
      rename_btn.setAttribute("data-session-id", session.id);
      rename_btn.textContent = "Rename";
      menu.appendChild(rename_btn);

      delete_btn = document.createElement("button");
      delete_btn.type = "button";
      delete_btn.className = "sidebar-session-menu-item";
      delete_btn.setAttribute("data-action", "session-menu-delete");
      delete_btn.setAttribute("data-session-id", session.id);
      delete_btn.textContent = "Delete";
      menu.appendChild(delete_btn);

      item.appendChild(menu);

      list.appendChild(item);
    }
  }

  ////////////////////////////////////////////////////////////////////////////
  // Sidebar state helpers
  ////////////////////////////////////////////////////////////////////////////

  function applyState(gadget) {
    var root = gadget.element.querySelector('[data-role="sidebar-root"]'),
      list,
      area;

    if (!root) {
      return;
    }

    if (gadget.state === "expanded") {
      root.setAttribute("data-state", "expanded");
      root.classList.remove("sidebar-root--collapsed");
    } else {
      root.setAttribute("data-state", "collapsed");
      root.classList.add("sidebar-root--collapsed");
    }

    // Hide session list when collapsed
    list = gadget.element.querySelector(".sidebar-session-list");
    if (list) {
      if (gadget.state === "collapsed") {
        list.style.display = "none";
      } else {
        list.style.display = "";
      }
    }

    // New Chat area alignment
    area = gadget.element.querySelector(".sidebar-session-area");
    if (area) {
      if (gadget.state === "collapsed") {
        area.style.alignItems = "center";
      } else {
        area.style.alignItems = "";
      }
    }

    // Mobile drawer
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

  ////////////////////////////////////////////////////////////////////////////
  // Notify Root of current active session
  ////////////////////////////////////////////////////////////////////////////

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
      var stored = readSidebarCookie();

      gadget.state = stored === "collapsed" ? "collapsed" : "expanded";
      gadget.is_mobile = isMobileWidth();
      gadget.mobile_open = false;

      // Initially there is only one session
      gadget.sessions = [
        {
          id: "session-1",
          title: "Chat 1",
          badge: ""
        }
      ];
      gadget.session_seq = 1;
      gadget.active_session_id = "session-1";
      gadget.open_menu_session_id = null;
      gadget.session_change_handler = null;

      applyState(gadget);
      renderSessions(gadget);

      // First time tell Root about the active session
      notifySessionChange(gadget);

      window.addEventListener("resize", function () {
        gadget.is_mobile = isMobileWidth();
        if (!gadget.is_mobile) {
          gadget.mobile_open = false;
          applyState(gadget);
        }
      });

      window.addEventListener("keydown", function (event) {
        if (
          (event.metaKey || event.ctrlKey) &&
          event.key.toLowerCase() === KEYBOARD_SHORTCUT
        ) {
          event.preventDefault();
          toggleSidebar(gadget);
        }
      });
    })

    // Root injects callback
    .declareMethod("setSessionChangeHandler", function (handler) {
      this.session_change_handler = handler;
      // Notify current active session immediately after setting
      notifySessionChange(this);
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

        action = target.getAttribute("data-action");
        if (!action && target.closest) {
          target = target.closest("[data-action]");
          if (target) {
            action = target.getAttribute("data-action");
          }
        }

        if (!action) {
          return;
        }

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

        // New Chat: create a new session locally
        if (action === "new-chat") {
          var new_id;
          evt.preventDefault();

          gadget.session_seq += 1;
          new_id = "session-" + gadget.session_seq;

          gadget.sessions.unshift({
            id: new_id,
            title: "New Chat",
            badge: ""
          });
          gadget.active_session_id = new_id;
          gadget.open_menu_session_id = null;

          renderSessions(gadget);
          notifySessionChange(gadget);
          return;
        }

        // The following operations all require session-id
        session_id = target.getAttribute("data-session-id");
        if (!session_id) {
          return;
        }
        session = findSessionById(gadget, session_id);

        // Activate session
        if (action === "session-activate") {
          evt.preventDefault();
          gadget.active_session_id = session_id;
          gadget.open_menu_session_id = null;
          renderSessions(gadget);
          notifySessionChange(gadget);
          return;
        }

        // Open/close three-dot menu
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

        // Rename
        if (action === "session-menu-rename") {
          evt.preventDefault();
          if (!session) {
            return;
          }
          new_title = window.prompt(
            "Rename chat",
            session.title || ""
          );
          gadget.open_menu_session_id = null;
          if (new_title) {
            session.title = new_title.trim() || session.title;
            renderSessions(gadget);
          }
          return;
        }

        // Delete
        if (action === "session-menu-delete") {
          evt.preventDefault();
          gadget.open_menu_session_id = null;

          if (!window.confirm("Delete this chat?")) {
            renderSessions(gadget);
            return;
          }

          // Remove local session
          for (i = 0; i < gadget.sessions.length; i += 1) {
            if (gadget.sessions[i].id === session_id) {
              gadget.sessions.splice(i, 1);
              break;
            }
          }

          // If deleting the current active, switch to the first one
          if (gadget.active_session_id === session_id) {
            if (gadget.sessions.length > 0) {
              gadget.active_session_id = gadget.sessions[0].id;
            } else {
              gadget.active_session_id = null;
            }
          }

          renderSessions(gadget);
          notifySessionChange(gadget);
        }
      },
      false,
      true
    );

}(window, document, rJS, RSVP));
