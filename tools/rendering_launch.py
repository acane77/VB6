"""One software-GPU launch profile shared by rendering acceptance runners."""
from __future__ import annotations

import os
import shlex
from collections.abc import Mapping, Sequence

SOFTWARE_GPU_FLAGS = (
    '--enable-unsafe-webgpu',
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader',
    '--use-vulkan=swiftshader',
    '--disable-partial-raster',
    '--run-all-compositor-stages-before-draw',
)


def rendering_launch_flags(*, software_gpu: bool = False,
                           environ: Mapping[str, str] | None = None,
                           base: Sequence[str] = ('--no-sandbox',)) -> list[str]:
    """Return the exact audited browser flags for a rendering test process."""
    environment = os.environ if environ is None else environ
    flags = [*base]
    if software_gpu:
        flags.extend(SOFTWARE_GPU_FLAGS)
    flags.extend(shlex.split(environment.get('RENDERING_BROWSER_FLAGS', '')))
    if any(not isinstance(flag, str) or not flag or '\x00' in flag for flag in flags):
        raise ValueError('Invalid rendering browser flag')
    return flags
