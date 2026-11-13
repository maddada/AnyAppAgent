# Kept as the existing regeneration entry point. The approved outlined lettering
# and icon are source assets, so this must never redraw the old placeholder.
from pathlib import Path
import runpy
runpy.run_path(str(Path(__file__).with_name('sync-brand.py')), run_name='__main__')
