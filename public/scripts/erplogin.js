$(function () {
    const passwordInput = $("#passwordInput");
    const toggleButton = $(".password-toggle");
    const loginForm = $(".login-form");
    const submitButton = $(".login-submit");
    const uiInput = $("#uiPreferenceInput");
    const isNarrow = window.matchMedia("(max-width: 900px)").matches;
    const uiValue = isNarrow ? "m" : "d";

    try {
        document.cookie = `gtr_ui=${uiValue}; path=/; max-age=31536000; samesite=lax`;
    } catch (err) { /* ignore */ }

    if (uiInput.length) {
        uiInput.val(uiValue);
    }

    if (uiValue === "m" && "serviceWorker" in navigator) {
        navigator.serviceWorker.register("/sw-m.js").catch(() => {});
    }

    if (toggleButton.length) {
        toggleButton.on("click", function () {
            if (!passwordInput.length) return;

            const isHidden = passwordInput.attr("type") === "password";
            passwordInput.attr("type", isHidden ? "text" : "password");
            $(this).attr("aria-pressed", isHidden);
            $(this).find("i").toggleClass("fa-eye fa-eye-slash");
            passwordInput.trigger("focus");
        });
    }

    if (loginForm.length) {
        loginForm.on("submit", function () {
            if (!submitButton.length) return;

            const defaultText = submitButton.data("default-text") || submitButton.html();
            submitButton.data("default-text", defaultText);
            submitButton.prop("disabled", true).addClass("is-loading");
            submitButton.html('<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span><span>Giriş yapılıyor</span>');
        });
    }
});

function getLoginCsrfToken() {
    const meta = document.querySelector('meta[name="csrf-token"]');
    const fromMeta = meta && meta.getAttribute("content");
    if (fromMeta) return fromMeta;
    const hidden = document.querySelector(".login-form input[name='_csrf']");
    return hidden && hidden.value ? hidden.value : "";
}

// iOS AutoFill gizli _csrf alanını düşürebilir; submit capture ile token'ı geri yazar.
document.addEventListener("submit", function (event) {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;

    const action = (form.getAttribute("action") || "").split("?")[0];
    const isLoginForm = form.classList.contains("login-form") || action === "/login";
    if (!isLoginForm || String(form.method || "get").toLowerCase() !== "post") return;

    const token = getLoginCsrfToken();
    if (!token) return;

    let input = form.querySelector('input[name="_csrf"]');
    if (!input) {
        input = document.createElement("input");
        input.type = "hidden";
        input.name = "_csrf";
        form.appendChild(input);
    }
    input.value = token;
}, true);
