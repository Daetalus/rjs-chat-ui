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

  function updateStreamingButton(gadget) {
    var button = gadget.element.querySelector('[data-action="stream"]');
    if (!button) {
      return;
    }

    if (gadget.is_streaming) {
      button.textContent = "Streaming...";
      button.disabled = true;
    } else {
      button.textContent = "Show Streaming";
      button.disabled = false;
    }
  }

  function renderMessages(gadget) {
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
      bubble_element.textContent = message.content || "";

      content_wrapper.appendChild(bubble_element);
      row_element.appendChild(content_wrapper);
      log_inner.appendChild(row_element);
    }

    // The outer .chat-scroll controls the scrollbar, here only ensure scrolling to the bottom
    scrollToBottom(log_inner.parentNode);
    updateStreamingButton(gadget);
  }

  ////////////////////////////////////////////////////////////////////////////
  // Gadget definition
  ////////////////////////////////////////////////////////////////////////////

  rJS(window)
    .ready(function (gadget) {
      gadget.messages = [
        {
          id: 1,
          role: "assistant",
          content: "Hello! This is a RenderJS-based chat demo."
        }
      ];
      gadget.max_message_id = 1;

      gadget.is_streaming = false;
      gadget.stream_interval_id = null;
      gadget.stream_buffer = "";
      gadget.placeholder_text =
        "This is a placeholder streamed reply from the AI. " +
        "Replace this with real model output later.";
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
      renderMessages(gadget);
    })

    // Clear the current session
    .declareMethod("clearMessages", function () {
      var gadget = this;
      gadget.messages = [];
      gadget.max_message_id = 0;
      renderMessages(gadget);
    })

    // ====== Original submit + streaming logic remains unchanged ======

    .declareMethod("handleUserSubmit", function (text) {
      var gadget = this,
        trimmed;

      if (typeof text !== "string") {
        return;
      }

      trimmed = text.replace(/\s+$/, "");
      if (!trimmed) {
        return;
      }

      gadget.max_message_id += 1;
      gadget.messages.push({
        id: gadget.max_message_id,
        role: "user",
        content: trimmed
      });

      renderMessages(gadget);

      // Append an assistant streaming placeholder reply
      gadget.startStreamingPlaceholder();
    })

    .declareMethod("startStreamingPlaceholder", function () {
      var gadget = this,
        new_id,
        stream_index = 0,
        full_text = gadget.placeholder_text;

      if (gadget.is_streaming) {
        return;
      }

      gadget.is_streaming = true;
      gadget.stream_buffer = "";

      gadget.max_message_id += 1;
      new_id = gadget.max_message_id;
      gadget.messages.push({
        id: new_id,
        role: "assistant",
        content: ""
      });

      renderMessages(gadget);

      gadget.stream_interval_id = window.setInterval(function () {
        var last_message;

        if (stream_index < full_text.length) {
          gadget.stream_buffer += full_text.charAt(stream_index);
          stream_index += 1;

          last_message = gadget.messages[gadget.messages.length - 1];
          last_message.content = gadget.stream_buffer;

          renderMessages(gadget);
        } else {
          window.clearInterval(gadget.stream_interval_id);
          gadget.stream_interval_id = null;
          gadget.is_streaming = false;
          updateStreamingButton(gadget);
        }
      }, 30);
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

    .onEvent(
      "click",
      function (evt) {
        var target = evt.target;
        if (target.getAttribute("data-action") === "stream") {
          evt.preventDefault();
          this.startStreamingPlaceholder();
        }
      },
      false,
      true
    );

}(window, document, rJS, RSVP));
