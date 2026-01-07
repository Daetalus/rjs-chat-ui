/*global window, rJS, RSVP */

(function (window, rJS, RSVP) {
  "use strict";

  var STORAGE_KEY = "rjs_session_messages",
    DEFAULT_WELCOME_MESSAGE = "Hello! This is a RenderJS-based chat demo.";

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

  function setMainViewMode(gadget, mode) {
    var layout;
    if (!gadget || !gadget.element) {
      return;
    }
    if (gadget.current_view_mode === mode) {
      return;
    }
    layout = gadget.element.querySelector('[data-role="chat-layout"]');
    if (layout) {
      layout.setAttribute("data-mode", mode);
      gadget.current_view_mode = mode;
    }
  }

  function updateAuthState(gadget, state) {
    var normalized = state === "authenticated" ? "unlocked" : "locked",
      body = window.document && window.document.body;
    gadget.auth_state = normalized;
    if (body) {
      body.setAttribute("data-auth-state", normalized);
    }
  }

  rJS(window)
    .ready(function (gadget) {
      gadget.session_message_dict = {};
      gadget.active_session_id = null;
      gadget.sidebar_gadget = null;
      gadget.chat_gadget = null;
      gadget.prompt_gadget = null;
      gadget.auth_gadget = null;
      gadget.is_authenticated = false;

      // Record whether each session has automatically generated a title from the first question
      gadget.derived_title_map = {};
      gadget.session_started_map = {};
      gadget.new_session_map = {};
      gadget.current_view_mode = "chat";
      updateAuthState(gadget, "locked");
    })

    .declareService(function () {
      var gadget = this,
        sidebar_gadget,
        chat_gadget,
        prompt_gadget,
        auth_gadget;

      function handleSidebarActiveChange(new_active_id) {
        var prev_id = gadget.active_session_id,
          dict = gadget.session_message_dict,
          messages,
          stored,
          started_flag;

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

        stored = dict[new_active_id];
        if (gadget.session_started_map[new_active_id] === undefined) {
          if (gadget.new_session_map[new_active_id]) {
            gadget.session_started_map[new_active_id] = false;
          } else {
            gadget.session_started_map[new_active_id] = true;
          }
        }
        started_flag = gadget.session_started_map[new_active_id];

        if (started_flag) {
          if (chat_gadget && chat_gadget.setMessages) {
            if (stored && stored.length > 0) {
              chat_gadget.setMessages(stored);
            } else {
              chat_gadget.setMessages([
                {
                  id: 1,
                  role: "assistant",
                  content: DEFAULT_WELCOME_MESSAGE
                }
              ]);
            }
          }
          setMainViewMode(gadget, "chat");
        } else {
          if (chat_gadget && chat_gadget.clearMessages) {
            chat_gadget.clearMessages();
          }
          setMainViewMode(gadget, "landing");
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

        gadget.session_started_map[session_id] = true;
        delete gadget.new_session_map[session_id];
        setMainViewMode(gadget, "chat");

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

      function handleSessionCreated(new_id) {
        if (!new_id) {
          return;
        }
        gadget.new_session_map[new_id] = true;
        gadget.session_started_map[new_id] = false;
        gadget.session_message_dict[new_id] = [];
        setMainViewMode(gadget, "landing");
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

      function handleAuthSubmit(credential) {
        var username = credential && credential.username,
          password = credential && credential.password;

        return RSVP.delay(150).then(function () {
          if (username === "nexedi" && password === "1234") {
            gadget.is_authenticated = true;
            updateAuthState(gadget, "authenticated");
            return;
          }
          throw new Error("Invalid username or password.");
        });
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

          if (sidebar_gadget.setSessionCreateHandler) {
            sidebar_gadget.setSessionCreateHandler(handleSessionCreated);
          }

          if (sidebar_gadget.setThemeChangeHandler) {
            sidebar_gadget.setThemeChangeHandler(handleThemeChange);
          }

          // setSessionChangeHandler internally calls notifySessionChange once immediately,
          // thus triggering handleSidebarActiveChange to complete the initial chat content + URL initialization.
          return gadget.getDeclaredGadget("auth");
        })
        .push(function (ag) {
          auth_gadget = ag;
          gadget.auth_gadget = ag;
          if (auth_gadget.setLoginHandler) {
            auth_gadget.setLoginHandler(handleAuthSubmit);
          }
          if (auth_gadget.focus) {
            auth_gadget.focus();
          }
        });
    });

}(window, rJS, RSVP));
