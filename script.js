window.addEventListener("DOMContentLoaded", () => {
  renderMathInElement(document.getElementById("method"), {
    delimiters: [
      { left: "$$", right: "$$", display: true },
      { left: "\\(", right: "\\)", display: false },
    ],
  });

  const button = document.getElementById("copy-bibtex");
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(document.getElementById("bibtex-entry").textContent);
      button.textContent = "Copied";
    } catch {
      button.textContent = "Copy failed";
    }
    setTimeout(() => {
      button.textContent = "Copy";
    }, 1500);
  });
});
