#!/usr/bin/env python3
"""Build public/index.html from src/: splice the scoring engine into the app and wrap it in a full HTML document."""
from pathlib import Path
root = Path(__file__).parent
app = (root / "src/app.template.html").read_text()
engine = (root / "src/engine.js").read_text()
body = app.replace("/*ENGINE*/", engine).replace("Murmur Sentiment Reader", "Sentimeter").replace("Murmur", "Sentimeter")
head = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="Sentimeter: sentiment analysis and social listening reports for social media and digital platforms.">
<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style>
</head>
<body>
"""
# Custom Report Builder: separate script and stylesheet, loaded on first use.
import hashlib
rb_parts = ["core", "data", "charts", "widgets", "templates", "editor", "panels", "export", "list"]
rb_js = "(()=>{\n\"use strict\";\n" + "\n".join((root / f"src/rb/{p}.js").read_text() for p in rb_parts) + "\n})();\n"
rb_css = (root / "src/rb/rb.css").read_text()
rbv = hashlib.sha256((rb_js + rb_css).encode()).hexdigest()[:10]
(root / "public/rb.js").write_text(rb_js)
(root / "public/rb.css").write_text(rb_css)
body = body.replace("__RBV__", rbv)
out = root / "public/index.html"
out.parent.mkdir(exist_ok=True)
out.write_text(head + body + "\n</body>\n</html>\n")
print("wrote", out, out.stat().st_size, "bytes")
