/*jslint nomen: true, indent: 2, maxerr: 3 */
/*global window, document, rJS, RSVP */

(function (window, document, rJS, RSVP) {
  "use strict";

  function adjustTextareaHeight(textarea, max_height) {
    if (!textarea) {
      return;
    }
    textarea.style.height = "auto";
    if (max_height) {
      textarea.style.height = Math.min(textarea.scrollHeight, max_height) + "px";
    } else {
      textarea.style.height = textarea.scrollHeight + "px";
    }
  }

  function renderFiles(gadget) {
    var files_container = gadget.element.querySelector('[data-role="files"]'),
      file_list = gadget.file_list || [],
      i,
      chip,
      name_span,
      remove_button;

    if (!files_container) {
      return;
    }

    files_container.textContent = "";

    for (i = 0; i < file_list.length; i += 1) {
      chip = document.createElement("div");
      chip.className = "prompt-file-chip";

      name_span = document.createElement("span");
      name_span.className = "prompt-file-chip-name";
      name_span.textContent = file_list[i].name;
      chip.appendChild(name_span);

      remove_button = document.createElement("button");
      remove_button.className = "prompt-file-chip-remove";
      remove_button.textContent = "×";
      remove_button.setAttribute("data-action", "remove-file");
      remove_button.setAttribute("data-file-index", String(i));
      chip.appendChild(remove_button);

      files_container.appendChild(chip);
    }
  }

  function clearInputAndFiles(gadget) {
    var textarea = gadget.element.querySelector('[data-role="textarea"]'),
      file_input = gadget.element.querySelector('[data-role="file-input"]');

    gadget.input_value = "";
    gadget.file_list = [];

    if (textarea) {
      textarea.value = "";
      adjustTextareaHeight(textarea, gadget.max_height);
    }
    if (file_input) {
      file_input.value = "";
    }

    renderFiles(gadget);
  }

  function handleSubmit(gadget) {
    var trimmed = (gadget.input_value || "").replace(/\s+$/, "");

    if (!trimmed && (!gadget.file_list || gadget.file_list.length === 0)) {
      return;
    }

    // Pass the text content to the injected handler
    if (gadget.submit_handler) {
      gadget.submit_handler(trimmed);
    }

    // Locally clear input and files
    clearInputAndFiles(gadget);
  }

  rJS(window)
    .ready(function (gadget) {
      gadget.input_value = "";
      gadget.file_list = [];
      gadget.max_height = 180;
      gadget.submit_handler = null;
    })

    // Parent gadget uses this method to inject callback
    .declareMethod("setSubmitHandler", function (handler) {
      this.submit_handler = handler;
    })

    .declareMethod("render", function () {
      var gadget = this,
        textarea = gadget.element.querySelector('[data-role="textarea"]');

      renderFiles(gadget);
      if (textarea) {
        adjustTextareaHeight(textarea, gadget.max_height);
      }
    })

    // Text input
    .onEvent(
      "input",
      function (evt) {
        var gadget = this,
          target = evt.target;

        if (target.getAttribute("data-role") === "textarea") {
          gadget.input_value = target.value;
          adjustTextareaHeight(target, gadget.max_height);
        }
      },
      true,
      false
    )

    // Enter to submit, Shift+Enter for new line
    .onEvent(
      "keydown",
      function (evt) {
        var gadget = this,
          target = evt.target;

        if (target.getAttribute("data-role") === "textarea") {
          if (evt.key === "Enter" && !evt.shiftKey) {
            evt.preventDefault();
            handleSubmit(gadget);
          }
        }
      },
      true,
      false
    )

    // Click (send button / attachment / delete file)
    .onEvent(
      "click",
      function (evt) {
        var gadget = this,
          action,
          index,
          textarea,
          file_input;

        action = evt.target.getAttribute("data-action");
        if (!action && evt.target.parentNode) {
          action = evt.target.parentNode.getAttribute("data-action");
        }

        if (action === "submit") {
          evt.preventDefault();
          handleSubmit(gadget);
          return;
        }

        if (action === "attach") {
          evt.preventDefault();
          file_input = gadget.element.querySelector('[data-role="file-input"]');
          if (file_input) {
            file_input.click();
          }
          return;
        }

        if (action === "remove-file") {
          evt.preventDefault();
          index = evt.target.getAttribute("data-file-index");
          if (index !== null) {
            index = parseInt(index, 10);
            gadget.file_list.splice(index, 1);
            renderFiles(gadget);
          }
        }

        // Click shell to focus textarea
        if (evt.target.getAttribute("data-role") === "shell" ||
            (evt.target.closest && evt.target.closest('[data-role="shell"]'))) {
          textarea = gadget.element.querySelector('[data-role="textarea"]');
          if (textarea) {
            textarea.focus();
          }
        }
      },
      false,
      true
    )

    // File selection
    .onEvent(
      "change",
      function (evt) {
        var gadget = this,
          target = evt.target,
          i;

        if (target.getAttribute("data-role") === "file-input") {
          if (target.files && target.files.length > 0) {
            for (i = 0; i < target.files.length; i += 1) {
              gadget.file_list.push(target.files[i]);
            }
            renderFiles(gadget);
          }
        }
      },
      true,
      false
    );

}(window, document, rJS, RSVP));

