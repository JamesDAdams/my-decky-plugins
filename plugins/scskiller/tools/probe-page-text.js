(() => {
  const text = String(document.body.innerText || "").replace(/\s+/g, " ").trim();
  const index = Math.max(0, text.indexOf("Finished") - 300);
  return JSON.stringify(
    {
      length: text.length,
      around: text.slice(index, index + 700),
      hasTabs: /Compiles|Running|Finished|Settings/.test(text),
      buttons: [...document.querySelectorAll("[role='button'], button")].slice(0, 8).map((el) => String(el.textContent || "").trim().slice(0, 20)),
    },
    null,
    1,
  );
})()
