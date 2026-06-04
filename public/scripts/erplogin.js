$(function () {
    const passwordInput = $("#passwordInput");
    const toggleButton = $(".password-toggle");
    const loginForm = $(".login-form");
    const submitButton = $(".login-submit");

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
