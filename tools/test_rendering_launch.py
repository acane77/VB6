"""Regression tests for the shared software-GPU browser profile."""
import unittest

from rendering_launch import SOFTWARE_GPU_FLAGS, rendering_launch_flags


class RenderingLaunchTests(unittest.TestCase):
    def test_default_profile_is_minimal(self):
        self.assertEqual(rendering_launch_flags(environ={}), ['--no-sandbox'])

    def test_software_profile_is_complete_and_stable(self):
        flags = rendering_launch_flags(software_gpu=True, environ={})
        self.assertEqual(flags, ['--no-sandbox', *SOFTWARE_GPU_FLAGS])
        for required in ('--enable-unsafe-webgpu', '--enable-unsafe-swiftshader',
                         '--use-angle=swiftshader', '--use-vulkan=swiftshader'):
            self.assertIn(required, flags)

    def test_workflow_flags_are_shell_parsed_once(self):
        flags = rendering_launch_flags(
            software_gpu=True,
            environ={'RENDERING_BROWSER_FLAGS': '--enable-gpu "--feature=Vulkan SwiftShader"'},
            base=('--no-sandbox', '--disable-dev-shm-usage'))
        self.assertEqual(flags[-2:], ['--enable-gpu', '--feature=Vulkan SwiftShader'])
        self.assertEqual(flags[:2], ['--no-sandbox', '--disable-dev-shm-usage'])

    def test_invalid_flags_fail_closed(self):
        with self.assertRaises(ValueError):
            rendering_launch_flags(environ={'RENDERING_BROWSER_FLAGS': '""'})


if __name__ == '__main__':
    unittest.main()
