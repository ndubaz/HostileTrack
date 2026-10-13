#!/usr/bin/env python3
"""Inline src/ into a single dist/index.html that plays from any static host."""
import pathlib

root = pathlib.Path(__file__).resolve().parent.parent
src = root / 'src'
html = (src / 'index.html').read_text()
for tag, f in [('/*@@CSS@@*/', 'style.css'), ('/*@@GEO@@*/', 'geo.js'), ('/*@@DATA@@*/', 'data.js'), ('/*@@SIM@@*/', 'sim.js'), ('/*@@TRAIN@@*/', 'training.js'), ('/*@@UI@@*/', 'ui.js')]:
    body = (src / f).read_text()
    if f.endswith('.js'):
        body = body.replace('</script', '<\\/script')
    html = html.replace(tag, body)
out = root / 'dist'
out.mkdir(exist_ok=True)
(out / 'index.html').write_text(html)
(out / 'artifact.html').write_text(html.replace('<link rel="manifest" href="manifest.webmanifest">\n', ''))
print('built', len(html) // 1024, 'KB')
