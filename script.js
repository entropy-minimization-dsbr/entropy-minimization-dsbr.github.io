window.addEventListener("DOMContentLoaded", () => {
  // Equations. KaTeX loads from a CDN; if it is slow or blocked, the rest of the page still works.
  if (window.renderMathInElement) {
    renderMathInElement(document.getElementById("method"), {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "\\(", right: "\\)", display: false },
      ],
    });
  }

  function copyOnClick(button, getText) {
    const label = button.querySelector("span") || button;
    const original = label.textContent;
    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(getText());
        label.textContent = "Copied";
      } catch {
        label.textContent = "Copy failed";
      }
      setTimeout(() => {
        label.textContent = original;
      }, 1500);
    });
  }

  // Code viewer: Changes, Before (EM) and After (DSBR) tabs.
  const view = document.getElementById("code-view");
  if (view) {
    const tabs = [...document.querySelectorAll(".codebox-tabs [role=tab]")];
    const meta = document.getElementById("code-meta");
    const metaHtml = meta.innerHTML;
    const select = (tab, focus) => {
      tabs.forEach((t) => {
        const on = t === tab;
        t.setAttribute("aria-selected", on);
        t.tabIndex = on ? 0 : -1;
      });
      view.dataset.view = tab.dataset.view;
      view.setAttribute("aria-labelledby", tab.id);
      if (tab.dataset.view === "changes") meta.innerHTML = metaHtml;
      else meta.textContent = tab.dataset.view === "before" ? "Entropy minimization (EM)" : "EM with the DSBR edits";
      if (focus) tab.focus();
    };
    tabs.forEach((tab, i) => {
      tab.addEventListener("click", () => select(tab));
      tab.addEventListener("keydown", (e) => {
        const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
        if (!step) return;
        e.preventDefault();
        select(tabs[(i + step + tabs.length) % tabs.length], true);
      });
    });
    copyOnClick(document.getElementById("copy-code"), () =>
      document.getElementById(view.dataset.view === "before" ? "code-before" : "code-after").textContent);
  }

  const bib = document.getElementById("copy-bibtex");
  if (bib) copyOnClick(bib, () => document.getElementById("bibtex-entry").textContent);
});
