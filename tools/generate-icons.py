"""Render Chores web and Android launcher artwork without native Node addons."""
from pathlib import Path
import cairosvg

root = Path(__file__).resolve().parent.parent
res = root / "android/capacitor/android/app/src/main/res"
source = (root / "public/icon.svg").read_bytes()

# Website/PWA artwork remains the complete icon.
for n in (192, 512):
    cairosvg.svg2png(
        bytestring=source,
        write_to=str(root / f"public/icon-{n}.png"),
        output_width=n,
        output_height=n,
    )

# Android adaptive icon: the teal field is the adaptive background layer and the
# checklist itself is the foreground. Keeping these separate lets Pixel Launcher
# crop/mask it correctly and avoids caching the old generic ic_launcher resource.
foreground_svg = b'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect x="120" y="96" width="272" height="320" rx="44" fill="#faf9f6"/>
  <g fill="none" stroke-linecap="round" stroke-linejoin="round">
    <rect x="158" y="150" width="56" height="56" rx="14" fill="#087f83"/>
    <path d="m173 178 10 10 18-22" stroke="#faf9f6" stroke-width="12"/>
    <g stroke="#263f4c" stroke-width="13">
      <rect x="164" y="243" width="44" height="44" rx="9"/>
      <rect x="164" y="329" width="44" height="44" rx="9"/>
      <path d="M247 178h101M247 265h101M247 351h76"/>
    </g>
  </g>
</svg>'''
monochrome_svg = b'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <g fill="none" stroke="#fff" stroke-width="28" stroke-linecap="round" stroke-linejoin="round">
    <rect x="132" y="116" width="248" height="280" rx="38"/>
    <path d="m169 184 20 20 38-48M250 183h82M169 264h42M250 264h82M169 340h42M250 340h60"/>
  </g>
</svg>'''

for density, legacy, adaptive in [
    ("mdpi", 48, 108),
    ("hdpi", 72, 162),
    ("xhdpi", 96, 216),
    ("xxhdpi", 144, 324),
    ("xxxhdpi", 192, 432),
]:
    folder = res / f"mipmap-{density}"
    folder.mkdir(parents=True, exist_ok=True)
    # Pre-Android-8 launchers use the complete icon.
    for name in ("chores_launcher", "chores_launcher_round"):
        cairosvg.svg2png(
            bytestring=source,
            write_to=str(folder / f"{name}.png"),
            output_width=legacy,
            output_height=legacy,
        )
    # Adaptive foreground uses a larger transparent canvas and is masked by Android.
    cairosvg.svg2png(
        bytestring=foreground_svg,
        write_to=str(folder / "chores_launcher_foreground.png"),
        output_width=adaptive,
        output_height=adaptive,
    )
    cairosvg.svg2png(
        bytestring=monochrome_svg,
        write_to=str(folder / "chores_launcher_monochrome.png"),
        output_width=adaptive,
        output_height=adaptive,
    )

values = res / "values"
values.mkdir(exist_ok=True, parents=True)
(values / "chores_launcher_background.xml").write_text(
    '<resources><color name="chores_launcher_background">#087f83</color></resources>\n'
)

adaptive26 = res / "mipmap-anydpi-v26"
adaptive26.mkdir(exist_ok=True, parents=True)
xml26 = '''<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
  <background android:drawable="@color/chores_launcher_background"/>
  <foreground android:drawable="@mipmap/chores_launcher_foreground"/>
</adaptive-icon>\n'''
for name in ("chores_launcher", "chores_launcher_round"):
    (adaptive26 / f"{name}.xml").write_text(xml26)

# Android 13+ themed icons use a dedicated monochrome layer.
adaptive33 = res / "mipmap-anydpi-v33"
adaptive33.mkdir(exist_ok=True, parents=True)
xml33 = '''<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
  <background android:drawable="@color/chores_launcher_background"/>
  <foreground android:drawable="@mipmap/chores_launcher_foreground"/>
  <monochrome android:drawable="@mipmap/chores_launcher_monochrome"/>
</adaptive-icon>\n'''
for name in ("chores_launcher", "chores_launcher_round"):
    (adaptive33 / f"{name}.xml").write_text(xml33)

# Keep splash artwork consistent with the launcher.
for folder in res.glob("drawable*"):
    splash = folder / "splash.png"
    if splash.exists():
        cairosvg.svg2png(bytestring=source, write_to=str(splash), output_width=512, output_height=512)

print("Rendered dedicated Chores launcher, adaptive, monochrome, web and splash icons.")
