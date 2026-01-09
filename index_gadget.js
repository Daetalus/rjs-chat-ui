/*global window, rJS, RSVP */

(function (window, rJS, RSVP) {
  "use strict";

  var DEFAULT_SESSION_TITLE = "New chat",
    TOKEN_STORAGE_KEY = "rag_ui_token",
    API_BASE_URL =
      window.APP_API_BASE_URL ||
      window.API_BASE_URL ||
      "http://localhost:8000";

  function normalizeBaseUrl(value) {
    var trimmed = value || "";
    if (!trimmed) {
      return "";
    }
    while (trimmed.length > 1 && trimmed.slice(-1) === "/") {
      trimmed = trimmed.slice(0, -1);
    }
    return trimmed;
  }

  function buildApiUrl(gadget, path) {
    var base = normalizeBaseUrl(gadget.api_base_url || API_BASE_URL || ""),
      normalized_path = path || "";
    if (!normalized_path) {
      normalized_path = "/";
    }
    if (normalized_path.charAt(0) !== "/") {
      normalized_path = "/" + normalized_path;
    }
    return base + normalized_path;
  }

  function getStoredToken() {
    var raw;
    try {
      raw = window.localStorage.getItem(TOKEN_STORAGE_KEY);
      return raw || null;
    } catch (ignore) {
      return null;
    }
  }

  function storeToken(token) {
    try {
      if (token) {
        window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
      } else {
        window.localStorage.removeItem(TOKEN_STORAGE_KEY);
      }
    } catch (ignore) {
      return;
    }
  }

  function getSessionIdFromURL() {
    try {
      var url = new URL(window.location.href);
      return url.searchParams.get("session");
    } catch (ignore) {
      return null;
    }
  }

  function setAuthToken(gadget, token) {
    gadget.auth_token = token || null;
    storeToken(token || null);
  }

  function toChatMessage(message, index) {
    var role = message && message.sender === "bot" ? "assistant" : "user";
    return {
      id: message && message.id ? message.id : index + 1,
      role: role,
      content: (message && message.text) || ""
    };
  }

  function mapMessagesForChat(message_list) {
    var list = Array.isArray(message_list) ? message_list : [],
      i,
      result = [];
    for (i = 0; i < list.length; i += 1) {
      result.push(toChatMessage(list[i], i));
    }
    return result;
  }

  function findSessionById(list, session_id) {
    var i;
    if (!session_id || !list || !list.length) {
      return null;
    }
    for (i = 0; i < list.length; i += 1) {
      if (list[i].id === session_id) {
        return list[i];
      }
    }
    return null;
  }

  function normalizeSessionListForSidebar(list) {
    var i,
      session,
      result = [];
    if (!list) {
      return result;
    }
    for (i = 0; i < list.length; i += 1) {
      session = list[i];
      if (session && session.id) {
        result.push({
          id: session.id,
          title: session.title || DEFAULT_SESSION_TITLE
        });
      }
    }
    return result;
  }

  function parseErrorDetail(text) {
    var parsed;
    if (!text) {
      return "Request failed.";
    }
    try {
      parsed = window.JSON.parse(text);
      if (parsed && parsed.detail) {
        if (typeof parsed.detail === "string") {
          return parsed.detail;
        }
        if (parsed.detail.message) {
          return parsed.detail.message;
        }
      }
    } catch (ignore) {
      return text;
    }
    return text;
  }

  function handleUnauthorized(gadget) {
    setAuthToken(gadget, null);
    gadget.is_authenticated = false;
    gadget.active_session_id = null;
    gadget.session_list = [];
    gadget.session_cache = {};
    gadget.session_started_map = {};
    gadget.derived_title_map = {};
    setMainViewMode(gadget, "chat");
    setSessionIdInURL(null);
    updateAuthState(gadget, "locked");
    if (gadget.sidebar_gadget && gadget.sidebar_gadget.setSessions) {
      gadget.sidebar_gadget.setSessions([]);
    }
    if (gadget.chat_gadget && gadget.chat_gadget.clearMessages) {
      gadget.chat_gadget.clearMessages();
    }
  }

  function apiFetchJSON(gadget, path, options) {
    var url = buildApiUrl(gadget, path),
      opts = options || {},
      headers = opts.headers ? Object.assign({}, opts.headers) : {},
      token = gadget.auth_token;

    if (opts.use_json !== false && opts.body && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }
    if (token) {
      headers.Authorization = "Bearer " + token;
    }

    return window
      .fetch(url, {
        method: opts.method || "GET",
        headers: headers,
        body: opts.body,
        signal: opts.signal
      })
      .then(function (response) {
        if (opts.expect_stream) {
          if (!response.ok) {
            return response.text().then(function (text) {
              if (response.status === 401) {
                handleUnauthorized(gadget);
              }
              throw new Error(parseErrorDetail(text));
            });
          }
          return response;
        }
        if (response.status === 204) {
          return null;
        }
        if (!response.ok) {
          return response.text().then(function (text) {
            var message = parseErrorDetail(text);
            if (response.status === 401) {
              handleUnauthorized(gadget);
            }
            throw new Error(message);
          });
        }
        return response
          .text()
          .then(function (text) {
            if (!text) {
              return null;
            }
            try {
              return window.JSON.parse(text);
            } catch (ignore) {
              return null;
            }
          });
      });
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
      gadget.active_session_id = null;
      gadget.sidebar_gadget = null;
      gadget.chat_gadget = null;
      gadget.prompt_gadget = null;
      gadget.auth_gadget = null;
      gadget.is_authenticated = false;
      gadget.api_base_url = API_BASE_URL;
      gadget.auth_token = getStoredToken();
      gadget.session_list = [];
      gadget.session_cache = {};
      gadget.pending_session_id = getSessionIdFromURL();
      gadget.active_stream_controller = null;
      gadget.is_streaming = false;

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

      function setPromptBusy(flag) {
        gadget.is_streaming = Boolean(flag);
        if (prompt_gadget && prompt_gadget.setBusy) {
          prompt_gadget.setBusy(flag);
        }
      }

      function abortActiveStream() {
        if (gadget.active_stream_controller) {
          try {
            gadget.active_stream_controller.abort();
          } catch (ignore) {
            // ignore abort errors
          }
        }
        gadget.active_stream_controller = null;
        setPromptBusy(false);
      }

      function handleThemeChange(is_dark) {
        applyDocumentTheme(is_dark);
        if (gadget.chat_gadget && gadget.chat_gadget.setTheme) {
          gadget.chat_gadget.setTheme(is_dark);
        }
        if (gadget.prompt_gadget && gadget.prompt_gadget.setTheme) {
          gadget.prompt_gadget.setTheme(is_dark);
        }
      }

      function syncSidebarSessions() {
        if (sidebar_gadget && sidebar_gadget.setSessions) {
          sidebar_gadget.setSessions(
            normalizeSessionListForSidebar(gadget.session_list)
          );
        }
      }

      function ensureActiveSession() {
        var target_id = gadget.active_session_id,
          from_url = gadget.pending_session_id,
          available;

        if (target_id) {
          available = findSessionById(gadget.session_list, target_id);
        }

        if (!available && from_url) {
          available = findSessionById(gadget.session_list, from_url);
          if (available) {
            target_id = from_url;
          }
          gadget.pending_session_id = null;
        }

        if (!available && gadget.session_list.length > 0) {
          target_id = gadget.session_list[0].id;
          available = gadget.session_list[0];
        }

        if (target_id && sidebar_gadget && sidebar_gadget.setActiveSession) {
          gadget.active_session_id = target_id;
          sidebar_gadget.setActiveSession(target_id);
        } else if (!target_id) {
          gadget.active_session_id = null;
          setMainViewMode(gadget, "landing");
          if (chat_gadget && chat_gadget.clearMessages) {
            chat_gadget.clearMessages();
          }
        }
      }

      function loadSessions(show_loading) {
        if (sidebar_gadget && sidebar_gadget.setSessionsError) {
          sidebar_gadget.setSessionsError("");
        }
        if (show_loading && sidebar_gadget && sidebar_gadget.setSessionsLoading) {
          sidebar_gadget.setSessionsLoading(true);
        }
        return apiFetchJSON(gadget, "/sessions", {
          method: "GET"
        }).then(
          function (session_list) {
            var list = Array.isArray(session_list)
              ? session_list.slice(0)
              : [];
            gadget.session_list = list;
            gadget.session_cache = gadget.session_cache || {};
            syncSidebarSessions();
            if (sidebar_gadget && sidebar_gadget.setSessionsLoading) {
              sidebar_gadget.setSessionsLoading(false);
            }
            ensureActiveSession();
          },
          function (error) {
            if (sidebar_gadget && sidebar_gadget.setSessionsLoading) {
              sidebar_gadget.setSessionsLoading(false);
            }
            if (sidebar_gadget && sidebar_gadget.setSessionsError) {
              sidebar_gadget.setSessionsError(
                (error && error.message) || "Unable to load sessions."
              );
            }
            throw error;
          }
        );
      }

      function applySessionMessages(session_id, messages) {
        var formatted = mapMessagesForChat(messages),
          has_messages = formatted.length > 0;

        gadget.session_started_map[session_id] = has_messages;

        if (has_messages) {
          if (chat_gadget && chat_gadget.setMessages) {
            chat_gadget.setMessages(formatted);
          }
          setMainViewMode(gadget, "chat");
        } else {
          if (chat_gadget && chat_gadget.clearMessages) {
            chat_gadget.clearMessages();
          }
          setMainViewMode(gadget, "landing");
        }
      }

      function loadSessionDetail(session_id) {
        if (!session_id) {
          return RSVP.resolve();
        }
        if (sidebar_gadget && sidebar_gadget.setSessionsError) {
          sidebar_gadget.setSessionsError("");
        }
        abortActiveStream();
        return apiFetchJSON(gadget, "/sessions/" + session_id, {
          method: "GET"
        }).then(
          function (session) {
            var detail = session || {};
            gadget.session_cache[session_id] = detail;
            applySessionMessages(session_id, detail.messages || []);
          },
          function (error) {
            if (chat_gadget && chat_gadget.clearMessages) {
              chat_gadget.clearMessages();
            }
            throw error;
          }
        );
      }

      function handleSidebarActiveChange(new_active_id) {
        if (!new_active_id) {
          return;
        }
        gadget.active_session_id = new_active_id;
        setSessionIdInURL(new_active_id);
        loadSessionDetail(new_active_id);
      }

      function streamChatResponse(session_id, user_text) {
        var accumulated = "",
          assistant_message_id = null,
          buffer = "",
          decoder = new window.TextDecoder(),
          url = "/chat/" + session_id;

        abortActiveStream();
        setPromptBusy(true);

        function finalizeStream() {
          gadget.active_stream_controller = null;
          setPromptBusy(false);
          gadget.session_cache[session_id] = null;
          return loadSessionDetail(session_id);
        }

        return apiFetchJSON(gadget, url, {
          method: "POST",
          body: window.JSON.stringify({ sender: "user", text: user_text }),
          expect_stream: true
        })
          .then(function (response) {
            var reader = response.body && response.body.getReader();
            if (!reader) {
              throw new Error("Unable to start streaming response.");
            }
            gadget.active_stream_controller = {
              abort: function () {
                reader.cancel();
              }
            };

            function ensureAssistantMessage() {
              if (!assistant_message_id && chat_gadget &&
                  chat_gadget.appendAssistantMessage) {
                assistant_message_id = chat_gadget.appendAssistantMessage("");
              }
            }

            function updateAssistantContent(content) {
              if (
                assistant_message_id &&
                chat_gadget &&
                chat_gadget.updateMessageContent
              ) {
                chat_gadget.updateMessageContent(assistant_message_id, content);
              }
            }

            function handlePayload(payload) {
              if (!payload || !payload.type) {
                return;
              }
              if (payload.type === "token") {
                ensureAssistantMessage();
                accumulated += payload.data || "";
                updateAssistantContent(accumulated);
              } else if (payload.type === "final") {
                ensureAssistantMessage();
                if (payload.data && payload.data.answer) {
                  accumulated = payload.data.answer;
                }
                updateAssistantContent(accumulated);
              } else if (payload.type === "error") {
                ensureAssistantMessage();
                accumulated =
                  accumulated || "Sorry, I could not fetch a response.";
                updateAssistantContent(accumulated);
              }
            }

            function processBuffer() {
              var parts = buffer.split("\n\n"),
                i,
                chunk,
                lines,
                data_lines,
                j,
                line,
                json_text;
              if (parts.length === 1) {
                return;
              }
              for (i = 0; i < parts.length - 1; i += 1) {
                chunk = parts[i].trim();
                if (!chunk) {
                  continue;
                }
                lines = chunk.split("\n");
                data_lines = [];
                for (j = 0; j < lines.length; j += 1) {
                  line = lines[j];
                  if (line.indexOf("data:") === 0) {
                    data_lines.push(line.slice(5).trim());
                  }
                }
                if (data_lines.length === 0) {
                  continue;
                }
                json_text = data_lines.join("\n");
                try {
                  handlePayload(window.JSON.parse(json_text));
                } catch (ignore) {
                  continue;
                }
              }
              buffer = parts[parts.length - 1];
            }

            function read() {
              return reader.read().then(function (result) {
                if (result.done) {
                  processBuffer();
                  return;
                }
                buffer += decoder.decode(result.value, { stream: true });
                processBuffer();
                return read();
              });
            }

            return read();
          })
          .then(function () {
            return finalizeStream();
          })
          .catch(function (error) {
            var fallback_message =
              "Sorry, I couldn't finish that request. Please try again.";
            if (!assistant_message_id && chat_gadget &&
                chat_gadget.appendAssistantMessage) {
              assistant_message_id =
                chat_gadget.appendAssistantMessage(fallback_message);
            } else if (assistant_message_id) {
              updateAssistantContent(
                accumulated || fallback_message
              );
            }
            return finalizeStream()
              .catch(function () {
                return;
              })
              .then(function () {
                if (window.console && window.console.error) {
                  window.console.error(error);
                }
              });
          });
      }

      function handlePromptSubmit(text) {
        var session_id = gadget.active_session_id,
          trimmed = typeof text === "string" ? text.replace(/\s+$/, "") : "",
          title;

        if (!trimmed || !session_id || gadget.is_streaming) {
          return;
        }

        if (!gadget.derived_title_map[session_id]) {
          title = createShortTitleFromQuestion(trimmed);
          gadget.derived_title_map[session_id] = true;
          handleSessionRenameRequest(session_id, title);
        }

        if (chat_gadget && chat_gadget.handleUserSubmit) {
          chat_gadget
            .handleUserSubmit(trimmed)
            .then(function () {
              gadget.session_started_map[session_id] = true;
              setMainViewMode(gadget, "chat");
              return streamChatResponse(session_id, trimmed);
            });
        }
      }

      function handleSessionCreateRequest() {
        if (!gadget.is_authenticated) {
          return;
        }
        if (sidebar_gadget && sidebar_gadget.setSessionsLoading) {
          sidebar_gadget.setSessionsLoading(true);
        }
        apiFetchJSON(gadget, "/sessions", {
          method: "POST",
          body: window.JSON.stringify({ title: DEFAULT_SESSION_TITLE })
        }).then(
          function (session) {
            var list = gadget.session_list.slice(0);
            list.unshift(session);
            gadget.session_list = list;
            gadget.session_started_map[session.id] = false;
            syncSidebarSessions();
            if (
              sidebar_gadget &&
              sidebar_gadget.setSessionsLoading
            ) {
              sidebar_gadget.setSessionsLoading(false);
            }
            if (sidebar_gadget && sidebar_gadget.setActiveSession) {
              sidebar_gadget.setActiveSession(session.id);
            } else {
              gadget.active_session_id = session.id;
              handleSidebarActiveChange(session.id);
            }
            setMainViewMode(gadget, "landing");
          },
          function (error) {
            if (
              sidebar_gadget &&
              sidebar_gadget.setSessionsLoading
            ) {
              sidebar_gadget.setSessionsLoading(false);
            }
            if (sidebar_gadget && sidebar_gadget.setSessionsError) {
              sidebar_gadget.setSessionsError(
                (error && error.message) || "Unable to create session."
              );
            }
          }
        );
      }

      function handleSessionRenameRequest(session_id, new_title) {
        if (!session_id || !new_title) {
          return RSVP.resolve();
        }
        return apiFetchJSON(gadget, "/sessions/" + session_id, {
          method: "PUT",
          body: window.JSON.stringify({ title: new_title })
        }).then(function (session) {
          var sidebar_title = (session && session.title) || new_title,
            local_session = findSessionById(gadget.session_list, session_id);
          if (local_session) {
            local_session.title = sidebar_title;
          }
          if (sidebar_gadget && sidebar_gadget.updateSessionTitle) {
            sidebar_gadget.updateSessionTitle(session_id, sidebar_title);
          } else {
            syncSidebarSessions();
          }
        });
      }

      function handleSessionDeleteRequest(session_id) {
        var i;
        if (!session_id) {
          return RSVP.resolve();
        }
        return apiFetchJSON(gadget, "/sessions/" + session_id, {
          method: "DELETE"
        }).then(function () {
          for (i = 0; i < gadget.session_list.length; i += 1) {
            if (gadget.session_list[i].id === session_id) {
              gadget.session_list.splice(i, 1);
              break;
            }
          }
          delete gadget.session_cache[session_id];
          delete gadget.session_started_map[session_id];
          if (gadget.active_session_id === session_id) {
            gadget.active_session_id = null;
            setSessionIdInURL(null);
          }
          syncSidebarSessions();
          ensureActiveSession();
        });
      }

      function performLogout() {
        abortActiveStream();
        handleUnauthorized(gadget);
        if (auth_gadget && auth_gadget.focus) {
          auth_gadget.focus();
        }
      }

      function handleAuthSubmit(credential) {
        var username = credential && credential.username,
          password = credential && credential.password;

        if (!username || !password) {
          return RSVP.reject(
            new Error("Username and password are required.")
          );
        }

        return window
          .fetch(buildApiUrl(gadget, "/token"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: window.JSON.stringify({
              username: username,
              password: password
            })
          })
          .then(function (response) {
            if (!response.ok) {
              return response.text().then(function (text) {
                throw new Error(parseErrorDetail(text));
              });
            }
            return response.json();
          })
          .then(function (data) {
            if (!data || !data.access_token) {
              throw new Error("Invalid token response.");
            }
            setAuthToken(gadget, data.access_token);
            gadget.is_authenticated = true;
            updateAuthState(gadget, "authenticated");
            return loadSessions(true);
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

          if (prompt_gadget.setSubmitHandler) {
            prompt_gadget.setSubmitHandler(handlePromptSubmit);
          }

          if (sidebar_gadget.setSessionChangeHandler) {
            sidebar_gadget.setSessionChangeHandler(handleSidebarActiveChange);
          }

          if (sidebar_gadget.setSessionCreateHandler) {
            sidebar_gadget.setSessionCreateHandler(handleSessionCreateRequest);
          }

          if (sidebar_gadget.setSessionRenameHandler) {
            sidebar_gadget.setSessionRenameHandler(
              handleSessionRenameRequest
            );
          }

          if (sidebar_gadget.setSessionDeleteHandler) {
            sidebar_gadget.setSessionDeleteHandler(
              handleSessionDeleteRequest
            );
          }

          if (sidebar_gadget.setThemeChangeHandler) {
            sidebar_gadget.setThemeChangeHandler(handleThemeChange);
          }

          if (sidebar_gadget.setLogoutHandler) {
            sidebar_gadget.setLogoutHandler(performLogout);
          }

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
          if (gadget.auth_token) {
            gadget.is_authenticated = true;
            updateAuthState(gadget, "authenticated");
            return loadSessions(true).catch(function () {
              performLogout();
            });
          }
        });
    });

}(window, rJS, RSVP));
