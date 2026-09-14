"""Render the checked-in checklist artwork without a Node native-addon dependency."""
from pathlib import Path
import cairosvg

root=Path(__file__).resolve().parent.parent
res=root/'android/capacitor/android/app/src/main/res'
source=(root/'public/icon.svg').read_bytes()
for n in (192,512):
    cairosvg.svg2png(bytestring=source,write_to=str(root/f'public/icon-{n}.png'),output_width=n,output_height=n)
for density,n,foreground in [('mdpi',48,108),('hdpi',72,162),('xhdpi',96,216),('xxhdpi',144,324),('xxxhdpi',192,432)]:
    folder=res/f'mipmap-{density}'; folder.mkdir(parents=True,exist_ok=True)
    for name in ('ic_launcher','ic_launcher_round'):
        cairosvg.svg2png(bytestring=source,write_to=str(folder/f'{name}.png'),output_width=n,output_height=n)
    cairosvg.svg2png(bytestring=source,write_to=str(folder/'ic_launcher_foreground.png'),output_width=foreground,output_height=foreground)
values=res/'values'; values.mkdir(exist_ok=True,parents=True)
(values/'icon_background.xml').write_text('<resources><color name="chores_icon_background">#087f83</color></resources>')
adaptive=res/'mipmap-anydpi-v26'; adaptive.mkdir(exist_ok=True,parents=True)
for name in ('ic_launcher','ic_launcher_round'):
    (adaptive/f'{name}.xml').write_text('<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android"><background android:drawable="@color/chores_icon_background"/><foreground android:drawable="@mipmap/ic_launcher_foreground"/></adaptive-icon>')
# Keep the splash artwork consistent with the launcher (no stock Capacitor logo).
for folder in res.glob('drawable*'):
    splash=folder/'splash.png'
    if splash.exists():
        cairosvg.svg2png(bytestring=source,write_to=str(splash),output_width=512,output_height=512)
print('Rendered Chores checklist web, launcher, adaptive and splash icons.')
