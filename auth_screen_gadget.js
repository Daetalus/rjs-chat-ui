/*jslint nomen: true, indent: 2, maxerr: 3 */
/*global window, document, rJS, RSVP */

(function (window, document, rJS, RSVP) {
  "use strict";

  function getField(gadget, role) {
    return gadget.element.querySelector('[data-role="' + role + '"]');
  }

  function setError(gadget, message) {
    var box = getField(gadget, "error");
    if (!box) {
      return;
    }
    if (message) {
      box.textContent = message;
      box.setAttribute("data-visible", "true");
    } else {
      box.textContent = "";
      box.setAttribute("data-visible", "false");
    }
  }

  function setStatus(gadget, text) {
    var status = getField(gadget, "status");
    if (status) {
      status.textContent = text || "";
    }
  }

  function updateButtonLabel(gadget, is_loading) {
    var button = getField(gadget, "submit"),
      mode = gadget.mode === "register" ? "register" : "login";
    if (!button) {
      return;
    }
    if (is_loading) {
      button.textContent = mode === "register" ? "Creating account…" : "Signing in…";
    } else {
      button.textContent = mode === "register" ? "Create account" : "Sign in";
    }
  }

  function setLoading(gadget, is_loading) {
    var username = getField(gadget, "username"),
      password = getField(gadget, "password"),
      confirm = getField(gadget, "confirm"),
      toggle = getField(gadget, "mode-toggle");
    gadget.is_loading = is_loading;
    if (username) {
      username.disabled = is_loading;
    }
    if (password) {
      password.disabled = is_loading;
    }
    if (confirm) {
      confirm.disabled = is_loading;
    }
    if (toggle) {
      toggle.disabled = is_loading;
    }
    updateButtonLabel(gadget, is_loading);
  }

  function setMode(gadget, target_mode) {
    var mode = target_mode === "register" ? "register" : "login",
      confirm_wrapper = getField(gadget, "confirm-field"),
      confirm_input = getField(gadget, "confirm"),
      subtitle = getField(gadget, "subtitle"),
      note = getField(gadget, "mode-note"),
      toggle_label = getField(gadget, "mode-toggle-label"),
      toggle_button = getField(gadget, "mode-toggle");

    gadget.mode = mode;

    if (confirm_wrapper) {
      confirm_wrapper.setAttribute(
        "data-visible",
        mode === "register" ? "true" : "false"
      );
      if (mode === "login" && confirm_input) {
        confirm_input.value = "";
      }
    }

    if (subtitle) {
      subtitle.textContent =
        mode === "register"
          ? "Create an account to start chatting."
          : "Sign in to continue your conversations.";
    }

    if (note) {
      note.textContent =
        mode === "register"
          ? "Use at least 6 characters for your password."
          : "Forgot credentials? Contact your administrator.";
    }

    if (toggle_label) {
      toggle_label.textContent =
        mode === "register"
          ? "Already have an account?"
          : "Don’t have an account?";
    }

    if (toggle_button) {
      toggle_button.textContent = mode === "register" ? "Sign in" : "Create one";
    }

    updateButtonLabel(gadget, gadget.is_loading);
  }

  function callSubmitHandler(gadget, credential, mode) {
    var handler =
      mode === "register" ? gadget.register_handler : gadget.submit_handler;
    if (!handler) {
      if (mode === "register") {
        return RSVP.reject(
          new Error("Registration is not available right now.")
        );
      }
      return RSVP.resolve();
    }
    try {
      return RSVP.resolve(handler(credential));
    } catch (error) {
      return RSVP.reject(error);
    }
  }

  rJS(window)
    .ready(function (gadget) {
      gadget.submit_handler = null;
      gadget.is_loading = false;
      gadget.register_handler = null;
      gadget.mode = "login";
      setError(gadget, "");
      setStatus(gadget, "");
      setMode(gadget, "login");
    })

    .declareMethod("setLoginHandler", function (handler) {
      this.submit_handler = handler;
    })

    .declareMethod("setRegisterHandler", function (handler) {
      this.register_handler = handler;
    })

    .declareMethod("focus", function () {
      var username = getField(this, "username");
      if (username && username.focus) {
        username.focus();
      }
    })

    .onEvent(
      "submit",
      function (evt) {
        var gadget = this,
          username_el = getField(gadget, "username"),
          password_el = getField(gadget, "password"),
          confirm_el = getField(gadget, "confirm"),
          mode = gadget.mode === "register" ? "register" : "login",
          username = (username_el && username_el.value) || "",
          password = (password_el && password_el.value) || "",
          confirm_value = (confirm_el && confirm_el.value) || "";

        evt.preventDefault();

        if (gadget.is_loading) {
          return;
        }

        username = username.trim();

        if (!username || !password) {
          setError(gadget, "Username and password are required.");
          return;
        }

        if (mode === "register") {
          if (password.length < 6) {
            setError(gadget, "Please choose a password with at least 6 characters.");
            return;
          }
          if (password !== confirm_value) {
            setError(gadget, "Passwords do not match.");
            return;
          }
        }

        setError(gadget, "");
        setStatus(gadget, "");
        setLoading(gadget, true);

        callSubmitHandler(
          gadget,
          { username: username, password: password },
          mode
        ).then(
          function () {
            setStatus(
              gadget,
              mode === "register"
                ? "Account created! Signing you in…"
                : "Success! Redirecting…"
            );
            setError(gadget, "");
            setLoading(gadget, false);
          },
          function (error) {
            var message =
              error && error.message
                ? error.message
                : "Unable to sign in. Please try again.";
            setError(gadget, message);
            setStatus(gadget, "");
            setLoading(gadget, false);
          }
        );
      },
      true,
      false
    )

    .onEvent(
      "click",
      function (evt) {
        var gadget = this,
          target = evt.target,
          role,
          desired_mode;
        if (!target) {
          return;
        }
        role = target.getAttribute("data-role");
        if (role === "mode-tab" || role === "mode-toggle") {
          evt.preventDefault();
          if (gadget.is_loading) {
            return;
          }
          desired_mode =
            role === "mode-tab"
              ? target.getAttribute("data-mode")
              : gadget.mode === "register"
                ? "login"
                : "register";
          setMode(gadget, desired_mode);
        }
      },
      false,
      false
    );
}(window, document, rJS, RSVP));
