/*jslint nomen: true, indent: 2, maxerr: 3 */
/*global window, document, rJS, RSVP */

(function (window, document, rJS, RSVP) {
  "use strict";

  ////////////////////////////////////////////////////////////////////////////
  // Helpers
  ////////////////////////////////////////////////////////////////////////////

  function scrollToBottom(container) {
    if (!container) {
      return;
    }
    container.scrollTop = container.scrollHeight;
  }

  function scrollMessageToTop(gadget, message_id) {
    if (!gadget || !message_id) {
      return RSVP.resolve();
    }
    return new RSVP.Promise(function (resolve) {
      var element = gadget.element,
        log_inner,
        selector,
        target;

      if (!element) {
        resolve();
        return;
      }

      log_inner = element.querySelector('[data-role="log-inner"]');
      if (!log_inner) {
        resolve();
        return;
      }

      selector = '[data-message-id="' + message_id + '"]';
      target = log_inner.querySelector(selector);
      if (!target || !target.scrollIntoView) {
        resolve();
        return;
      }

      (window.requestAnimationFrame ||
        function (cb) {
          RSVP.delay(0).then(function () {
            cb();
          });
        })(function () {
        try {
          target.scrollIntoView({ behavior: "smooth", block: "start" });
        } catch (ignore) {
          target.scrollIntoView();
        }
        RSVP.delay(350).then(function () {
          resolve();
        });
      });
    });
  }

  function scrollLastUserMessageToTop(gadget) {
    var element = gadget.element,
      log_inner,
      messages = gadget.messages || [],
      i,
      last_user_msg = null,
      target;

    if (!element) {
      return;
    }
    log_inner = element.querySelector('[data-role="log-inner"]');
    if (!log_inner) {
      return;
    }

    // Find last user message
    for (i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].role === "user") {
        last_user_msg = messages[i];
        break;
      }
    }

    if (last_user_msg) {
      target = log_inner.querySelector(
        '[data-message-id="' + last_user_msg.id + '"]'
      );
      if (target) {
        target.scrollIntoView({ block: "start" });
        return;
      }
    }

    // Fallback: scroll to bottom if no user message found
    scrollToBottom(log_inner.parentNode);
  }

  var markdown_renderer = null,
    STREAMING_TIP_HTML =
      '<div class="assistant-stream-tip" data-visible="true">Searching documents...</div>';

  function findMessageById(message_list, message_id) {
    var i,
      current_id;
    if (!message_id || !message_list) {
      return null;
    }
    for (i = 0; i < message_list.length; i += 1) {
      current_id = message_list[i] && message_list[i].id;
      if (
        current_id &&
        String(current_id) === String(message_id)
      ) {
        return message_list[i];
      }
    }
    return null;
  }

  function ensureMarkdownRenderer() {
    if (!markdown_renderer && window.markdownit) {
      try {
        markdown_renderer = window.markdownit({
          html: false,
          linkify: true,
          breaks: true
        });
      } catch (ignore) {
        markdown_renderer = null;
      }
    }
    return markdown_renderer;
  }

  function escapeHTML(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function renderAssistantContent(text) {
    var renderer = ensureMarkdownRenderer(),
      source = text || "",
      html;

    if (renderer) {
      try {
        html = renderer.render(source);
      } catch (ignore) {
        html = null;
      }
    }
    if (!html) {
      html = escapeHTML(source).replace(/\r?\n/g, "<br>");
    }
    if (window.DOMPurify && window.DOMPurify.sanitize) {
      html = window.DOMPurify.sanitize(html);
    }
    return '<div class="markdown-body">' + html + '</div>';
  }

  function renderMessages(gadget, options) {
    var log_inner = gadget.element.querySelector('[data-role="log-inner"]'),
      messages = gadget.messages || [],
      i,
      message,
      row_element,
      avatar_element,
      content_wrapper,
      bubble_element,
      is_assistant;

    if (!log_inner) {
      return;
    }

    log_inner.textContent = "";

    for (i = 0; i < messages.length; i += 1) {
      message = messages[i];
      is_assistant = message.role === "assistant";

      row_element = document.createElement("div");
      row_element.className =
        "message-row " +
        (is_assistant ? "message-row--assistant" : "message-row--user");
      
      if (message.is_streaming) {
        row_element.classList.add("message-row--streaming");
      }

      row_element.setAttribute("data-message-id", message.id);

      if (is_assistant) {
        avatar_element = document.createElement("div");
        avatar_element.className = "message-avatar";
        avatar_element.textContent = "AI";
        row_element.appendChild(avatar_element);
      }

      content_wrapper = document.createElement("div");
      content_wrapper.className = "message-content-wrapper";

      bubble_element = document.createElement("div");
      bubble_element.className =
        "message-bubble " +
        (is_assistant
          ? "message-bubble--assistant"
          : "message-bubble--user");
      if (is_assistant) {
        if (message.is_streaming && !message.content) {
          bubble_element.innerHTML = STREAMING_TIP_HTML;
        } else {
          bubble_element.innerHTML = renderAssistantContent(
            message.content || ""
          );
        }
      } else {
        bubble_element.textContent = message.content || "";
      }

      content_wrapper.appendChild(bubble_element);
      row_element.appendChild(content_wrapper);
      log_inner.appendChild(row_element);
    }

    if (!options || options.scrollToBottom !== false) {
      scrollToBottom(log_inner.parentNode);
    }
  }

  function updateBubbleContent(gadget, message) {
    var element,
      log_inner,
      row,
      bubble;

    if (!gadget || !gadget.element || !message) {
      return false;
    }
    element = gadget.element;
    log_inner = element.querySelector('[data-role="log-inner"]');
    if (!log_inner) {
      return false;
    }
    row = log_inner.querySelector(
      '[data-message-id="' + message.id + '"]'
    );
    if (!row) {
      return false;
    }
    bubble = row.querySelector(".message-bubble");
    if (!bubble) {
      return false;
    }
    if (message.role === "assistant") {
      if (message.is_streaming && !message.content) {
        bubble.innerHTML = STREAMING_TIP_HTML;
      } else {
        bubble.innerHTML = renderAssistantContent(message.content || "");
      }
    } else {
      bubble.textContent = message.content || "";
    }
    scrollToBottom(log_inner.parentNode);
    return true;
  }

  ////////////////////////////////////////////////////////////////////////////
  // Gadget definition
  ////////////////////////////////////////////////////////////////////////////

  rJS(window)
    .ready(function (gadget) {
      gadget.messages = [];
      gadget.max_message_id = 0;
      gadget.is_dark_mode = false;
      renderMessages(gadget);
    })

    .declareMethod("render", function () {
      renderMessages(this);
    })

    // ===== Key addition: Multi-session support =====

    // Read all messages from the current session (return a copy)
    .declareMethod("getMessages", function () {
      var gadget = this;
      return (gadget.messages || []).map(function (m) {
        return {
          id: m.id,
          role: m.role,
          content: m.content
        };
      });
    })

    // Completely replace the current session content with a set of messages
    .declareMethod("setMessages", function (message_list) {
      var gadget = this,
        list = message_list || [],
        i,
        max_id = 0,
        id;

      gadget.messages = [];

      for (i = 0; i < list.length; i += 1) {
        id = list[i].id || (i + 1);
        gadget.messages.push({
          id: id,
          role: list[i].role || "assistant",
          content: list[i].content || ""
        });
        if (id > max_id) {
          max_id = id;
        }
      }
      gadget.max_message_id = max_id;
      renderMessages(gadget, { scrollToBottom: false });
      scrollLastUserMessageToTop(gadget);
    })

    // Clear the current session
    .declareMethod("clearMessages", function () {
      var gadget = this;
      gadget.messages = [];
      gadget.max_message_id = 0;
      renderMessages(gadget);
    })

    // ====== User input handling ======

    .declareMethod("handleUserSubmit", function (text, options) {
      var gadget = this,
        trimmed,
        new_message_id;

      if (typeof text !== "string") {
        return;
      }

      trimmed = text.replace(/\s+$/, "");
      if (!trimmed) {
        return;
      }

      gadget.max_message_id += 1;
      new_message_id = gadget.max_message_id;
      gadget.messages.push({
        id: new_message_id,
        role: "user",
        content: trimmed
      });

      renderMessages(gadget, { scrollToBottom: false });

      if (options && options.scroll === false) {
        return RSVP.resolve(new_message_id);
      }

      return scrollMessageToTop(gadget, new_message_id).then(function () {
        return new_message_id;
      });
    })

    .declareMethod("appendAssistantMessage", function (content, options) {
      var gadget = this,
        new_id;

      gadget.max_message_id += 1;
      new_id = gadget.max_message_id;
      gadget.messages.push({
        id: new_id,
        role: "assistant",
        content: content || "",
        is_streaming: options && options.is_streaming
      });
      renderMessages(gadget);
      return new_id;
    })

    .declareMethod("updateMessageContent", function (message_id, content) {
      var gadget = this,
        message = findMessageById(gadget.messages, message_id);
      if (!message) {
        return;
      }
      message.content = content || "";
      if (updateBubbleContent(gadget, message)) {
        return;
      }
      renderMessages(gadget, { scrollToBottom: false });
    })

    .declareMethod("finishStreamingMessage", function (message_id) {
      var gadget = this,
        message = findMessageById(gadget.messages, message_id);
      if (!message) {
        return;
      }
      message.is_streaming = false;
      renderMessages(gadget, { scrollToBottom: false });
    })

    .declareMethod("scrollToMessage", function (message_id) {
      return scrollMessageToTop(this, message_id);
    })

    .declareMethod("setTheme", function (is_dark) {
      var root = document.documentElement;
      this.is_dark_mode = Boolean(is_dark);
      if (!root) {
        return;
      }
      if (this.is_dark_mode) {
        root.classList.add("dark");
      } else {
        root.classList.remove("dark");
      }
    })

}(window, document, rJS, RSVP));
