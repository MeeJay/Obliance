# Mockup artboard format (.dc.html) — rules for builder agents

Each artboard is ONE self-contained file `project/<Name>.dc.html` (name: letters/digits/_ then letters/digits/_ . - ; no spaces; unique stems). Skeleton (keep the head line EXACTLY):

```html
<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>Parc — téléphone</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Rajdhani:wght@600;700&family=JetBrains+Mono:wght@400;600&display=swap');
body{margin:0;font-family:Inter,system-ui,sans-serif;background:#0b0d1a;color:#e8ecf5}
a{color:#ff6868;text-decoration:none}a:hover{color:#ff8a8a}
</style>
</helmet>
<div style="width: 390px; height: 844px; box-sizing: border-box; display: flex; flex-direction: column; background: #0b0d1a; overflow: hidden">
  ... screen markup ...
</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{"$preview":{"width":390,"height":844}}'>
class Component extends DCLogic {
  renderVals() { return {}; }
}
</script>
</body>
</html>
```

(Use a Google Fonts `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?...">` inside `<helmet>` instead of @import if you prefer; only Google Fonts css2 is allowed as network.)

## Rules that fail silently if broken
- Keep `<script src="./support.js"></script>` exactly; close every non-void element; quote every attribute.
- The root element has a FIXED size equal to the artboard size (phone 390×844, tablet landscape 1280×800, tablet portrait 800×1280) and the same `$preview`.
- Put visual styles INLINE (`style="…"`); `<helmet><style>` only for body basics, fonts, `a`/`a:hover` colors (and optional keyframes). No external CSS files.
- Lay out with flex or grid + gap. Grid: `display: grid; grid-template-columns: repeat(N, minmax(0, 1fr))`.
- `{{hole}}` = dotted lookup into renderVals() only, never an expression. Prefer literal markup for copy.
- ALWAYS include the `<script type="text/x-dc" data-dc-script>` block with `class Component extends DCLogic` (classic JS, no imports).
- All UI is markup — never build DOM from script (no innerHTML/appendChild).
- Repeats: `<sc-for list="{{items}}" as="item" hint-placeholder-count="3">…{{item.name}}…</sc-for>`; branches: `<sc-if value="{{flag}}" hint-placeholder-val="{{ true }}">…</sc-if>`. Events: `onClick="{{ handler }}"` where handler comes from renderVals(); state via this.state / this.setState.
- Links between artboards (clickable prototype): `<a href="Fleet.dc.html">…</a>` — style the `<a>` itself as the button/row (a `<button>` inside an `<a>` swallows the click).
- Icons: inline stroke SVG (use lucide icon paths — D:\Obliance\node_modules\lucide-react\dist\esm\icons\<name>.js contains the SVG node data; 24 viewBox, stroke-width 2, stroke="currentColor", fill="none"). Never emoji.
- No `<iframe>`, `<object>`, `<embed>`, no global keydown handlers, no fake OS status bar or fake Android navigation bar.
- Accessible markup: real `<button>`, `<a href>`, `<input>` + `<label>`; `aria-label` on icon-only buttons. Text contrast ≥ 4.5:1 (3:1 for ≥ 24px).
- Touch targets ≥ 44px (48dp in Android terms).
- Do not invent statistics as facts: use the realistic sample data given in the design doc (device names, counts) consistently across artboards.
- Rationale/notes go in your report, never inside an artboard.
