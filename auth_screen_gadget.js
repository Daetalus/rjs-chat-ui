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

  function setLoading(gadget, is_loading) {
    var username = getField(gadget, "username"),
      password = getField(gadget, "password"),
      button = getField(gadget, "submit");
    gadget.is_loading = is_loading;
    if (username) {
      username.disabled = is_loading;
    }
    if (password) {
      password.disabled = is_loading;
    }
    if (button) {
      button.disabled = is_loading;
      button.textContent = is_loading ? "Signing in…" : "Sign in";
    }
  }

  function callSubmitHandler(gadget, credential) {
    if (!gadget.submit_handler) {
      return RSVP.resolve();
    }
    try {
      return RSVP.resolve(gadget.submit_handler(credential));
    } catch (error) {
      return RSVP.reject(error);
    }
  }

  rJS(window)
    .ready(function (gadget) {
      gadget.submit_handler = null;
      gadget.is_loading = false;
      setError(gadget, "");
      setStatus(gadget, "");
    })

    .declareMethod("setLoginHandler", function (handler) {
      this.submit_handler = handler;
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
          username = (username_el && username_el.value) || "",
          password = (password_el && password_el.value) || "";

        evt.preventDefault();

        if (gadget.is_loading) {
          return;
        }

        username = username.trim();

        if (!username || !password) {
          setError(gadget, "Username and password are required.");
          return;
        }

        setError(gadget, "");
        setStatus(gadget, "");
        setLoading(gadget, true);

        callSubmitHandler(gadget, { username: username, password: password }).then(
          function () {
            setStatus(gadget, "Success! Redirecting…");
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
    );
}(window, document, rJS, RSVP));
