/*global window, rJS, RSVP */

(function (window, rJS, RSVP) {
  "use strict";

  var DEFAULT_SESSION_TITLE = "New chat",
    TOKEN_STORAGE_KEY = "rag_ui_token",
    USERNAME_STORAGE_KEY = "rag_ui_username",
    DEFAULT_API_BASE_URL = (function () {
      var loc = window.location || {},
        protocol = loc.protocol || "http:",
        host = loc.hostname || "",
        port = loc.port || "",
        origin =
          loc.origin ||
          protocol +
            "//" +
            (loc.host || (host + (port ? ":" + port : ""))),
        local_hosts = ["localhost", "127.0.0.1", "[::1]", "0.0.0.0"],
        is_local_host = local_hosts.indexOf(host) !== -1,
        local_backend = protocol + "//localhost:8000";

      if (is_local_host) {
        if (host === "0.0.0.0") {
          return protocol + "//127.0.0.1:8001";
        }
        if (port === "8000") {
          return origin;
        }
        if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") {
          return local_backend;
        }
      }

      return origin.replace(/\/$/, "") + "/api";
    }()),
    API_BASE_URL =
      window.APP_API_BASE_URL ||
      window.API_BASE_URL ||
      DEFAULT_API_BASE_URL;

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

  function isMobileViewport() {
    return window.innerWidth <= 1024;
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

  function getStoredUsername() {
    try {
      return window.localStorage.getItem(USERNAME_STORAGE_KEY);
    } catch (ignore) {
      return null;
    }
  }

  function storeUsername(value) {
    try {
      if (value) {
        window.localStorage.setItem(USERNAME_STORAGE_KEY, value);
      } else {
        window.localStorage.removeItem(USERNAME_STORAGE_KEY);
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

  function updateSidebarProfile(gadget) {
    if (gadget.sidebar_gadget && gadget.sidebar_gadget.setUserProfile) {
      gadget.sidebar_gadget.setUserProfile({
        name: gadget.current_username || "Guest user",
        username: gadget.current_username || ""
      });
    }
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
    storeUsername(null);
    gadget.is_authenticated = false;
    gadget.active_session_id = null;
    gadget.session_list = [];
    gadget.session_cache = {};
    gadget.session_started_map = {};
    gadget.derived_title_map = {};
    gadget.current_username = null;
    setMainViewMode(gadget, "chat");
    setSessionIdInURL(null);
    updateAuthState(gadget, "locked");
    updateSidebarProfile(gadget);
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

  function updateSidebarVisibilityState(gadget, detail) {
    var info = detail || {},
      has_flag = Object.prototype.hasOwnProperty.call(info, "is_visible"),
      visible = has_flag ? Boolean(info.is_visible) : true;

    gadget.sidebar_visible = visible;
    gadget.sidebar_is_mobile = Boolean(info.is_mobile);
    gadget.sidebar_mobile_open = Boolean(info.mobile_open);
  }

  rJS(window)
    .ready(function (gadget) {
      var initial_mobile;
      gadget.active_session_id = null;
      gadget.sidebar_gadget = null;
      gadget.header_gadget = null;
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
      gadget.current_username = getStoredUsername();

      gadget.derived_title_map = {};
      gadget.session_started_map = {};
      gadget.new_session_map = {};
      gadget.current_view_mode = "chat";
      updateAuthState(gadget, "locked");

      initial_mobile = isMobileViewport();
      updateSidebarVisibilityState(gadget, {
        is_visible: initial_mobile ? false : true,
        is_mobile: initial_mobile,
        mobile_open: false
      });

      gadget.app_main = window.document.querySelector('[data-role="app-main"]');
      gadget.mobile_media_query =
        window.matchMedia && window.matchMedia("(max-width: 1024px)");

      if (gadget.app_main) {
        gadget.mobile_main_listener = rJS.loopEventListener(
          gadget.app_main,
          "click",
          true,
          function (event) {
            if (
              gadget.sidebar_is_mobile &&
              gadget.sidebar_mobile_open &&
              gadget.sidebar_gadget &&
              gadget.sidebar_gadget.toggleSidebar
            ) {
              event.preventDefault();
              event.stopPropagation();
              gadget.sidebar_gadget.toggleSidebar();
            }
          },
          false
        );
      }
    })

    .declareService(function () {
      var gadget = this,
        sidebar_gadget,
        chat_gadget,
        header_gadget,
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
        if (gadget.header_gadget && gadget.header_gadget.setTheme) {
          gadget.header_gadget.setTheme(is_dark);
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

      function streamChatResponse(session_id, user_text, assistant_id) {
        var accumulated = "",
          assistant_message_id = assistant_id,
          assistant_message_promise = null,
          buffer = "",
          pending_content = "",
          raf_scheduled = false,
          chunk_counter = 0,
          decoder = new window.TextDecoder(),
          url = "/chat/" + session_id,
          ui_task =
            (RSVP.resolve && RSVP.resolve()) ||
            new RSVP.Promise(function (resolve) {
              resolve();
            });

        function queueTask(fn) {
          ui_task = ui_task.then(
            function () {
              return fn();
            },
            function () {
              return fn();
            }
          );
          return ui_task;
        }

        function ensureAssistantMessage() {
          if (assistant_message_id !== null) {
            return queueTask(function () {
              return assistant_message_id;
            });
          }
          // Should not happen with new flow, but fallback:
          if (assistant_message_promise) {
            return assistant_message_promise;
          }
          assistant_message_promise = queueTask(function () {
            return chat_gadget.appendAssistantMessage("", { is_streaming: true }).then(function (id) {
              assistant_message_id = id;
              return id;
            });
          });
          return assistant_message_promise;
        }

        function applyAssistantContent(content) {
          return ensureAssistantMessage().then(function (message_id) {
            return queueTask(function () {
              return chat_gadget.updateMessageContent(
                message_id,
                content || ""
              );
            });
          });
        }

        function requestAssistantPaint(force) {
          var raf =
            window.requestAnimationFrame ||
            function (cb) {
              return window.setTimeout(cb, 0);
            };
          if (force) {
            raf_scheduled = false;
            applyAssistantContent(pending_content);
            return;
          }
          if (raf_scheduled) {
            return;
          }
          raf_scheduled = true;
          raf(function () {
            raf_scheduled = false;
            applyAssistantContent(pending_content);
          });
        }

        abortActiveStream();
        setPromptBusy(true);

        function finalizeStream() {
          gadget.active_stream_controller = null;
          setPromptBusy(false);
          if (chat_gadget && chat_gadget.finishStreamingMessage && assistant_message_id) {
             chat_gadget.finishStreamingMessage(assistant_message_id);
          }
          gadget.session_cache[session_id] = null;
          return loadSessionDetail(session_id);
        }

        return apiFetchJSON(gadget, url, {
          method: "POST",
          body: window.JSON.stringify({ sender: "user", text: user_text }),
          expect_stream: true
        })
          .then(function (response) {
            var reader = response.body && response.body.getReader(),
              header_obj = response.headers,
              content_type =
                (header_obj && header_obj.get
                  ? header_obj.get("content-type")
                  : "") || "",
              is_event_stream =
                content_type.toLowerCase().indexOf("text/event-stream") !== -1;
            if (!reader) {
              throw new Error("Unable to start streaming response.");
            }
            gadget.active_stream_controller = {
              abort: function () {
                reader.cancel();
              }
            };

            function handlePayload(payload) {
              if (!payload || !payload.type) {
                return;
              }
              if (payload.type === "token") {
                accumulated += payload.data || "";
                pending_content = accumulated;
                requestAssistantPaint(false);
              } else if (payload.type === "final") {
                if (payload.data && payload.data.answer) {
                  accumulated = payload.data.answer;
                }
                pending_content = accumulated;
                requestAssistantPaint(true);
              } else if (payload.type === "error") {
                accumulated =
                  accumulated || "Sorry, I could not fetch a response.";
                pending_content = accumulated;
                requestAssistantPaint(true);
              }
            }

            function processBuffer(flush_remainder) {
              var delimiter_index,
                delimiter_length,
                record,
                line,
                newline_index,
                raw_line,
                trimmed_line;

              function dispatchJsonText(text) {
                var payload_text = text || "";
                if (!payload_text) {
                  return;
                }
                if (payload_text.indexOf("data:") === 0) {
                  payload_text = payload_text.slice(5);
                  if (payload_text.charAt(0) === " ") {
                    payload_text = payload_text.slice(1);
                  }
                }
                payload_text = payload_text.trim();
                if (!payload_text) {
                  return;
                }
                try {
                  handlePayload(window.JSON.parse(payload_text));
                } catch (ignore) {
                  return;
                }
              }

              function consumeRecord(text) {
                var local_lines = text.split(/\r?\n/),
                  local_data_lines = [],
                  j,
                  current_line,
                  payload_text;
                for (j = 0; j < local_lines.length; j += 1) {
                  current_line = local_lines[j];
                  if (current_line.indexOf("data:") === 0) {
                    payload_text = current_line.slice(5);
                    if (payload_text.charAt(0) === " ") {
                      payload_text = payload_text.slice(1);
                    }
                    if (payload_text) {
                      local_data_lines.push(payload_text);
                    }
                  }
                }
                if (local_data_lines.length === 0) {
                  return;
                }
                try {
                  handlePayload(
                    window.JSON.parse(local_data_lines.join("\n"))
                  );
                } catch (ignore) {
                  return;
                }
              }

              if (is_event_stream) {
                while (true) {
                  delimiter_index = buffer.indexOf("\n\n");
                  delimiter_length = 2;
                  line = buffer.indexOf("\r\n\r\n");
                  if (
                    line !== -1 &&
                    (delimiter_index === -1 || line < delimiter_index)
                  ) {
                    delimiter_index = line;
                    delimiter_length = 4;
                  }
                  if (delimiter_index === -1) {
                    break;
                  }
                  record = buffer.slice(0, delimiter_index);
                  buffer = buffer.slice(delimiter_index + delimiter_length);
                  consumeRecord(record);
                }
                if (flush_remainder && buffer) {
                  consumeRecord(buffer);
                  buffer = "";
                }
                return;
              }

              while ((newline_index = buffer.indexOf("\n")) !== -1) {
                raw_line = buffer.slice(0, newline_index);
                buffer = buffer.slice(newline_index + 1);
                trimmed_line = raw_line.replace(/\r$/, "").trim();
                if (!trimmed_line) {
                  continue;
                }
                dispatchJsonText(trimmed_line);
              }
              if (flush_remainder && buffer) {
                trimmed_line = buffer.replace(/\r$/, "").trim();
                if (trimmed_line) {
                  dispatchJsonText(trimmed_line);
                }
                buffer = "";
              }
            }

            function read() {
              return reader.read().then(function (result) {
                if (result.done) {
                  processBuffer(true);
                  return;
                }
                buffer += decoder.decode(result.value, { stream: true });
                processBuffer(false);
                chunk_counter += 1;
                if (chunk_counter % 8 === 0) {
                  return RSVP.delay(0).then(read);
                }
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
            pending_content = accumulated || fallback_message;
            requestAssistantPaint(true);
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
          title,
          user_msg_id;

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
            .handleUserSubmit(trimmed, { scroll: false })
            .then(function (id) {
              user_msg_id = id;
              gadget.session_started_map[session_id] = true;
              setMainViewMode(gadget, "chat");
              return chat_gadget.appendAssistantMessage("", { is_streaming: true });
            })
            .then(function (assistant_msg_id) {
              return chat_gadget.scrollToMessage(user_msg_id)
                .then(function () {
                  return streamChatResponse(session_id, trimmed, assistant_msg_id);
                });
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
            storeUsername(username);
            gadget.current_username = username;
            updateSidebarProfile(gadget);
            gadget.is_authenticated = true;
            updateAuthState(gadget, "authenticated");
            return loadSessions(true);
          });
      }

      function handleRegisterSubmit(credential) {
        var username = credential && credential.username,
          password = credential && credential.password;

        if (!username || !password) {
          return RSVP.reject(
            new Error("Username and password are required.")
          );
        }

        return apiFetchJSON(gadget, "/register", {
          method: "POST",
          body: window.JSON.stringify({
            username: username,
            password: password
          })
        }).then(function () {
          return handleAuthSubmit({
            username: username,
            password: password
          });
        });
      }

      return gadget.getDeclaredGadget("sidebar")
        .push(function (sg) {
          sidebar_gadget = sg;
          gadget.sidebar_gadget = sg;
          updateSidebarProfile(gadget);
          return gadget.getDeclaredGadget("chat");
        })
        .push(function (cg) {
          chat_gadget = cg;
          gadget.chat_gadget = cg;
          return gadget.getDeclaredGadget("header");
        })
        .push(function (hg) {
          var is_dark_mode = !!(
            window.document &&
            window.document.body &&
            window.document.body.classList.contains("dark")
          );
          header_gadget = hg;
          gadget.header_gadget = hg;
          if (header_gadget.setToggleHandler) {
            header_gadget.setToggleHandler(function () {
              if (
                gadget.sidebar_gadget &&
                gadget.sidebar_gadget.toggleSidebar
              ) {
                gadget.sidebar_gadget.toggleSidebar();
              }
            });
          }
          if (header_gadget.setTitle) {
            header_gadget.setTitle("Rapid.Space RAG");
          }
          if (header_gadget.setTheme) {
            header_gadget.setTheme(is_dark_mode);
          }
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

          if (sidebar_gadget.setSidebarVisibilityHandler) {
            sidebar_gadget.setSidebarVisibilityHandler(function (detail) {
              updateSidebarVisibilityState(gadget, detail);
            });
          }

          function handleMobileMediaChange() {
            if (
              sidebar_gadget &&
              sidebar_gadget.refreshResponsiveState
            ) {
              sidebar_gadget.refreshResponsiveState();
            }
          }

          if (gadget.mobile_media_query && !gadget.media_query_bound) {
            gadget.media_query_bound = true;
            if (gadget.mobile_media_query.addEventListener) {
              gadget.mobile_media_query.addEventListener(
                "change",
                handleMobileMediaChange
              );
            } else if (gadget.mobile_media_query.addListener) {
              gadget.mobile_media_query.addListener(handleMobileMediaChange);
            }
          }

          if (
            gadget.mobile_media_query &&
            gadget.mobile_media_query.matches &&
            sidebar_gadget &&
            sidebar_gadget.refreshResponsiveState
          ) {
            sidebar_gadget.refreshResponsiveState();
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
          if (auth_gadget.setRegisterHandler) {
            auth_gadget.setRegisterHandler(handleRegisterSubmit);
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
