/*global window, rJS, RSVP */

(function (window, rJS, RSVP) {
  "use strict";

  var STORAGE_KEY = "rjs_session_messages";

  function loadSessionMessageDict() {
    var raw;
    try {
      raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return {};
      }
      return window.JSON.parse(raw) || {};
    } catch (ignore) {
      return {};
    }
  }

  function saveSessionMessageDict(dict) {
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        window.JSON.stringify(dict || {})
      );
    } catch (ignore) {
      // ignore storage errors
    }
  }

  function createShortTitleFromQuestion(text) {
    var t = (text || "").replace(/\s+/g, " ").trim();
    if (!t) {
      return "New Chat";
    }
    if (t.length > 40) {
      t = t.slice(0, 37) + "...";
    }
    return t;
  }

  // Each time the session switches, write the session_id to URL ?session=xxx
  function setSessionIdInURL(session_id) {
    try {
      var url = new URL(window.location.href);
      if (session_id) {
        url.searchParams.set("session", session_id);
      } else {
        url.searchParams["delete"]("session");
      }
      window.history.replaceState(null, "", url.toString());
    } catch (ignore) {
      // Skip if URL constructor is not supported
    }
  }

  function applyDocumentTheme(is_dark) {
    var root = window.document && window.document.documentElement,
      body = window.document && window.document.body;

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
      gadget.session_message_dict = {};
      gadget.active_session_id = null;
      gadget.sidebar_gadget = null;
      gadget.chat_gadget = null;
      gadget.prompt_gadget = null;

      // Record whether each session has automatically generated a title from the first question
      gadget.derived_title_map = {};
    })

    .declareService(function () {
      var gadget = this,
        sidebar_gadget,
        chat_gadget,
        prompt_gadget;

      function handleSidebarActiveChange(new_active_id) {
        var prev_id = gadget.active_session_id,
          dict = gadget.session_message_dict,
          messages;

        if (!new_active_id) {
          return;
        }

        // First save the messages from the previous session
        if (prev_id && chat_gadget && chat_gadget.getMessages) {
          try {
            messages = chat_gadget.getMessages();
            dict[prev_id] = messages;
            saveSessionMessageDict(dict);
          } catch (ignore) {
            // ignore
          }
        }

        // Switch active
        gadget.active_session_id = new_active_id;

        // Update URL
        setSessionIdInURL(new_active_id);

        // Load messages for the new session
        if (dict[new_active_id] &&
            chat_gadget && chat_gadget.setMessages) {
          chat_gadget.setMessages(dict[new_active_id]);
        } else if (chat_gadget && chat_gadget.setMessages) {
          // No saved messages: give a default welcome message
          chat_gadget.setMessages([
            {
              id: 1,
              role: "assistant",
              content: "Hello! This is a RenderJS-based chat demo."
            }
          ]);
        }
      }

      function handlePromptSubmit(text) {
        var trimmed,
          session_id = gadget.active_session_id,
          dict = gadget.session_message_dict,
          title;

        if (typeof text !== "string") {
          return;
        }
        trimmed = text.replace(/\s+$/, "");
        if (!trimmed) {
          return;
        }
        if (!session_id) {
          return;
        }

        // When the user inputs for the first time, automatically generate a title for the current session (only once)
        if (!gadget.derived_title_map[session_id]) {
          title = createShortTitleFromQuestion(trimmed);
          if (gadget.sidebar_gadget &&
              gadget.sidebar_gadget.updateSessionTitle) {
            gadget.sidebar_gadget.updateSessionTitle(session_id, title);
          }
          gadget.derived_title_map[session_id] = true;
        }

        // Call Chat gadget to handle user message + placeholder streaming
        if (chat_gadget && chat_gadget.handleUserSubmit) {
          chat_gadget.handleUserSubmit(trimmed);
        }

        // Immediately save the current session messages after sending
        if (chat_gadget && chat_gadget.getMessages) {
          try {
            dict[session_id] = chat_gadget.getMessages();
            saveSessionMessageDict(dict);
          } catch (ignore2) {
            // ignore
          }
        }
      }

      // 1. First get the three sub gadgets: sidebar / chat / prompt
      function handleThemeChange(is_dark) {
        applyDocumentTheme(is_dark);
        if (gadget.chat_gadget && gadget.chat_gadget.setTheme) {
          gadget.chat_gadget.setTheme(is_dark);
        }
        if (gadget.prompt_gadget && gadget.prompt_gadget.setTheme) {
          gadget.prompt_gadget.setTheme(is_dark);
        }
      }

      return gadget.getDeclaredGadget("sidebar")
        .push(function (sg) {
          sidebar_gadget = sg;
          gadget.sidebar_gadget = sg;
          return gadget.getDeclaredGadget("chat");
        })
        .push(function (cg) {
          chat_gadget = cg;
          gadget.chat_gadget = cg;
          return gadget.getDeclaredGadget("prompt");
        })
        .push(function (pg) {
          prompt_gadget = pg;
          gadget.prompt_gadget = pg;

          // Load message mapping for all sessions from localStorage
          gadget.session_message_dict = loadSessionMessageDict();

          // Prompt → Root
          if (prompt_gadget.setSubmitHandler) {
            prompt_gadget.setSubmitHandler(handlePromptSubmit);
          }

          // Sidebar → Root: callback when active session changes
          if (sidebar_gadget.setSessionChangeHandler) {
            sidebar_gadget.setSessionChangeHandler(handleSidebarActiveChange);
          }

          if (sidebar_gadget.setThemeChangeHandler) {
            sidebar_gadget.setThemeChangeHandler(handleThemeChange);
          }

          // setSessionChangeHandler internally calls notifySessionChange once immediately,
          // thus triggering handleSidebarActiveChange to complete the initial chat content + URL initialization.
          return;
        });
    });

}(window, rJS, RSVP));
